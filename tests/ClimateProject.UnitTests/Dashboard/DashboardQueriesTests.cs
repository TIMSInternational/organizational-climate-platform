using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.UnitTests.Dashboard;

/// <summary>
/// Proves the dashboard aggregates translate to SQL, and that the predicates and columns
/// each one is supposed to push down actually appear in it.
///
/// Same technique and same justification as <c>SurveyQueriesTests</c>: EF builds the SQL
/// from the model alone, so <c>ToQueryString()</c> needs a provider but never a connection.
/// The alternative — finding out in an integration run, or in production — is what these
/// exist to avoid.
///
/// ## What this file deliberately does NOT prove, having once pretended to
///
/// <list type="bullet">
/// <item><b>Round trips.</b> An earlier version of this file counted semicolons in
/// <c>ToQueryString()</c> and asserted the answer was 1, calling that the guard for #132's
/// "no N+1". It was decoration. <c>ToQueryString()</c> renders a single
/// <c>IRelationalCommand</c> by construction, so it cannot represent a second round trip
/// no matter what the query does; measured on this model, a deliberately pathological
/// triple-nested correlated subquery renders with exactly as many semicolons as the real
/// queries do — zero. The assertion could not fail, so it did not guard anything. The
/// N+1 property is now measured where round trips exist:
/// <c>DashboardEndpointsTests.No_dashboard_issues_a_round_trip_per_row</c> counts commands
/// through a <c>DbCommandInterceptor</c> on a fixture grown past every row limit.</item>
/// <item><b>Scoping.</b> Deleting <c>d.CompanyId == companyId</c> from
/// <c>DepartmentSummaries</c> leaves every test here green — the tenant boundary is proven
/// by <c>DashboardEndpointsTests</c>, which seeds two tenants so a leak changes a number.
/// A fragment assertion below such as "the SQL mentions <c>departments</c>" says the table
/// is in the query, not that the query is scoped.</item>
/// </list>
/// </summary>
public class DashboardQueriesTests
{
    // Never dialled. UseNpgsql only needs a parseable string to build the model and the SQL.
    private const string OfflineConnectionString = "Host=localhost;Database=translation-only;Username=none;Password=none";

    private static ClimateProjectDbContext CreateContext()
        => new(new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(OfflineConnectionString)
            .Options);

    private static readonly Guid CompanyId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid DepartmentId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly DateTimeOffset AsOf = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public void The_platform_company_summary_tallies_each_tenant_with_a_correlated_subquery()
    {
        using var db = CreateContext();

        var sql = DashboardQueries
            .CompanySummaries(db.Companies, db.Users, db.Surveys, db.Responses, 12)
            .ToQueryString();

        // Three correlated aggregates -- users, surveys, responses -- named in the SQL
        // rather than computed in C# over materialised rows. That they also ride in a
        // single round trip is measured by the interceptor test, not inferred here.
        Assert.Contains("users", sql, StringComparison.Ordinal);
        Assert.Contains("surveys", sql, StringComparison.Ordinal);
        Assert.Contains("responses", sql, StringComparison.Ordinal);
        Assert.Contains("COUNT", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_department_summary_counts_members_and_responses_in_sql()
    {
        using var db = CreateContext();

        var sql = DashboardQueries
            .DepartmentSummaries(db.Departments, db.Users, db.Responses, CompanyId, 12)
            .ToQueryString();

        Assert.Contains("departments", sql, StringComparison.Ordinal);
        Assert.Contains("COUNT", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_survey_tallies_translate_as_conditional_counts_over_one_group()
    {
        using var db = CreateContext();

        var sql = DashboardQueries.SurveyCounts(db.Surveys).ToQueryString();

        // Total, active and draft in one grouped projection. Three separate CountAsync
        // calls would be three round trips for three numbers off the same table.
        Assert.Contains("COUNT", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("active", sql, StringComparison.Ordinal);
        Assert.Contains("draft", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_response_tallies_translate_as_conditional_counts_over_one_group()
    {
        using var db = CreateContext();

        var sql = DashboardQueries.ResponseCounts(db.Responses).ToQueryString();

        Assert.Contains("is_complete", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_user_tallies_translate_as_conditional_counts_over_one_group()
    {
        using var db = CreateContext();

        var sql = DashboardQueries.UserCounts(db.Users).ToQueryString();

        Assert.Contains("is_active", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_action_plan_tallies_translate_with_the_cutoff_as_a_parameter()
    {
        using var db = CreateContext();

        var sql = DashboardQueries.ActionPlanCounts(db.ActionPlans, AsOf).ToQueryString();

        Assert.Contains("due_date", sql, StringComparison.Ordinal);
        // Completed and cancelled plans are not outstanding work and must be excluded in
        // SQL, not after the fact.
        Assert.Contains("completed", sql, StringComparison.Ordinal);
        Assert.Contains("cancelled", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_department_survey_filter_treats_an_untargeted_survey_as_company_wide()
    {
        using var db = CreateContext();

        var sql = DashboardQueries
            .ActiveForDepartment(db.Surveys, db.SurveyDepartmentTargets, CompanyId, DepartmentId)
            .ToQueryString();

        Assert.Contains("survey_department_targets", sql, StringComparison.Ordinal);
        // Both halves of the rule: "has no targets" OR "targets me". Only the second would
        // hide every company-wide survey from every department.
        Assert.Contains("NOT EXISTS", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("department_id = @departmentId", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_survey_summary_projection_translates_including_the_nullable_target_audience()
    {
        using var db = CreateContext();

        var sql = DashboardQueries.SurveySummaries(db.Surveys, 5).ToQueryString();

        Assert.Contains("title_en", sql, StringComparison.Ordinal);
        Assert.Contains("title_es", sql, StringComparison.Ordinal);
        Assert.Contains("target_audience_count", sql, StringComparison.Ordinal);
    }

    /// <summary>
    /// The department dashboard's own survey projection. Two things have to be true of the
    /// SQL and both are the fix for a real defect: the participation figure is counted from
    /// the response rows with a department predicate, and the survey's own denormalised
    /// company-wide columns are nowhere in it.
    /// </summary>
    [Fact]
    public void The_department_survey_projection_counts_responses_per_department_and_asks_for_no_target()
    {
        using var db = CreateContext();

        var sql = DashboardQueries
            .SurveySummariesForDepartment(db.Surveys, db.Responses, CompanyId, DepartmentId, 5)
            .ToQueryString();

        Assert.Contains("responses", sql, StringComparison.Ordinal);
        Assert.Contains("department_id = @departmentId", sql, StringComparison.Ordinal);
        Assert.Contains("is_complete", sql, StringComparison.Ordinal);
        // `Survey.ResponseCount` and `Survey.TargetAudienceCount` are tenant-wide numbers
        // living on the survey row; neither belongs on a department's page, so neither is
        // even selected.
        Assert.DoesNotContain("target_audience_count", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("response_count", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_pending_survey_projection_counts_questions_in_sql()
    {
        using var db = CreateContext();

        var sql = DashboardQueries.PendingSurveys(db.Surveys, db.Questions, 5).ToQueryString();

        Assert.Contains("questions", sql, StringComparison.Ordinal);
        Assert.Contains("COUNT", sql, StringComparison.OrdinalIgnoreCase);
    }
}
