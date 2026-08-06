using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Persistence;

/// <summary>One row of the admin listing, before its title is resolved for a locale.</summary>
public sealed record SurveyListRow(
    Guid Id,
    string? TitleEn,
    string? TitleEs,
    Guid CompanyId,
    string Type,
    string Status,
    string Language,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    int ResponseCount,
    int? TargetAudienceCount,
    int QuestionCount,
    DateTimeOffset CreatedAt);

/// <summary>One row of <c>/surveys/my</c>, before its title is resolved for a locale.</summary>
public sealed record MySurveyRow(
    Guid Id,
    string? TitleEn,
    string? TitleEs,
    string? DescriptionEn,
    string? DescriptionEs,
    string Language,
    string Type,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    int QuestionCount,
    bool Anonymous,
    int? TimeLimitMinutes);

/// <summary>
/// The survey listings' LINQ, composed over <see cref="IQueryable{T}"/> rather than over a
/// DbContext.
///
/// Extracted from the endpoint for one reason: these are the first correlated subqueries in
/// a projection anywhere in this codebase, and a shape EF cannot translate throws at
/// request time, not at build time. Taking the sequences as parameters lets
/// <c>SurveyQueriesTranslationTests</c> call <c>ToQueryString()</c> on the real thing and
/// prove the SQL exists -- no container, no connection, and no second copy of the query
/// that could drift from the one the endpoint actually runs.
///
/// Locale resolution deliberately stays out: <c>_en</c>/<c>_es</c> come back as columns and
/// are resolved in memory, because the fallback rule is not expressible in SQL and pushing
/// it there would produce silent substitution instead of a self-reported fallback.
/// </summary>
public static class SurveyQueries
{
    /// <summary>
    /// Surveys <paramref name="userId"/> is expected to answer: active, in their company,
    /// targeted at them, and not already completed by them.
    /// </summary>
    /// <param name="departmentId">
    /// Null for a user with no department. Branched rather than folded into one predicate
    /// so the generated SQL is unambiguous instead of relying on a <c>= NULL</c> comparison
    /// that is never true.
    /// </param>
    public static IQueryable<Survey> AssignedTo(
        IQueryable<Survey> surveys,
        IQueryable<SurveyDepartmentTarget> departmentTargets,
        IQueryable<Response> responses,
        Guid companyId,
        Guid? departmentId,
        Guid userId)
    {
        var query = surveys.Where(s => s.CompanyId == companyId && s.Status == SurveyStatuses.Active);

        // No targets at all means company-wide; any targets means only those departments.
        query = departmentId is Guid department
            ? query.Where(s =>
                !departmentTargets.Any(t => t.SurveyId == s.Id)
                || departmentTargets.Any(t => t.SurveyId == s.Id && t.DepartmentId == department))
            : query.Where(s => !departmentTargets.Any(t => t.SurveyId == s.Id));

        // "Must answer" excludes what has already been answered. An anonymous survey stores
        // no UserId, so it stays listed for its whole window -- the alternative is
        // identifying respondents to an anonymous survey, which is the one thing it
        // promises not to do.
        return query.Where(s => !responses.Any(r => r.SurveyId == s.Id && r.UserId == userId && r.IsComplete));
    }

    /// <summary>
    /// Searches BOTH title columns. Searching only the requested locale would make a
    /// bilingual survey findable in one language and invisible in the other.
    /// </summary>
    public static IQueryable<Survey> WithTitleMatching(IQueryable<Survey> surveys, string term)
    {
        var pattern = $"%{EscapeLike(term.Trim())}%";
        return surveys.Where(s =>
            (s.TitleEn != null && EF.Functions.ILike(s.TitleEn, pattern, LikeEscapeCharacter))
            || (s.TitleEs != null && EF.Functions.ILike(s.TitleEs, pattern, LikeEscapeCharacter)));
    }

    public static IQueryable<SurveyListRow> ToListRows(IQueryable<Survey> surveys, IQueryable<Question> questions)
        => surveys
            .OrderByDescending(s => s.CreatedAt)
            .Select(s => new SurveyListRow(
                s.Id,
                s.TitleEn,
                s.TitleEs,
                s.CompanyId,
                s.Type,
                s.Status,
                s.Language,
                s.StartDate,
                s.EndDate,
                s.ResponseCount,
                s.TargetAudienceCount,
                questions.Count(q => q.SurveyId == s.Id),
                s.CreatedAt));

    public static IQueryable<MySurveyRow> ToMyRows(IQueryable<Survey> surveys, IQueryable<Question> questions)
        => surveys
            // Soonest deadline first: an inbox is a queue, not an archive.
            .OrderBy(s => s.EndDate)
            .Select(s => new MySurveyRow(
                s.Id,
                s.TitleEn,
                s.TitleEs,
                s.DescriptionEn,
                s.DescriptionEs,
                s.Language,
                s.Type,
                s.StartDate,
                s.EndDate,
                questions.Count(q => q.SurveyId == s.Id),
                s.Settings.Anonymous,
                s.Settings.TimeLimitMinutes));

    private const string LikeEscapeCharacter = "\\";

    /// <summary>
    /// ILIKE treats <c>%</c> and <c>_</c> as wildcards, so an unescaped search for "50%"
    /// would match every survey in the tenant.
    /// </summary>
    public static string EscapeLike(string value)
        => value.Replace("\\", "\\\\", StringComparison.Ordinal)
                .Replace("%", "\\%", StringComparison.Ordinal)
                .Replace("_", "\\_", StringComparison.Ordinal);
}
