using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.UnitTests.Dashboard;

/// <summary>
/// Proves the dashboard aggregates translate to SQL, and — the part that matters for #132's
/// "no N+1 in the aggregate queries" — that each of them is **one** statement.
///
/// Same technique and same justification as <c>SurveyQueriesTests</c>: EF builds the SQL
/// from the model alone, so <c>ToQueryString()</c> needs a provider but never a connection.
/// The alternative (finding out in an integration run, or in production) is what these
/// exist to avoid, and an N+1 in particular does not fail at all — it just gets slower with
/// every customer, which is the failure mode a test has to be looked for rather than
/// waited for.
///
/// The N+1 assertion is <c>StatementCount</c>: a projection that fell out to client
/// evaluation would either throw here or emit the per-row query separately. One statement
/// containing the per-row aggregate is proof the count rides along in the same round trip.
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

    /// <summary>
    /// Top-level statements in the generated SQL. Npgsql separates a batch with a
    /// semicolon-terminated line, so a query that produced more than one round trip shows
    /// up as more than one statement here.
    /// </summary>
    private static int StatementCount(string sql)
        => sql.Split(';', StringSplitOptions.RemoveEmptyEntries)
            .Count(part => !string.IsNullOrWhiteSpace(part));

    [Fact]
    public void The_platform_company_summary_counts_every_row_in_one_statement()
    {
        using var db = CreateContext();

        var sql = DashboardQueries
            .CompanySummaries(db.Companies, db.Users, db.Surveys, db.Responses, 12)
            .ToQueryString();

        // Three correlated aggregates -- users, surveys, responses -- inside ONE select
        // over companies. If any of them were evaluated per row this would not be one
        // statement, and the platform overview would issue 3N+1 queries.
        Assert.Equal(1, StatementCount(sql));
        Assert.Contains("users", sql, StringComparison.Ordinal);
        Assert.Contains("surveys", sql, StringComparison.Ordinal);
        Assert.Contains("responses", sql, StringComparison.Ordinal);
        Assert.Contains("COUNT", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_department_summary_counts_members_and_responses_in_one_statement()
    {
        using var db = CreateContext();

        var sql = DashboardQueries
            .DepartmentSummaries(db.Departments, db.Users, db.Responses, CompanyId, 12)
            .ToQueryString();

        Assert.Equal(1, StatementCount(sql));
        Assert.Contains("departments", sql, StringComparison.Ordinal);
        Assert.Contains("COUNT", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_survey_tallies_collapse_into_one_grouped_statement()
    {
        using var db = CreateContext();

        var sql = DashboardQueries.SurveyCounts(db.Surveys).ToQueryString();

        // Total, active and draft from one pass. Three separate CountAsync calls would be
        // three round trips for three numbers off the same table.
        Assert.Equal(1, StatementCount(sql));
        Assert.Contains("COUNT", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("active", sql, StringComparison.Ordinal);
        Assert.Contains("draft", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_response_tallies_collapse_into_one_grouped_statement()
    {
        using var db = CreateContext();

        var sql = DashboardQueries.ResponseCounts(db.Responses).ToQueryString();

        Assert.Equal(1, StatementCount(sql));
        Assert.Contains("is_complete", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_user_tallies_collapse_into_one_grouped_statement()
    {
        using var db = CreateContext();

        var sql = DashboardQueries.UserCounts(db.Users).ToQueryString();

        Assert.Equal(1, StatementCount(sql));
        Assert.Contains("is_active", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_action_plan_tallies_translate_with_the_cutoff_as_a_parameter()
    {
        using var db = CreateContext();

        var sql = DashboardQueries.ActionPlanCounts(db.ActionPlans, AsOf).ToQueryString();

        Assert.Equal(1, StatementCount(sql));
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

        Assert.Equal(1, StatementCount(sql));
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

        Assert.Equal(1, StatementCount(sql));
        Assert.Contains("title_en", sql, StringComparison.Ordinal);
        Assert.Contains("title_es", sql, StringComparison.Ordinal);
        Assert.Contains("target_audience_count", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_pending_survey_projection_counts_questions_in_the_same_statement()
    {
        using var db = CreateContext();

        var sql = DashboardQueries.PendingSurveys(db.Surveys, db.Questions, 5).ToQueryString();

        Assert.Equal(1, StatementCount(sql));
        Assert.Contains("questions", sql, StringComparison.Ordinal);
        Assert.Contains("COUNT", sql, StringComparison.OrdinalIgnoreCase);
    }
}
