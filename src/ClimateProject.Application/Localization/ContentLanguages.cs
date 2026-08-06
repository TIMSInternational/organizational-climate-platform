namespace ClimateProject.Application.Localization;

/// <summary>
/// The one canonical vocabulary for *content* language, kept deliberately separate
/// from the display-preference language on <c>Company.Settings.Language</c> and
/// <c>User.Preferences.Language</c>.
///
/// UI-string i18n (#78/#176) translates the chrome; this vocabulary governs the text
/// an admin authored -- a survey title, a question, an option label. The two are not
/// the same setting and must not be collapsed into one: a Spanish-speaking employee
/// can be served an English-only survey, and the product has to be able to say so.
///
/// Deliberately a validated string set rather than a C# enum, matching
/// <c>Roles</c>, the <c>Status</c> columns and <c>QuestionTypes</c>.
/// </summary>
public static class ContentLanguages
{
    public const string English = "en";
    public const string Spanish = "es";

    /// <summary>
    /// An explicit per-survey override meaning "this survey is authored in both
    /// languages". Decided 2026-08-05 (#195): the default is the company's own
    /// language, and <c>both</c> is the exception rather than the norm -- so the
    /// publish gate below only demands a second translation when someone opts in.
    /// </summary>
    public const string Both = "both";

    /// <summary>
    /// Locales content can actually be stored in. A third language is a migration
    /// adding one entry here and one column pair per field -- and, because no read
    /// DTO is <c>En</c>/<c>Es</c>-shaped, zero frontend change. That property is the
    /// whole reason the paired-column design was affordable; see #195.
    /// </summary>
    public static readonly string[] Locales = [English, Spanish];

    /// <summary>Values accepted for <c>Survey.Language</c> / <c>Microclimate.Language</c>.</summary>
    public static readonly string[] ValidLanguages = [English, Spanish, Both];

    /// <summary>
    /// Matches <c>web/src/i18n/locale.ts</c>'s <c>FALLBACK_LOCALE</c>. Used only as
    /// the last resort in <see cref="LocalizedContent.Resolve"/>, never as a silent
    /// default for authored content -- see the note there.
    /// </summary>
    public const string FallbackLocale = English;

    public static bool IsLocale(string? value) => value is English or Spanish;

    public static bool IsValidLanguage(string? value) => value is English or Spanish or Both;

    /// <summary>
    /// Lower-cases and trims, and maps a BCP-47 tag ("es-CO", "EN-us") to its base
    /// locale so a <c>?lang=</c> query parameter or an <c>Accept-Language</c> header
    /// can be handed straight in. Returns null for anything unrecognised rather than
    /// guessing.
    /// </summary>
    public static string? NormaliseLocale(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var trimmed = raw.Trim();
        var separator = trimmed.IndexOfAny(['-', '_']);
        if (separator > 0)
        {
            trimmed = trimmed[..separator];
        }

        var lowered = trimmed.ToLowerInvariant();
        return IsLocale(lowered) ? lowered : null;
    }

    public static string? NormaliseLanguage(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var lowered = raw.Trim().ToLowerInvariant();
        return IsValidLanguage(lowered) ? lowered : null;
    }

    /// <summary>
    /// The locales a piece of content must actually be authored in to satisfy its own
    /// <paramref name="language"/>. <c>both</c> requires two; a single language
    /// requires one. This is what the publish gate iterates.
    /// </summary>
    public static IReadOnlyList<string> RequiredLocales(string? language)
        => NormaliseLanguage(language) switch
        {
            Both => Locales,
            Spanish => [Spanish],
            _ => [English],
        };

    /// <summary>
    /// The single locale a piece of content is authored in, or null when it is
    /// <c>both</c>. Used both by the read-time fallback (step 2) and by the
    /// write-time attribution of a bare string (see <c>LocalizedInput</c>).
    /// </summary>
    public static string? SingleLocaleOf(string? language)
        => NormaliseLanguage(language) switch
        {
            Spanish => Spanish,
            English => English,
            _ => null,
        };
}
