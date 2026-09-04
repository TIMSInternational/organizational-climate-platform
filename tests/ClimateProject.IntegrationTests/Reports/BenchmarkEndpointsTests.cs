using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
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
public class BenchmarkEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"bencha-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"benchb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public BenchmarkEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "Bench Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Bench Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, string emailDomain, Guid? companyId = null)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "A-good-passw0rd"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        if (companyId.HasValue)
        {
            user.CompanyId = companyId.Value;
        }
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    private static CreateBenchmarkRequest ValidCreateRequest(string name, Guid? companyId, Guid? priorPeriodBenchmarkId = null) => new(
        name, "d", "industry", "engagement", "internal", null, null, null, companyId, priorPeriodBenchmarkId);

    [Fact]
    public async Task Create_a_benchmark_with_a_prior_period_reference_and_add_a_metric()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var priorResponse = await client.PostAsJsonAsync("/admin/benchmarks", ValidCreateRequest("2025 Engagement", null));
        var prior = await priorResponse.Content.ReadFromJsonAsync<BenchmarkDetail>();

        var response = await client.PostAsJsonAsync("/admin/benchmarks", ValidCreateRequest("2026 Engagement", null, prior!.Id));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<BenchmarkDetail>();
        Assert.Equal(prior.Id, created!.PriorPeriodBenchmarkId);

        var metricResponse = await client.PostAsJsonAsync($"/admin/benchmarks/{created.Id}/metrics", new AddBenchmarkMetricRequest(
            "engagement_score", 78.5, "percent", 65.0, 500));
        Assert.Equal(HttpStatusCode.Created, metricResponse.StatusCode);
        var withMetric = await metricResponse.Content.ReadFromJsonAsync<BenchmarkDetail>();
        Assert.Single(withMetric!.Metrics);
    }

    [Fact]
    public async Task Create_rejects_an_unknown_PriorPeriodBenchmarkId()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/benchmarks", ValidCreateRequest("X", null, Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("", "d", "t", "c", "s")]
    [InlineData("   ", "d", "t", "c", "s")]
    [InlineData("n", "d", "  ", "c", "s")]
    [InlineData("n", "d", "t", "", "s")]
    [InlineData("n", "d", "t", "c", "")]
    public async Task Create_rejects_blank_required_fields(string name, string description, string type, string category, string source)
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/benchmarks", new CreateBenchmarkRequest(
            name, description, type, category, source, null, null, null, null, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_can_create_read_and_update_a_benchmark_scoped_to_their_own_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/benchmarks", ValidCreateRequest("Company A Benchmark", _companyAId));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<BenchmarkDetail>();
        Assert.Equal(_companyAId, created!.CompanyId);

        var getResponse = await client.GetAsync($"/admin/benchmarks/{created.Id}");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);

        var listResponse = await client.GetAsync("/admin/benchmarks");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        var list = await listResponse.Content.ReadFromJsonAsync<List<BenchmarkListItem>>();
        Assert.Contains(list!, b => b.Id == created.Id);

        var updateResponse = await client.PutAsJsonAsync($"/admin/benchmarks/{created.Id}", new UpdateBenchmarkRequest(
            "Updated Name", "Updated description", "updated-industry", null, null));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<BenchmarkDetail>();
        Assert.Equal("Updated Name", updated!.Name);
        Assert.Equal("Updated description", updated.Description);
        Assert.Equal("updated-industry", updated.Industry);
        // Immutable fields must survive the PUT unchanged (UpdateBenchmarkRequest no longer carries them).
        Assert.Equal("industry", updated.Type);
        Assert.Equal("engagement", updated.Category);
        Assert.Equal("internal", updated.Source);
        Assert.Equal(_companyAId, updated.CompanyId);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_create_a_global_benchmark()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/benchmarks", ValidCreateRequest("Sneaky Global", null));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_create_a_benchmark_for_another_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/benchmarks", ValidCreateRequest("Cross Tenant", _companyBId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_can_read_a_global_benchmark_but_cannot_write_to_it()
    {
        var client = _factory.CreateClient();
        var superAdminToken = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        var globalResponse = await client.PostAsJsonAsync("/admin/benchmarks", ValidCreateRequest("Global Benchmark", null));
        var global = await globalResponse.Content.ReadFromJsonAsync<BenchmarkDetail>();

        var companyAdminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", companyAdminToken);

        // Read: global benchmarks are visible to every tenant.
        var getResponse = await client.GetAsync($"/admin/benchmarks/{global!.Id}");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);

        var listResponse = await client.GetAsync("/admin/benchmarks");
        var list = await listResponse.Content.ReadFromJsonAsync<List<BenchmarkListItem>>();
        Assert.Contains(list!, b => b.Id == global.Id);

        // Write: a CompanyAdmin must not be able to tamper with a benchmark every other
        // tenant also sees -- this is the cross-tenant vulnerability the fix closes.
        var updateResponse = await client.PutAsJsonAsync($"/admin/benchmarks/{global.Id}", new UpdateBenchmarkRequest(
            "Tampered", "Tampered description", null, null, null));
        Assert.Equal(HttpStatusCode.Forbidden, updateResponse.StatusCode);

        var metricResponse = await client.PostAsJsonAsync($"/admin/benchmarks/{global.Id}/metrics", new AddBenchmarkMetricRequest(
            "tampered_metric", 1.0, "percent", null, null));
        Assert.Equal(HttpStatusCode.Forbidden, metricResponse.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_read_or_write_another_companys_benchmark()
    {
        var client = _factory.CreateClient();
        var superAdminToken = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        var companyBResponse = await client.PostAsJsonAsync("/admin/benchmarks", ValidCreateRequest("Company B Benchmark", _companyBId));
        var companyBBenchmark = await companyBResponse.Content.ReadFromJsonAsync<BenchmarkDetail>();

        var companyAdminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", companyAdminToken);

        var getResponse = await client.GetAsync($"/admin/benchmarks/{companyBBenchmark!.Id}");
        Assert.Equal(HttpStatusCode.Forbidden, getResponse.StatusCode);

        var listResponse = await client.GetAsync("/admin/benchmarks");
        var list = await listResponse.Content.ReadFromJsonAsync<List<BenchmarkListItem>>();
        Assert.DoesNotContain(list!, b => b.Id == companyBBenchmark.Id);

        var updateResponse = await client.PutAsJsonAsync($"/admin/benchmarks/{companyBBenchmark.Id}", new UpdateBenchmarkRequest(
            "Tampered", "Tampered description", null, null, null));
        Assert.Equal(HttpStatusCode.Forbidden, updateResponse.StatusCode);

        var metricResponse = await client.PostAsJsonAsync($"/admin/benchmarks/{companyBBenchmark.Id}/metrics", new AddBenchmarkMetricRequest(
            "tampered_metric", 1.0, "percent", null, null));
        Assert.Equal(HttpStatusCode.Forbidden, metricResponse.StatusCode);
    }

    [Fact]
    public async Task Update_rejects_blank_required_fields()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/benchmarks", ValidCreateRequest("Benchmark To Update", null));
        var created = await createResponse.Content.ReadFromJsonAsync<BenchmarkDetail>();

        var updateResponse = await client.PutAsJsonAsync($"/admin/benchmarks/{created!.Id}", new UpdateBenchmarkRequest(
            "  ", "d", null, null, null));

        Assert.Equal(HttpStatusCode.BadRequest, updateResponse.StatusCode);
    }

    [Fact]
    public async Task Get_and_update_return_404_for_an_unknown_benchmark()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var getResponse = await client.GetAsync($"/admin/benchmarks/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, getResponse.StatusCode);

        var updateResponse = await client.PutAsJsonAsync($"/admin/benchmarks/{Guid.NewGuid()}", new UpdateBenchmarkRequest(
            "n", "d", null, null, null));
        Assert.Equal(HttpStatusCode.NotFound, updateResponse.StatusCode);
    }

    /// <summary>
    /// #285: <c>benchmarks.created_by</c> must name the caller's own row, even when their
    /// <c>sub</c> spells another user's <c>Id</c>.
    ///
    /// <c>persona_external_id</c> is a free-form 64-character string, so nothing stops one
    /// being a Guid in canonical form -- #154's ETL is the feature that will start filling
    /// the column from legacy ids. The collider's <c>sub</c> is minted from their own
    /// <c>PersonaExternalId</c> (<c>PersonaExternalId ?? Id</c>, AuthEndpoints), which here
    /// is the victim's <c>Id</c>. This endpoint resolved <c>Id</c> first until #285.
    ///
    /// Asserted against the row rather than the response: <c>BenchmarkDetail</c> does not
    /// carry <c>CreatedBy</c>, so the stored value is the only place the misresolution shows.
    /// </summary>
    [Fact]
    public async Task A_guid_shaped_external_id_never_files_the_benchmark_against_the_user_whose_id_it_matches()
    {
        var victimEmail = $"{Guid.NewGuid():N}@{_companyADomain}";
        var colliderEmail = $"{Guid.NewGuid():N}@{_companyADomain}";
        var client = _factory.CreateClient();
        Assert.Equal(
            HttpStatusCode.Created,
            (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Victim", victimEmail, "A-good-passw0rd"))).StatusCode);
        Assert.Equal(
            HttpStatusCode.Created,
            (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Collider", colliderEmail, "A-good-passw0rd"))).StatusCode);

        Guid colliderId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var victim = await db.Users.FirstAsync(u => u.Email == victimEmail);
            var collider = await db.Users.FirstAsync(u => u.Email == colliderEmail);
            collider.Role = Roles.SuperAdmin;
            collider.PersonaExternalId = victim.Id.ToString();
            await db.SaveChangesAsync();
            colliderId = collider.Id;
            Assert.NotEqual(victim.Id, collider.Id);
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(colliderEmail, "A-good-passw0rd"));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token);

        var response = await client.PostAsJsonAsync("/admin/benchmarks", ValidCreateRequest($"Collision {Guid.NewGuid():N}", null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<BenchmarkDetail>();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var stored = await db.Benchmarks.AsNoTracking().FirstAsync(b => b.Id == created!.Id);
            Assert.Equal(colliderId, stored.CreatedBy);
        }
    }
}
