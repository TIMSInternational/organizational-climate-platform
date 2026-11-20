using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.RespondentContent;

/// <summary>
/// Everything the chain reads for one company, and optionally one of its surveys, as loaded by
/// <c>RespondentContentStore.LoadAsync</c> (Infrastructure). Pure data, so the chain is testable
/// without a database.
/// </summary>
/// <param name="CompanyValues">The company's own rows (<c>survey_id</c> null).</param>
/// <param name="SurveyValues">The survey's rows in the table; empty for a company-only read.</param>
/// <param name="SurveySettings">The survey's settings, for its legacy columns; null for a company-only read.</param>
public sealed record RespondentContentSources(
    IReadOnlyList<RespondentContentValue> CompanyValues,
    IReadOnlyList<RespondentContentValue> SurveyValues,
    SurveySettings? SurveySettings)
{
    public static readonly RespondentContentSources Empty = new([], [], null);
}

/// <summary>
/// The fallback chain, once, for every reader (ruled 2026-11-19,
/// <c>docs/decisions/editable-respondent-content.md</c>):
/// <code>survey row → survey legacy column (legacy keys only) → company row → (absent: product default)</code>
/// </summary>
/// <remarks>
/// <para><b>Overrides only.</b> A key appears in the result only when the survey or the company
/// set it; the product default is the reader's to supply (the catalogue on a screen, the C# copy
/// in a composer). So the web renders <c>content[key] ?? t(key)</c> and a composer
/// <c>content.GetValueOrDefault(key) ?? copy.Default</c>.</para>
///
/// <para><b>Never another locale's words.</b> A text is looked up in the requested locale and
/// nowhere else: a Spanish override is never shown to an English reader, who gets the product
/// default in English (<c>docs/decisions/author-content-i18n.md</c>). Display keys are read from
/// locale <c>*</c> and returned under their key whatever the locale asked for. A locale that is
/// neither <c>es</c> nor <c>en</c> gets display keys only.</para>
///
/// <para><b>Only what the registry names, only valid values.</b> A row whose key the registry no
/// longer has, a text stored under <c>*</c>, a display value outside its set, or a blank value is
/// skipped -- the chain moves on to the next level as if it were absent.</para>
/// </remarks>
public static class RespondentContentResolver
{
    /// <summary>The effective overrides for <paramref name="locale"/>.</summary>
    /// <param name="kinds">Which <see cref="RespondentContentKinds"/> to include; null for all of them.</param>
    public static IReadOnlyDictionary<string, string> Resolve(
        RespondentContentSources sources,
        string? locale,
        IReadOnlyCollection<string>? kinds = null)
    {
        ArgumentNullException.ThrowIfNull(sources);

        var survey = Index(sources.SurveyValues);
        var company = Index(sources.CompanyValues);
        var result = new Dictionary<string, string>(StringComparer.Ordinal);

        foreach (var entry in RespondentContentRegistry.Entries)
        {
            if (kinds is not null && !kinds.Contains(entry.Kind))
            {
                continue;
            }

            var value = entry.IsDisplay
                ? Pick(entry, survey, company, null, RespondentContentLocales.Any)
                : RespondentContentLocales.IsText(locale)
                    ? Pick(entry, survey, company, sources.SurveySettings, locale!)
                    : null;

            if (value is not null)
            {
                result[entry.Key] = value;
            }
        }

        return result;
    }

    /// <summary>
    /// The effective overrides in every locale, shaped as the GET and the PUT body are:
    /// <c>{ "es": {...}, "en": {...}, "*": {...} }</c>, texts under their locale and display keys
    /// under <c>*</c>. Every locale is present, possibly empty.
    /// </summary>
    public static IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> ResolveByLocale(RespondentContentSources sources)
    {
        ArgumentNullException.ThrowIfNull(sources);

        var textKinds = new[] { RespondentContentKinds.Screen, RespondentContentKinds.Email };
        return new Dictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.Ordinal)
        {
            [RespondentContentLocales.Spanish] = Resolve(sources, RespondentContentLocales.Spanish, textKinds),
            [RespondentContentLocales.English] = Resolve(sources, RespondentContentLocales.English, textKinds),
            [RespondentContentLocales.Any] = Resolve(sources, RespondentContentLocales.Any, [RespondentContentKinds.Display]),
        };
    }

    /// <summary>
    /// Stored values grouped by locale (every locale present), keeping only what the registry
    /// would read: the same filter <see cref="Resolve"/> applies, without the chain.
    /// </summary>
    public static IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> GroupByLocale(IEnumerable<RespondentContentValue> values)
    {
        ArgumentNullException.ThrowIfNull(values);

        var grouped = RespondentContentLocales.All.ToDictionary(
            locale => locale,
            _ => new Dictionary<string, string>(StringComparer.Ordinal),
            StringComparer.Ordinal);
        foreach (var value in values)
        {
            if (Usable(value) is { } text && grouped.TryGetValue(value.Locale, out var bucket))
            {
                bucket[value.Key] = text;
            }
        }

        return grouped.ToDictionary(
            pair => pair.Key,
            pair => (IReadOnlyDictionary<string, string>)pair.Value,
            StringComparer.Ordinal);
    }

    private static string? Pick(
        RespondentContentEntry entry,
        Dictionary<(string Key, string Locale), string> survey,
        Dictionary<(string Key, string Locale), string> company,
        SurveySettings? surveySettings,
        string locale)
    {
        // 1. The survey's own row.
        if (survey.TryGetValue((entry.Key, locale), out var fromSurvey))
        {
            return fromSurvey;
        }

        // 2. The survey's legacy column, for the four keys that had one -- in THIS locale only.
        if (entry.LegacyColumn is not null && surveySettings is not null
            && RespondentContentLegacy.Read(surveySettings, entry.LegacyColumn, locale) is { } fromColumn)
        {
            return fromColumn;
        }

        // 3. The company's row.
        return company.TryGetValue((entry.Key, locale), out var fromCompany) ? fromCompany : null;
    }

    private static Dictionary<(string Key, string Locale), string> Index(IReadOnlyList<RespondentContentValue> values)
    {
        var index = new Dictionary<(string Key, string Locale), string>();
        foreach (var value in values)
        {
            if (Usable(value) is { } text)
            {
                index[(value.Key, value.Locale)] = text;
            }
        }

        return index;
    }

    /// <summary>The value as the chain may use it, or null when the registry would not read it.</summary>
    private static string? Usable(RespondentContentValue value)
    {
        if (string.IsNullOrWhiteSpace(value.Value)
            || !RespondentContentRegistry.TryGet(value.Key, out var entry)
            || !entry.TakesLocale(value.Locale))
        {
            return null;
        }

        if (entry.IsDisplay && !entry.AllowedValues.Contains(value.Value, StringComparer.Ordinal))
        {
            return null;
        }

        return value.Value;
    }
}
