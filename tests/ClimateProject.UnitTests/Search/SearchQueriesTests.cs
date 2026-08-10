using ClimateProject.Application.Search;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.UnitTests.Search;

/// <summary>
/// Proves the search LINQ translates to SQL, and -- the point of #145 -- that the tenant
/// predicate is in that SQL rather than applied to its results.
///
/// <c>ToQueryString()</c> builds the SQL from the model alone, so this needs a provider but
/// never a connection: no container, no database, and no second copy of the query that
/// could drift from the one the endpoint runs. The shapes here are the ones that throw at
/// request time rather than build time if they are wrong -- <c>EF.Property</c> against a
/// shadow tsvector column, <c>ts_rank</c> in an ORDER BY, and the join that gives questions
/// a tenant.
/// </summary>
public class SearchQueriesTests
{
    // Never dialled. UseNpgsql only needs a parseable string to build the model and the SQL.
    private const string OfflineConnectionString = "Host=localhost;Database=translation-only;Username=none;Password=none";

    private static ClimateProjectDbContext CreateContext()
        => new(new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(OfflineConnectionString)
            .Options);

    private static readonly Guid CompanyId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid DepartmentId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid UserId = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private static readonly SearchScope Scoped = SearchScope.ForCompany(CompanyId);
    private const string Query = "clima:*";
    private const int Limit = 10;

    // ToQueryString prefixes the statement with the parameter declarations, which of course
    // contain the parameter values. Assertions about what is or is not inlined have to look
    // at the statement itself.
    private static string Statement(string queryString)
    {
        var select = queryString.IndexOf("SELECT", StringComparison.Ordinal);
        Assert.True(select >= 0, $"no SELECT in:\n{queryString}");
        return queryString[select..];
    }

    public static TheoryData<string> EveryEntitySearch()
    {
        using var db = CreateContext();
        return
        [
            SearchQueries.Surveys(db.Surveys, Scoped, Query, Limit).ToQueryString(),
            SearchQueries.Questions(db.Questions, db.Surveys, Scoped, Query, Limit).ToQueryString(),
            SearchQueries.Departments(db.Departments, Scoped, Query, Limit).ToQueryString(),
            SearchQueries.Users(db.Users, Scoped, Query, Limit).ToQueryString(),
            SearchQueries.ActionPlans(db.ActionPlans, Scoped, Query, Limit).ToQueryString(),
            SearchQueries.Reports(db.Reports, Scoped, Query, Limit).ToQueryString(),
        ];
    }

    [Theory]
    [MemberData(nameof(EveryEntitySearch))]
    public void Every_entity_search_matches_ranks_and_limits_inside_one_statement(string queryString)
    {
        var sql = Statement(queryString);

        Assert.Contains("search_vector", sql, StringComparison.Ordinal);
        Assert.Contains("@@", sql, StringComparison.Ordinal);
        Assert.Contains("to_tsquery", sql, StringComparison.Ordinal);
        Assert.Contains("ts_rank", sql, StringComparison.Ordinal);
        Assert.Contains("LIMIT", sql, StringComparison.Ordinal);
    }

    [Theory]
    [MemberData(nameof(EveryEntitySearch))]
    public void Every_scoped_entity_search_filters_by_company_in_the_statement(string queryString)
    {
        var sql = Statement(queryString);

        // The tenant predicate has to be part of what the database runs. Applied afterwards,
        // the unfiltered rows would have existed in memory first, and every later refactor
        // would be one mistake away from returning them.
        var whereIndex = sql.IndexOf("WHERE", StringComparison.Ordinal);
        Assert.True(whereIndex >= 0, $"no WHERE clause in:\n{sql}");
        Assert.Contains("company_id", sql[whereIndex..], StringComparison.Ordinal);
    }

    [Fact]
    public void A_cross_tenant_search_is_the_only_shape_without_a_company_predicate()
    {
        using var db = CreateContext();

        var sql = Statement(SearchQueries.Surveys(db.Surveys, SearchScope.CrossTenant(), Query, Limit).ToQueryString());

        // Reachable only from the SuperAdmin branch of SearchEndpoints.ResolveAccessAsync. The
        // company id still comes back in the projection so a cross-company caller can tell
        // two identically named rows apart -- it is the WHERE that must be free of it.
        var whereIndex = sql.IndexOf("WHERE", StringComparison.Ordinal);
        Assert.True(whereIndex >= 0, $"no WHERE clause in:\n{sql}");
        Assert.DoesNotContain("company_id", sql[whereIndex..], StringComparison.Ordinal);
    }

    [Fact]
    public void Question_search_reaches_its_tenant_through_the_owning_survey()
    {
        using var db = CreateContext();

        var sql = Statement(SearchQueries.Questions(db.Questions, db.Surveys, Scoped, Query, Limit).ToQueryString());

        // questions has no company_id of its own, so the join to surveys IS the tenant
        // boundary. A LEFT JOIN here would return questions whose survey was filtered out.
        Assert.Contains("questions", sql, StringComparison.Ordinal);
        Assert.Contains("surveys", sql, StringComparison.Ordinal);
        Assert.Contains("INNER JOIN", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("LEFT JOIN", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void Question_search_applies_its_limit_after_the_tenant_join_not_before()
    {
        using var db = CreateContext();

        var sql = Statement(SearchQueries.Questions(db.Questions, db.Surveys, Scoped, Query, Limit).ToQueryString());

        // "Top N matches, then keep the ones in my company" returns nothing for a tenant
        // whose matches were crowded out by a bigger tenant's. The LIMIT therefore has to
        // come after the join, not inside a subquery feeding it.
        var join = sql.IndexOf("INNER JOIN", StringComparison.Ordinal);
        var limit = sql.LastIndexOf("LIMIT", StringComparison.Ordinal);
        Assert.True(limit > join, $"LIMIT is applied before the tenant join in:\n{sql}");
    }

    [Fact]
    public void The_non_admin_surface_is_the_assigned_survey_query_narrowed_by_the_term()
    {
        using var db = CreateContext();

        var sql = Statement(SearchQueries.AssignedSurveys(
            db.Surveys, db.SurveyDepartmentTargets, db.Responses, CompanyId, DepartmentId, UserId, Query, Limit).ToQueryString());

        // Both halves must be in one statement: the assignment predicate from
        // SurveyQueries.AssignedTo, and the full-text match.
        Assert.Contains("survey_department_targets", sql, StringComparison.Ordinal);
        Assert.Contains("responses", sql, StringComparison.Ordinal);
        Assert.Contains("company_id", sql, StringComparison.Ordinal);
        Assert.Contains("@@", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_search_term_is_a_bound_parameter_and_never_inlined_into_the_statement()
    {
        using var db = CreateContext();

        var sql = Statement(SearchQueries.Surveys(db.Surveys, Scoped, "payroll:*", Limit).ToQueryString());

        Assert.DoesNotContain("payroll", sql, StringComparison.Ordinal);
    }
}
