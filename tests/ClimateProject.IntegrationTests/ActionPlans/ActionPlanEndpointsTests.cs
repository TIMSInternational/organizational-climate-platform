using System.Linq;
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
public class ActionPlanEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"apa-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"apb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public ActionPlanEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "AP Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "AP Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, string emailDomain, Guid companyId)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    [Fact]
    public async Task CompanyAdmin_can_create_a_plan_with_kpis_and_objectives_then_read_it_back()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            Title: "Improve onboarding",
            Description: "Reduce time-to-productivity for new hires",
            CompanyId: _companyAId,
            DepartmentId: null,
            DueDate: DateTimeOffset.UtcNow.AddDays(30),
            Priority: "high",
            Tags: new[] { "onboarding" },
            TemplateId: null,
            SourceSurveyId: null,
            SourceInsightId: null,
            Kpis: new List<CreateKpiInput> { new("Time to productivity", 30, "days", "monthly") },
            Objectives: new List<CreateObjectiveInput> { new("New hires productive within a month", "90% self-report ready") }));

        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Single(created!.Kpis);
        Assert.Single(created.Objectives);
        Assert.Equal("not_started", created.Status);

        var getResponse = await client.GetAsync($"/action-plans/{created.Id}");
        var fetched = await getResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Equal("Improve onboarding", fetched!.Title);
        Assert.Single(fetched.Kpis);

        var listResponse = await client.GetAsync($"/action-plans?companyId={_companyAId}");
        var list = await listResponse.Content.ReadFromJsonAsync<ActionPlanListResponse>();
        Assert.Contains(list!.ActionPlans, p => p.Id == created.Id);
    }

    [Fact]
    public async Task Create_rejects_invalid_priority()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Bad", "Bad plan", _companyAId, null, DateTimeOffset.UtcNow.AddDays(10), "not_a_priority", null, null, null, null, null, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_create_or_read_plans_in_another_company()
    {
        var client = _factory.CreateClient();
        var tokenA = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var tokenB = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyBDomain, _companyBId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenB);
        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "B's plan", "desc", _companyBId, null, DateTimeOffset.UtcNow.AddDays(10), "low", null, null, null, null, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);
        var crossCreate = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Cross", "desc", _companyBId, null, DateTimeOffset.UtcNow.AddDays(10), "low", null, null, null, null, null, null));
        Assert.Equal(HttpStatusCode.Forbidden, crossCreate.StatusCode);

        var crossGet = await client.GetAsync($"/action-plans/{created!.Id}");
        Assert.Equal(HttpStatusCode.Forbidden, crossGet.StatusCode);
    }

    /// <summary>
    /// #124's privilege check, on the exact parameter the new company-context selector
    /// drives.
    /// </summary>
    /// <remarks>
    /// The web app's SuperAdmin company selector works by sending an explicit
    /// <c>?companyId=</c> on endpoints that already took one. That is only safe because
    /// the parameter is not an override: <c>CanAccessCompany</c> short-circuits on
    /// SuperAdmin and otherwise compares the caller's own claim to the requested id, so a
    /// CompanyAdmin supplying someone else's id is refused rather than scoped to it.
    /// <para>
    /// The neighbouring <c>CompanyAdmin_cannot_create_or_read_plans_in_another_company</c>
    /// covers POST and GET-by-id; this covers the LIST route, which is the one the
    /// selector actually drives and the one where a leak would return another tenant's
    /// whole plan set rather than a single row.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task CompanyAdmin_cannot_list_another_companys_plans_via_the_companyId_parameter()
    {
        var client = _factory.CreateClient();
        var tokenA = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var tokenB = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyBDomain, _companyBId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenB);
        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "B's only plan", "desc", _companyBId, null, DateTimeOffset.UtcNow.AddDays(10), "low", null, null, null, null, null, null));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);

        // Refused outright -- not silently rewritten to A's own company, which would
        // return an empty list and read as "B has no plans".
        var crossList = await client.GetAsync($"/action-plans?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.Forbidden, crossList.StatusCode);

        // And the same caller is still served their own company, so the guard is not
        // simply refusing everything.
        var ownList = await client.GetAsync($"/action-plans?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.OK, ownList.StatusCode);
        var plans = (await ownList.Content.ReadFromJsonAsync<ActionPlanListResponse>())!.ActionPlans;
        Assert.DoesNotContain(plans, p => p.CompanyId == _companyBId);
    }

    [Fact]
    public async Task CompanyAdmin_can_update_status_and_priority()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "To update", "desc", _companyAId, null, DateTimeOffset.UtcNow.AddDays(10), "low", null, null, null, null, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();

        var updateResponse = await client.PutAsJsonAsync($"/action-plans/{created!.Id}", new UpdateActionPlanRequest(null, null, null, "in_progress", "critical", null));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Equal("in_progress", updated!.Status);
        Assert.Equal("critical", updated.Priority);
    }

    [Fact]
    public async Task NonAdmin_cannot_create_a_plan()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Employee plan", "desc", _companyAId, null, DateTimeOffset.UtcNow.AddDays(10), "low", null, null, null, null, null, null));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task NonAdmin_cannot_update_a_plan_in_their_own_company()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Admin-created", "desc", _companyAId, null, DateTimeOffset.UtcNow.AddDays(10), "low", null, null, null, null, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();

        var employeeToken = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", employeeToken);

        var updateResponse = await client.PutAsJsonAsync($"/action-plans/{created!.Id}", new UpdateActionPlanRequest(
            "Hijacked title", null, null, null, null, null));

        Assert.Equal(HttpStatusCode.Forbidden, updateResponse.StatusCode);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var getResponse = await client.GetAsync($"/action-plans/{created.Id}");
        var stillOriginal = await getResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Equal("Admin-created", stillOriginal!.Title);
    }

    [Fact]
    public async Task NonAdmin_cannot_list_or_read_plans_in_their_own_company()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Admin-created", "desc", _companyAId, null, DateTimeOffset.UtcNow.AddDays(10), "low", null, null, null, null, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();

        var employeeToken = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", employeeToken);

        var listResponse = await client.GetAsync($"/action-plans?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.Forbidden, listResponse.StatusCode);

        var getResponse = await client.GetAsync($"/action-plans/{created!.Id}");
        Assert.Equal(HttpStatusCode.Forbidden, getResponse.StatusCode);
    }

    [Fact]
    public async Task Create_with_unknown_template_id_returns_400_not_500()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Plan", "desc", _companyAId, null, DateTimeOffset.UtcNow.AddDays(10), "low", null, Guid.NewGuid(), null, null, null, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_with_another_companys_template_id_is_rejected()
    {
        var client = _factory.CreateClient();
        var tokenB = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyBDomain, _companyBId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenB);

        var templateResponse = await client.PostAsJsonAsync("/action-plan-templates", new CreateActionPlanTemplateRequest(
            "B's template", "desc", "hr", _companyBId, null));
        var template = await templateResponse.Content.ReadFromJsonAsync<ActionPlanTemplateDetail>();

        var tokenA = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);

        var crossResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Cross-tenant template plan", "desc", _companyAId, null, DateTimeOffset.UtcNow.AddDays(10), "low", null, template!.Id, null, null, null, null));

        Assert.Equal(HttpStatusCode.BadRequest, crossResponse.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.ActionPlans.AnyAsync(p => p.Title == "Cross-tenant template plan"));
    }

    [Fact]
    public async Task Create_with_a_valid_own_company_template_id_succeeds_and_increments_usage_count()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var templateResponse = await client.PostAsJsonAsync("/action-plan-templates", new CreateActionPlanTemplateRequest(
            "A's template", "desc", "hr", _companyAId, null));
        var template = await templateResponse.Content.ReadFromJsonAsync<ActionPlanTemplateDetail>();
        Assert.Equal(0, template!.UsageCount);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "From template", "desc", _companyAId, null, DateTimeOffset.UtcNow.AddDays(10), "low", null, template.Id, null, null, null, null));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Equal(template.Id, created!.TemplateId);

        var listResponse = await client.GetAsync($"/action-plan-templates?companyId={_companyAId}");
        var list = await listResponse.Content.ReadFromJsonAsync<ActionPlanTemplateListResponse>();
        Assert.Equal(1, list!.Templates.Single(t => t.Id == template.Id).UsageCount);
    }

    /// <summary>
    /// req(#168): `action_plans.source_survey_id` now carries a foreign key. An FK turns an
    /// unknown id into a <c>DbUpdateException</c> at SaveChanges, which reaches the caller as an
    /// opaque 500 -- where this same request returned 201 before the constraint existed. That is
    /// the regression the constraint introduces, and it is invisible to the persistence-layer
    /// tests, which never go through the endpoint.
    ///
    /// <para>The FK also cannot close tenancy: it checks that the survey row EXISTS, not whose it
    /// is. So the second case here is the cross-tenant one -- the same hole #87 closed on
    /// demographic snapshots and #207's follow-up closed on analytics insights.</para>
    /// </summary>
    [Fact]
    public async Task Creating_a_plan_against_an_unknown_source_survey_is_refused_with_400_not_a_500()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            Title: "Plan from a survey that is not there",
            Description: "The source survey id names no row",
            CompanyId: _companyAId,
            DepartmentId: null,
            DueDate: DateTimeOffset.UtcNow.AddDays(30),
            Priority: "high",
            Tags: null,
            TemplateId: null,
            SourceSurveyId: Guid.NewGuid(),
            SourceInsightId: null,
            Kpis: null,
            Objectives: null));

        // Asserting the status AND the body: "not a 500" is not the guarantee. The caller has to
        // be told which field it got wrong, or the refusal is unactionable.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("SourceSurveyId", body);
    }

    [Fact]
    public async Task Creating_a_plan_against_another_companys_survey_is_refused()
    {
        var client = _factory.CreateClient();

        // Company B has no users until someone signs up into it, and surveys.created_by is a
        // foreign key, so the author has to exist before the survey can.
        await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyBDomain, _companyBId);

        Guid otherCompanysSurveyId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            // surveys.created_by is itself a foreign key, so the survey needs an author that
            // exists. Seeding one without it fails inside this fixture rather than at the
            // endpoint, which is a confusing way to learn the same lesson #168 is about.
            var author = await db.Users.FirstAsync(u => u.CompanyId == _companyBId);
            var survey = new Survey
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyBId,
                CreatedBy = author.Id,
                TitleEn = "Company B climate",
                Language = "en",
                Type = "general_climate",
                Status = "closed",
                StartDate = DateTimeOffset.UtcNow.AddDays(-10),
                EndDate = DateTimeOffset.UtcNow.AddDays(-1),
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Surveys.Add(survey);
            await db.SaveChangesAsync();
            otherCompanysSurveyId = survey.Id;
        }

        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            Title: "Plan from someone else's survey",
            Description: "The source survey exists, but belongs to company B",
            CompanyId: _companyAId,
            DepartmentId: null,
            DueDate: DateTimeOffset.UtcNow.AddDays(30),
            Priority: "high",
            Tags: null,
            TemplateId: null,
            SourceSurveyId: otherCompanysSurveyId,
            SourceInsightId: null,
            Kpis: null,
            Objectives: null));

        // The FK would have accepted this row: the survey exists. Only the hand-written tenancy
        // check refuses it, which is exactly why the FK does not make that check redundant.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("different company", await response.Content.ReadAsStringAsync());
    }

}
