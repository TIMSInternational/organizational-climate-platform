using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Reports;

[Collection("Postgres")]
public class ReportEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"rep-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public ReportEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Report Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = _companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    [Fact]
    public async Task CompanyAdmin_creates_a_report_and_it_completes_immediately()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Q3 Climate Report", "Quarterly summary", "climate_summary", _companyId, "pdf", null));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<ReportDetail>();
        Assert.Equal("completed", created!.Status);
        Assert.NotNull(created.ReportOutput);
    }

    /// <summary>
    /// req(#152): a generated report must actually render the AI insights that exist for the
    /// company. The legacy generator read <c>AIInsight</c> through a rival model shape and the
    /// section came back empty with no error, so this asserts on the insight's own prose and its
    /// 0-100 confidence surviving the whole round trip -- rows in, report output out.
    /// </summary>
    [Fact]
    public async Task A_generated_report_renders_the_companys_AI_insights_and_no_one_elses()
    {
        var otherCompanyId = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.Companies.Add(new Company
            {
                Id = otherCompanyId, Name = "Other Co", EmailDomain = $"other-{Guid.NewGuid():N}.test",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            db.AIInsights.AddRange(
                NewInsight(_companyId, "Elevated attrition risk in Engineering", confidenceScore: 87),
                NewInsight(_companyId, "Stale insight", expiresAt: DateTimeOffset.UtcNow.AddDays(-1)),
                NewInsight(otherCompanyId, "Another tenant's insight"));
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Q3 Climate Report", null, "climate_summary", _companyId, "pdf", null));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<ReportDetail>();
        var document = JsonSerializer.Deserialize<ReportOutputDocument>(created!.ReportOutput!, JsonSerializerOptions.Web);

        var item = Assert.Single(document!.AiInsights);
        Assert.Equal("Elevated attrition risk in Engineering", item.Title);
        Assert.Equal("Engagement scores trending down over the last 3 cycles", item.Description);
        Assert.Equal(87, item.ConfidenceScore);
        Assert.Equal(["Engineering", "QA"], item.AffectedSegments);
        Assert.Equal(["Schedule 1:1s", "Review workload distribution"], item.RecommendedActions);
    }

    private static AIInsight NewInsight(Guid companyId, string title, int confidenceScore = 87, DateTimeOffset? expiresAt = null)
        => new()
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Type = "risk",
            Category = "attrition",
            Title = title,
            Description = "Engagement scores trending down over the last 3 cycles",
            ConfidenceScore = confidenceScore,
            Priority = "high",
            AffectedSegments = ["Engineering", "QA"],
            RecommendedActions = ["Schedule 1:1s", "Review workload distribution"],
            ExpiresAt = expiresAt,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };

    [Fact]
    public async Task Download_increments_count_only_when_completed()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Report", null, "type", _companyId, "csv", null));
        var created = await createResponse.Content.ReadFromJsonAsync<ReportDetail>();

        var downloadResponse = await client.PostAsync($"/admin/reports/{created!.Id}/download", null);
        Assert.Equal(HttpStatusCode.OK, downloadResponse.StatusCode);
        var downloaded = await downloadResponse.Content.ReadFromJsonAsync<ReportDetail>();
        Assert.Equal(1, downloaded!.DownloadCount);
    }

    /// <summary>
    /// #285: <c>reports.created_by</c> must name the caller's own row, even when their
    /// <c>sub</c> spells another user's <c>Id</c>.
    ///
    /// <c>persona_external_id</c> is a free-form 64-character string, so nothing stops one
    /// being a Guid in canonical form -- #154's ETL is the feature that will start filling
    /// the column from legacy ids. Here the collider's <c>PersonaExternalId</c> is the
    /// victim's <c>Id</c>, which is exactly what the collider's <c>sub</c> is then minted
    /// from (<c>PersonaExternalId ?? Id</c>, AuthEndpoints).
    ///
    /// This endpoint resolved <c>Id</c> first until #285, so the report was filed against the
    /// victim -- an audit trail naming someone who did nothing.
    /// </summary>
    [Fact]
    public async Task A_guid_shaped_external_id_never_files_the_report_against_the_user_whose_id_it_matches()
    {
        var (colliderId, colliderToken) = await SeedCollisionAsync();
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", colliderToken);

        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Collision Report", null, "climate_summary", _companyId, "pdf", null));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<ReportDetail>();
        Assert.Equal(colliderId, created!.CreatedBy);
    }

    /// <summary>
    /// Two accounts, where the second one's <c>PersonaExternalId</c> is the first one's
    /// <c>Id</c>. Returns the second account's own id and a token minted after the collision
    /// exists, so its <c>sub</c> is the Guid-shaped external id rather than its own.
    /// </summary>
    private async Task<(Guid ColliderId, string Token)> SeedCollisionAsync()
    {
        var victimEmail = $"{Guid.NewGuid():N}@{_companyDomain}";
        var colliderEmail = $"{Guid.NewGuid():N}@{_companyDomain}";
        var setup = _factory.CreateClient();
        Assert.Equal(
            HttpStatusCode.Created,
            (await setup.PostAsJsonAsync("/auth/signup", new SignupRequest("Victim", victimEmail, "a-good-password"))).StatusCode);
        Assert.Equal(
            HttpStatusCode.Created,
            (await setup.PostAsJsonAsync("/auth/signup", new SignupRequest("Collider", colliderEmail, "a-good-password"))).StatusCode);

        Guid colliderId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var victim = await db.Users.FirstAsync(u => u.Email == victimEmail);
            var collider = await db.Users.FirstAsync(u => u.Email == colliderEmail);
            collider.Role = Roles.CompanyAdmin;
            collider.CompanyId = _companyId;
            collider.PersonaExternalId = victim.Id.ToString();
            await db.SaveChangesAsync();
            colliderId = collider.Id;
            Assert.NotEqual(victim.Id, collider.Id);
        }

        var login = await setup.PostAsJsonAsync("/auth/login", new LoginRequest(colliderEmail, "a-good-password"));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return (colliderId, (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token);
    }
}
