namespace ClimateProject.Application.Localization;

/// <summary>
/// One authored field resolved for one request locale.
///
/// Note what is *not* here: no <c>En</c>, no <c>Es</c>. That is the load-bearing
/// constraint from #195 -- reads return the resolved text plus the locale it
/// resolved to, never per-language fields. It is what makes a third language one
/// migration instead of a rewrite of every page that renders content.
/// </summary>
/// <param name="Text">
/// The text to render, or null when the field is genuinely absent in every locale.
/// Never an empty string and never a key path: #78 fixed a real bug where missing
/// keys rendered raw key paths to Spanish users, and the same failure at content
/// level must not be reintroduced.
/// </param>
/// <param name="ResolvedLocale">The locale <see cref="Text"/> is actually written in, or null when absent.</param>
/// <param name="IsFallback">
/// True when the caller asked for a locale and got a different one. Every fallback
/// self-reports; silently substituting English into a Spanish survey is precisely
/// the "untranslated strings" the requirement's test case forbids. Absence is not a
/// fallback -- an absent field reports <c>false</c> with a null <see cref="Text"/>.
/// </param>
public sealed record LocalizedText(string? Text, string? ResolvedLocale, bool IsFallback)
{
    public static readonly LocalizedText Absent = new(null, null, false);
}

/// <summary>
/// The read-time resolution rule for paired <c>&lt;field&gt;_en</c> /
/// <c>&lt;field&gt;_es</c> columns, in one place so every endpoint resolves content
/// identically.
///
/// Deliberate divergence from UI-string i18n: **UI strings fall back to English;
/// authored content does not silently.** <c>FALLBACK_LOCALE = 'en'</c> is right for
/// chrome and wrong as an invisible default for a question put to a Spanish-speaking
/// employee. Hence <see cref="LocalizedText.IsFallback"/>, and hence the publish gate
/// in <see cref="ContentPublishValidation"/> -- a fallback alone can only ever make
/// "no untranslated strings" *usually* true.
/// </summary>
public static class LocalizedContent
{
    /// <param name="en">The <c>_en</c> column.</param>
    /// <param name="es">The <c>_es</c> column.</param>
    /// <param name="requestedLocale">
    /// The locale the caller wants. Anything unrecognised is treated as
    /// <see cref="ContentLanguages.FallbackLocale"/>.
    /// </param>
    /// <param name="contentLanguage">
    /// The owning survey's/microclimate's own <c>Language</c> ('es' | 'en' | 'both').
    /// When it names a single language, that language is preferred over English as
    /// the fallback -- a Spanish-only survey falls back to its own Spanish, not to an
    /// English column that was never authored.
    /// </param>
    public static LocalizedText Resolve(string? en, string? es, string? requestedLocale, string? contentLanguage)
    {
        var requested = ContentLanguages.NormaliseLocale(requestedLocale) ?? ContentLanguages.FallbackLocale;

        // 1. The requested locale, if it was authored.
        var requestedValue = ValueFor(en, es, requested);
        if (!string.IsNullOrWhiteSpace(requestedValue))
        {
            return new LocalizedText(requestedValue, requested, false);
        }

        // 2. The content's own single language, when it has one.
        var single = ContentLanguages.SingleLocaleOf(contentLanguage);
        if (single is not null && single != requested)
        {
            var singleValue = ValueFor(en, es, single);
            if (!string.IsNullOrWhiteSpace(singleValue))
            {
                return new LocalizedText(singleValue, single, true);
            }
        }

        // 3. English, matching web/src/i18n/locale.ts's FALLBACK_LOCALE.
        if (requested != ContentLanguages.FallbackLocale && !string.IsNullOrWhiteSpace(en))
        {
            return new LocalizedText(en, ContentLanguages.FallbackLocale, true);
        }

        // 4. Genuinely absent. Return null and let the caller decide what to render.
        return LocalizedText.Absent;
    }

    /// <summary>
    /// <see cref="Resolve"/> reduced to the text alone, for the many call sites that
    /// only render. Callers that need to badge a fallback use <see cref="Resolve"/>.
    /// </summary>
    public static string? ResolveText(string? en, string? es, string? requestedLocale, string? contentLanguage)
        => Resolve(en, es, requestedLocale, contentLanguage).Text;

    private static string? ValueFor(string? en, string? es, string locale)
        => locale == ContentLanguages.Spanish ? es : en;
}
