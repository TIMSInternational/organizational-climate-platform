using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
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
        _companyWideSurveyId = await SeedSurveyAsync(db, companyA.Id, authorA, "Company-wide pulse", SurveyStatuses.Active, now.AddDays(30));
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

    private static async Task<Guid> SeedSurveyAsync(
        ClimateProjectDbContext db, Guid companyId, Guid createdBy, string title, string status, DateTimeOffset endDate)
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
