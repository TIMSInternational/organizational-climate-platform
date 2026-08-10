namespace ClimateProject.Application.Dashboard;

/// <summary>
/// The four role dashboards (#132), one payload per role.
///
/// There is deliberately **no** single "dashboard" DTO with optional sections. One
/// endpoint returning everything and letting the client hide what the viewer may not see
/// puts every tenant's figures on the wire for anyone who opens the network tab -- the
/// issue calls this out by name and it is the whole reason these are four separate shapes.
/// A role's payload contains only what that role is permitted to know, so there is nothing
/// to filter client-side and nothing to leak.
///
/// Every count is produced server-side by <c>DashboardQueries</c>, never by returning rows
/// for the client to length-check.
/// </summary>
/// <param name="Title">
/// Already resolved for the request locale via <c>LocalizedContent</c>, and nullable for
/// the same reason every other read surface here is: a survey whose title is absent in
/// every language has no text to render, and a key path or an empty string would be worse
/// than nothing. See <c>LocalizedText.Text</c>.
/// </param>
public sealed record DashboardSurveySummary(
    Guid Id,
    string? Title,
    string Status,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    int ResponseCount,
    int? TargetAudienceCount);

/// <summary>
/// A survey on a <em>department's</em> dashboard.
///
/// Deliberately not <see cref="DashboardSurveySummary"/>, and the difference is the whole
/// point: that shape's two participation columns come straight off the survey row, where
/// <c>ResponseCount</c> is incremented once per completed response <em>anywhere in the
/// tenant</em> and <c>TargetAudienceCount</c> is the tenant's invited headcount. On a page
/// contracted to one department both describe every other department as well.
/// </summary>
/// <param name="ResponseCount">
/// Completed responses from this department alone, counted in SQL against the response
/// rows rather than read off the survey.
/// </param>
public sealed record DashboardDepartmentSurveySummary(
    Guid Id,
    string? Title,
    string Status,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    int ResponseCount);

/// <summary>One tenant on the platform overview. SuperAdmin-only by construction.</summary>
public sealed record DashboardCompanySummary(
    Guid Id,
    string Name,
    int UserCount,
    int ActiveSurveyCount,
    int CompletedResponseCount,
    DateTimeOffset CreatedAt);

/// <summary>
/// One department's participation.
/// </summary>
/// <param name="CompletedResponseCount">
/// Completed responses only. A part-finished response is not participation, and counting
/// it would let a department look engaged on the strength of people who opened a survey
/// and left.
/// </param>
public sealed record DashboardDepartmentSummary(
    Guid Id,
    string Name,
    int MemberCount,
    int CompletedResponseCount);

/// <summary>
/// The platform overview. Every figure here spans all tenants, which is exactly why the
/// endpoint that builds it admits <c>Roles.SuperAdmin</c> and nobody else.
/// </summary>
public sealed record SuperAdminDashboard(
    int CompanyCount,
    int UserCount,
    int ActiveUserCount,
    int SurveyCount,
    int ActiveSurveyCount,
    int ResponseCount,
    int CompletedResponseCount,
    IReadOnlyList<DashboardCompanySummary> Companies);

/// <summary>One company's overview: its people, its surveys, its action plans.</summary>
public sealed record CompanyAdminDashboard(
    Guid CompanyId,
    string CompanyName,
    int UserCount,
    int ActiveUserCount,
    int DepartmentCount,
    int SurveyCount,
    int ActiveSurveyCount,
    int DraftSurveyCount,
    int ResponseCount,
    int CompletedResponseCount,
    int OpenActionPlanCount,
    int OverdueActionPlanCount,
    IReadOnlyList<DashboardSurveySummary> OngoingSurveys,
    IReadOnlyList<DashboardDepartmentSummary> Departments);

/// <summary>
/// One department's overview, for the person who runs it.
/// </summary>
/// <param name="MemberCount">Everyone whose user row points at this department, active or not.</param>
/// <param name="ActiveSurveys">
/// Every figure on these rows is department-scoped, like every figure above them. See
/// <see cref="DashboardDepartmentSurveySummary"/> for why they are not the company
/// dashboard's shape.
/// </param>
public sealed record DepartmentAdminDashboard(
    Guid DepartmentId,
    string DepartmentName,
    Guid CompanyId,
    int MemberCount,
    int ActiveMemberCount,
    int ActiveSurveyCount,
    int CompletedResponseCount,
    int OpenActionPlanCount,
    int OverdueActionPlanCount,
    IReadOnlyList<DashboardDepartmentSurveySummary> ActiveSurveys);

/// <summary>
/// A survey the caller is expected to answer. Narrower than
/// <see cref="DashboardSurveySummary"/> on purpose: a respondent has no business being told
/// how many other people have answered, which is the figure that turns an anonymous survey
/// into a headcount.
/// </summary>
public sealed record DashboardPendingSurvey(
    Guid Id,
    string? Title,
    string Type,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    int QuestionCount);

/// <summary>
/// The landing experience for a plain employee -- the "evaluated user" dashboard, and the
/// only real one this role has ever had.
///
/// Scoped per <em>user</em>, not per role: the endpoint resolves the caller's own user row
/// and reports on that row alone, so supervisor and leader get their own figures here too
/// rather than their team's. Nothing on this payload describes anyone else.
/// </summary>
/// <param name="NextDeadline">
/// The soonest close date among the pending surveys, or null when there are none. Computed
/// here rather than left to the client so an empty list and a genuinely absent deadline are
/// the same answer.
/// </param>
/// <param name="CompanyId">
/// Null for a user who belongs to no tenant, which in this schema is a global super_admin
/// (#191) -- and for whom every figure below is legitimately zero rather than an error, the
/// same answer <c>/surveys/my</c> already gives them.
/// </param>
public sealed record EmployeeDashboard(
    string Name,
    Guid? CompanyId,
    Guid? DepartmentId,
    string? DepartmentName,
    int PendingSurveyCount,
    int CompletedSurveyCount,
    int UnreadNotificationCount,
    DateTimeOffset? NextDeadline,
    IReadOnlyList<DashboardPendingSurvey> PendingSurveys);
