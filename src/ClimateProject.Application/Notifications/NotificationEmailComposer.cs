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
/// **Only tokens are read out of <c>Data</c>, never a URL, and every one is shape-checked.**
/// <c>data</c> is a jsonb column, and <c>POST /notifications</c> lets a company admin write
/// it verbatim. A composer that rendered an <c>href</c> straight from that blob would turn
/// this platform's verified sending domain into a phishing relay -- the same attack
/// <see cref="EmailBranding.Paragraphs"/> exists to stop, arriving through a different door.
/// So the payload may only supply an opaque token, it must satisfy
/// <see cref="SurveyAccessTokens.HasExpectedShape"/>, and the path around it is always built
/// by <see cref="SurveyAccessTokens"/>. There is no input to this class that can change the
/// host or the path of the link it renders.
/// </para>
/// </summary>
public static class NotificationEmailComposer
{
    /// <summary>The web app path where a recipient manages the opt-outs #192 stores.</summary>
    public const string PreferencesPath = "settings/notifications";

    /// <summary>
    /// <see cref="Notification.Data"/> key carrying one invitee's own
    /// <c>survey_invitations.invitation_token</c>.
    ///
    /// <para>
    /// **Deliberately not written by the queueing side.** <c>SurveyDistributionEndpoints</c>
    /// persists <c>surveyId</c> and <c>surveyInvitationId</c> only, because <c>data</c> is
    /// returned by <c>GET /notifications?companyId=</c> and a persisted token there would let
    /// any CompanyAdmin open any employee's survey as that employee. The token is resolved
    /// from <c>survey_invitations</c> at delivery time and handed to this composer on an
    /// in-memory row, which is also what makes revocation between queueing and sending real.
    /// A payload that reaches here without one is the normal case, not an error.
    /// </para>
    /// </summary>
    public const string SurveyInvitationTokenKey = "surveyInvitationToken";

    /// <summary>
    /// <see cref="Notification.Data"/> key carrying the survey's open share token -- the one
    /// embedded in <c>survey_distributions.public_url</c>.
    ///
    /// The fallback, not the preference: a personalised link is what lets the invitation be
    /// marked opened and, on a non-anonymous survey, attributed at all. The share token is
    /// company-wide and already public by design, so unlike the invitation token it is safe
    /// for the queueing side to persist.
    /// </summary>
    public const string SurveyShareTokenKey = "surveyShareToken";

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
    /// The site-relative survey path a payload asks for, or null when it asks for none.
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
    /// The invitation token wins when both are present. A personalised link is the only one
    /// that can mark the invitation opened, so preferring the share link would silently cost
    /// the distribution surface its only pre-response signal.
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

            if (TokenOrNull(payload.RootElement, SurveyInvitationTokenKey) is { } invitationToken)
            {
                return SurveyAccessTokens.InvitationLinkPath(invitationToken);
            }

            return TokenOrNull(payload.RootElement, SurveyShareTokenKey) is { } shareToken
                ? SurveyAccessTokens.PublicLinkPath(shareToken)
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
    /// A token from the payload, or null unless it is a string that looks like one of ours.
    ///
    /// The shape check is load-bearing, not defensive tidiness: without it a value of
    /// <c>"../../login?next=https://evil.example"</c> written through
    /// <c>POST /notifications</c> would be concatenated into the path and mailed under this
    /// platform's own domain. Rejecting anything that is not 43 base64url characters means a
    /// payload can choose *between* our two links and can choose nothing else.
    /// </summary>
    private static string? TokenOrNull(JsonElement payload, string key)
        => payload.TryGetProperty(key, out var value)
           && value.ValueKind == JsonValueKind.String
           && SurveyAccessTokens.HasExpectedShape(value.GetString())
            ? value.GetString()
            : null;

    private sealed record EmailChrome(
        string Greeting,
        string WhyReceiving,
        string ManagePreferences,
        string SubjectFallback,
        string OpenSurvey);
}
