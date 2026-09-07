namespace ClimateProject.Application.Localization;

/// <summary>
/// The read and write rules for Tier 2 content -- the paired columns #210 added to the
/// fields only an administrator ever reads: template names, action-plan titles, KPI units,
/// benchmark descriptions, report titles.
///
/// <para>
/// Tier 1 (#195) resolves against a language the content <em>declares</em>:
/// <c>Survey.Language</c>, read by a publish gate. None of the Tier 2 rows declares one,
/// and none has a gate, so the only honest statement about a template's or a plan's
/// language is what its two columns contain -- the same argument
/// <c>SurveyTemplateLanguage.Infer</c> makes for template questions. Every helper here
/// therefore infers the content language from the pair itself.
/// </para>
///
/// <para>
/// <b>A bare string is never refused here.</b> Tier 1 rejects a bare string for content
/// authored in <c>both</c>, because filing one language's text into the wrong column of a
/// bilingual survey is served to respondents as a lie. These fields reach no respondent,
/// and every existing admin form sends them as bare strings -- so a refusal would be a
/// regression for every bilingual tenant on the day the columns land, with nothing gained.
/// A bare string is filed under <see cref="AttributionLocale"/> instead, and a caller who
/// wants both languages sends <c>{ "en": ..., "es": ... }</c>, the same wire shape as
/// everywhere else.
/// </para>
/// </summary>
public static class AuthoredContent
{
    /// <summary>
    /// The language a pair of columns is authored in, read off the columns: <c>both</c>,
    /// <c>en</c>, <c>es</c>, or null when neither half holds text.
    /// </summary>
    public static string? LanguageOf(string? en, string? es)
        => (!string.IsNullOrWhiteSpace(en), !string.IsNullOrWhiteSpace(es)) switch
        {
            (true, true) => ContentLanguages.Both,
            (true, false) => ContentLanguages.English,
            (false, true) => ContentLanguages.Spanish,
            _ => null,
        };

    /// <summary>
    /// <see cref="LocalizedContent.Resolve"/> with the content language inferred from the
    /// pair, so a Spanish-only template read in English comes back in Spanish, flagged as a
    /// fallback, rather than as an English column that was never written.
    /// </summary>
    public static LocalizedText Resolve(string? en, string? es, string? requestedLocale)
        => LocalizedContent.Resolve(en, es, requestedLocale, LanguageOf(en, es));

    public static string? ResolveText(string? en, string? es, string? requestedLocale)
        => Resolve(en, es, requestedLocale).Text;

    /// <summary>
    /// Resolves and records the field in <paramref name="fallbackFields"/> when it had to
    /// reach for the other language -- the self-reporting every fallback owes the reader.
    /// </summary>
    public static string? Resolve(
        string? en,
        string? es,
        string? requestedLocale,
        string fieldPath,
        List<string> fallbackFields)
    {
        var resolved = Resolve(en, es, requestedLocale);
        if (resolved.IsFallback)
        {
            fallbackFields.Add(fieldPath);
        }

        return resolved.Text;
    }

    /// <summary>
    /// <see cref="ResolveText"/> for a field the write side guarantees is authored in at
    /// least one language (every <c>required</c> Tier 2 field: <see cref="TryApply"/>
    /// callers refuse to un-author the last language).
    /// </summary>
    /// <remarks>
    /// The empty-string branch is unreachable through the API. It exists so a row emptied
    /// by hand renders as a blank rather than as a 500, and it is deliberately not a key
    /// path or a placeholder -- #78's lesson about missing keys rendering to Spanish users
    /// applies to content too.
    /// </remarks>
    public static string ResolveRequired(string? en, string? es, string? requestedLocale)
        => ResolveText(en, es, requestedLocale) ?? string.Empty;

    /// <summary>
    /// The locale a bare string is filed under on write, in order of how much the signal
    /// knows about the author: the language the request declares, then the owning
    /// company's single language, then the language the author reads the product in, then
    /// English. A company set to <c>both</c> carries no single language and falls through.
    /// </summary>
    public static string AttributionLocale(string? declaredLanguage, string? companyLanguage, string? authorDisplayLanguage)
        => ContentLanguages.SingleLocaleOf(declaredLanguage)
           ?? ContentLanguages.SingleLocaleOf(companyLanguage)
           ?? ContentLanguages.NormaliseLocale(authorDisplayLanguage)
           ?? ContentLanguages.FallbackLocale;

    /// <summary>
    /// Applies one write to a pair. A null <paramref name="input"/> leaves both halves
    /// alone; a bare string replaces the <paramref name="attributionLocale"/> half; a
    /// locale-keyed object replaces exactly the halves it names. A supplied blank clears
    /// that half to null -- the explicit "remove this translation" -- and it is the
    /// caller's job to refuse the result when a required field ends up authored in no
    /// language at all (<see cref="IsAuthored"/>).
    /// </summary>
    /// <returns>False, with <paramref name="error"/> set, only for an unsupported locale key.</returns>
    public static bool TryApply(
        LocalizedInput? input,
        string attributionLocale,
        string fieldName,
        ref string? en,
        ref string? es,
        out string? error)
    {
        error = null;
        if (input is null)
        {
            return true;
        }

        if (!input.TryResolve(attributionLocale, fieldName, out var newEn, out var newEs, out error))
        {
            return false;
        }

        if (newEn is not null)
        {
            en = Normalise(newEn);
        }

        if (newEs is not null)
        {
            es = Normalise(newEs);
        }

        return true;
    }

    /// <summary>True when at least one half holds text.</summary>
    public static bool IsAuthored(string? en, string? es)
        => !string.IsNullOrWhiteSpace(en) || !string.IsNullOrWhiteSpace(es);

    /// <summary>
    /// Trimmed, and null for blank: the columns never hold an empty string, so "cleared"
    /// and "never authored" are the same value and <see cref="LanguageOf"/> reads both as
    /// absence.
    /// </summary>
    private static string? Normalise(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }
}
