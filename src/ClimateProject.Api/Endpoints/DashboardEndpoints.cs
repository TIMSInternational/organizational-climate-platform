using System.Net.Mime;
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
/// whatever the size of the tenant, and that is *measured* rather than asserted from the
/// shape of the LINQ: <c>DashboardEndpointsTests.No_dashboard_issues_a_round_trip_per_row</c>
/// counts the commands a real request sends through a <c>DbCommandInterceptor</c>, with the
/// fixture grown past every row limit below.
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

    /// <summary>
    /// Action plans named in "what came of the last one". A short narrative of what
    /// happened after a survey closed, not the plan directory -- <c>/action-plans</c> is
    /// that, and <c>openPlanCount</c> carries the full tally either way.
    /// </summary>
    private const int PlanRowLimit = 5;

    /// <summary>
    /// The dimension name <c>SurveyAggregation.DepartmentBreakdown</c> stamps on the
    /// department breakdown. A literal there and a literal here is one literal too many,
    /// but the aggregation exposes no constant to bind to and inventing one is a change to
    /// a file this work does not own. The coupling is guarded rather than trusted:
    /// <c>EmployeeLastOutcomeEndpointTests</c> asserts a non-zero protected count against a
    /// fixture built to produce one, which is exactly the assertion a renamed dimension
    /// would silently turn into a zero.
    /// </summary>
    private const string DepartmentDimension = "department";

    public static void MapDashboardEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/dashboard").RequireAuthorization();

        group.MapGet("/super-admin", SuperAdminAsync);
        group.MapGet("/company-admin", CompanyAdminAsync);
        group.MapGet("/department-admin", DepartmentAdminAsync);
        group.MapGet("/employee", EmployeeAsync);
        group.MapGet("/employee/last-outcome", EmployeeLastOutcomeAsync);
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

        // SurveySummaries, the company dashboard's projection, is deliberately NOT used here.
        // Its two participation columns are the survey row's own denormalised
        // company-wide figures, and printing them on a page contracted to one department
        // puts "Responses 140 / Target 200" directly beneath this page's own
        // department-scoped "Completed responses 5".
        var surveyRows = await DashboardQueries
            .SurveySummariesForDepartment(
                activeSurveys, db.Responses, department.CompanyId, scopedDepartmentId, SurveyRowLimit)
            .ToListAsync(cancellationToken);

        var climate = await TeamClimateAsync(
            db, department.CompanyId, scopedDepartmentId, lang, cancellationToken);

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
            surveyRows.Select(s => ToDepartmentSummary(s, lang)).ToList(),
            climate));
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
                    s.QuestionCount,
                    // Carried straight through from the survey row. `SurveyRespondView`
                    // sends the same field from the same place, so the chip on this card
                    // and the promise on the page it opens are one fact, not two.
                    s.Anonymous))
                .ToList()));
    }

    // ------------------------------------------------------------------
    // Employee — what came of the last one
    // ------------------------------------------------------------------

    /// <summary>
    /// <c>GET /dashboard/employee/last-outcome</c> — the panel that answers the question
    /// anonymity leaves open.
    ///
    /// ## Why an employee may read this at all
    ///
    /// No role gate, exactly like <see cref="EmployeeAsync"/> and for the same reason: the
    /// acting user is resolved from their own row and every figure below is scoped to the
    /// company on that row. There is no argument that could widen it, so there is no role
    /// question to ask.
    ///
    /// ## Why it is not a side door into results
    ///
    /// All four <c>/surveys/{id}/results</c> routes go through
    /// <c>SurveyEndpoints.CanAdminister</c>, so this handler serving the same survey to an
    /// employee has to be more than "returns less". Two properties keep it honest:
    ///
    /// <list type="number">
    /// <item><b>Nothing scored is ever computed.</b> The aggregation is fed no questions
    /// and no answers, so <c>SurveyAggregate.Questions</c> is empty by construction and
    /// every segment's question list with it. There is no per-question, per-segment or
    /// per-dimension number in memory for a later edit to accidentally serialise, which is
    /// a stronger guarantee than a projection that carefully leaves them out.</item>
    /// <item><b>A protected department is counted and never named.</b> Suppression exists
    /// to hide a group small enough that the group is the person, so publishing "Finance
    /// was withheld" would defeat it in the act of announcing it. The withheld names are
    /// filtered out of the plan list too — see
    /// <see cref="DashboardPlanOpened.DepartmentName"/> for why a nameless row beats a
    /// missing one.</item>
    /// </list>
    ///
    /// The responses and the departments <em>are</em> fed in whole, because those are the
    /// inputs the suppression decision actually reads. What is withheld from the
    /// aggregation is precisely what would be a leak coming out of it.
    ///
    /// ## Below the survey floor
    ///
    /// A survey under <c>SurveyResultsPrivacy.MinimumRespondents</c> comes back from the
    /// aggregation with no breakdowns at all, so both department counts are zero here while
    /// <c>responseCount</c> still reports the handful of answers. That is the existing rule
    /// showing through rather than a special case: below that floor the product declines to
    /// describe the shape of who answered, and this panel is not the surface that gets to
    /// overrule it.
    /// </summary>
    private static async Task<IResult> EmployeeLastOutcomeAsync(
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        var actingUserId = await SurveyEndpoints.ResolveActingUserIdAsync(currentUser, db, cancellationToken);
        if (actingUserId is null)
        {
            return SurveyEndpoints.ActingUserRequired();
        }

        var me = await db.Users
            .Where(u => u.Id == actingUserId.Value)
            .Select(u => new { u.CompanyId })
            .FirstAsync(cancellationToken);

        // A user with no company belongs to no tenant (#191). Nothing has closed for them,
        // which is the same answer as a tenant that has never closed a survey.
        if (me.CompanyId is not Guid myCompanyId)
        {
            return NoLastOutcome();
        }

        var survey = await DashboardQueries
            .LatestClosedSurvey(db.Surveys, myCompanyId)
            .FirstOrDefaultAsync(cancellationToken);
        if (survey is null)
        {
            return NoLastOutcome();
        }

        var responseRows = await DashboardQueries
            .SurveyResponses(db.Responses, survey.Id, myCompanyId)
            .ToListAsync(cancellationToken);

        var departments = await DashboardQueries
            .AggregationDepartments(db.Departments, db.Users, myCompanyId)
            .ToListAsync(cancellationToken);

        var noDemographics = new Dictionary<string, string>(StringComparer.Ordinal);
        var aggregate = SurveyAggregation.Compute(
            // Empty, and this is the load-bearing line of the handler. Questions and
            // answers feed nothing in the aggregation but the per-question and per-segment
            // figures -- exactly what this endpoint may not return -- so streaming the
            // answer table for them would be cost with no output, and their absence turns
            // "we do not serialise the scores" into "there are no scores to serialise".
            questions: [],
            responses: [.. responseRows.Select(r => new AggregationResponse(
                r.ResponseId,
                r.Language,
                r.DepartmentId,
                r.IsComplete,
                r.StartTime,
                r.CompletionTime,
                r.TotalTimeSeconds,
                noDemographics))],
            answers: [],
            departments: departments,
            // No participation rate is rendered here, and the aggregation's own answer for
            // "no invited headcount" is null rather than a fabricated denominator.
            targetAudienceCount: null);

        // Absent below the survey floor, where the aggregation returns no breakdowns at
        // all. Empty is then the correct reading of both counts -- see the summary above.
        var byDepartment = aggregate.Breakdowns
            .FirstOrDefault(b => string.Equals(b.Dimension, DepartmentDimension, StringComparison.Ordinal));
        var segments = byDepartment?.Segments ?? [];

        // The withheld ids never leave this method. They exist only to decide which names
        // may -- see the plan projection below.
        var protectedDepartmentIds = new HashSet<Guid>();
        foreach (var segment in segments)
        {
            if (segment.IsSuppressed && Guid.TryParse(segment.Key, out var withheldId))
            {
                protectedDepartmentIds.Add(withheldId);
            }
        }

        var openPlans = DashboardQueries.OpenPlansOpenedSince(db.ActionPlans, myCompanyId, survey.EndDate);
        var openPlanCount = await openPlans.CountAsync(cancellationToken);
        var planRows = await DashboardQueries
            .PlansOpened(openPlans, db.Departments, PlanRowLimit)
            .ToListAsync(cancellationToken);

        return Results.Ok(new EmployeeLastOutcome(
            survey.Id,
            LocalizedContent.ResolveText(survey.TitleEn, survey.TitleEs, lang, survey.Language),
            survey.EndDate,
            aggregate.Summary.CompletedCount,
            segments.Count,
            segments.Count(s => s.IsSuppressed),
            SurveyResultsPrivacy.MinimumSegmentRespondents,
            [.. planRows.Select(p => new DashboardPlanOpened(
                p.DepartmentId is Guid departmentId && !protectedDepartmentIds.Contains(departmentId)
                    ? p.DepartmentName
                    : null,
                p.CreatedAt))],
            openPlanCount));
    }

    /// <summary>
    /// There is no last one. A JSON <c>null</c> at 200 rather than a 404 or a zero-filled
    /// payload: the panel is absent, not empty, and the client's job is to hide it. A 404
    /// would say the route was wrong, and a shape full of zeroes would render as "0 answers
    /// across 0 departments" — a sentence about a survey that never happened.
    /// </summary>
    /// <remarks>
    /// Written as text rather than as <c>Results.Json&lt;EmployeeLastOutcome?&gt;(null)</c>,
    /// which looks like the same thing and is not: the framework's JSON writer returns early
    /// on a null value, so that overload sends a **zero-length body** stamped
    /// <c>application/json</c>. Every caller in <c>web/</c> reaches the response through
    /// <c>authFetch</c> and then calls <c>.json()</c> on it, and <c>.json()</c> throws on an
    /// empty body. Four bytes of valid JSON parse to null everywhere and need no client to
    /// special-case a status code. Guarded by
    /// <c>Nothing_comes_back_when_the_company_has_never_closed_a_survey</c>, which asserts
    /// the bytes rather than the deserialised value for exactly this reason.
    /// </remarks>
    private static IResult NoLastOutcome() => Results.Text("null", MediaTypeNames.Application.Json);

    private static DashboardSurveySummary ToSummary(DashboardSurveyRow row, string? lang)
        => new(
            row.Id,
            LocalizedContent.ResolveText(row.TitleEn, row.TitleEs, lang, row.Language),
            row.Status,
            row.StartDate,
            row.EndDate,
            row.ResponseCount,
            row.TargetAudienceCount);

    private static DashboardDepartmentSurveySummary ToDepartmentSummary(
        DashboardDepartmentSurveyRow row,
        string? lang)
        => new(
            row.Id,
            LocalizedContent.ResolveText(row.TitleEn, row.TitleEs, lang, row.Language),
            row.Status,
            row.StartDate,
            row.EndDate,
            row.ResponseCount);

    /// <summary>
    /// One department's climate scores from the most recent survey it could have answered.
    ///
    /// **This is the second caller for the per-dimension aggregation**, which is what this
    /// screen's own note said it was waiting for. It runs the same
    /// <see cref="SurveyAggregateLoader"/> the results routes and the climate-over-time
    /// matrix run, and rolls the department's segment up through the shared
    /// <see cref="SurveyAggregation.SegmentDimensionScores"/> — so a leader's dashboard and
    /// a company admin's climate map cannot print two different numbers for the same team.
    ///
    /// **The most recent CLOSED survey, not the active one.** An open survey's scores move
    /// under the reader between two loads, and a team reading that changes while nobody
    /// answered anything invites the leader to read collection progress as a change in
    /// climate. It is also why the participation figures above this are a separate
    /// question from the scores.
    ///
    /// **Cost:** exactly one aggregation, of one survey. The trends route is capped at
    /// twelve because it is this N times; a dashboard is a page load and reads one.
    ///
    /// Returns null when the company has no closed survey at all — "nothing has closed
    /// yet" is a different statement from "your team's reading is withheld", and the two
    /// must not collapse into one empty panel.
    /// </summary>
    private static async Task<DashboardTeamClimate?> TeamClimateAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        Guid departmentId,
        string? lang,
        CancellationToken cancellationToken)
    {
        var survey = await db.Surveys
            .AsNoTracking()
            .Where(s => s.CompanyId == companyId
                        && (s.Status == SurveyStatuses.Closed || s.Status == SurveyStatuses.Archived))
            .OrderByDescending(s => s.EndDate)
            .ThenByDescending(s => s.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (survey is null) return null;

        var locale = SurveyContent.ResolveRequestLocale(lang, survey.Language);
        var fallbackFields = new List<string>();
        var aggregate = await SurveyAggregateLoader.ComputeAsync(
            db, survey, locale, fallbackFields, cancellationToken);

        var title = SurveyContent.Resolve(
            survey.TitleEn, survey.TitleEs, locale, survey.Language, "title", fallbackFields);

        // A survey below its OWN floor withholds every group in it, however large the
        // department -- that floor is about the survey, and a big team inside a small
        // survey does not satisfy it. Its dimension list is empty too, so there is not
        // even a set of names to withhold scores for.
        if (aggregate.IsSuppressed)
        {
            return new DashboardTeamClimate(
                survey.Id, title, survey.EndDate, 0, IsSuppressed: true,
                SurveyResultsPrivacy.MinimumSegmentRespondents, []);
        }

        // A withheld SEGMENT still names the dimensions, with null scores.
        //
        // Which dimensions an instrument asked about is not the protected fact -- it is the
        // same list for everyone in the company, and a leader can already read it off the
        // survey. The protected fact is this team's SCORES. Returning an empty list instead
        // would leave a client with no columns to hatch, so the row would render blank,
        // which is precisely the "reads as missing data" failure `ProtectedCell` exists to
        // prevent. Found by writing the test for it: the grid drew nothing at all.
        var withheld = new DashboardTeamClimate(
            survey.Id, title, survey.EndDate, 0, IsSuppressed: true,
            SurveyResultsPrivacy.MinimumSegmentRespondents,
            aggregate.Dimensions
                .Select(d => new DashboardDimensionScore(d.Dimension, null))
                .ToList());

        var segment = aggregate.Breakdowns
            .FirstOrDefault(b => string.Equals(b.Dimension, "department", StringComparison.Ordinal))
            ?.Segments
            .FirstOrDefault(s => string.Equals(s.Key, departmentId.ToString(), StringComparison.Ordinal));

        // Absent and too-small collapse to one withheld answer on purpose: told apart, a
        // reader could difference "we did not answer" against "we were too few" and learn
        // roughly how few.
        if (segment is null || segment.IsSuppressed) return withheld;

        var scores = SurveyAggregation.SegmentDimensionScores(aggregate.Questions, segment);

        return new DashboardTeamClimate(
            survey.Id,
            title,
            survey.EndDate,
            segment.RespondentCount,
            IsSuppressed: false,
            SurveyResultsPrivacy.MinimumSegmentRespondents,
            scores
                .OrderBy(pair => pair.Key, StringComparer.Ordinal)
                .Select(pair => new DashboardDimensionScore(pair.Key, pair.Value))
                .ToList());
    }

}
