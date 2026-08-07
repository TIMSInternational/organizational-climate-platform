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
            SubjectFallback: "A notification from {0}"),
        [ContentLanguages.Spanish] = new EmailChrome(
            Greeting: "Hola {0}:",
            WhyReceiving: "Recibes este mensaje porque tienes una cuenta en {0}.",
            ManagePreferences: "Gestiona tus preferencias de notificación",
            SubjectFallback: "Una notificación de {0}"),
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
    public static EmailMessage Compose(
        Notification notification,
        NotificationRecipient recipient,
        string? preferencesUrl)
    {
        ArgumentNullException.ThrowIfNull(notification);
        ArgumentNullException.ThrowIfNull(recipient);

        var chrome = ChromeFor(recipient.Language);
        var greeting = string.Format(System.Globalization.CultureInfo.InvariantCulture, chrome.Greeting, recipient.Name);
        var why = string.Format(System.Globalization.CultureInfo.InvariantCulture, chrome.WhyReceiving, EmailBranding.ProductName);

        var subject = string.IsNullOrWhiteSpace(notification.Title)
            ? string.Format(System.Globalization.CultureInfo.InvariantCulture, chrome.SubjectFallback, EmailBranding.ProductName)
            : EmailMessage.ToHeaderValue(notification.Title);

        var html = new StringBuilder();
        html.Append(EmailBranding.Heading(subject));
        html.Append(EmailBranding.Paragraphs(greeting));
        html.Append(EmailBranding.Paragraphs(notification.Message));

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
        string SubjectFallback);
}
