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
    private readonly string _companyDomain = $"bench-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public BenchmarkEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Bench Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
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
    public async Task Create_a_benchmark_with_a_prior_period_reference_and_add_a_metric()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var priorResponse = await client.PostAsJsonAsync("/admin/benchmarks", new CreateBenchmarkRequest(
            "2025 Engagement", "d", "industry", "engagement", "internal", null, null, null, null, null));
        var prior = await priorResponse.Content.ReadFromJsonAsync<BenchmarkDetail>();

        var response = await client.PostAsJsonAsync("/admin/benchmarks", new CreateBenchmarkRequest(
            "2026 Engagement", "d", "industry", "engagement", "internal", null, null, null, null, prior!.Id));
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
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/benchmarks", new CreateBenchmarkRequest(
            "X", "d", "t", "c", "s", null, null, null, null, Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
