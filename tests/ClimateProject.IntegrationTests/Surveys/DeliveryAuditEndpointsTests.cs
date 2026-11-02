using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// <c>GET /admin/companies/{companyId}/delivery-audit</c>, against four people whose stories are the
/// four the file has to tell apart: bounced and stuck, bounced but got in anyway, bounced at an
/// address they no longer hold a code for, and no signal at all.
/// </summary>
[Collection("Postgres")]
public class DeliveryAuditEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _domain = $"delaudit-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public DeliveryAuditEndpointsTests(PostgresContainerFixture postgres) => _factory = postgres.App;

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;
        var company = new Company
        {
            Id = Guid.NewGuid(), Name = "Audit Co", EmailDomain = _domain, CreatedAt = now,
            Settings = new CompanySettings { Language = "es" },
        };
        db.Companies.Add(company);
        _companyId = company.Id;

        var survey = new Survey
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, CreatedBy = Guid.Empty, TitleEs = "Clima con claves", Language = "es",
            Type = "periodic", Status = "active", StartDate = now.AddDays(-5), EndDate = now.AddDays(5), CreatedAt = now, UpdatedAt = now,
        };
        survey.Settings.CredentialMode = CredentialModes.PerSurvey;
        db.Surveys.Add(survey);

        var codeSent = now.AddDays(-3);
        // (name, signed in?, bounce relative to the code, or null for none)
        (string Name, bool SignedIn, double? BounceDays)[] people =
        [
            ("Ana Stuck", false, +1),
            ("Beto GotIn", true, +1),
            ("Caro Earlier", false, -2),
            ("Dani Silent", false, null),
        ];
        foreach (var (name, signedIn, bounceDays) in people)
        {
            var user = new User
            {
                Id = Guid.NewGuid(), Name = name, Email = $"{name.Split(' ')[0].ToLowerInvariant()}-{Guid.NewGuid():N}@{_domain}",
                PasswordHash = "x", Role = Roles.Employee, CompanyId = company.Id, IsActive = true, CreatedAt = now, UpdatedAt = now,
            };
            db.Users.Add(user);
            survey.CreatedBy = user.Id;
            db.SurveyCredentials.Add(new SurveyCredential
            {
                SurveyId = survey.Id, UserId = user.Id, Username = $"t-{Guid.NewGuid():N}"[..20], PasswordHash = "x",
                CreatedAt = codeSent, LastSignInAt = signedIn ? now : null,
            });
            if (bounceDays is { } days)
            {
                db.EmailDeliveryEvents.Add(new EmailDeliveryEvent
                {
                    Id = Guid.NewGuid(), UserId = user.Id, Email = user.Email, EventType = "bounce", BounceType = "Permanent",
                    Diagnostic = "550 5.1.1 user unknown", OccurredAt = codeSent.AddDays(days), SnsMessageId = Guid.NewGuid().ToString(),
                    ReceivedAt = now,
                });
            }
        }

        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<HttpClient> ClientAsync(string role)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_domain}";
        Assert.True((await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Admin", email, "A-good-passw0rd"))).IsSuccessStatusCode);
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.CompanyId = role == Roles.SuperAdmin ? null : _companyId;
            await db.SaveChangesAsync();
        }

        var token = (await (await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd")))
            .Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [Fact]
    public async Task A_company_administrator_cannot_read_it()
    {
        using var client = await ClientAsync(Roles.CompanyAdmin);

        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync($"/admin/companies/{_companyId}/delivery-audit")).StatusCode);
    }

    [Fact]
    public async Task It_tells_stuck_from_got_in_from_stale_from_silent()
    {
        using var client = await ClientAsync(Roles.SuperAdmin);

        var response = await client.GetAsync($"/admin/companies/{_companyId}/delivery-audit");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var book = new XLWorkbook(new MemoryStream(await response.Content.ReadAsByteArrayAsync()));

        var summary = book.Worksheet("Resumen");
        Assert.Equal("Clima con claves", summary.Cell(7, 1).GetString());
        Assert.Equal(4, summary.Cell(7, 2).GetValue<int>());   // codes sent
        Assert.Equal(1, summary.Cell(7, 3).GetValue<int>());   // Beto signed in
        Assert.Equal(1, summary.Cell(7, 4).GetValue<int>());   // Ana: bounced after her code, never in
        Assert.Equal(2, summary.Cell(7, 5).GetValue<int>());   // Caro and Dani: no signal

        var listed = book.Worksheet("No entregados").RowsUsed().Skip(1)
            .Select(r => (Name: r.Cell(1).GetString(), In: r.Cell(8).GetString())).ToList();
        Assert.Equal([("Ana Stuck", "No"), ("Beto GotIn", "Sí")], listed);
    }
}
