using System.Text;
using System.Text.Json;
using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
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
/// **The survey link, and why this class is the one that decides it.** A survey invitation's
/// body says "follow the link in this message to take part", and until now no link was ever
/// rendered -- the composer read <c>Title</c> and <c>Message</c> and nothing else, so the
/// only mail on the critical path of the product promised something it did not contain. The
/// link is chosen here rather than pre-built by the caller because *which* path applies is a
/// function of <see cref="Notification.Data"/>, and reading that blob is the composer's job;
/// what the caller owns is the origin the path hangs off, which arrives as
/// <c>resolveLink</c>. That split is why this stays free of configuration.
/// </para>
/// <para>
/// **An id is read out of <c>Data</c>, never a URL, and it is parsed before it is used.**
/// <c>data</c> is a jsonb column, and <c>POST /notifications</c> lets a company admin write
/// it verbatim. A composer that rendered an <c>href</c> straight from that blob would turn
/// this platform's verified sending domain into a phishing relay -- the same attack
/// <see cref="EmailBranding.Paragraphs"/> exists to stop, arriving through a different door.
/// So the payload may supply exactly one thing, a survey id; it must parse as a
/// <see cref="Guid"/>; and the path is then rendered from the parsed value by
/// <see cref="SurveyWebPaths.Respond"/>. The caller's own characters never reach the URL, so
/// there is no input to this class that can change the host or the path of the link it
/// renders -- only *which* survey it points at, and only among surveys, which is the one
/// choice the payload is meant to have.
/// </para>
/// </summary>
public static class NotificationEmailComposer
{
    /// <summary>The web app path where a recipient manages the opt-outs #192 stores.</summary>
    public const string PreferencesPath = "settings/notifications";

    /// <summary>
    /// The <see cref="Notification.Data"/> key carrying the survey a notification is about.
    ///
    /// <para>
    /// **This is the key the queueing side actually writes.** <c>SurveyDistributionEndpoints</c>
    /// serialises <c>surveyId</c> and <c>surveyInvitationId</c> into <c>data</c> for every
    /// invitation and every reminder it persists, and <c>surveyId</c> is the half that names
    /// something a recipient can open. Reading anything else here would render a link on a
    /// payload that is never produced, which is a composer that looks finished and mails the
    /// same link-less invitation it always did.
    /// </para>
    /// <para>
    /// **Not the invitation token, and not by accident.** <c>data</c> is returned by
    /// <c>GET /notifications?companyId=</c>, which any CompanyAdmin may call, so a token
    /// persisted there would hand them the ability to open any employee's survey as that
    /// employee. The id is not a credential: <c>/surveys/{id}/respond</c> is behind
    /// <c>RequireAuth</c> and the respond endpoint re-resolves the caller's own user row and
    /// re-checks the survey's department targets, so a recipient who forwards this link gives
    /// away nothing they were not already able to give away by forwarding the email.
    /// </para>
    /// </summary>
    public const string SurveyIdKey = "surveyId";

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
    /// <param name="resolveLink">
    /// Turns a site-relative path into an absolute URL -- in production
    /// <c>EmailOptions.LinkTo</c>, which hangs it off the configured <c>AppBaseUrl</c>. Null
    /// omits the survey link entirely rather than emitting a relative <c>href</c> that means
    /// nothing in a mail client.
    ///
    /// <para>
    /// A resolver rather than a second pre-built URL like <paramref name="preferencesUrl"/>,
    /// and the asymmetry is the point: the preferences path is a constant the caller already
    /// knows, whereas the survey path is chosen from <see cref="Notification.Data"/> at
    /// compose time, so no caller can resolve it in advance without duplicating the payload
    /// reading this class exists to own.
    /// </para>
    /// </param>
    public static EmailMessage Compose(
        Notification notification,
        NotificationRecipient recipient,
        string? preferencesUrl,
        Func<string, string>? resolveLink = null)
    {
        ArgumentNullException.ThrowIfNull(notification);
        ArgumentNullException.ThrowIfNull(recipient);

        var chrome = ChromeFor(recipient.Language);
        var greeting = string.Format(System.Globalization.CultureInfo.InvariantCulture, chrome.Greeting, recipient.Name);
        var why = string.Format(System.Globalization.CultureInfo.InvariantCulture, chrome.WhyReceiving, EmailBranding.ProductName);

        var subject = string.IsNullOrWhiteSpace(notification.Title)
            ? string.Format(System.Globalization.CultureInfo.InvariantCulture, chrome.SubjectFallback, EmailBranding.ProductName)
            : EmailMessage.ToHeaderValue(notification.Title);

        // Resolved before either body is built so the two cannot disagree about whether a
        // link is present -- a text part that promises a link the HTML part omits is how a
        // plain-text reader ends up with a dead end.
        var surveyPath = SurveyLinkPath(notification.Data);
        var surveyUrl = surveyPath is null || resolveLink is null ? null : resolveLink(surveyPath);

        var html = new StringBuilder();
        html.Append(EmailBranding.Heading(subject));
        html.Append(EmailBranding.Paragraphs(greeting));
        html.Append(EmailBranding.Paragraphs(notification.Message));
        if (!string.IsNullOrWhiteSpace(surveyUrl))
        {
            html.Append(EmailBranding.Button(surveyUrl, chrome.OpenSurvey));
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
        if (!string.IsNullOrWhiteSpace(surveyUrl))
        {
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

    /// <summary>
    /// The site-relative survey path a payload names, or null when it names none.
    ///
    /// <para>
    /// **Every failure is null, never an exception.** This runs inside
    /// <c>NotificationDelivery</c>'s sweep, and although that sweep does catch a throwing
    /// sender, the cost of getting here by exception is a row marked <c>failed</c> that will
    /// be retried three times and never succeed -- one malformed blob quietly consuming a
    /// recipient's retry budget. <c>data</c> holds whatever was written to it: nothing at
    /// all, a JSON array, a number, a truncated object, or a key whose value is an object
    /// where a string was expected. All of those mean "no link", which degrades to exactly
    /// the email this class sent before, and that is a correct email rather than a broken
    /// one.
    /// </para>
    /// <para>
    /// <see cref="Guid.Empty"/> is rejected alongside the unparseable. It parses, so nothing
    /// downstream would object, but <c>/surveys/00000000-0000-0000-0000-000000000000/respond</c>
    /// is a 404 with a button on it -- worse for the recipient than the link-less email,
    /// because it looks like the product is broken rather than like there was nothing to link.
    /// </para>
    /// </summary>
    /// <param name="data">The raw <c>data</c> column. Arbitrary JSON, or not JSON at all.</param>
    private static string? SurveyLinkPath(string? data)
    {
        if (string.IsNullOrWhiteSpace(data))
        {
            return null;
        }

        try
        {
            using var payload = JsonDocument.Parse(data);
            if (payload.RootElement.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            return SurveyIdOrNull(payload.RootElement) is { } surveyId
                ? SurveyWebPaths.Respond(surveyId)
                : null;
        }
        catch (JsonException)
        {
            // Not JSON, or nested past the reader's depth limit. Either way there is no
            // payload to read and the mail still has to go out.
            return null;
        }
    }

    /// <summary>
    /// The survey id a payload names, or null unless it is a string holding a real
    /// <see cref="Guid"/> that is not <see cref="Guid.Empty"/>.
    ///
    /// The parse is load-bearing, not defensive tidiness. Without it a value of
    /// <c>"../../login?next=https://evil.example"</c> written through
    /// <c>POST /notifications</c> would be concatenated into the path and mailed under this
    /// platform's own domain. Returning a <see cref="Guid"/> rather than the caller's string
    /// is what makes that impossible rather than merely unlikely: the path is rendered from
    /// the parsed value, so a payload can choose a survey and can choose nothing else --
    /// braces, a trailing quote or a whole second path segment are all lost in the round trip.
    /// </summary>
    private static Guid? SurveyIdOrNull(JsonElement payload)
        => payload.TryGetProperty(SurveyIdKey, out var value)
           && value.ValueKind == JsonValueKind.String
           && Guid.TryParse(value.GetString(), out var surveyId)
           && surveyId != Guid.Empty
            ? surveyId
            : null;

    private sealed record EmailChrome(
        string Greeting,
        string WhyReceiving,
        string ManagePreferences,
        string SubjectFallback,
        string OpenSurvey);
}
