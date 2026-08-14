using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Dashboard;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Dashboard;

/// <summary>
/// #132's four role dashboards, and mostly their refusals.
///
/// Two tenants are seeded, not one, and every figure asserted on company A is chosen so
/// that company B's rows would visibly change it if the scope leaked. A test that only ever
/// looks at one company cannot tell a correctly-scoped aggregate from an unscoped one --
/// both return the same number when there is nothing else in the database.
///
/// The denials that matter most, and why each is here rather than assumed:
///
/// <list type="bullet">
/// <item><c>CompanyId == null</c> is GLOBAL in this schema, so a guard shaped "was a
/// company id supplied?" is backwards -- absence is the widest scope, not the narrowest.
/// #207 and #256 were both that mistake. Hence
/// <c>A_company_admin_with_no_company_claim_is_refused_rather_than_given_global_scope</c>.</item>
/// <item>Omitting the query parameter is the obvious way to reach for "everything", so
/// every scoped route is called with it omitted as well as with a foreign id.</item>
/// </list>
/// </summary>
[Collection("Postgres")]
public class DashboardEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"dsha-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"dshb-{Guid.NewGuid():N}.test";

    /// <summary>Survey.ResponseCount on the company-wide survey — a tenant-wide tally.</summary>
    private const int CompanyWideResponseCount = 140;

    /// <summary>Survey.TargetAudienceCount on the company-wide survey — a tenant-wide headcount.</summary>
    private const int CompanyWideTargetAudience = 200;

    private Guid _companyAId;
    private Guid _companyBId;
    private Guid _engineeringId;
    private Guid _salesId;
    private Guid _companyBDepartmentId;
    private Guid _companyWideSurveyId;
    private Guid _engineeringOnlySurveyId;

    public DashboardEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;

        var companyA = new Company { Id = Guid.NewGuid(), Name = "Dashboard Co A", EmailDomain = _companyADomain, CreatedAt = now };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Dashboard Co B", EmailDomain = _companyBDomain, CreatedAt = now };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();

        var engineering = new Department { Id = Guid.NewGuid(), CompanyId = companyA.Id, Name = "Engineering", CreatedAt = now, UpdatedAt = now };
        var sales = new Department { Id = Guid.NewGuid(), CompanyId = companyA.Id, Name = "Sales", CreatedAt = now, UpdatedAt = now };
        var marketingB = new Department { Id = Guid.NewGuid(), CompanyId = companyB.Id, Name = "Marketing", CreatedAt = now, UpdatedAt = now };
        db.Departments.AddRange(engineering, sales, marketingB);
        _engineeringId = engineering.Id;
        _salesId = sales.Id;
        _companyBDepartmentId = marketingB.Id;
        await db.SaveChangesAsync();

        var authorA = await SeedUserAsync(db, companyA.Id, engineering.Id);
        var authorB = await SeedUserAsync(db, companyB.Id, marketingB.Id);

        // Company A: one company-wide active survey, one targeted only at Engineering, one
        // draft. Company B: one active survey, which must never appear in A's figures.
        // The company-wide survey carries the denormalised tenant-wide figures a real one
        // would: 140 completed responses across every department, 200 people invited. Only
        // two of those responses are Engineering's, which is what makes it visible when a
        // department's page reaches for the survey row instead of the response rows.
        //
        // The two surveys an Engineering employee owes an answer to differ in their
        // anonymity setting, deliberately and in opposite directions: the company-wide pulse
        // is anonymous, the Engineering-only one is not. A fixture where both agreed would
        // let a projection that returned a constant -- or read the wrong survey's setting --
        // pass every assertion below.
        _companyWideSurveyId = await SeedSurveyAsync(
            db, companyA.Id, authorA, "Company-wide pulse", SurveyStatuses.Active, now.AddDays(30),
            responseCount: CompanyWideResponseCount, targetAudienceCount: CompanyWideTargetAudience,
            anonymous: true);
        _engineeringOnlySurveyId = await SeedSurveyAsync(db, companyA.Id, authorA, "Engineering only", SurveyStatuses.Active, now.AddDays(10));
        await SeedSurveyAsync(db, companyA.Id, authorA, "Not published yet", SurveyStatuses.Draft, now.AddDays(60));
        await SeedSurveyAsync(db, companyB.Id, authorB, "Other tenant survey", SurveyStatuses.Active, now.AddDays(20));

        db.SurveyDepartmentTargets.Add(new SurveyDepartmentTarget
        {
            SurveyId = _engineeringOnlySurveyId,
            DepartmentId = engineering.Id,
        });
        await db.SaveChangesAsync();

        // Two completed responses in A/Engineering and one in B. Plus one INCOMPLETE
        // response in A/Engineering, which must not be counted as participation.
        await SeedResponseAsync(db, _companyWideSurveyId, companyA.Id, engineering.Id, isComplete: true);
        await SeedResponseAsync(db, _companyWideSurveyId, companyA.Id, engineering.Id, isComplete: true);
        await SeedResponseAsync(db, _companyWideSurveyId, companyA.Id, engineering.Id, isComplete: false);
        await SeedResponseAsync(db, _companyWideSurveyId, companyB.Id, marketingB.Id, isComplete: true);

        // One overdue open plan and one completed plan in A/Engineering, plus a plan in B.
        await SeedActionPlanAsync(db, companyA.Id, engineering.Id, authorA, "in_progress", now.AddDays(-3));
        await SeedActionPlanAsync(db, companyA.Id, engineering.Id, authorA, "not_started", now.AddDays(14));
        await SeedActionPlanAsync(db, companyA.Id, engineering.Id, authorA, "completed", now.AddDays(-30));
        await SeedActionPlanAsync(db, companyB.Id, marketingB.Id, authorB, "in_progress", now.AddDays(-3));
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------------
    // Seeding
    // ------------------------------------------------------------------

    private static async Task<Guid> SeedUserAsync(ClimateProjectDbContext db, Guid companyId, Guid? departmentId)
    {
        var now = DateTimeOffset.UtcNow;
        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            DepartmentId = departmentId,
            Email = $"seed-{Guid.NewGuid():N}@seed.test",
            Name = "Seed User",
            Role = Roles.Employee,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    /// <param name="responseCount">
    /// The survey row's own denormalised tally, bumped once per completed response
    /// <em>company-wide</em> by <c>SurveyResponseEndpoints</c>. Seeded here at a value that
    /// deliberately disagrees with the number of response rows in any one department, so a
    /// page that renders it where a department-scoped figure belongs prints a number no
    /// other assertion in this file could produce.
    /// </param>
    /// <param name="targetAudienceCount">The author-entered tenant-wide invited headcount.</param>
    /// <param name="anonymous">
    /// The survey's own <c>Settings.Anonymous</c>, i.e. the promise the respond page will
    /// make about it. Defaults to false, which is <c>SurveySettings</c>'s own default and
    /// therefore the safe one: a fixture that silently made every survey anonymous would be
    /// a fixture in which the dangerous direction is never exercised.
    /// </param>
    private static async Task<Guid> SeedSurveyAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        Guid createdBy,
        string title,
        string status,
        DateTimeOffset endDate,
        int responseCount = 0,
        int? targetAudienceCount = null,
        bool anonymous = false)
    {
        var now = DateTimeOffset.UtcNow;
        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            CreatedBy = createdBy,
            TitleEn = title,
            TitleEs = $"{title} (ES)",
            Language = "both",
            Type = "general_climate",
            StartDate = now.AddDays(-1),
            EndDate = endDate,
            Status = status,
            ResponseCount = responseCount,
            TargetAudienceCount = targetAudienceCount,
            Settings = new SurveySettings { Anonymous = anonymous },
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();
        return survey.Id;
    }

    private static async Task SeedResponseAsync(
        ClimateProjectDbContext db, Guid surveyId, Guid companyId, Guid departmentId, bool isComplete)
    {
        var now = DateTimeOffset.UtcNow;
        db.Responses.Add(new Response
        {
            Id = Guid.NewGuid(),
            SurveyId = surveyId,
            CompanyId = companyId,
            DepartmentId = departmentId,
            SessionId = Guid.NewGuid().ToString("N"),
            IsComplete = isComplete,
            IsAnonymous = true,
            StartTime = now,
            CompletionTime = isComplete ? now : null,
            CreatedAt = now,
            UpdatedAt = now,
        });
        await db.SaveChangesAsync();
    }

    private static async Task SeedActionPlanAsync(
        ClimateProjectDbContext db, Guid companyId, Guid departmentId, Guid createdBy, string status, DateTimeOffset dueDate)
    {
        var now = DateTimeOffset.UtcNow;
        db.ActionPlans.Add(new ActionPlan
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            DepartmentId = departmentId,
            CreatedBy = createdBy,
            Title = "Plan",
            Description = "Plan description",
            Status = status,
            DueDate = dueDate,
            CreatedAt = now,
            UpdatedAt = now,
        });
        await db.SaveChangesAsync();
    }

    // ------------------------------------------------------------------
    // Auth helpers
    // ------------------------------------------------------------------

    private async Task<HttpClient> ClientAsync(
        string role,
        string emailDomain,
        Guid? companyId = null,
        Guid? departmentId = null,
        bool clearCompany = false)
        => (await ClientWithEmailAsync(role, emailDomain, companyId, departmentId, clearCompany)).Client;

    /// <summary>
    /// The same client, plus the address it authenticated as — needed by the notification
    /// test, which has to find the caller's own user row in order to seed rows against it.
    /// </summary>
    private async Task<(HttpClient Client, string Email)> ClientWithEmailAsync(
        string role,
        string emailDomain,
        Guid? companyId = null,
        Guid? departmentId = null,
        bool clearCompany = false)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            if (companyId.HasValue)
            {
                user.CompanyId = companyId.Value;
            }

            // NULL company is GLOBAL scope in this schema, so it is set explicitly and only
            // where a test is deliberately exercising that case.
            if (clearCompany)
            {
                user.CompanyId = null;
            }

            user.DepartmentId = departmentId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return (client, email);
    }

    // ------------------------------------------------------------------
    // SuperAdmin
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_platform_dashboard_reports_across_every_tenant_for_a_super_admin()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain, clearCompany: true);

        var response = await client.GetAsync("/dashboard/super-admin");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<SuperAdminDashboard>())!;

        // Other test classes share this database, so the platform totals are asserted as
        // lower bounds -- what matters is that BOTH seeded tenants are in scope, which a
        // per-company query would fail.
        Assert.True(body.CompanyCount >= 2);
        Assert.True(body.ActiveSurveyCount >= 3);
        Assert.True(body.CompletedResponseCount >= 3);

        var companyA = Assert.Single(body.Companies, c => c.Id == _companyAId);
        Assert.Equal("Dashboard Co A", companyA.Name);
        // Company A's own figures, not the platform's: two active surveys and two completed
        // responses. The third response is incomplete and the third survey is a draft.
        Assert.Equal(2, companyA.ActiveSurveyCount);
        Assert.Equal(2, companyA.CompletedResponseCount);
    }

    [Fact]
    public async Task The_platform_dashboard_is_refused_to_every_role_but_super_admin()
    {
        foreach (var role in new[] { Roles.CompanyAdmin, Roles.Leader, Roles.Supervisor, Roles.Employee })
        {
            var client = await ClientAsync(role, _companyADomain, _companyAId);
            var response = await client.GetAsync("/dashboard/super-admin");
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }
    }

    // ------------------------------------------------------------------
    // CompanyAdmin
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_company_dashboard_reports_only_the_admins_own_tenant()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var response = await client.GetAsync("/dashboard/company-admin");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<CompanyAdminDashboard>())!;

        Assert.Equal(_companyAId, body.CompanyId);
        Assert.Equal("Dashboard Co A", body.CompanyName);
        Assert.Equal(3, body.SurveyCount);
        Assert.Equal(2, body.ActiveSurveyCount);
        Assert.Equal(1, body.DraftSurveyCount);
        // Three responses in A, of which two completed. Company B's response is excluded.
        Assert.Equal(3, body.ResponseCount);
        Assert.Equal(2, body.CompletedResponseCount);
        Assert.Equal(2, body.DepartmentCount);
        // Two outstanding plans (the completed one is not work), one of them overdue.
        Assert.Equal(2, body.OpenActionPlanCount);
        Assert.Equal(1, body.OverdueActionPlanCount);

        // Ongoing surveys, soonest deadline first, and drafts are not ongoing.
        Assert.Equal(
            new[] { _engineeringOnlySurveyId, _companyWideSurveyId },
            body.OngoingSurveys.Select(s => s.Id));

        // The tenant-wide figures, which is what a tenant-wide page is for. The department
        // dashboard must NOT show these -- see
        // The_department_survey_list_counts_that_departments_responses_and_shows_no_tenant_target.
        var companyWide = Assert.Single(body.OngoingSurveys, s => s.Id == _companyWideSurveyId);
        Assert.Equal(CompanyWideResponseCount, companyWide.ResponseCount);
        Assert.Equal(CompanyWideTargetAudience, companyWide.TargetAudienceCount);

        var engineering = Assert.Single(body.Departments, d => d.Id == _engineeringId);
        Assert.Equal(2, engineering.CompletedResponseCount);
        Assert.Contains(body.Departments, d => d.Id == _salesId);
        Assert.DoesNotContain(body.Departments, d => d.Id == _companyBDepartmentId);
    }

    [Fact]
    public async Task A_company_admin_asking_for_another_tenant_is_refused_rather_than_quietly_given_their_own()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var response = await client.GetAsync($"/dashboard/company-admin?companyId={_companyBId}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /// <summary>
    /// The #207/#256 shape, stated directly.
    ///
    /// A guard written as "if a companyId was supplied, check it" lets this caller through
    /// with no tenant predicate at all -- and in this schema a missing company is GLOBAL,
    /// the most privileged value there is. The only route to platform-wide data must be the
    /// SuperAdmin role, checked explicitly.
    /// </summary>
    [Fact]
    public async Task A_company_admin_with_no_company_claim_is_refused_rather_than_given_global_scope()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, clearCompany: true);

        var withoutParameter = await client.GetAsync("/dashboard/company-admin");
        Assert.Equal(HttpStatusCode.Forbidden, withoutParameter.StatusCode);

        // And naming a tenant does not grant one either -- the claim is what confers access.
        var withParameter = await client.GetAsync($"/dashboard/company-admin?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.Forbidden, withParameter.StatusCode);
    }

    [Fact]
    public async Task A_super_admin_must_name_a_company_for_the_company_dashboard()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain, clearCompany: true);

        var unscoped = await client.GetAsync("/dashboard/company-admin");
        Assert.Equal(HttpStatusCode.BadRequest, unscoped.StatusCode);

        var scoped = await client.GetAsync($"/dashboard/company-admin?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.OK, scoped.StatusCode);
        var body = (await scoped.Content.ReadFromJsonAsync<CompanyAdminDashboard>())!;
        Assert.Equal(_companyBId, body.CompanyId);
        Assert.Equal(1, body.CompletedResponseCount);
    }

    [Fact]
    public async Task The_company_dashboard_is_refused_to_the_non_admin_roles()
    {
        foreach (var role in new[] { Roles.Leader, Roles.Supervisor, Roles.Employee })
        {
            var client = await ClientAsync(role, _companyADomain, _companyAId, _engineeringId);
            var response = await client.GetAsync($"/dashboard/company-admin?companyId={_companyAId}");
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }
    }

    // ------------------------------------------------------------------
    // DepartmentAdmin
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_department_dashboard_scopes_a_leader_to_their_own_department()
    {
        var client = await ClientAsync(Roles.Leader, _companyADomain, _companyAId, _engineeringId);

        var response = await client.GetAsync("/dashboard/department-admin");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<DepartmentAdminDashboard>())!;

        Assert.Equal(_engineeringId, body.DepartmentId);
        Assert.Equal("Engineering", body.DepartmentName);
        Assert.Equal(_companyAId, body.CompanyId);
        Assert.Equal(2, body.CompletedResponseCount);
        Assert.Equal(2, body.OpenActionPlanCount);
        Assert.Equal(1, body.OverdueActionPlanCount);

        // Both of A's active surveys: the company-wide one (no targets) and the one
        // targeted at this department. B's active survey is another tenant's.
        Assert.Equal(2, body.ActiveSurveyCount);
        Assert.Equal(
            new[] { _engineeringOnlySurveyId, _companyWideSurveyId },
            body.ActiveSurveys.Select(s => s.Id));
    }

    [Fact]
    public async Task A_department_with_no_targeted_survey_still_sees_the_company_wide_one()
    {
        var client = await ClientAsync(Roles.Supervisor, _companyADomain, _companyAId, _salesId);

        var body = (await (await client.GetAsync("/dashboard/department-admin")).Content
            .ReadFromJsonAsync<DepartmentAdminDashboard>())!;

        Assert.Equal(_salesId, body.DepartmentId);
        Assert.Equal(new[] { _companyWideSurveyId }, body.ActiveSurveys.Select(s => s.Id));
        // Engineering's participation and its action plans belong to Engineering.
        Assert.Equal(0, body.CompletedResponseCount);
        Assert.Equal(0, body.OpenActionPlanCount);
    }

    /// <summary>
    /// Every figure on a department's page is that department's, including the ones in the
    /// survey table.
    ///
    /// <para>
    /// The defect this pins: <c>Survey.ResponseCount</c> and <c>Survey.TargetAudienceCount</c>
    /// are denormalised <em>tenant-wide</em> columns — the first bumped once per completed
    /// response anywhere in the company, the second the headcount the author typed in. The
    /// department dashboard used to project them straight through, so a leader of a
    /// six-person team read "Completed responses 5" as a KPI and, immediately below it for
    /// the same survey, "Responses 140 / Target 200". Two identically-named metrics at two
    /// different scopes, one of them describing every other department.
    /// </para>
    ///
    /// <para>
    /// 140 and 200 are seeded precisely so that the wrong answer is a number no correctly
    /// scoped query in this fixture could ever return.
    /// </para>
    /// </summary>
    [Fact]
    public async Task The_department_survey_list_counts_that_departments_responses_and_shows_no_tenant_target()
    {
        var engineering = await ClientAsync(Roles.Leader, _companyADomain, _companyAId, _engineeringId);
        var sales = await ClientAsync(Roles.Supervisor, _companyADomain, _companyAId, _salesId);

        var engineeringBody = (await (await engineering.GetAsync("/dashboard/department-admin")).Content
            .ReadFromJsonAsync<DepartmentAdminDashboard>())!;
        var salesBody = (await (await sales.GetAsync("/dashboard/department-admin")).Content
            .ReadFromJsonAsync<DepartmentAdminDashboard>())!;

        var forEngineering = Assert.Single(engineeringBody.ActiveSurveys, s => s.Id == _companyWideSurveyId);
        var forSales = Assert.Single(salesBody.ActiveSurveys, s => s.Id == _companyWideSurveyId);

        // Same survey, same tenant, two departments -- and therefore two different numbers.
        // Engineering has two completed responses to it (plus one incomplete, which is not
        // participation); Sales has none.
        Assert.Equal(2, forEngineering.ResponseCount);
        Assert.Equal(0, forSales.ResponseCount);

        // And it agrees with the KPI printed directly above it on the same page, which is
        // the disagreement that made the old behaviour a defect rather than a rounding
        // difference.
        Assert.Equal(engineeringBody.CompletedResponseCount, forEngineering.ResponseCount);
        Assert.Equal(salesBody.CompletedResponseCount, forSales.ResponseCount);

        // There is no per-department invited headcount in this schema, so the payload
        // offers none rather than passing off the tenant's. Read as raw JSON on purpose:
        // deserializing into the DTO would silently drop the field, so a typed assertion
        // could never see it come back.
        var raw = await (await engineering.GetAsync("/dashboard/department-admin")).Content
            .ReadFromJsonAsync<JsonElement>();
        var firstSurvey = raw.GetProperty("activeSurveys").EnumerateArray().First();
        Assert.False(firstSurvey.TryGetProperty("targetAudienceCount", out _));
    }

    [Fact]
    public async Task A_leader_naming_someone_elses_department_is_refused()
    {
        var client = await ClientAsync(Roles.Leader, _companyADomain, _companyAId, _engineeringId);

        var sibling = await client.GetAsync($"/dashboard/department-admin?departmentId={_salesId}");
        Assert.Equal(HttpStatusCode.Forbidden, sibling.StatusCode);

        var otherTenant = await client.GetAsync($"/dashboard/department-admin?departmentId={_companyBDepartmentId}");
        Assert.Equal(HttpStatusCode.Forbidden, otherTenant.StatusCode);
    }

    [Fact]
    public async Task A_company_admin_may_open_a_department_in_their_own_tenant_and_no_other()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var own = await client.GetAsync($"/dashboard/department-admin?departmentId={_engineeringId}");
        Assert.Equal(HttpStatusCode.OK, own.StatusCode);

        var foreign = await client.GetAsync($"/dashboard/department-admin?departmentId={_companyBDepartmentId}");
        Assert.Equal(HttpStatusCode.Forbidden, foreign.StatusCode);

        // Omitting the id is not "every department": it is a 400.
        var unscoped = await client.GetAsync("/dashboard/department-admin");
        Assert.Equal(HttpStatusCode.BadRequest, unscoped.StatusCode);
    }

    [Fact]
    public async Task An_employee_is_refused_the_department_dashboard_even_for_their_own_department()
    {
        var client = await ClientAsync(Roles.Employee, _companyADomain, _companyAId, _engineeringId);

        var response = await client.GetAsync($"/dashboard/department-admin?departmentId={_engineeringId}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // Employee (the evaluated user)
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_employee_dashboard_lists_the_surveys_that_person_still_owes()
    {
        var client = await ClientAsync(Roles.Employee, _companyADomain, _companyAId, _engineeringId);

        var response = await client.GetAsync("/dashboard/employee");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<EmployeeDashboard>())!;

        Assert.Equal(_companyAId, body.CompanyId);
        Assert.Equal(_engineeringId, body.DepartmentId);
        Assert.Equal("Engineering", body.DepartmentName);
        Assert.Equal(2, body.PendingSurveyCount);
        Assert.Equal(
            new[] { _engineeringOnlySurveyId, _companyWideSurveyId },
            body.PendingSurveys.Select(s => s.Id));
        // The soonest close date across the pending set, not merely the first row's.
        Assert.Equal(body.PendingSurveys.Min(s => s.EndDate), body.NextDeadline);
        // Nobody has answered anything AS THIS USER: the seeded responses are anonymous
        // rows with no user id.
        Assert.Equal(0, body.CompletedSurveyCount);
    }

    /// <summary>
    /// Home's task card leads with an "Anonymous" chip, so the flag behind it has to be the
    /// survey's own and not the page's assumption.
    ///
    /// <para>
    /// Both directions, in one request, against two surveys the same reader owes an answer
    /// to: the company-wide pulse is anonymous and the Engineering-only survey is not. A
    /// projection hardcoded either way passes half of this and fails the other half, which
    /// is the point -- the expensive mistake here is not a missing chip but a chip printed
    /// over a survey that records who answered.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Each_pending_survey_carries_its_own_anonymity_setting()
    {
        var client = await ClientAsync(Roles.Employee, _companyADomain, _companyAId, _engineeringId);

        var body = (await (await client.GetAsync("/dashboard/employee")).Content
            .ReadFromJsonAsync<EmployeeDashboard>())!;

        Assert.True(
            body.PendingSurveys.Single(s => s.Id == _companyWideSurveyId).Anonymous,
            "The anonymous survey came back unmarked, so its card would offer no promise at all.");
        Assert.False(
            body.PendingSurveys.Single(s => s.Id == _engineeringOnlySurveyId).Anonymous,
            "A survey that records who answered came back marked anonymous.");
    }

    /// <summary>
    /// The same fact, read off both screens that state it.
    ///
    /// <para>
    /// The chip on Home is a promise the respond page has to keep, and the two are served by
    /// different handlers over different projections. This asserts they cannot drift: for
    /// every survey in the queue, <c>/dashboard/employee</c> and <c>/surveys/{id}/respond</c>
    /// report the same anonymity. It is the reason the dashboard reads
    /// <c>Survey.Settings.Anonymous</c> rather than anything of its own.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Home_and_the_respond_page_never_disagree_about_anonymity()
    {
        var client = await ClientAsync(Roles.Employee, _companyADomain, _companyAId, _engineeringId);

        var body = (await (await client.GetAsync("/dashboard/employee")).Content
            .ReadFromJsonAsync<EmployeeDashboard>())!;

        // Vacuity control: the loop below proves nothing about a queue that is empty, or
        // one whose surveys happen to agree with each other.
        Assert.Equal(2, body.PendingSurveys.Count);
        Assert.Equal(2, body.PendingSurveys.Select(s => s.Anonymous).Distinct().Count());

        foreach (var pending in body.PendingSurveys)
        {
            var respondResponse = await client.GetAsync($"/surveys/{pending.Id}/respond");
            Assert.Equal(HttpStatusCode.OK, respondResponse.StatusCode);
            var respond = (await respondResponse.Content.ReadFromJsonAsync<SurveyRespondView>())!;

            Assert.Equal(respond.Anonymous, pending.Anonymous);
        }
    }

    [Fact]
    public async Task An_employee_outside_the_targeted_department_is_not_shown_that_survey()
    {
        var client = await ClientAsync(Roles.Employee, _companyADomain, _companyAId, _salesId);

        var body = (await (await client.GetAsync("/dashboard/employee")).Content
            .ReadFromJsonAsync<EmployeeDashboard>())!;

        Assert.Equal(1, body.PendingSurveyCount);
        Assert.Equal(new[] { _companyWideSurveyId }, body.PendingSurveys.Select(s => s.Id));
    }

    [Fact]
    public async Task The_employee_dashboard_never_reports_another_tenants_surveys()
    {
        var client = await ClientAsync(Roles.Employee, _companyBDomain, _companyBId, _companyBDepartmentId);

        var body = (await (await client.GetAsync("/dashboard/employee")).Content
            .ReadFromJsonAsync<EmployeeDashboard>())!;

        Assert.Equal(_companyBId, body.CompanyId);
        Assert.DoesNotContain(body.PendingSurveys, s => s.Id == _companyWideSurveyId);
        Assert.DoesNotContain(body.PendingSurveys, s => s.Id == _engineeringOnlySurveyId);
    }

    [Fact]
    public async Task The_employee_dashboard_counts_only_the_callers_own_unread_notifications()
    {
        var (mine, myEmail) = await ClientWithEmailAsync(Roles.Employee, _companyADomain, _companyAId, _engineeringId);
        var (_, theirEmail) = await ClientWithEmailAsync(Roles.Employee, _companyADomain, _companyAId, _engineeringId);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var meId = await db.Users.Where(u => u.Email == myEmail).Select(u => u.Id).FirstAsync();
            var themId = await db.Users.Where(u => u.Email == theirEmail).Select(u => u.Id).FirstAsync();
            var now = DateTimeOffset.UtcNow;

            // One unread and one already-opened for me; three unread for the other person.
            db.Notifications.AddRange(
                Notification(meId, _companyAId, openedAt: null),
                Notification(meId, _companyAId, openedAt: now),
                Notification(themId, _companyAId, openedAt: null),
                Notification(themId, _companyAId, openedAt: null),
                Notification(themId, _companyAId, openedAt: null));
            await db.SaveChangesAsync();
        }

        var body = (await (await mine.GetAsync("/dashboard/employee")).Content
            .ReadFromJsonAsync<EmployeeDashboard>())!;

        Assert.Equal(1, body.UnreadNotificationCount);
    }

    /// <summary>
    /// A global super_admin has no tenant (#191), so there is no survey they are expected
    /// to answer. Empty, not a 500 -- the same answer <c>/surveys/my</c> gives them.
    /// </summary>
    [Fact]
    public async Task The_employee_dashboard_is_empty_rather_than_broken_for_a_user_with_no_company()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain, clearCompany: true);

        var response = await client.GetAsync("/dashboard/employee");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<EmployeeDashboard>())!;

        Assert.Null(body.CompanyId);
        Assert.Equal(0, body.PendingSurveyCount);
        Assert.Empty(body.PendingSurveys);
        Assert.Null(body.NextDeadline);
    }

    [Fact]
    public async Task Survey_titles_come_back_in_the_requested_locale()
    {
        var client = await ClientAsync(Roles.Employee, _companyADomain, _companyAId, _salesId);

        var english = (await (await client.GetAsync("/dashboard/employee?lang=en")).Content
            .ReadFromJsonAsync<EmployeeDashboard>())!;
        var spanish = (await (await client.GetAsync("/dashboard/employee?lang=es")).Content
            .ReadFromJsonAsync<EmployeeDashboard>())!;

        Assert.Equal("Company-wide pulse", Assert.Single(english.PendingSurveys).Title);
        Assert.Equal("Company-wide pulse (ES)", Assert.Single(spanish.PendingSurveys).Title);
    }

    // ------------------------------------------------------------------
    // No N+1 — measured, not inferred
    // ------------------------------------------------------------------

    /// <summary>
    /// #132's "aggregate queries must not N+1; measure against realistic data", measured.
    ///
    /// <para>
    /// <b>Why here and not in a unit test.</b> The unit-test version of this guard counted
    /// statements in <c>ToQueryString()</c> and could not fail: EF renders one command from
    /// a query and cannot represent a second round trip in that string, so a deliberately
    /// pathological triple-nested correlated subquery scored exactly the same as the real
    /// projections. An N+1 translates perfectly well — it just executes N more times — so
    /// the only place it is observable is at execution. <see cref="CommandCountingInterceptor"/>
    /// counts what the request actually sent.
    /// </para>
    ///
    /// <para>
    /// <b>Why a bound rather than a before/after comparison.</b> The pages are row-limited,
    /// so "the count did not change when the data grew" goes quiet as soon as a page
    /// saturates — the platform overview is capped at twelve tenants and this database is
    /// shared, so it may well be full before this test adds anything. A fixed ceiling stays
    /// falsifiable either way: the fixture below is grown until every page is at or near its
    /// limit, so one extra round trip per row would put every route far past its ceiling.
    /// The slack under each ceiling matters less than the gap between that slack and what an
    /// N+1 would cost: the cheapest one available to any of these pages is five more round
    /// trips, and no ceiling here has five to spare.
    /// </para>
    /// </summary>
    [Fact]
    public async Task No_dashboard_issues_a_round_trip_per_row()
    {
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain, clearCompany: true);
        var companyAdmin = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var leader = await ClientAsync(Roles.Leader, _companyADomain, _companyAId, _engineeringId);
        var employee = await ClientAsync(Roles.Employee, _companyADomain, _companyAId, _engineeringId);

        await SeedRealisticVolumeAsync();

        var platform = await MeasureAsync(superAdmin, "/dashboard/super-admin");
        var tenant = await MeasureAsync(companyAdmin, "/dashboard/company-admin");
        var department = await MeasureAsync(leader, "/dashboard/department-admin");
        var mine = await MeasureAsync(employee, "/dashboard/employee");

        // Each page really is returning a page's worth of rows. Without this the ceilings
        // below would pass on an empty result set, which is the way a measurement like this
        // goes vacuous.
        var platformBody = await platform.Response.Content.ReadFromJsonAsync<SuperAdminDashboard>();
        var tenantBody = await tenant.Response.Content.ReadFromJsonAsync<CompanyAdminDashboard>();
        var departmentBody = await department.Response.Content.ReadFromJsonAsync<DepartmentAdminDashboard>();
        var mineBody = await mine.Response.Content.ReadFromJsonAsync<EmployeeDashboard>();

        Assert.True(platformBody!.Companies.Count >= 8, $"companies: {platformBody.Companies.Count}");
        Assert.True(tenantBody!.Departments.Count >= 10, $"departments: {tenantBody.Departments.Count}");
        Assert.Equal(5, tenantBody.OngoingSurveys.Count);
        Assert.Equal(5, departmentBody!.ActiveSurveys.Count);
        Assert.Equal(5, mineBody!.PendingSurveys.Count);

        // Measured on this fixture: 6 / 9 / 9 / 9, one under each ceiling. It was 5 / 8 / 8 / 8
        // when these ceilings were written; #284's revocation check adds one SELECT to every
        // authenticated request, which is why all four moved by exactly one and none of them
        // moved by a row count. The remaining slack is one rather than two, and that is still
        // not enough to hide an N+1: the smallest any of these pages could acquire costs five
        // more (the survey lists are capped at five rows) and the largest costs eleven
        // (company A's departments).
        Assert.True(platform.Commands <= 7, $"platform overview sent {platform.Commands} commands");
        Assert.True(tenant.Commands <= 10, $"tenant dashboard sent {tenant.Commands} commands");
        Assert.True(department.Commands <= 10, $"department dashboard sent {department.Commands} commands");
        Assert.True(mine.Commands <= 10, $"employee dashboard sent {mine.Commands} commands");
    }

    /// <summary>One request, and the number of database commands it sent.</summary>
    private async Task<(HttpResponseMessage Response, int Commands)> MeasureAsync(HttpClient client, string url)
    {
        // Reset immediately before the request: signup and login went through this counter
        // too, and so does anything the seeding above did.
        _factory.CommandCounter.Reset();
        var response = await client.GetAsync(url);
        var commands = _factory.CommandCounter.Count;
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (response, commands);
    }

    /// <summary>
    /// Enough rows that every list on every dashboard is at or past its limit: nine more
    /// tenants (the platform card grid takes twelve, newest first), nine more departments in
    /// company A (its table takes twelve), six more company-wide active surveys (every
    /// survey list takes five) and a completed response to each from Engineering.
    /// </summary>
    private async Task SeedRealisticVolumeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;
        var authorA = await SeedUserAsync(db, _companyAId, _engineeringId);

        for (var i = 0; i < 9; i++)
        {
            db.Companies.Add(new Company
            {
                Id = Guid.NewGuid(),
                Name = $"Volume Co {i}",
                EmailDomain = $"vol-{Guid.NewGuid():N}.test",
                CreatedAt = now,
            });
            db.Departments.Add(new Department
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyAId,
                Name = $"Volume Dept {i}",
                CreatedAt = now,
                UpdatedAt = now,
            });
        }

        await db.SaveChangesAsync();

        for (var i = 0; i < 6; i++)
        {
            var surveyId = await SeedSurveyAsync(
                db, _companyAId, authorA, $"Volume survey {i}", SurveyStatuses.Active, now.AddDays(2 + i));
            await SeedResponseAsync(db, surveyId, _companyAId, _engineeringId, isComplete: true);
        }
    }

    /// <summary>
    /// A delivered notification, read or unread.
    /// </summary>
    /// <remarks>
    /// <b>Status is <c>sent</c>, not the <c>pending</c> default, and that is not cosmetic.</b>
    /// <c>GET /admin/system/status</c> reports the notification backlog for the WHOLE
    /// deployment — there is no tenant scoping that could keep another class's rows out of
    /// it — and <c>SystemStatusEndpointsTests</c> asserts exact pending/due counts without
    /// clearing the table first. Seeding five pending rows here turned its expected 3 into
    /// an 8, from a different test class in a different directory. Sent rows are invisible
    /// to that count, and they are the more accurate fixture anyway: "unread" is
    /// <c>OpenedAt == null</c>, which is a property of a notification that *has* been
    /// delivered.
    /// </remarks>
    private static Notification Notification(Guid userId, Guid companyId, DateTimeOffset? openedAt)
    {
        var now = DateTimeOffset.UtcNow;
        return new Notification
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            CompanyId = companyId,
            Type = "survey_reminder",
            Channel = "email",
            Title = "Reminder",
            Message = "Please respond",
            Status = NotificationStatuses.Sent,
            ScheduledFor = now.AddMinutes(-5),
            SentAt = now.AddMinutes(-5),
            OpenedAt = openedAt,
            CreatedAt = now,
            UpdatedAt = now,
        };
    }
}
