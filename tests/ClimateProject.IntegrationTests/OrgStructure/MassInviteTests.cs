using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Email;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace ClimateProject.IntegrationTests.OrgStructure;

/// <summary>
/// Mass invite (ruled 2026-10-13): the roster import creates each person's account with a
/// generated username and password, emails both, and the person signs in with them and is
/// never asked their demographics. Every password here is read from the captured email,
/// because that is the only place the product ever puts one.
/// </summary>
[Collection("Postgres")]
public class MassInviteTests(PostgresContainerFixture postgres) : IAsyncLifetime
{
    private readonly string _companyDomain = $"massinvite-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _otherCompanyId;
    private Guid _areaFieldId;
    private CapturingFactory _factory = null!;

    public async Task InitializeAsync()
    {
        _factory = new CapturingFactory(postgres.ConnectionString);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Empresa de Servicios Públicos",
            EmailDomain = _companyDomain,
            CreatedAt = DateTimeOffset.UtcNow,
            Settings = new CompanySettings { Language = "es" },
        };
        var other = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Other Co",
            EmailDomain = $"massinvite-other-{Guid.NewGuid():N}.test",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.AddRange(company, other);
        _companyId = company.Id;
        _otherCompanyId = other.Id;

        var now = DateTimeOffset.UtcNow;
        var field = new DemographicField { Id = Guid.NewGuid(), CompanyId = _companyId, Field = "sede", LabelEs = "Sede", Type = "select", Order = 1, CreatedAt = now, UpdatedAt = now };
        db.DemographicFields.Add(field);
        db.DemographicFieldOptions.AddRange(
            new DemographicFieldOption { DemographicFieldId = field.Id, Order = 1, Value = "heredia", LabelEs = "Heredia" },
            new DemographicFieldOption { DemographicFieldId = field.Id, Order = 2, Value = "belen", LabelEs = "Belén" });
        _areaFieldId = field.Id;

        await db.SaveChangesAsync();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<HttpClient> AdminClientAsync(Guid companyId)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Mass Admin", email, "A-good-passw0rd"));
        Assert.True(signup.IsSuccessStatusCode, $"signup returned {signup.StatusCode}");

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private Task<HttpResponseMessage> ImportAsync(HttpClient client, bool preview, params BulkImportRowInput[] rows)
        => client.PostAsJsonAsync("/admin/users/bulk-import/rows", new BulkImportRowsRequest(
            _companyId, preview, rows, WithCredentials: true));

    private static async Task<HttpStatusCode> LoginStatusAsync(HttpClient client, string identifier, string password)
        => (await client.PostAsJsonAsync("/auth/login", new LoginRequest(identifier, password))).StatusCode;

    [Fact]
    public async Task An_imported_person_gets_an_account_with_their_demographics_and_signs_in_with_the_emailed_username()
    {
        var client = await AdminClientAsync(_companyId);
        var email = $"ana-{Guid.NewGuid():N}@example.com";

        var response = await ImportAsync(client, preview: false,
            new BulkImportRowInput(3, "Ana Rojas", email, "Colaborador", null, new() { ["sede"] = "heredia" }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        var result = System.Text.Json.JsonSerializer.Deserialize<BulkImportResponse>(body, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))!;
        Assert.Equal("created", Assert.Single(result.Rows).Status);
        Assert.Empty(result.Rows[0].Issues);

        var sent = Assert.Single(_factory.Sent, s => s.ToEmail == email);
        Assert.Matches("^empresad-[23456789abcdefghjkmnpqrstuvwxyz]{8}$", sent.Username);
        Assert.Matches("^[A-HJ-NP-Za-hjkmnp-z2-9]{10}$", sent.Password);
        Assert.Equal("es", sent.Language);
        // The API never hands the password to the administrator: the email is its only copy.
        Assert.DoesNotContain(sent.Password, body, StringComparison.Ordinal);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.SingleAsync(u => u.Email == email);
            Assert.Equal(sent.Username, user.Username);
            Assert.Equal("Ana Rojas", user.Name);
            Assert.Equal(_companyId, user.CompanyId);
            Assert.Equal(Roles.Employee, user.Role);
            Assert.NotEqual(sent.Password, user.PasswordHash);
            var demographic = await db.UserDemographics.SingleAsync(d => d.UserId == user.Id);
            Assert.Equal(_areaFieldId, demographic.DemographicFieldId);
            Assert.Equal("heredia", demographic.Value);
            Assert.False(await db.UserInvitations.AnyAsync(i => i.Email == email));
        }

        var anonymous = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, await LoginStatusAsync(anonymous, sent.Username, sent.Password));
        // Typed from a phone, with a capital and a trailing space: still the same person.
        Assert.Equal(HttpStatusCode.OK, await LoginStatusAsync(anonymous, " " + sent.Username.ToUpperInvariant() + " ", sent.Password));
        Assert.Equal(HttpStatusCode.Unauthorized, await LoginStatusAsync(anonymous, sent.Username, sent.Password + "x"));
    }

    [Fact]
    public async Task A_preview_creates_no_account_and_sends_nothing()
    {
        var client = await AdminClientAsync(_companyId);
        var email = $"preview-{Guid.NewGuid():N}@example.com";

        var response = await ImportAsync(client, preview: true, new BulkImportRowInput(2, "Preview Person", email, "Colaborador", null));

        Assert.Equal("valid", Assert.Single((await response.Content.ReadFromJsonAsync<BulkImportResponse>())!.Rows).Status);
        Assert.DoesNotContain(_factory.Sent, s => s.ToEmail == email);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.Users.AnyAsync(u => u.Email == email));
    }

    [Fact]
    public async Task A_failed_email_is_named_on_its_row_and_the_account_still_exists()
    {
        var client = await AdminClientAsync(_companyId);
        var email = $"bounce-{Guid.NewGuid():N}@example.com";
        _factory.FailFor.Add(email);

        var response = await ImportAsync(client, preview: false, new BulkImportRowInput(2, "Bounce Person", email, "Colaborador", null));

        var row = Assert.Single((await response.Content.ReadFromJsonAsync<BulkImportResponse>())!.Rows);
        Assert.Equal("created", row.Status);
        Assert.Contains(row.Issues, i => i.Code == "credentials_not_sent");
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.True(await db.Users.AnyAsync(u => u.Email == email && u.Username != null));
    }

    [Fact]
    public async Task Without_the_flag_the_import_still_sends_invitations_and_creates_no_account()
    {
        var client = await AdminClientAsync(_companyId);
        var email = $"invite-{Guid.NewGuid():N}@example.com";

        var response = await client.PostAsJsonAsync("/admin/users/bulk-import/rows", new BulkImportRowsRequest(
            _companyId, false, [new BulkImportRowInput(2, "Invited Person", email, "Colaborador", null)]));

        Assert.Equal("invited", Assert.Single((await response.Content.ReadFromJsonAsync<BulkImportResponse>())!.Rows).Status);
        Assert.DoesNotContain(_factory.Sent, s => s.ToEmail == email);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.Users.AnyAsync(u => u.Email == email));
    }

    [Fact]
    public async Task Resend_replaces_the_password_keeps_the_username_and_never_returns_the_password()
    {
        var client = await AdminClientAsync(_companyId);
        var email = $"resend-{Guid.NewGuid():N}@example.com";
        await ImportAsync(client, preview: false, new BulkImportRowInput(2, "Resend Person", email, "Colaborador", null));
        var first = Assert.Single(_factory.Sent, s => s.ToEmail == email);
        Guid userId;
        using (var scope = _factory.Services.CreateScope())
        {
            userId = await scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>().Users
                .Where(u => u.Email == email).Select(u => u.Id).SingleAsync();
        }

        var resend = await client.PostAsync($"/admin/users/{userId}/credentials", null);

        Assert.Equal(HttpStatusCode.OK, resend.StatusCode);
        var body = await resend.Content.ReadAsStringAsync();
        Assert.Contains("\"delivered\":true", body, StringComparison.Ordinal);
        var second = _factory.Sent.Where(s => s.ToEmail == email).Last();
        Assert.NotSame(first, second);
        Assert.Equal(first.Username, second.Username);
        Assert.NotEqual(first.Password, second.Password);
        Assert.DoesNotContain(second.Password, body, StringComparison.Ordinal);

        var anonymous = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, await LoginStatusAsync(anonymous, first.Username, first.Password));
        Assert.Equal(HttpStatusCode.OK, await LoginStatusAsync(anonymous, second.Username, second.Password));
    }

    [Fact]
    public async Task Resend_refuses_an_account_that_signs_in_by_email()
    {
        var client = await AdminClientAsync(_companyId);
        Guid adminId;
        using (var scope = _factory.Services.CreateScope())
        {
            adminId = await scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>().Users
                .Where(u => u.CompanyId == _companyId && u.Role == Roles.CompanyAdmin).Select(u => u.Id).FirstAsync();
        }

        var response = await client.PostAsync($"/admin/users/{adminId}/credentials", null);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Another_companys_admin_cannot_resend_and_learns_nothing()
    {
        var owner = await AdminClientAsync(_companyId);
        var email = $"tenant-{Guid.NewGuid():N}@example.com";
        await ImportAsync(owner, preview: false, new BulkImportRowInput(2, "Tenant Person", email, "Colaborador", null));
        Guid userId;
        using (var scope = _factory.Services.CreateScope())
        {
            userId = await scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>().Users
                .Where(u => u.Email == email).Select(u => u.Id).SingleAsync();
        }

        var stranger = await AdminClientAsync(_otherCompanyId);
        var sentBefore = _factory.Sent.Count(s => s.ToEmail == email);

        var response = await stranger.PostAsync($"/admin/users/{userId}/credentials", null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(sentBefore, _factory.Sent.Count(s => s.ToEmail == email));
    }

    [Fact]
    public async Task The_user_list_shows_which_accounts_have_a_generated_username()
    {
        var client = await AdminClientAsync(_companyId);
        var email = $"listed-{Guid.NewGuid():N}@example.com";
        await ImportAsync(client, preview: false, new BulkImportRowInput(2, "Listed Person", email, "Colaborador", null));

        var list = await client.GetFromJsonAsync<UserListResponse>($"/admin/users?companyId={_companyId}");

        var listed = Assert.Single(list!.Users, u => u.Email == email);
        Assert.Equal(Assert.Single(_factory.Sent, s => s.ToEmail == email).Username, listed.Username);
        Assert.All(list.Users.Where(u => u.Email != email && !u.Email.StartsWith("ana-") && !u.Email.StartsWith("resend-")
                                         && !u.Email.StartsWith("bounce-") && !u.Email.StartsWith("tenant-")),
            u => Assert.Null(u.Username));
    }

    internal sealed record SentCredentials(string ToEmail, string Username, string Password, string? Language);

    private sealed class CapturingSender(CapturingFactory owner) : ICredentialsEmailSender
    {
        public Task<EmailSendOutcome> SendAsync(
            string toEmail, string username, string password, string? companyLanguage, CancellationToken cancellationToken)
        {
            if (owner.FailFor.Contains(toEmail))
            {
                return Task.FromResult(EmailSendOutcome.PermanentFailure("refused for the test"));
            }

            owner.Sent.Enqueue(new SentCredentials(toEmail, username, password, companyLanguage));
            return Task.FromResult(EmailSendOutcome.Success());
        }
    }

    private sealed class CapturingFactory(string connectionString) : AuthWebApplicationFactory(connectionString)
    {
        public ConcurrentQueue<SentCredentials> Sent { get; } = new();
        public ConcurrentBag<string> FailFor { get; } = [];

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<ICredentialsEmailSender>();
                services.AddScoped<ICredentialsEmailSender>(_ => new CapturingSender(this));
            });
        }
    }
}
