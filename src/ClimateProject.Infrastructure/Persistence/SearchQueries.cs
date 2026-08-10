using ClimateProject.Application.Search;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence.Configurations;
using Microsoft.EntityFrameworkCore;
using NpgsqlTypes;

namespace ClimateProject.Infrastructure.Persistence;

/// <summary>
/// One hit from any searchable table, before its text is resolved for a locale.
/// </summary>
/// <param name="TitleEn">
/// For a language-paired entity, the <c>_en</c> column. For an entity with a single
/// untranslated title (a department, an action plan, a report, a person) this carries that
/// one string and <paramref name="TitleEs"/> is null -- which is exactly the input
/// <c>LocalizedContent.Resolve</c> already handles correctly, so the endpoint has one
/// resolution path rather than two.
/// </param>
/// <param name="ContentLanguage">
/// The owning content's <c>Language</c> ('es' | 'en' | 'both'), or null when the entity has
/// no authored language. Feeds step 2 of the resolution rule.
/// </param>
public sealed record SearchHitRow(
    string Type,
    Guid Id,
    string? TitleEn,
    string? TitleEs,
    string? SubtitleEn,
    string? SubtitleEs,
    string? ContentLanguage,
    Guid? CompanyId,
    Guid? ParentId);

/// <summary>
/// The permission-filtered full-text queries behind <c>/search</c> (#145).
///
/// Two rules govern everything in this file.
///
/// **The tenant predicate is composed into the query, never applied to its results.**
/// Every method below takes a <see cref="SearchScope"/> and puts <c>company_id = @p</c>
/// into the same statement as the <c>@@</c> match and the <c>LIMIT</c>, so the unfiltered
/// set is never materialised. Filtering afterwards would mean the rows existed in memory,
/// and then a count, a <c>Take</c> applied in the wrong order, a log line or a later
/// refactor leaks them. This is the whole reason #145 is a story of its own.
///
/// Note in particular that the limit is applied *after* the tenant predicate everywhere,
/// including for questions. "Top 10 matches, then keep the ones in my company" is the
/// subtle version of the same bug: it silently returns nothing for a tenant whose matches
/// were crowded out by another tenant's.
///
/// **The scope a role gets is copied from that entity's existing listing endpoint, never
/// invented here.** Search must not be the first surface that exposes a row. Surveys,
/// questions, departments, users, action plans and reports are all admin-only reads today
/// (<c>SurveyEndpoints.CanAdminister</c>, <c>UserEndpoints.CanAccessCompany</c> and the
/// three <c>CanAccessCompany</c> twins), so non-admin roles get exactly one search surface:
/// <see cref="AssignedSurveys"/>, which reuses <c>SurveyQueries.AssignedTo</c> -- the same
/// predicate that decides what <c>/surveys/my</c> shows them.
///
/// Composed over <see cref="IQueryable{T}"/> rather than over a DbContext for the reason
/// <c>SurveyQueries</c> gives: <c>ToQueryString()</c> can then prove in a unit test, with no
/// container and no connection, that these shapes translate to SQL -- and an EF shape that
/// does not translate throws at request time, not at build time.
/// </summary>
public static class SearchQueries
{
    private const string Vector = SearchIndexConfiguration.PropertyName;
    private const string Config = SearchIndexConfiguration.Configuration;

    /// <summary>
    /// Surveys inside <paramref name="scope"/>. Both title columns and both description
    /// columns feed one vector, so a Spanish-only survey is found by Spanish words and an
    /// English one by English words without the caller saying which language they meant.
    /// </summary>
    public static IQueryable<SearchHitRow> Surveys(IQueryable<Survey> surveys, SearchScope scope, string tsQuery, int limit)
    {
        var scoped = scope.CompanyId is Guid company ? surveys.Where(s => s.CompanyId == company) : surveys;

        return TopMatches(scoped, tsQuery, limit)
            .Select(s => new SearchHitRow(
                SearchEntityTypes.Survey,
                s.Id,
                s.TitleEn,
                s.TitleEs,
                s.DescriptionEn,
                s.DescriptionEs,
                s.Language,
                s.CompanyId,
                null));
    }

    /// <summary>
    /// Surveys <paramref name="userId"/> is expected to answer, narrowed by the search
    /// term. The only search surface a leader, supervisor or employee has, because
    /// <c>/surveys/my</c> is the only listing of any searchable entity their role can read.
    ///
    /// The assignment predicate comes from <c>SurveyQueries.AssignedTo</c> rather than
    /// being restated here: two copies of "which surveys is this person allowed to see"
    /// is one copy too many, and the copy that drifts is the one that leaks.
    /// </summary>
    public static IQueryable<SearchHitRow> AssignedSurveys(
        IQueryable<Survey> surveys,
        IQueryable<SurveyDepartmentTarget> departmentTargets,
        IQueryable<Response> responses,
        Guid companyId,
        Guid? departmentId,
        Guid userId,
        string tsQuery,
        int limit)
        => Surveys(
            SurveyQueries.AssignedTo(surveys, departmentTargets, responses, companyId, departmentId, userId),
            SearchScope.ForCompany(companyId),
            tsQuery,
            limit);

    /// <summary>
    /// Questions inside <paramref name="scope"/>. Questions carry no <c>company_id</c> of
    /// their own, so the tenant predicate is an inner join to the scoped survey set. The
    /// join comes before the ordering and the limit, so the page is the tenant's top
    /// matches and not "everyone's top matches, filtered". The survey's title rides along
    /// as the subtitle so a bare question text is identifiable in a result list.
    /// </summary>
    public static IQueryable<SearchHitRow> Questions(
        IQueryable<Question> questions,
        IQueryable<Survey> surveys,
        SearchScope scope,
        string tsQuery,
        int limit)
    {
        var scopedSurveys = scope.CompanyId is Guid company ? surveys.Where(s => s.CompanyId == company) : surveys;

        return questions
            .Where(q => EF.Property<NpgsqlTsVector>(q, Vector).Matches(EF.Functions.ToTsQuery(Config, tsQuery)))
            .Join(scopedSurveys, q => q.SurveyId, s => s.Id, (q, s) => new { Question = q, Survey = s })
            .OrderByDescending(x => EF.Property<NpgsqlTsVector>(x.Question, Vector).Rank(EF.Functions.ToTsQuery(Config, tsQuery)))
            .ThenBy(x => x.Question.Id)
            .Take(limit)
            .Select(x => new SearchHitRow(
                SearchEntityTypes.Question,
                x.Question.Id,
                x.Question.TextEn,
                x.Question.TextEs,
                x.Survey.TitleEn,
                x.Survey.TitleEs,
                x.Survey.Language,
                x.Survey.CompanyId,
                x.Survey.Id));
    }

    public static IQueryable<SearchHitRow> Departments(IQueryable<Department> departments, SearchScope scope, string tsQuery, int limit)
    {
        var scoped = scope.CompanyId is Guid company ? departments.Where(d => d.CompanyId == company) : departments;

        return TopMatches(scoped, tsQuery, limit)
            .Select(d => new SearchHitRow(
                SearchEntityTypes.Department,
                d.Id,
                d.Name,
                null,
                d.Description,
                null,
                null,
                d.CompanyId,
                null));
    }

    /// <summary>
    /// Users inside <paramref name="scope"/>.
    ///
    /// <c>User.CompanyId</c> is nullable and NULL means "belongs to no tenant" (#191) --
    /// today only a global super_admin. The scoped predicate is a plain
    /// <c>company_id = @p</c>, so those rows can never match a CompanyAdmin's search, which
    /// is the same outcome <c>UserEndpoints.ListAsync</c> documents for its own listing.
    /// </summary>
    public static IQueryable<SearchHitRow> Users(IQueryable<User> users, SearchScope scope, string tsQuery, int limit)
    {
        var scoped = scope.CompanyId is Guid company ? users.Where(u => u.CompanyId == company) : users;

        return TopMatches(scoped, tsQuery, limit)
            .Select(u => new SearchHitRow(
                SearchEntityTypes.User,
                u.Id,
                u.Name,
                null,
                u.Email,
                null,
                null,
                u.CompanyId,
                null));
    }

    public static IQueryable<SearchHitRow> ActionPlans(IQueryable<ActionPlan> actionPlans, SearchScope scope, string tsQuery, int limit)
    {
        var scoped = scope.CompanyId is Guid company ? actionPlans.Where(a => a.CompanyId == company) : actionPlans;

        return TopMatches(scoped, tsQuery, limit)
            .Select(a => new SearchHitRow(
                SearchEntityTypes.ActionPlan,
                a.Id,
                a.Title,
                null,
                a.Description,
                null,
                null,
                a.CompanyId,
                null));
    }

    public static IQueryable<SearchHitRow> Reports(IQueryable<Report> reports, SearchScope scope, string tsQuery, int limit)
    {
        var scoped = scope.CompanyId is Guid company ? reports.Where(r => r.CompanyId == company) : reports;

        return TopMatches(scoped, tsQuery, limit)
            .Select(r => new SearchHitRow(
                SearchEntityTypes.Report,
                r.Id,
                r.Title,
                null,
                r.Description,
                null,
                null,
                r.CompanyId,
                null));
    }

    /// <summary>
    /// Match, rank, cap -- in one statement, over an already tenant-scoped sequence.
    ///
    /// The <c>Id</c> tiebreak is not decoration. <c>ts_rank</c> over short titles produces
    /// ties constantly, and without a total order Postgres is free to return a different
    /// subset of the tied rows each time, which reads as results flickering while someone
    /// types. It is <c>EF.Property</c> rather than a typed selector so that this stays one
    /// helper for six entity types; every searchable entity keys on a <c>Guid Id</c>.
    ///
    /// Recency is deliberately not part of the ordering: <c>Question</c> has no
    /// <c>UpdatedAt</c>, and one ordering rule that holds for every kind is worth more than
    /// a slightly better one that holds for five of six.
    /// </summary>
    private static IQueryable<TEntity> TopMatches<TEntity>(IQueryable<TEntity> scoped, string tsQuery, int limit)
        where TEntity : class
        => scoped
            .Where(e => EF.Property<NpgsqlTsVector>(e, Vector).Matches(EF.Functions.ToTsQuery(Config, tsQuery)))
            .OrderByDescending(e => EF.Property<NpgsqlTsVector>(e, Vector).Rank(EF.Functions.ToTsQuery(Config, tsQuery)))
            .ThenBy(e => EF.Property<Guid>(e, "Id"))
            .Take(limit);
}
