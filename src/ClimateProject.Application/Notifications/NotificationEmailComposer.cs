using System.Text;
using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Notifications;

/// <summary>
/// Turns a notification row plus its recipient into the email that carries it.
///
/// <para>
/// **What is and is not translated here.** <c>Notification.Title</c> and
/// <c>Notification.Message</c> are authored once, by an admin, at dispatch time -- one row
/// per recipient but one authored text for the whole batch. They are content, and this
/// composer renders them exactly as written; translating them is not something a send path
/// can do. What *is* translated is the chrome around them: the greeting, the sign-off, the
/// explanation of why the mail arrived, and the label on the preferences link. That is the
/// same split #195 draws between authored content and product UI, applied to mail.
/// </para>
/// <para>
/// **No En/Es-shaped output.** The constraint from #195 is that no read surface exposes
/// per-language fields, and it holds here too: this returns one <see cref="EmailMessage"/>
/// already resolved for one recipient's locale. Adding a third language is a row in
/// <see cref="Copy"/>, and nothing that consumes this changes.
/// </para>
/// <para>
/// **The survey link, and why it arrives already absolute.** An invitation's body tells the
/// recipient to follow the link in the message; until <c>surveyUrl</c> existed this composer
/// read <c>Title</c> and <c>Message</c> and nothing else, so the one mail on the critical
/// path of the product promised something it did not contain. The URL is passed in rather
/// than derived here because deriving it means two things this class must not do: read
/// configuration (which origin?) and read the database (which token?). What it does own is
/// that a link, once supplied, appears in <b>both</b> parts of the message. A call to action
/// that exists only in the HTML part is a dead end for every plain-text reader, and mail
/// clients that render text are exactly the conservative corporate clients this product's
/// recipients read their mail in.
/// </para>
/// </summary>
public static class NotificationEmailComposer
{
    /// <summary>The web app path where a recipient manages the opt-outs #192 stores.</summary>
    public const string PreferencesPath = "settings/notifications";

    /// <summary>
    /// The translated chrome, keyed by locale. Deliberately a dictionary keyed by
    /// <see cref="ContentLanguages.Locales"/> values rather than a pair of properties: a
    /// third locale is one more entry, and nothing downstream has to learn about it.
    /// </summary>
    private static readonly Dictionary<string, EmailChrome> Copy = new(StringComparer.Ordinal)
    {
        [ContentLanguages.English] = new EmailChrome(
            Greeting: "Hi {0},",
            WhyReceiving: "You are receiving this because you have an account on {0}.",
            ManagePreferences: "Manage your notification preferences",
            SubjectFallback: "A notification from {0}",
            OpenSurvey: "Open the survey"),
        [ContentLanguages.Spanish] = new EmailChrome(
            Greeting: "Hola {0}:",
            WhyReceiving: "Recibes este mensaje porque tienes una cuenta en {0}.",
            ManagePreferences: "Gestiona tus preferencias de notificación",
            SubjectFallback: "Una notificación de {0}",
            OpenSurvey: "Abrir la encuesta"),
    };

    /// <summary>
    /// Composes the message. Never returns null: a notification with an empty title still
    /// has to arrive with a subject, so <see cref="EmailChrome.SubjectFallback"/> covers it
    /// rather than the mail going out with a blank subject line.
    /// </summary>
    /// <param name="preferencesUrl">
    /// Absolute URL of the preferences page, or null to omit the link. Passed in rather than
    /// built here so the composer stays free of configuration and stays a pure function.
    /// </param>
    /// <param name="surveyUrl">
    /// Absolute URL of the survey this notification invites the recipient to, or null when
    /// there is none -- a notification that is not about a survey, or one whose invitation
    /// has been revoked since it was queued.
    ///
    /// <para>
    /// Required rather than optional-with-a-default, and that is the point of it: a default
    /// of null is how this composer spent its whole life sending link-less invitations
    /// without a single call site having to decide anything. Every caller now states whether
    /// this mail has a destination.
    /// </para>
    /// </param>
    public static EmailMessage Compose(
        Notification notification,
        NotificationRecipient recipient,
        string? preferencesUrl,
        string? surveyUrl)
    {
        ArgumentNullException.ThrowIfNull(notification);
        ArgumentNullException.ThrowIfNull(recipient);

        var chrome = ChromeFor(recipient.Language);
        var greeting = string.Format(System.Globalization.CultureInfo.InvariantCulture, chrome.Greeting, recipient.Name);
        var why = string.Format(System.Globalization.CultureInfo.InvariantCulture, chrome.WhyReceiving, EmailBranding.ProductName);

        var subject = string.IsNullOrWhiteSpace(notification.Title)
            ? string.Format(System.Globalization.CultureInfo.InvariantCulture, chrome.SubjectFallback, EmailBranding.ProductName)
            : EmailMessage.ToHeaderValue(notification.Title);

        // One decision, read by both bodies below, so the two parts of the same message
        // cannot disagree about whether this mail has a destination.
        var hasSurveyLink = !string.IsNullOrWhiteSpace(surveyUrl);

        var html = new StringBuilder();
        html.Append(EmailBranding.Heading(subject));
        html.Append(EmailBranding.Paragraphs(greeting));
        html.Append(EmailBranding.Paragraphs(notification.Message));
        if (hasSurveyLink)
        {
            html.Append(EmailBranding.Button(surveyUrl!, chrome.OpenSurvey));
        }

        var footer = new StringBuilder();
        footer.Append(EmailBranding.Escape(why));
        if (!string.IsNullOrWhiteSpace(preferencesUrl))
        {
            footer.Append("<br>");
            footer.Append($"""<a href="{EmailBranding.Escape(preferencesUrl)}" style="color:#1f6feb;">{EmailBranding.Escape(chrome.ManagePreferences)}</a>""");
        }

        html.Append(EmailBranding.Footer(footer.ToString()));

        var text = new StringBuilder();
        text.Append(greeting).Append("\n\n");
        text.Append(notification.Message).Append("\n\n");
        if (hasSurveyLink)
        {
            // The bare URL, not a label wrapping one. A plain-text reader has to be able to
            // copy this line into a browser, and every mail client that autolinks text needs
            // the scheme and the whole of the path present as characters.
            text.Append(chrome.OpenSurvey).Append(": ").Append(surveyUrl).Append("\n\n");
        }

        text.Append("--\n").Append(why);
        if (!string.IsNullOrWhiteSpace(preferencesUrl))
        {
            text.Append('\n').Append(chrome.ManagePreferences).Append(": ").Append(preferencesUrl);
        }

        return new EmailMessage(
            recipient.EmailAddress,
            EmailMessage.ToHeaderValue(recipient.Name),
            subject,
            text.ToString(),
            EmailBranding.Document(recipient.Language, html.ToString()));
    }

    private static EmailChrome ChromeFor(string? language)
    {
        var locale = ContentLanguages.NormaliseLocale(language) ?? ContentLanguages.FallbackLocale;
        return Copy.TryGetValue(locale, out var chrome) ? chrome : Copy[ContentLanguages.FallbackLocale];
    }

    private sealed record EmailChrome(
        string Greeting,
        string WhyReceiving,
        string ManagePreferences,
        string SubjectFallback,
        string OpenSurvey);
}
