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
/// One department row of the company dashboard: its people and their completed responses
/// across every survey the tenant has run, which the client reads as a
/// completed-responses-per-person rate against the organisation's own.
/// </summary>
/// <param name="MemberCount">
/// Everyone whose user row points at this department, <b>active or not</b> — deliberately
/// not the per-survey participation denominator (<c>DepartmentHeadcount.Population</c>,
/// which counts active members only). <paramref name="CompletedResponseCount"/> spans the
/// tenant's whole survey history and keeps the responses of members deactivated since, so
/// the denominator under it keeps those members too; and the organisation rate this row
/// is compared against divides by the tenant's total user count, so every cell of the
/// comparison is measured by one rule. <c>DashboardQueries.DepartmentSummaries</c> states
/// the full argument.
/// </param>
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
/// <param name="MemberCount">
/// Everyone whose user row points at this department, active or not — the same deliberate
/// choice, for the same reason, as <see cref="DashboardDepartmentSummary"/>'s member
/// count: the client divides <paramref name="CompletedResponseCount"/>, an all-time
/// figure that keeps the responses of members deactivated since, by this number. The
/// per-survey participation denominator is a different population
/// (<c>DepartmentHeadcount.Population</c>, active members only).
/// </param>
/// <param name="ActiveMemberCount">
/// The members who can still log in and answer — the same population
/// <c>DepartmentHeadcount.Population</c> defines, sized here by
/// <c>DashboardQueries.UserCounts</c>' conditional count in the same single statement as
/// <paramref name="MemberCount"/>. Rendered as context under the all-members figure.
/// </param>
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
/// <param name="Anonymous">
/// The survey's own <c>Settings.Anonymous</c>, and it is here so that Home and the respond
/// page cannot disagree about the one promise this product makes to a respondent.
///
/// <para>
/// It is read from the same place <c>SurveyResponseEndpoints</c> fills
/// <c>SurveyRespondView.Anonymous</c> from -- the survey row's owned settings -- rather than
/// from anything derived, because the two screens are a single sentence read in two
/// sittings: the chip on the card says "this one cannot come back to you", and the page it
/// leads to has to be able to finish that sentence. Anonymity is per-survey, never a
/// constant, so a client that assumed it would be telling some respondents their answers
/// are untraceable on a survey where they are not -- which is the worst thing either screen
/// could say.
/// </para>
/// </param>
public sealed record DashboardPendingSurvey(
    Guid Id,
    string? Title,
    string Type,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    int QuestionCount,
    bool Anonymous);

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

/// <summary>
/// One action plan opened since the last survey closed.
/// </summary>
/// <param name="DepartmentName">
/// **Null is a deliberate answer, not missing data**, and it means one of two things that
/// this payload is careful to leave indistinguishable: the plan is company-wide and has no
/// department at all, or the plan belongs to a department that was <em>protected</em> in
/// that survey's results.
///
/// <para>
/// Naming the second kind would defeat the suppression it is named after. It would also be
/// defeated by the obvious alternative — dropping the row and leaving
/// <see cref="EmployeeLastOutcome.OpenPlanCount"/> higher than the list is long — because a
/// reader who can already list the company's departments could then subtract the named ones
/// and be left with the protected one. A nameless row that a company-wide plan produces
/// just as readily narrows nothing.
/// </para>
/// </param>
public sealed record DashboardPlanOpened(string? DepartmentName, DateTimeOffset CreatedAt);

/// <summary>
/// "What came of the last one" -- the panel an employee's home page carries between
/// surveys, and the only honest reason this product has to bring them back to it.
///
/// ## Why the payload is counts and dates and nothing else
///
/// An employee is not authorized for results: all four <c>/surveys/{id}/results</c> routes
/// go through <c>SurveyEndpoints.CanAdminister</c>. This endpoint must not become the side
/// door around that, so there is no field here that could hold a score -- no per-question
/// figure, no per-segment figure, no per-dimension figure, not even a per-department
/// response count. What the reader gets is the shape of what happened: how many people
/// answered, across how many departments, how many of those stayed protected, and what has
/// been opened since. Every one of those is knowable without knowing who answered, which is
/// exactly the class of fact anonymity leaves available.
///
/// ## The suppression rule, restated as an output
///
/// <see cref="ProtectedDepartmentCount"/> is a count and never a list. A department falls
/// below <see cref="MinimumGroupSize"/> precisely when naming it would name the handful of
/// people in it, so this payload reports *how many* were withheld and never *which* -- the
/// same "withheld counts are always reported, never silently dropped" rule
/// <c>SurveyResultsPrivacy</c> applies everywhere else, with the identifying half removed
/// because the audience here is the workforce rather than an administrator.
/// </summary>
/// <param name="ClosedOn">The survey's end date. The panel's headline is "Q3 closed on 5 August".</param>
/// <param name="ResponseCount">
/// Completed responses company-wide. A count over the whole tenant identifies nobody, and
/// it is the figure that makes the rest of the panel legible ("24 answers across five
/// departments").
/// </param>
/// <param name="DepartmentCount">
/// Departments that answered at all -- including the protected ones, which is what makes
/// <see cref="ProtectedDepartmentCount"/> readable as a fraction of it rather than as an
/// unexplained extra.
/// </param>
/// <param name="ProtectedDepartmentCount">
/// How many of those were withheld for being below the floor. Never their names, never
/// their sizes; see <see cref="DashboardPlanOpened.DepartmentName"/> for the second place
/// that rule has to be applied.
/// </param>
/// <param name="MinimumGroupSize">
/// <c>SurveyResultsPrivacy.MinimumSegmentRespondents</c>, so the UI can say *why* a
/// department was protected in the same breath as saying that it was. Sent rather than
/// hardcoded client-side for the reason that constant gives for not being a literal 5.
/// </param>
/// <param name="PlansOpenedSince">
/// A bounded page of what was opened after the survey closed, oldest first -- this is a
/// short narrative of what happened next, not a directory. <see cref="OpenPlanCount"/> is
/// the full tally.
/// </param>
public sealed record EmployeeLastOutcome(
    Guid SurveyId,
    string? SurveyTitle,
    DateTimeOffset ClosedOn,
    int ResponseCount,
    int DepartmentCount,
    int ProtectedDepartmentCount,
    int MinimumGroupSize,
    IReadOnlyList<DashboardPlanOpened> PlansOpenedSince,
    int OpenPlanCount);
