using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.UnitTests.Surveys;

/// <summary>
/// Proves the survey listings' LINQ actually translates to SQL.
///
/// These are the first correlated subqueries in a projection anywhere in this codebase, and
/// an untranslatable shape throws at request time rather than at build time -- so without
/// this the failure would first appear in an integration run, or in production. EF builds
/// the SQL from the model alone, so <c>ToQueryString()</c> needs a provider but never a
/// connection: no container, no database, and no separate copy of the query that could
/// drift from the one the endpoint runs.
/// </summary>
public class SurveyQueriesTests
{
    // Never dialled. UseNpgsql only needs a parseable string to build the model and the
    // SQL; ToQueryString does not open a connection.
    private const string OfflineConnectionString = "Host=localhost;Database=translation-only;Username=none;Password=none";

    private static ClimateProjectDbContext CreateContext()
        => new(new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(OfflineConnectionString)
            .Options);

    private static readonly Guid CompanyId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid DepartmentId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid UserId = Guid.Parse("33333333-3333-3333-3333-333333333333");

    [Fact]
    public void The_assigned_to_filter_translates_for_a_user_with_a_department()
    {
        using var db = CreateContext();

        var sql = SurveyQueries.AssignedTo(
            db.Surveys, db.SurveyDepartmentTargets, db.Responses, CompanyId, DepartmentId, UserId).ToQueryString();

        Assert.Contains("survey_department_targets", sql, StringComparison.Ordinal);
        Assert.Contains("responses", sql, StringComparison.Ordinal);
        Assert.Contains("status", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_assigned_to_filter_translates_for_a_user_with_no_department()
    {
        using var db = CreateContext();

        var sql = SurveyQueries.AssignedTo(
            db.Surveys, db.SurveyDepartmentTargets, db.Responses, CompanyId, departmentId: null, UserId).ToQueryString();

        // The no-department branch must be a plain "has no targets" test, never a
        // department comparison against NULL that is silently never true.
        Assert.Contains("survey_department_targets", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("department_id =", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_admin_listing_projection_including_its_question_count_translates()
    {
        using var db = CreateContext();

        var sql = SurveyQueries.ToListRows(db.Surveys, db.Questions).ToQueryString();

        Assert.Contains("questions", sql, StringComparison.Ordinal);
        Assert.Contains("COUNT", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("title_en", sql, StringComparison.Ordinal);
        Assert.Contains("title_es", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_my_listing_projection_translates_including_the_owned_settings_columns()
    {
        using var db = CreateContext();

        var sql = SurveyQueries.ToMyRows(db.Surveys, db.Questions).ToQueryString();

        // Anonymous and TimeLimitMinutes live on the owned SurveySettings type; a projection
        // over an owned member is the shape most likely to fall out to client evaluation.
        Assert.Contains("settings_anonymous", sql, StringComparison.Ordinal);
        Assert.Contains("settings_time_limit_minutes", sql, StringComparison.Ordinal);
        Assert.Contains("COUNT", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_title_search_translates_to_a_case_insensitive_match_on_both_columns()
    {
        using var db = CreateContext();

        var sql = SurveyQueries.WithTitleMatching(db.Surveys, "engagement").ToQueryString();

        Assert.Contains("ILIKE", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("title_en", sql, StringComparison.Ordinal);
        Assert.Contains("title_es", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_full_my_pipeline_translates_end_to_end()
    {
        using var db = CreateContext();

        var assigned = SurveyQueries.AssignedTo(
            db.Surveys, db.SurveyDepartmentTargets, db.Responses, CompanyId, DepartmentId, UserId);

        // Composing the filter and the projection is what the endpoint actually does, and
        // either half translating alone would not prove the pair does.
        var sql = SurveyQueries.ToMyRows(assigned, db.Questions).ToQueryString();

        Assert.Contains("ORDER BY", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("end_date", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_full_admin_listing_pipeline_translates_end_to_end()
    {
        using var db = CreateContext();

        var filtered = SurveyQueries.WithTitleMatching(
            db.Surveys.Where(s => s.CompanyId == CompanyId && s.Status == "draft"), "pulse");

        var sql = SurveyQueries.ToListRows(filtered, db.Questions).ToQueryString();

        Assert.Contains("ILIKE", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("COUNT", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("50%", "50\\%")]
    [InlineData("a_b", "a\\_b")]
    [InlineData("back\\slash", "back\\\\slash")]
    [InlineData("plain", "plain")]
    public void Like_wildcards_in_a_search_term_are_escaped_so_they_match_literally(string input, string expected)
        => Assert.Equal(expected, SurveyQueries.EscapeLike(input));
}
