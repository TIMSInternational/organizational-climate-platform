using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.ActionPlans;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.ActionPlans;

[Collection("Postgres")]
public class ActionPlanProgressEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"prog-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public ActionPlanProgressEndpointTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Progress Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
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
    public async Task Recording_progress_updates_kpi_and_objective_current_values()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Plan", "desc", _companyId, null, DateTimeOffset.UtcNow.AddDays(30), "medium", null, null, null, null,
            new List<CreateKpiInput> { new("Adoption", 100, "percent", "monthly") },
            new List<CreateObjectiveInput> { new("Ship feature", "Live in prod") }));
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();
        var kpiId = created!.Kpis[0].Id;
        var objectiveId = created.Objectives[0].Id;

        var progressResponse = await client.PostAsJsonAsync($"/action-plans/{created.Id}/progress", new RecordProgressRequest(
            OverallNotes: "Good progress this month",
            KpiUpdates: new List<KpiUpdateInput> { new(kpiId, 40, "40% adopted so far") },
            ObjectiveUpdates: new List<ObjectiveUpdateInput> { new(objectiveId, "in_progress", 50, "Halfway done") }));

        Assert.Equal(HttpStatusCode.Created, progressResponse.StatusCode);

        var getResponse = await client.GetAsync($"/action-plans/{created.Id}");
        var updated = await getResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Equal(40, updated!.Kpis[0].CurrentValue);
        Assert.Equal(50, updated.Objectives[0].CompletionPercentage);
        Assert.Equal("in_progress", updated.Objectives[0].CurrentStatus);
    }

    [Fact]
    public async Task Recording_progress_for_a_kpi_that_does_not_belong_to_the_plan_fails()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Plan", "desc", _companyId, null, DateTimeOffset.UtcNow.AddDays(30), "medium", null, null, null, null, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();

        var progressResponse = await client.PostAsJsonAsync($"/action-plans/{created!.Id}/progress", new RecordProgressRequest(
            "notes", new List<KpiUpdateInput> { new(Guid.NewGuid(), 10, null) }, null));

        Assert.Equal(HttpStatusCode.BadRequest, progressResponse.StatusCode);
    }

    [Fact]
    public async Task Recording_progress_as_a_non_admin_role_is_forbidden()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Plan", "desc", _companyId, null, DateTimeOffset.UtcNow.AddDays(30), "medium", null, null, null, null, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();

        var employeeToken = await SignUpAndGetTokenAsync(client, Roles.Employee);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", employeeToken);

        var progressResponse = await client.PostAsJsonAsync($"/action-plans/{created!.Id}/progress", new RecordProgressRequest(
            "notes", null, null));

        Assert.Equal(HttpStatusCode.Forbidden, progressResponse.StatusCode);
    }

    [Fact]
    public async Task Recording_progress_with_blank_overall_notes_fails_with_400()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Plan", "desc", _companyId, null, DateTimeOffset.UtcNow.AddDays(30), "medium", null, null, null, null, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();

        var progressResponse = await client.PostAsJsonAsync($"/action-plans/{created!.Id}/progress", new RecordProgressRequest(
            "   ", null, null));

        Assert.Equal(HttpStatusCode.BadRequest, progressResponse.StatusCode);
    }

    [Fact]
    public async Task Recording_progress_with_missing_overall_notes_field_fails_with_400_not_500()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Plan", "desc", _companyId, null, DateTimeOffset.UtcNow.AddDays(30), "medium", null, null, null, null, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();

        // Raw JSON payload that omits overallNotes entirely; System.Text.Json binds the
        // missing property to null for the non-nullable record parameter.
        var payload = new { kpiUpdates = (object?)null, objectiveUpdates = (object?)null };
        var progressResponse = await client.PostAsJsonAsync($"/action-plans/{created!.Id}/progress", payload);

        Assert.Equal(HttpStatusCode.BadRequest, progressResponse.StatusCode);
    }
}
