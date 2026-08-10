using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Infrastructure.Persistence;

/// <summary>Several survey tallies for one scope, from one statement.</summary>
public sealed record DashboardSurveyCounts(int Total, int Active, int Draft)
{
    public static readonly DashboardSurveyCounts Empty = new(0, 0, 0);
}

/// <summary>Response tallies for one scope, from one statement.</summary>
public sealed record DashboardResponseCounts(int Total, int Completed)
{
    public static readonly DashboardResponseCounts Empty = new(0, 0);
}

/// <summary>Headcount tallies for one scope, from one statement.</summary>
public sealed record DashboardUserCounts(int Total, int Active)
{
    public static readonly DashboardUserCounts Empty = new(0, 0);
}

/// <summary>Action-plan tallies for one scope, from one statement.</summary>
public sealed record DashboardActionPlanCounts(int Open, int Overdue)
{
    public static readonly DashboardActionPlanCounts Empty = new(0, 0);
}

/// <summary>One tenant row of the platform overview, before nothing -- it needs no locale resolution.</summary>
public sealed record DashboardCompanyRow(
    Guid Id,
    string Name,
    int UserCount,
    int ActiveSurveyCount,
    int CompletedResponseCount,
    DateTimeOffset CreatedAt);

/// <summary>One department row, before nothing -- department names are not paired-language columns.</summary>
public sealed record DashboardDepartmentRow(Guid Id, string Name, int MemberCount, int CompletedResponseCount);

/// <summary>One survey row of a dashboard list, before its title is resolved for a locale.</summary>
public sealed record DashboardSurveyRow(
    Guid Id,
    string? TitleEn,
    string? TitleEs,
    string Language,
    string Status,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    int ResponseCount,
    int? TargetAudienceCount);

/// <summary>
/// One survey row of a <em>department's</em> dashboard, before its title is resolved.
///
/// Separate from <see cref="DashboardSurveyRow"/> because it carries no target: the only
/// invited-headcount this schema has is <c>Survey.TargetAudienceCount</c>, a single
/// author-entered number for the whole tenant with no per-department breakdown, so there is
/// nothing honest to put in that column on a page contracted to one department.
/// </summary>
/// <param name="ResponseCount">
/// Completed responses <em>from this department alone</em> — computed, not the denormalised
/// <c>Survey.ResponseCount</c>, which is bumped once per completed response company-wide.
/// </param>
public sealed record DashboardDepartmentSurveyRow(
    Guid Id,
    string? TitleEn,
    string? TitleEs,
    string Language,
    string Status,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    int ResponseCount);

/// <summary>One pending survey for a respondent, before its title is resolved for a locale.</summary>
public sealed record DashboardPendingSurveyRow(
    Guid Id,
    string? TitleEn,
    string? TitleEs,
    string Language,
    string Type,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    int QuestionCount);

/// <summary>
/// The aggregate LINQ behind the four role dashboards (#132), composed over
/// <see cref="IQueryable{T}"/> rather than over a DbContext.
///
/// ## Why this is a separate class, and why it takes sequences
///
/// Exactly the reason <see cref="SurveyQueries"/> gives: a LINQ shape EF cannot translate
/// throws at request time, not at build time, and these are the heaviest projections in
/// the codebase -- correlated subqueries per row plus grouped conditional counts. Taking
/// the sequences as parameters lets <c>DashboardQueriesTests</c> call
/// <c>ToQueryString()</c> on the very query the endpoint runs, with no container and no
/// connection, and prove that it translates and that the intended predicates survive into
/// the SQL.
///
/// <c>ToQueryString()</c> proves nothing about round trips and no test here claims it
/// does: it renders one command by construction, so it cannot represent a second one. The
/// N+1 property is measured where round trips actually happen --
/// <c>DashboardEndpointsTests.No_dashboard_issues_a_round_trip_per_row</c> counts the
/// commands a real request sends through a <c>DbCommandInterceptor</c>, against a fixture
/// deliberately grown past every row limit on the page.
///
/// ## The N+1 rule this class exists to enforce
///
/// Every per-row figure -- a company's user count, a department's response count -- is a
/// **correlated subquery inside the list projection**, so a page of N rows is one round
/// trip, not N+1. Nothing here loops and re-queries, and nothing here materialises a
/// collection in order to call <c>.Count()</c> on it in memory. The scalar tallies use
/// <c>GroupBy(_ =&gt; 1)</c> with conditional counts so that several related figures
/// (total/active/draft) also collapse into a single statement instead of one round trip
/// each.
///
/// <c>GroupBy(_ =&gt; 1)</c> over an empty table yields no group at all, so every caller
/// must treat "no row" as the zero tally -- hence the <c>Empty</c> members on the count
/// records above. Returning null there and letting it surface as a 500 on a brand-new
/// tenant would make the dashboard fail precisely for the customer who has just signed up.
///
/// Locale resolution deliberately stays out, same as <see cref="SurveyQueries"/>: the
/// <c>_en</c>/<c>_es</c> columns come back as columns and are resolved in memory, because
/// the fallback rule is not expressible in SQL.
/// </summary>
public static class DashboardQueries
{
    /// <summary>Action-plan statuses that are not outstanding work.</summary>
    private const string CompletedStatus = "completed";
    private const string CancelledStatus = "cancelled";

    public static IQueryable<DashboardSurveyCounts> SurveyCounts(IQueryable<Survey> surveys)
        => surveys
            .GroupBy(_ => 1)
            .Select(g => new DashboardSurveyCounts(
                g.Count(),
                g.Count(s => s.Status == SurveyStatuses.Active),
                g.Count(s => s.Status == SurveyStatuses.Draft)));

    public static IQueryable<DashboardResponseCounts> ResponseCounts(IQueryable<Response> responses)
        => responses
            .GroupBy(_ => 1)
            .Select(g => new DashboardResponseCounts(g.Count(), g.Count(r => r.IsComplete)));

    public static IQueryable<DashboardUserCounts> UserCounts(IQueryable<User> users)
        => users
            .GroupBy(_ => 1)
            .Select(g => new DashboardUserCounts(g.Count(), g.Count(u => u.IsActive)));

    /// <summary>
    /// Outstanding action plans, and how many of those are past their due date.
    /// </summary>
    /// <param name="asOf">
    /// Passed in rather than read from <c>DateTimeOffset.UtcNow</c> inside the expression:
    /// a clock call in a LINQ tree is either evaluated once at translation time (silently
    /// freezing the cutoff) or not translatable at all, and either way a test cannot pin it.
    /// </param>
    public static IQueryable<DashboardActionPlanCounts> ActionPlanCounts(
        IQueryable<ActionPlan> actionPlans,
        DateTimeOffset asOf)
        => actionPlans
            .Where(p => p.Status != CompletedStatus && p.Status != CancelledStatus)
            .GroupBy(_ => 1)
            .Select(g => new DashboardActionPlanCounts(g.Count(), g.Count(p => p.DueDate < asOf)));

    /// <summary>
    /// The platform's tenants, newest first, each with its own tallies as correlated
    /// subqueries -- one statement for the whole table.
    /// </summary>
    public static IQueryable<DashboardCompanyRow> CompanySummaries(
        IQueryable<Company> companies,
        IQueryable<User> users,
        IQueryable<Survey> surveys,
        IQueryable<Response> responses,
        int limit)
        => companies
            .OrderByDescending(c => c.CreatedAt)
            .ThenBy(c => c.Id)
            .Take(limit)
            .Select(c => new DashboardCompanyRow(
                c.Id,
                c.Name,
                users.Count(u => u.CompanyId == c.Id),
                surveys.Count(s => s.CompanyId == c.Id && s.Status == SurveyStatuses.Active),
                responses.Count(r => r.CompanyId == c.Id && r.IsComplete),
                c.CreatedAt));

    /// <summary>
    /// One company's departments with their headcount and participation, as one statement.
    /// </summary>
    /// <remarks>
    /// The company predicate is applied here rather than left to the caller because it is
    /// the tenant boundary: a department list built without it is every tenant's org chart.
    /// The response subquery is additionally constrained by company id and not by
    /// department alone -- department ids are globally unique, but relying on that to
    /// enforce a tenant boundary makes the boundary an accident of the id scheme.
    /// </remarks>
    public static IQueryable<DashboardDepartmentRow> DepartmentSummaries(
        IQueryable<Department> departments,
        IQueryable<User> users,
        IQueryable<Response> responses,
        Guid companyId,
        int limit)
        => departments
            .Where(d => d.CompanyId == companyId)
            .OrderBy(d => d.Name)
            .ThenBy(d => d.Id)
            .Take(limit)
            .Select(d => new DashboardDepartmentRow(
                d.Id,
                d.Name,
                users.Count(u => u.DepartmentId == d.Id && u.CompanyId == companyId),
                responses.Count(r => r.DepartmentId == d.Id && r.CompanyId == companyId && r.IsComplete)));

    /// <summary>
    /// The active surveys one department is expected to answer.
    ///
    /// The targeting rule is <see cref="SurveyQueries.AssignedTo"/>'s, minus the per-user
    /// "and I have not answered it yet" clause: no target rows at all means company-wide,
    /// any target rows means only the named departments. Stated once there and once here
    /// is one time too many, but the alternative -- reusing <c>AssignedTo</c> with a
    /// sentinel user id -- would silently drop every survey any one person had completed
    /// from a *department's* list.
    /// </summary>
    public static IQueryable<Survey> ActiveForDepartment(
        IQueryable<Survey> surveys,
        IQueryable<SurveyDepartmentTarget> departmentTargets,
        Guid companyId,
        Guid departmentId)
        => surveys
            .Where(s => s.CompanyId == companyId && s.Status == SurveyStatuses.Active)
            .Where(s =>
                !departmentTargets.Any(t => t.SurveyId == s.Id)
                || departmentTargets.Any(t => t.SurveyId == s.Id && t.DepartmentId == departmentId));

    /// <summary>
    /// A dashboard's survey list: soonest deadline first, because a dashboard list is a
    /// queue of what needs attention rather than an archive.
    /// </summary>
    public static IQueryable<DashboardSurveyRow> SurveySummaries(IQueryable<Survey> surveys, int limit)
        => surveys
            .OrderBy(s => s.EndDate)
            .ThenBy(s => s.Id)
            .Take(limit)
            .Select(s => new DashboardSurveyRow(
                s.Id,
                s.TitleEn,
                s.TitleEs,
                s.Language,
                s.Status,
                s.StartDate,
                s.EndDate,
                s.ResponseCount,
                s.TargetAudienceCount));

    /// <summary>
    /// The same list, for a department's own dashboard, with participation counted from
    /// that department's rows instead of read off the survey.
    /// </summary>
    /// <remarks>
    /// <b>Why this exists rather than reusing <see cref="SurveySummaries"/>.</b>
    /// <c>Survey.ResponseCount</c> and <c>Survey.TargetAudienceCount</c> are denormalised
    /// company-wide figures: the first is incremented once per completed response anywhere
    /// in the tenant (<c>SurveyResponseEndpoints</c>), the second is the invited headcount
    /// the author typed in. Rendering either on a page contracted to one department puts a
    /// company-wide number directly under a department-scoped one with the same name — a
    /// six-person team reading "Completed responses 5" above "Responses 140 / Target 200".
    ///
    /// So the count here is a correlated subquery over this department's responses (one
    /// statement, no N+1), and there is no target column at all: a per-department invited
    /// headcount does not exist in the schema and inventing one from the member count would
    /// contradict the number the author actually entered.
    /// </remarks>
    public static IQueryable<DashboardDepartmentSurveyRow> SurveySummariesForDepartment(
        IQueryable<Survey> surveys,
        IQueryable<Response> responses,
        Guid companyId,
        Guid departmentId,
        int limit)
        => surveys
            .OrderBy(s => s.EndDate)
            .ThenBy(s => s.Id)
            .Take(limit)
            .Select(s => new DashboardDepartmentSurveyRow(
                s.Id,
                s.TitleEn,
                s.TitleEs,
                s.Language,
                s.Status,
                s.StartDate,
                s.EndDate,
                responses.Count(r =>
                    r.SurveyId == s.Id
                    && r.DepartmentId == departmentId
                    && r.CompanyId == companyId
                    && r.IsComplete)));

    /// <summary>
    /// The respondent's queue. Feed it <see cref="SurveyQueries.AssignedTo"/> so that
    /// "what I still owe" here and on <c>/surveys/my</c> can never be two different answers.
    /// </summary>
    public static IQueryable<DashboardPendingSurveyRow> PendingSurveys(
        IQueryable<Survey> assigned,
        IQueryable<Question> questions,
        int limit)
        => assigned
            .OrderBy(s => s.EndDate)
            .ThenBy(s => s.Id)
            .Take(limit)
            .Select(s => new DashboardPendingSurveyRow(
                s.Id,
                s.TitleEn,
                s.TitleEs,
                s.Language,
                s.Type,
                s.StartDate,
                s.EndDate,
                questions.Count(q => q.SurveyId == s.Id)));
}
