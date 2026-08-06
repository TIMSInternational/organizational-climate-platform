using System.Globalization;
using ClimateProject.Application.Localization;

namespace ClimateProject.Application.Scheduling;

/// <summary>
/// The wording of the notifications the scheduler generates itself.
///
/// <para>These are the only notifications in the platform with no human author. An admin
/// writes a survey invitation; nobody writes "you have 4 unread notifications". So the copy
/// has to live in code -- but it still has to be bilingual, because a Spanish-speaking
/// employee receiving an English reminder is the exact defect #78 and #195 exist to prevent,
/// and it is not made acceptable by the sender being a machine.</para>
///
/// <para><b>Which language.</b> <c>User.Preferences.Language</c>, not the survey's
/// <c>Language</c>. <see cref="ContentLanguages"/> is explicit that the two are different
/// settings, and this text is chrome around the content rather than content: a reminder about
/// an English-only survey should still say "You have not responded yet" in the recipient's own
/// language. The survey's own title is interpolated in whatever language it was authored in,
/// resolved through <see cref="LocalizedContent"/> like everywhere else.</para>
///
/// <para>Not routed through the <c>web/src/i18n</c> catalogue -- that catalogue is TypeScript,
/// shipped to the browser, and these strings are rendered into an email body server-side and
/// then frozen into a <c>notifications</c> row. Two locales, resolved here, with English as
/// the last resort exactly as <c>FALLBACK_LOCALE</c> prescribes.</para>
/// </summary>
public static class ScheduledNotificationCopy
{
    /// <summary>One string in the two locales the platform stores content in.</summary>
    /// <param name="En">English.</param>
    /// <param name="Es">Spanish.</param>
    public sealed record Phrase(string En, string Es)
    {
        /// <summary>
        /// The variant for <paramref name="locale"/>, falling back to English for anything
        /// unrecognised. Safe to hand a raw <c>User.Preferences.Language</c>, which is a free
        /// varchar with no validation behind it.
        /// </summary>
        public string For(string? locale)
            => string.Equals(ContentLanguages.NormaliseLocale(locale), ContentLanguages.Spanish, StringComparison.Ordinal)
                ? Es
                : En;
    }

    private static readonly Phrase ReminderTitle = new(
        "Reminder: your response is still pending",
        "Recordatorio: tu respuesta sigue pendiente");

    private static readonly Phrase ReminderBodyNamed = new(
        "You have not yet completed \"{0}\". It closes on {1}.",
        "Aun no has completado \"{0}\". Cierra el {1}.");

    private static readonly Phrase ReminderBodyUnnamed = new(
        "You have a pending response. It closes on {0}.",
        "Tienes una respuesta pendiente. Cierra el {0}.");

    private static readonly Phrase DigestTitle = new(
        "Your activity summary",
        "Tu resumen de actividad");

    private static readonly Phrase DigestBodySingle = new(
        "You have 1 new notification since {0}.",
        "Tienes 1 notificacion nueva desde el {0}.");

    private static readonly Phrase DigestBodyMany = new(
        "You have {0} new notifications since {1}.",
        "Tienes {0} notificaciones nuevas desde el {1}.");

    /// <summary>Subject line for an invitation reminder.</summary>
    public static string ReminderTitleFor(string? locale) => ReminderTitle.For(locale);

    /// <summary>
    /// Body for an invitation reminder.
    ///
    /// <paramref name="contentTitle"/> is nullable because the survey's title may be absent in
    /// every locale -- an unpublished draft distributed by mistake, or a legacy row imported
    /// without one. Interpolating an empty string there would produce
    /// <c>You have not yet completed ""</c>, so there is a second phrasing that omits the name
    /// entirely rather than showing an empty pair of quotes.
    /// </summary>
    public static string ReminderBodyFor(string? locale, string? contentTitle, DateTimeOffset closesAtUtc)
    {
        var closes = closesAtUtc.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        return string.IsNullOrWhiteSpace(contentTitle)
            ? string.Format(CultureInfo.InvariantCulture, ReminderBodyUnnamed.For(locale), closes)
            : string.Format(CultureInfo.InvariantCulture, ReminderBodyNamed.For(locale), contentTitle, closes);
    }

    /// <summary>Subject line for a digest.</summary>
    public static string DigestTitleFor(string? locale) => DigestTitle.For(locale);

    /// <summary>
    /// Body for a digest. Singular and plural are separate phrases rather than one string with
    /// an "(s)" -- Spanish pluralises the noun and the numeral agreement differently, and
    /// "1 notificaciones" is the sort of thing that makes a product look machine-translated.
    /// </summary>
    public static string DigestBodyFor(string? locale, int count, DateTimeOffset sinceUtc)
    {
        var since = sinceUtc.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        return count == 1
            ? string.Format(CultureInfo.InvariantCulture, DigestBodySingle.For(locale), since)
            : string.Format(CultureInfo.InvariantCulture, DigestBodyMany.For(locale), count, since);
    }
}
