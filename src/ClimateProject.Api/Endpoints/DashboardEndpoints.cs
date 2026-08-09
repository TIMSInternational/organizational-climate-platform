using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Dashboard;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The four role dashboards (#132) — the landing page for every user.
///
/// Not to be confused with <c>services/tracking-api</c>'s file of the same name, which
/// serves the tracking product's own dashboard and shares nothing with this one.
///
/// ## One endpoint per role, not one endpoint with a role switch
///
/// Each route returns only what its role may see, and refuses every other role outright.
/// The rejected alternative — a single <c>GET /dashboard</c> returning the union and a
/// client that hides the parts it should not draw — publishes every tenant's figures to
/// anyone who opens the network tab. Nothing here is filtered client-side; the scope is
/// decided in the handler before a single row is read.
///
/// ## The scoping rule, and the hole it is written to avoid
///
/// <c>CompanyId == null</c> is **GLOBAL** in this schema — the most privileged value, not
/// the least (see <c>User.CompanyId</c>, and #191). A guard shaped "did the caller supply
/// a company id?" is therefore backwards: the *absence* of a scope is the widest scope
/// there is, and that exact hole has been found twice already (#207, #256).
///
/// So every handler below opens the same way:
///
/// <list type="number">
/// <item>Widening is reached only through <c>Role == Roles.SuperAdmin</c>, explicitly,
/// first. No other branch can ever produce a query with no tenant predicate.</item>
/// <item>A <c>company_admin</c> whose <c>companyId</c> claim is missing or unparseable is
/// <c>Forbid</c>, never "unscoped". <see cref="OwnCompanyId"/> returns null there and every
/// caller treats null as denial.</item>
/// <item>A supplied <c>companyId</c>/<c>departmentId</c> is a *narrowing* request that is
/// checked against what the caller already had. It never grants anything.</item>
/// </list>
///
/// ## Department membership comes from the user's row, never from the token
///
/// Same reason <c>SurveyEndpoints.ListMineAsync</c> gives: people move teams, and a token
/// minted before a transfer would keep serving the old team's numbers until it expired.
///
/// ## No N+1
///
/// Every per-row figure is a correlated subquery inside the list projection — see
/// <see cref="DashboardQueries"/>, whose whole reason to exist as a separate,
/// <c>IQueryable</c>-taking class is that <c>DashboardQueriesTests</c> can then assert the
/// generated SQL directly. A handler here issues a fixed, small number of statements
/// whatever the size of the tenant.
/// </summary>
public static class DashboardEndpoints
{
    /// <summary>
    /// Tenants shown on the platform overview. Bounded because the card grid is a summary,
    /// not a directory — <c>/admin/companies</c> is the paginated list.
    /// </summary>
    private const int CompanyRowLimit = 12;

    /// <summary>Departments shown on the company overview. Same reasoning; the full org chart is <c>/departments</c>.</summary>
    private const int DepartmentRowLimit = 12;

    /// <summary>Surveys shown in a dashboard list.</summary>
    private const int SurveyRowLimit = 5;

    public static void MapDashboardEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/dashboard").RequireAuthorization();

        group.MapGet("/super-admin", SuperAdminAsync);
        group.MapGet("/company-admin", CompanyAdminAsync);
        group.MapGet("/department-admin", DepartmentAdminAsync);
        group.MapGet("/employee", EmployeeAsync);
    }

    /// <summary>
    /// The caller's own tenant, or null when they have none —
    /// <see cref="CompanyScope.OwnCompanyId"/>, not a second copy of it, so a blank or
    /// malformed claim is handled here exactly as everywhere else.
    ///
    /// Null is a *denial* everywhere it is consumed below, never a widening. A global
    /// super_admin's claim is the empty string (#191), so this returning null for them is
    /// correct and harmless: their branch is chosen by role before this is ever called.
    /// </summary>
    private static Guid? OwnCompanyId(CurrentUser currentUser)
        => CompanyScope.OwnCompanyId(currentUser);

    private static IResult CompanyIdRequired()
        => Results.Json(new { message = "companyId is required" }, statusCode: 400);

    private static IResult DepartmentIdRequired()
        => Results.Json(new { message = "departmentId is required" }, statusCode: 400);

    // ------------------------------------------------------------------
    // SuperAdmin — the platform overview
    // ------------------------------------------------------------------

    private static async Task<IResult> SuperAdminAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var companyCount = await db.Companies.CountAsync(cancellationToken);
        var users = await DashboardQueries.UserCounts(db.Users).FirstOrDefaultAsync(cancellationToken)
                    ?? DashboardUserCounts.Empty;
        var surveys = await DashboardQueries.SurveyCounts(db.Surveys).FirstOrDefaultAsync(cancellationToken)
                      ?? DashboardSurveyCounts.Empty;
        var responses = await DashboardQueries.ResponseCounts(db.Responses).FirstOrDefaultAsync(cancellationToken)
                        ?? DashboardResponseCounts.Empty;

        var companies = await DashboardQueries
            .CompanySummaries(db.Companies, db.Users, db.Surveys, db.Responses, CompanyRowLimit)
            .ToListAsync(cancellationToken);

        return Results.Ok(new SuperAdminDashboard(
            companyCount,
            users.Total,
            users.Active,
            surveys.Total,
            surveys.Active,
            responses.Total,
            responses.Completed,
            companies
                .Select(c => new DashboardCompanySummary(
                    c.Id, c.Name, c.UserCount, c.ActiveSurveyCount, c.CompletedResponseCount, c.CreatedAt))
                .ToList()));
    }

    // ------------------------------------------------------------------
    // CompanyAdmin — one tenant
    // ------------------------------------------------------------------

    private static async Task<IResult> CompanyAdminAsync(
        Guid? companyId,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        Guid scopedCompanyId;
        if (currentUser.Role == Roles.SuperAdmin)
        {
            // Required, not optional. A super_admin with no company selected has the
            // platform dashboard; silently defaulting to "all companies" here would give
            // this endpoint two completely different meanings depending on a query string.
            if (companyId is not Guid requested)
            {
                return CompanyIdRequired();
            }

            scopedCompanyId = requested;
        }
        else if (currentUser.Role == Roles.CompanyAdmin)
        {
            if (OwnCompanyId(currentUser) is not Guid own)
            {
                return Results.Forbid();
            }

            // Refused rather than silently ignored. A CompanyAdmin who asked for another
            // tenant's numbers gets told no; quietly answering with their own would let a
            // caller believe the figures on screen are the ones they requested.
            if (companyId.HasValue && companyId.Value != own)
            {
                return Results.Forbid();
            }

            scopedCompanyId = own;
        }
        else
        {
            return Results.Forbid();
        }

        var company = await db.Companies
            .Where(c => c.Id == scopedCompanyId)
            .Select(c => new { c.Id, c.Name })
            .FirstOrDefaultAsync(cancellationToken);
        if (company is null)
        {
            return Results.Json(new { message = "Company not found" }, statusCode: 404);
        }

        var now = DateTimeOffset.UtcNow;
        var scopedSurveys = db.Surveys.Where(s => s.CompanyId == scopedCompanyId);

        var users = await DashboardQueries
            .UserCounts(db.Users.Where(u => u.CompanyId == scopedCompanyId))
            .FirstOrDefaultAsync(cancellationToken) ?? DashboardUserCounts.Empty;
        var departmentCount = await db.Departments.CountAsync(d => d.CompanyId == scopedCompanyId, cancellationToken);
        var surveys = await DashboardQueries.SurveyCounts(scopedSurveys)
            .FirstOrDefaultAsync(cancellationToken) ?? DashboardSurveyCounts.Empty;
        var responses = await DashboardQueries
            .ResponseCounts(db.Responses.Where(r => r.CompanyId == scopedCompanyId))
            .FirstOrDefaultAsync(cancellationToken) ?? DashboardResponseCounts.Empty;
        var actionPlans = await DashboardQueries
            .ActionPlanCounts(db.ActionPlans.Where(p => p.CompanyId == scopedCompanyId), now)
            .FirstOrDefaultAsync(cancellationToken) ?? DashboardActionPlanCounts.Empty;

        var ongoing = await DashboardQueries
            .SurveySummaries(scopedSurveys.Where(s => s.Status == SurveyStatuses.Active), SurveyRowLimit)
            .ToListAsync(cancellationToken);

        var departments = await DashboardQueries
            .DepartmentSummaries(db.Departments, db.Users, db.Responses, scopedCompanyId, DepartmentRowLimit)
            .ToListAsync(cancellationToken);

        return Results.Ok(new CompanyAdminDashboard(
            company.Id,
            company.Name,
            users.Total,
            users.Active,
            departmentCount,
            surveys.Total,
            surveys.Active,
            surveys.Draft,
            responses.Total,
            responses.Completed,
            actionPlans.Open,
            actionPlans.Overdue,
            ongoing.Select(s => ToSummary(s, lang)).ToList(),
            departments
                .Select(d => new DashboardDepartmentSummary(d.Id, d.Name, d.MemberCount, d.CompletedResponseCount))
                .ToList()));
    }

    // ------------------------------------------------------------------
    // DepartmentAdmin — one department
    // ------------------------------------------------------------------

    private static async Task<IResult> DepartmentAdminAsync(
        Guid? departmentId,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        // `leader` and `supervisor` are this repo's department-scoped roles; there is no
        // `department_admin` in `Roles`. Both run a department, so both land here.
        var runsADepartment = currentUser.Role is Roles.Leader or Roles.Supervisor;
        if (!runsADepartment && currentUser.Role != Roles.SuperAdmin && currentUser.Role != Roles.CompanyAdmin)
        {
            return Results.Forbid();
        }

        Guid scopedDepartmentId;
        if (runsADepartment)
        {
            var actingUserId = await SurveyEndpoints.ResolveActingUserIdAsync(currentUser, db, cancellationToken);
            if (actingUserId is null)
            {
                return SurveyEndpoints.ActingUserRequired();
            }

            var me = await db.Users
                .Where(u => u.Id == actingUserId.Value)
                .Select(u => new { u.DepartmentId })
                .FirstAsync(cancellationToken);

            // Read from the row, not the token: people move teams.
            if (me.DepartmentId is not Guid mine)
            {
                return Results.Json(
                    new { message = "The authenticated user is not assigned to a department" },
                    statusCode: 400);
            }

            // Narrowing only. Naming someone else's department is a denial, not a lookup.
            if (departmentId.HasValue && departmentId.Value != mine)
            {
                return Results.Forbid();
            }

            scopedDepartmentId = mine;
        }
        else
        {
            if (departmentId is not Guid requested)
            {
                return DepartmentIdRequired();
            }

            scopedDepartmentId = requested;
        }

        var department = await db.Departments
            .Where(d => d.Id == scopedDepartmentId)
            .Select(d => new { d.Id, d.Name, d.CompanyId })
            .FirstOrDefaultAsync(cancellationToken);
        if (department is null)
        {
            return Results.Json(new { message = "Department not found" }, statusCode: 404);
        }

        // The tenant check for the two admin roles, applied AFTER the row is loaded because
        // it is the row that says which tenant the department belongs to. A super_admin
        // passes unconditionally; a company_admin only on their own company; and a
        // company_admin with no parseable claim is refused rather than widened.
        if (currentUser.Role == Roles.CompanyAdmin
            && (OwnCompanyId(currentUser) is not Guid ownCompanyId || ownCompanyId != department.CompanyId))
        {
            return Results.Forbid();
        }

        var now = DateTimeOffset.UtcNow;

        var members = await DashboardQueries
            .UserCounts(db.Users.Where(u => u.DepartmentId == scopedDepartmentId && u.CompanyId == department.CompanyId))
            .FirstOrDefaultAsync(cancellationToken) ?? DashboardUserCounts.Empty;

        var responses = await DashboardQueries
            .ResponseCounts(db.Responses.Where(r =>
                r.DepartmentId == scopedDepartmentId && r.CompanyId == department.CompanyId))
            .FirstOrDefaultAsync(cancellationToken) ?? DashboardResponseCounts.Empty;

        var actionPlans = await DashboardQueries
            .ActionPlanCounts(
                db.ActionPlans.Where(p => p.DepartmentId == scopedDepartmentId && p.CompanyId == department.CompanyId),
                now)
            .FirstOrDefaultAsync(cancellationToken) ?? DashboardActionPlanCounts.Empty;

        var activeSurveys = DashboardQueries.ActiveForDepartment(
            db.Surveys, db.SurveyDepartmentTargets, department.CompanyId, scopedDepartmentId);

        var activeSurveyCount = await activeSurveys.CountAsync(cancellationToken);
        var surveyRows = await DashboardQueries
            .SurveySummaries(activeSurveys, SurveyRowLimit)
            .ToListAsync(cancellationToken);

        return Results.Ok(new DepartmentAdminDashboard(
            department.Id,
            department.Name,
            department.CompanyId,
            members.Total,
            members.Active,
            activeSurveyCount,
            responses.Completed,
            actionPlans.Open,
            actionPlans.Overdue,
            surveyRows.Select(s => ToSummary(s, lang)).ToList()));
    }

    // ------------------------------------------------------------------
    // Employee — the evaluated user
    // ------------------------------------------------------------------

    private static async Task<IResult> EmployeeAsync(
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        // No role gate at all, deliberately, and this is the one route here where that is
        // right: everything below is scoped to the caller's OWN user row and describes
        // nobody else, exactly like `/surveys/my` and `/notifications/mine`. A role check
        // would be the wrong axis — the question is not "what may this role see" but
        // "whose row is this", and the answer is always "their own".
        var actingUserId = await SurveyEndpoints.ResolveActingUserIdAsync(currentUser, db, cancellationToken);
        if (actingUserId is null)
        {
            return SurveyEndpoints.ActingUserRequired();
        }

        var me = await db.Users
            .Where(u => u.Id == actingUserId.Value)
            .Select(u => new { u.Id, u.Name, u.CompanyId, u.DepartmentId })
            .FirstAsync(cancellationToken);

        var unreadNotifications = await db.Notifications
            .CountAsync(n => n.UserId == me.Id && n.OpenedAt == null, cancellationToken);

        // A user with no company belongs to no tenant (#191, a global super_admin). There
        // is no survey they are expected to answer, so this is an empty dashboard rather
        // than an error -- the same answer `/surveys/my` gives them.
        if (me.CompanyId is not Guid myCompanyId)
        {
            return Results.Ok(new EmployeeDashboard(
                me.Name, null, null, null, 0, 0, unreadNotifications, null, []));
        }

        var departmentName = me.DepartmentId is Guid myDepartmentId
            ? await db.Departments
                .Where(d => d.Id == myDepartmentId)
                .Select(d => d.Name)
                .FirstOrDefaultAsync(cancellationToken)
            : null;

        var assigned = SurveyQueries.AssignedTo(
            db.Surveys, db.SurveyDepartmentTargets, db.Responses, myCompanyId, me.DepartmentId, me.Id);

        var pendingCount = await assigned.CountAsync(cancellationToken);
        var pendingRows = await DashboardQueries
            .PendingSurveys(assigned, db.Questions, SurveyRowLimit)
            .ToListAsync(cancellationToken);

        var completedCount = await db.Responses
            .CountAsync(r => r.UserId == me.Id && r.IsComplete, cancellationToken);

        // The soonest close date across ALL pending surveys, not merely the page of them
        // above -- with a row limit of five, taking `pendingRows.First()` would be right
        // today and wrong the moment the list is sorted any other way.
        var nextDeadline = pendingCount == 0
            ? null
            : (DateTimeOffset?)await assigned.MinAsync(s => s.EndDate, cancellationToken);

        return Results.Ok(new EmployeeDashboard(
            me.Name,
            myCompanyId,
            me.DepartmentId,
            departmentName,
            pendingCount,
            completedCount,
            unreadNotifications,
            nextDeadline,
            pendingRows
                .Select(s => new DashboardPendingSurvey(
                    s.Id,
                    LocalizedContent.ResolveText(s.TitleEn, s.TitleEs, lang, s.Language),
                    s.Type,
                    s.StartDate,
                    s.EndDate,
                    s.QuestionCount))
                .ToList()));
    }

    private static DashboardSurveySummary ToSummary(DashboardSurveyRow row, string? lang)
        => new(
            row.Id,
            LocalizedContent.ResolveText(row.TitleEn, row.TitleEs, lang, row.Language),
            row.Status,
            row.StartDate,
            row.EndDate,
            row.ResponseCount,
            row.TargetAudienceCount);
}
