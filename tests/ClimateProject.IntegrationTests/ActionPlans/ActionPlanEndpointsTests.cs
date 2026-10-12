using ClimateProject.Application.Localization;
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
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "A-good-passw0rd"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    /// <summary>The id the token carries, which is what the owner check compares against.</summary>
    private async Task<Guid> UserIdForAsync(string emailDomain, string role)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        return await db.Users.Where(u => u.Email.EndsWith(emailDomain) && u.Role == role)
            .OrderByDescending(u => u.CreatedAt).Select(u => u.Id).FirstAsync();
    }

    /// <summary>A plan owned by <paramref name="ownerId"/>, written straight to the database.</summary>
    private async Task<Guid> SeedPlanAsync(Guid companyId, Guid createdBy, Guid? ownerId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(),
            TitleEn = "Owned plan",
            DescriptionEn = "A plan with somebody answerable for it.",
            CompanyId = companyId,
            CreatedBy = createdBy,
            OwnerId = ownerId,
            DueDate = DateTimeOffset.UtcNow.AddDays(10),
            Status = "not_started",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.ActionPlans.Add(plan);
        await db.SaveChangesAsync();
        return plan.Id;
    }

    // -- a plan's owner can read it ------------------------------------------------------
    //
    // Reads were gated by CanAccessCompany, so only the two admin roles could open a plan.
    // That became a defect the moment the due-date nudge existed: telling an owner their plan
    // is due and then 403-ing them on it is the product contradicting its own notification.

    [Fact]
    public async Task A_leader_who_owns_a_plan_can_read_it_and_sees_it_in_their_list()
    {
        var client = _factory.CreateClient();
        await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var adminId = await UserIdForAsync(_companyADomain, Roles.CompanyAdmin);

        var leaderClient = _factory.CreateClient();
        var leaderToken = await SignUpAndGetTokenAsync(leaderClient, Roles.Leader, _companyADomain, _companyAId);
        var leaderId = await UserIdForAsync(_companyADomain, Roles.Leader);
        leaderClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", leaderToken);

        var mine = await SeedPlanAsync(_companyAId, adminId, leaderId);
        var someoneElses = await SeedPlanAsync(_companyAId, adminId, adminId);

        var detail = await leaderClient.GetAsync($"/action-plans/{mine}");
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);

        var list = await leaderClient.GetAsync($"/action-plans?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        var rows = (await list.Content.ReadFromJsonAsync<ActionPlanListResponse>())!.ActionPlans;

        // Exactly their own: the list is scoped, not merely permitted.
        Assert.Contains(rows, r => r.Id == mine);
        Assert.DoesNotContain(rows, r => r.Id == someoneElses);
    }

    [Fact]
    public async Task A_leader_cannot_read_a_plan_they_do_not_own()
    {
        var client = _factory.CreateClient();
        await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var adminId = await UserIdForAsync(_companyADomain, Roles.CompanyAdmin);

        var leaderClient = _factory.CreateClient();
        var leaderToken = await SignUpAndGetTokenAsync(leaderClient, Roles.Leader, _companyADomain, _companyAId);
        leaderClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", leaderToken);

        var someoneElses = await SeedPlanAsync(_companyAId, adminId, adminId);

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await leaderClient.GetAsync($"/action-plans/{someoneElses}")).StatusCode);
    }

    [Fact]
    public async Task An_unassigned_plan_is_readable_by_nobody_but_an_admin()
    {
        var client = _factory.CreateClient();
        await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var adminId = await UserIdForAsync(_companyADomain, Roles.CompanyAdmin);

        var leaderClient = _factory.CreateClient();
        var leaderToken = await SignUpAndGetTokenAsync(leaderClient, Roles.Leader, _companyADomain, _companyAId);
        leaderClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", leaderToken);

        // OwnerId is null. A null owner must never match a null-ish subject id or an
        // unparsable one -- the check has to fail closed, not compare two absences.
        var unowned = await SeedPlanAsync(_companyAId, adminId, ownerId: null);

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await leaderClient.GetAsync($"/action-plans/{unowned}")).StatusCode);
    }

    [Fact]
    public async Task Owning_a_plan_does_not_let_a_leader_change_it()
    {
        var client = _factory.CreateClient();
        await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var adminId = await UserIdForAsync(_companyADomain, Roles.CompanyAdmin);

        var leaderClient = _factory.CreateClient();
        var leaderToken = await SignUpAndGetTokenAsync(leaderClient, Roles.Leader, _companyADomain, _companyAId);
        var leaderId = await UserIdForAsync(_companyADomain, Roles.Leader);
        leaderClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", leaderToken);

        var mine = await SeedPlanAsync(_companyAId, adminId, leaderId);

        // Read is granted; write is not. The plan's own screen says so in words --
        // "Registra avance la administración" -- and this is that sentence as a test.
        var update = await leaderClient.PutAsJsonAsync(
            $"/action-plans/{mine}",
            new UpdateActionPlanRequest(null, null, null, "in_progress", null, null));

        Assert.Equal(HttpStatusCode.Forbidden, update.StatusCode);
    }

    [Fact]
    public async Task An_owner_id_does_not_cross_a_company_boundary()
    {
        var client = _factory.CreateClient();
        await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyBDomain, _companyBId);
        var otherAdminId = await UserIdForAsync(_companyBDomain, Roles.CompanyAdmin);

        var leaderClient = _factory.CreateClient();
        var leaderToken = await SignUpAndGetTokenAsync(leaderClient, Roles.Leader, _companyADomain, _companyAId);
        var leaderId = await UserIdForAsync(_companyADomain, Roles.Leader);
        leaderClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", leaderToken);

        // A plan in company B naming a company A user as its owner. Nothing should produce
        // this row, but an owner check that trusted the id alone would hand a tenant's plan
        // to an outsider, so the tenant is compared as well.
        var crossTenant = await SeedPlanAsync(_companyBId, otherAdminId, leaderId);

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await leaderClient.GetAsync($"/action-plans/{crossTenant}")).StatusCode);

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await leaderClient.GetAsync($"/action-plans?companyId={_companyBId}")).StatusCode);
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
    public async Task List_returns_where_a_plan_came_from_so_a_client_can_read_its_origin()
    {
        // Both halves of a plan's provenance were stored and neither was ever returned.
        // `SourceSurveyId` has been written and tenancy-checked since #168; the results screen
        // tags every plan it raises `seguimiento`, `department:<id>` and `dimension:<key>`.
        // With the list item carrying neither, the client could not know where a plan came
        // from, and the Planes de Acción screen marked its whole origin column "Datos de
        // muestra" over data that already existed.
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        Guid surveyId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var author = await db.Users.FirstAsync(u => u.CompanyId == _companyAId);
            var survey = new Survey
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyAId,
                CreatedBy = author.Id,
                TitleEn = "Q3 climate",
                Language = "en",
                Type = SurveyTypes.Periodic,
                Status = "closed",
                StartDate = DateTimeOffset.UtcNow.AddDays(-10),
                EndDate = DateTimeOffset.UtcNow.AddDays(-1),
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Surveys.Add(survey);
            await db.SaveChangesAsync();
            surveyId = survey.Id;
        }

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            Title: "Seguimiento para Ventanilla — Reconocimiento",
            Description: "Raised from the results map",
            CompanyId: _companyAId,
            DepartmentId: null,
            DueDate: DateTimeOffset.UtcNow.AddDays(30),
            Priority: "high",
            Tags: new[] { "seguimiento", "dimension:recognition" },
            TemplateId: null,
            SourceSurveyId: surveyId,
            SourceInsightId: null,
            Kpis: null,
            Objectives: null));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();

        // The detail carries it too: the screen that opens one plan needs the same fact.
        Assert.Equal(surveyId, created!.SourceSurveyId);

        var listResponse = await client.GetAsync($"/action-plans?companyId={_companyAId}");
        var list = await listResponse.Content.ReadFromJsonAsync<ActionPlanListResponse>();
        var row = Assert.Single(list!.ActionPlans, p => p.Id == created.Id);
        Assert.Equal(surveyId, row.SourceSurveyId);
        Assert.Contains("dimension:recognition", row.Tags);

        // A plan raised by hand names no origin, and says so with nulls rather than a guess.
        var plainResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            Title: "Raised by hand",
            Description: "No survey behind this one",
            CompanyId: _companyAId,
            DepartmentId: null,
            DueDate: DateTimeOffset.UtcNow.AddDays(30),
            Priority: "medium",
            Tags: null,
            TemplateId: null,
            SourceSurveyId: null,
            SourceInsightId: null,
            Kpis: null,
            Objectives: null));
        var plain = await plainResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();
        var plainRow = Assert.Single(
            (await (await client.GetAsync($"/action-plans?companyId={_companyAId}"))
                .Content.ReadFromJsonAsync<ActionPlanListResponse>())!.ActionPlans,
            p => p.Id == plain!.Id);
        Assert.Null(plainRow.SourceSurveyId);
        Assert.Empty(plainRow.Tags);
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

    /// <summary>
    /// A non-admin who owns nothing sees nothing -- and is told so, rather than refused.
    /// </summary>
    /// <remarks>
    /// <para>This asserted a 403 on the LIST until the due-date nudge made that untenable:
    /// an owner has to be able to reach the plan they are being mailed about, so the list is
    /// now scoped to what the caller owns instead of being closed to them. The policy changed
    /// deliberately; this test changed with it rather than being deleted.</para>
    ///
    /// <para><b>200-with-nothing-in-it is the stronger claim, not the weaker one.</b> A 403
    /// says only "you were not allowed to ask". This says the query ran and returned none of
    /// the tenant's plans, which is the thing that would actually leak if the scoping filter
    /// were dropped -- a mutation that removes it turns this empty list into a populated one
    /// and fails here, where a status-code assertion would have passed.</para>
    ///
    /// <para>The DETAIL half is unchanged and still a refusal: ownership is the only key a
    /// non-admin has, and this plan has no owner at all.</para>
    /// </remarks>
    [Fact]
    public async Task A_non_admin_owning_nothing_gets_an_empty_list_and_cannot_open_a_plan()
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
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);

        var rows = (await listResponse.Content.ReadFromJsonAsync<ActionPlanListResponse>())!.ActionPlans;
        Assert.Empty(rows);

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
        Assert.False(await db.ActionPlans.AnyAsync(p => p.TitleEn == "Cross-tenant template plan"));
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
                Type = "periodic",
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


    // ------------------------------------------------------------------
    // #210 -- every authored field on a plan is a paired column
    // ------------------------------------------------------------------

    private static LocalizedInput Both(string en, string es)
        => LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = en, ["es"] = es });

    [Fact]
    public async Task A_bilingual_plan_reads_every_field_in_the_requested_locale_with_nothing_fallen_back()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            Title: Both("Improve onboarding", "Mejorar la incorporación"),
            Description: Both("Reduce ramp-up", "Reducir el tiempo de adaptación"),
            CompanyId: _companyAId,
            DepartmentId: null,
            DueDate: DateTimeOffset.UtcNow.AddDays(30),
            Priority: "high",
            Tags: null,
            TemplateId: null,
            SourceSurveyId: null,
            SourceInsightId: null,
            Kpis: [new CreateKpiInput(Both("Time to productivity", "Tiempo hasta productividad"), 30, Both("days", "días"), "weekly")],
            Objectives: [new CreateObjectiveInput(Both("Buddy every hire", "Un compañero por contratación"), Both("100% paired", "100% emparejados"))]));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();

        var spanish = await (await client.GetAsync($"/action-plans/{created!.Id}?lang=es")).Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Equal("Mejorar la incorporación", spanish!.Title);
        Assert.Equal("Reducir el tiempo de adaptación", spanish.Description);
        Assert.Equal("Tiempo hasta productividad", spanish.Kpis.Single().Name);
        Assert.Equal("días", spanish.Kpis.Single().Unit);
        Assert.Equal("Un compañero por contratación", spanish.Objectives.Single().Description);
        Assert.Equal("100% emparejados", spanish.Objectives.Single().SuccessCriteria);
        Assert.Empty(spanish.FallbackFields);

        var english = await (await client.GetAsync($"/action-plans/{created.Id}?lang=en")).Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Equal("Improve onboarding", english!.Title);
        Assert.Equal("days", english.Kpis.Single().Unit);

        var listed = await (await client.GetAsync($"/action-plans?companyId={_companyAId}&lang=es")).Content.ReadFromJsonAsync<ActionPlanListResponse>();
        Assert.Equal("Mejorar la incorporación", listed!.ActionPlans.Single(p => p.Id == created.Id).Title);
    }

    [Fact]
    public async Task A_bare_plan_lands_in_the_companys_language_and_a_Spanish_reader_is_told_which_fields_fell_back()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            Title: "Improve onboarding",
            Description: "Reduce ramp-up",
            CompanyId: _companyAId,
            DepartmentId: null,
            DueDate: DateTimeOffset.UtcNow.AddDays(30),
            Priority: "high",
            Tags: null,
            TemplateId: null,
            SourceSurveyId: null,
            SourceInsightId: null,
            Kpis: [new CreateKpiInput("Time to productivity", 30, "days", "weekly")],
            Objectives: [new CreateObjectiveInput("Buddy every hire", "100% paired")]));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();

        var spanish = await (await client.GetAsync($"/action-plans/{created!.Id}?lang=es")).Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Equal("Improve onboarding", spanish!.Title);
        Assert.Equal(
            ["title", "description", "kpis[0].name", "kpis[0].unit", "objectives[0].description", "objectives[0].successCriteria"],
            spanish.FallbackFields);

        // The company is English, so the bare strings are English columns.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var kpi = await db.ActionPlanKpis.AsNoTracking().SingleAsync(k => k.ActionPlanId == created.Id);
        Assert.Equal(("Time to productivity", null, "days", null), (kpi.NameEn, kpi.NameEs, kpi.UnitEn, kpi.UnitEs));
    }

    [Fact]
    public async Task Updating_with_a_bare_title_keeps_the_other_half_and_a_blank_bare_title_is_still_ignored()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            Both("Improve onboarding", "Mejorar la incorporación"), Both("Reduce ramp-up", "Reducir"), _companyAId, null,
            DateTimeOffset.UtcNow.AddDays(30), "high", null, null, null, null, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();

        var updated = await client.PutAsJsonAsync($"/action-plans/{created!.Id}", new UpdateActionPlanRequest("Improve onboarding v2", null, null, null, null, null));
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);

        var ignored = await client.PutAsJsonAsync($"/action-plans/{created.Id}", new UpdateActionPlanRequest("   ", null, null, null, null, null));
        Assert.Equal(HttpStatusCode.OK, ignored.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var row = await db.ActionPlans.AsNoTracking().SingleAsync(p => p.Id == created.Id);
        Assert.Equal("Improve onboarding v2", row.TitleEn);
        Assert.Equal("Mejorar la incorporación", row.TitleEs);
    }

    /// <summary>
    /// A user of the company, created the way the harness creates every other one, returned
    /// with the name the list is expected to print.
    /// </summary>
    private async Task<(Guid Id, string Name)> AUserOfAsync(HttpClient client, Guid companyId, string emailDomain)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Owner Person", email, "A-good-passw0rd"));
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.CompanyId = companyId;
        await db.SaveChangesAsync();
        return (user.Id, user.Name);
    }

    [Fact]
    public async Task A_plan_can_be_given_an_owner_and_the_list_prints_their_name()
    {
        // The entity had no owner at all: every plan read "Sin asignar" and the screen's
        // "SIN RESPONSABLE 4 de 4" tile counted a column that did not exist. The name travels
        // on the list item because the list is what prints one per row.
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var owner = await AUserOfAsync(client, _companyAId, _companyADomain);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            Title: "Recognition standard",
            Description: "Publish one",
            CompanyId: _companyAId,
            DepartmentId: null,
            DueDate: DateTimeOffset.UtcNow.AddDays(30),
            Priority: "high",
            Tags: null,
            TemplateId: null,
            SourceSurveyId: null,
            SourceInsightId: null,
            Kpis: null,
            Objectives: null,
            OwnerId: owner.Id));

        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Equal(owner.Id, created!.OwnerId);
        Assert.Equal(owner.Name, created.OwnerName);

        var listResponse = await client.GetAsync($"/action-plans?companyId={_companyAId}");
        var list = await listResponse.Content.ReadFromJsonAsync<ActionPlanListResponse>();
        var row = Assert.Single(list!.ActionPlans, p => p.Id == created.Id);
        Assert.Equal(owner.Id, row.OwnerId);
        Assert.Equal(owner.Name, row.OwnerName);
    }

    [Fact]
    public async Task A_plan_with_no_owner_says_so_rather_than_naming_anybody()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Unowned", "For now", _companyAId, null, DateTimeOffset.UtcNow.AddDays(30), "high",
            null, null, null, null, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();

        Assert.Null(created!.OwnerId);
        Assert.Null(created.OwnerName);
    }

    [Fact]
    public async Task An_owner_from_another_company_is_refused_with_400_not_an_opaque_500()
    {
        // The FK proves the row exists, never whose it is. Without the tenancy half, a company
        // admin could file a plan against another tenant's user and read that user's NAME back
        // out of the list payload -- the leak `SourceSurveyId` is checked for, one column over.
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var stranger = await AUserOfAsync(client, _companyBId, _companyBDomain);

        var response = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Cross-tenant", "No", _companyAId, null, DateTimeOffset.UtcNow.AddDays(30), "high",
            null, null, null, null, null, null, OwnerId: stranger.Id));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("different company", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task An_owner_who_does_not_exist_is_refused_with_400_not_an_opaque_500()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Ghost", "No", _companyAId, null, DateTimeOffset.UtcNow.AddDays(30), "high",
            null, null, null, null, null, null, OwnerId: Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("does not reference an existing user", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task An_update_that_does_not_mention_the_owner_leaves_the_owner_alone()
    {
        // `OwnerId: null` means "not in this request", exactly as `Status: null` does on this
        // record. Treating it as "unassign" would clear the owner on every status change --
        // and a status change is the commonest write this screen makes.
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var owner = await AUserOfAsync(client, _companyAId, _companyADomain);

        var created = await (await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Owned", "Yes", _companyAId, null, DateTimeOffset.UtcNow.AddDays(30), "high",
            null, null, null, null, null, null, OwnerId: owner.Id))).Content.ReadFromJsonAsync<ActionPlanDetail>();

        var afterStatus = await client.PutAsJsonAsync($"/action-plans/{created!.Id}",
            new UpdateActionPlanRequest(null, null, null, "in_progress", null, null));
        Assert.Equal(HttpStatusCode.OK, afterStatus.StatusCode);
        var read = await (await client.GetAsync($"/action-plans/{created.Id}")).Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Equal(owner.Id, read!.OwnerId);
        Assert.Equal("in_progress", read.Status);
    }

    [Fact]
    public async Task An_owner_can_be_assigned_and_unassigned_but_never_both_in_one_request()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var owner = await AUserOfAsync(client, _companyAId, _companyADomain);

        var created = await (await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "To assign", "Later", _companyAId, null, DateTimeOffset.UtcNow.AddDays(30), "high",
            null, null, null, null, null, null))).Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Null(created!.OwnerId);

        var assigned = await client.PutAsJsonAsync($"/action-plans/{created.Id}",
            new UpdateActionPlanRequest(null, null, null, null, null, null, OwnerId: owner.Id));
        Assert.Equal(HttpStatusCode.OK, assigned.StatusCode);
        Assert.Equal(owner.Id, (await assigned.Content.ReadFromJsonAsync<ActionPlanDetail>())!.OwnerId);

        var both = await client.PutAsJsonAsync($"/action-plans/{created.Id}",
            new UpdateActionPlanRequest(null, null, null, null, null, null, OwnerId: owner.Id, ClearOwner: true));
        Assert.Equal(HttpStatusCode.BadRequest, both.StatusCode);
        // And it changed nothing: the refusal path writes no owner, in either direction.
        var unchanged = await (await client.GetAsync($"/action-plans/{created.Id}")).Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Equal(owner.Id, unchanged!.OwnerId);

        var cleared = await client.PutAsJsonAsync($"/action-plans/{created.Id}",
            new UpdateActionPlanRequest(null, null, null, null, null, null, ClearOwner: true));
        Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);
        var after = (await cleared.Content.ReadFromJsonAsync<ActionPlanDetail>())!;
        Assert.Null(after.OwnerId);
        Assert.Null(after.OwnerName);
    }

    [Fact]
    public async Task Deleting_the_owner_unassigns_the_plan_rather_than_deleting_it_or_refusing()
    {
        // `owner_id` is SetNull where `created_by` is Restrict, and the difference is the
        // point: history must not be erasable by deleting a user, but a current assignment
        // genuinely ends when the person leaves. Restrict here would make offboarding fail
        // for anyone who had ever been handed a plan; Cascade would delete the work with
        // the worker.
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var owner = await AUserOfAsync(client, _companyAId, _companyADomain);

        var created = await (await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Owned then orphaned", "Yes", _companyAId, null, DateTimeOffset.UtcNow.AddDays(30), "high",
            null, null, null, null, null, null, OwnerId: owner.Id))).Content.ReadFromJsonAsync<ActionPlanDetail>();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.Users.Remove(await db.Users.SingleAsync(u => u.Id == owner.Id));
            await db.SaveChangesAsync();
        }

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var row = await db.ActionPlans.AsNoTracking().SingleAsync(p => p.Id == created!.Id);
            Assert.Null(row.OwnerId);
        }
    }
}
