using ClimateProject.Application.RespondentContent;
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Persistence;

/// <summary>
/// Reads what <see cref="RespondentContentResolver"/> needs from the database, and resolves it --
/// the one entry point every payload, composer and preview calls (ruled 2026-11-19,
/// <c>docs/decisions/editable-respondent-content.md</c>).
/// </summary>
/// <remarks>
/// <para><b>How a caller uses it.</b> A respondent payload:
/// <c>await RespondentContentStore.ResolveAsync(db, survey, resolvedLocale, RespondentContentKinds.RespondentPayload, ct)</c>.
/// Several locales from one read (an email written in both languages):
/// <c>var sources = await RespondentContentStore.LoadAsync(db, survey, ct);</c> then
/// <c>RespondentContentResolver.Resolve(sources, "es")</c> and <c>(sources, "en")</c>. A company
/// with no survey in hand: the <c>companyId</c> overloads. All of them read only; none writes.</para>
/// <para>Two queries at most (the company's rows, the survey's rows), no tracking.</para>
/// </remarks>
public static class RespondentContentStore
{
    /// <summary>The company's rows, the survey's rows, and the survey's legacy columns.</summary>
    public static async Task<RespondentContentSources> LoadAsync(
        ClimateProjectDbContext db,
        Survey survey,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(survey);

        var rows = await db.RespondentContentOverrides
            .AsNoTracking()
            .Where(o => o.CompanyId == survey.CompanyId && (o.SurveyId == null || o.SurveyId == survey.Id))
            .Select(o => new { o.SurveyId, o.Key, o.Locale, o.Value })
            .ToListAsync(cancellationToken);

        return new RespondentContentSources(
            [.. rows.Where(r => r.SurveyId == null).Select(r => new RespondentContentValue(r.Key, r.Locale, r.Value))],
            [.. rows.Where(r => r.SurveyId != null).Select(r => new RespondentContentValue(r.Key, r.Locale, r.Value))],
            survey.Settings);
    }

    /// <summary>The company's own rows only: what a reader gets where no survey is involved.</summary>
    public static async Task<RespondentContentSources> LoadAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);

        var rows = await db.RespondentContentOverrides
            .AsNoTracking()
            .Where(o => o.CompanyId == companyId && o.SurveyId == null)
            .Select(o => new RespondentContentValue(o.Key, o.Locale, o.Value))
            .ToListAsync(cancellationToken);

        return new RespondentContentSources(rows, [], null);
    }

    /// <summary>The effective overrides for <paramref name="survey"/> in <paramref name="locale"/>.</summary>
    /// <param name="kinds">Which kinds to include; null for all. A respondent payload passes <see cref="RespondentContentKinds.RespondentPayload"/>.</param>
    public static async Task<IReadOnlyDictionary<string, string>> ResolveAsync(
        ClimateProjectDbContext db,
        Survey survey,
        string locale,
        IReadOnlyCollection<string>? kinds,
        CancellationToken cancellationToken)
        => RespondentContentResolver.Resolve(await LoadAsync(db, survey, cancellationToken), locale, kinds);

    /// <summary>The effective overrides for a company with no survey, in <paramref name="locale"/>.</summary>
    public static async Task<IReadOnlyDictionary<string, string>> ResolveAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        string locale,
        IReadOnlyCollection<string>? kinds,
        CancellationToken cancellationToken)
        => RespondentContentResolver.Resolve(await LoadAsync(db, companyId, cancellationToken), locale, kinds);
}
