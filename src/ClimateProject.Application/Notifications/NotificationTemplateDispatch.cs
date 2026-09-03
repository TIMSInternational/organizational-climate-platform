using ClimateProject.Application.Email;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Notifications;

/// <summary>
/// The body a template contributes to an outgoing notification email, or null when the
/// notification has none and the composer falls back to <c>Notification.Title</c> and
/// <c>Notification.Message</c>.
/// </summary>
/// <param name="Html">
/// Already-rendered HTML. Appended to the message verbatim rather than escaped: the markup is
/// the admin's own, and the *values* substituted into it were HTML-encoded by
/// <see cref="NotificationTemplateRenderer"/> at render time. Escaping here instead would
/// render an admin's own markup as literal text.
/// </param>
public sealed record NotificationTemplateBody(string? Subject, string? Text, string? Html);

/// <summary>Which body a composed notification email actually carries, and why.</summary>
/// <param name="Path">One of the <c>Path*</c> constants on <see cref="NotificationTemplateDispatch"/>.</param>
/// <param name="Failure">The render exception, when <see cref="Path"/> is the render-failure one.</param>
public sealed record ComposedNotificationEmail(EmailMessage Message, string Path, Exception? Failure = null);

/// <summary>
/// Decides whether an outgoing notification email is composed from its template or from the
/// notification's own <c>Title</c>/<c>Message</c>, and composes it either way.
///
/// <para>
/// <b>Pure on purpose.</b> Every branch below is a decision about what a recipient reads, and
/// none of them needs a database: the template row is loaded by the caller and handed in,
/// possibly null. That is what lets the whole decision table -- no template, missing,
/// inactive, cross-tenant, empty, renderer threw -- be asserted in the unit suite against the
/// composed <see cref="EmailMessage"/> rather than against a status column.
/// </para>
/// <para>
/// <b>A template never loses a notification.</b> Every failure mode falls back to the
/// notification's own title and message and still sends. A notification is a thing an admin
/// or the platform decided a person needs to be told; a template is how it is dressed. The
/// caller logs <see cref="ComposedNotificationEmail.Path"/> so a silently-unused
/// template is visible in the logs rather than only in a mailbox.
/// </para>
/// </summary>
public static class NotificationTemplateDispatch
{
    /// <summary>The notification names no template. The overwhelmingly common case, and not a fault.</summary>
    public const string PathNoTemplate = "no_template";

    /// <summary>The notification names a template id that no longer resolves to a row.</summary>
    public const string PathTemplateMissing = "template_missing";

    /// <summary>The row exists but is deactivated. An inactive template is one an admin took out of service.</summary>
    public const string PathTemplateInactive = "template_inactive";

    /// <summary>
    /// The row belongs to another tenant. <c>POST /notifications</c> already refuses such a
    /// <c>templateId</c> (<c>NotificationEndpoints.ValidateTemplateAsync</c>), so reaching this
    /// means the template's ownership changed after the notification was queued -- and the
    /// check is repeated here because the row is read at send time, not at queue time.
    /// </summary>
    public const string PathTemplateCrossTenant = "template_cross_tenant";

    /// <summary>The template resolved and rendered to nothing at all in this locale.</summary>
    public const string PathTemplateEmpty = "template_empty";

    /// <summary>Rendering threw. The notification is still sent, from its own title and message.</summary>
    public const string PathTemplateRenderFailed = "template_render_failed";

    /// <summary>The template was rendered and is what the recipient reads.</summary>
    public const string PathTemplate = "template";

    // The variables the send path can fill from the notification, its recipient and its
    // company. A template may declare any names it likes -- these are the ones that resolve
    // to something without a human typing them, and they are named here as constants so a
    // preview request can supply the same names and see the same substitution.
    public const string UserNameVariable = "userName";
    public const string UserEmailVariable = "userEmail";
    public const string CompanyNameVariable = "companyName";
    public const string NotificationTitleVariable = "notificationTitle";
    public const string NotificationMessageVariable = "notificationMessage";
    public const string NotificationTypeVariable = "notificationType";
    public const string ActionUrlVariable = "actionUrl";

    /// <summary>
    /// The substitution values the send path derives, before the template's own declared
    /// defaults are merged under them by <see cref="NotificationTemplateRenderer.BuildValues"/>.
    /// </summary>
    /// <param name="actionUrl">
    /// The invitation link this mail carries, or null when it carries none. Resolved by the
    /// sender at send time from the invitation row, never from caller-supplied text.
    /// </param>
    public static Dictionary<string, string?> VariablesFor(
        Notification notification,
        NotificationRecipient recipient,
        string? companyName,
        string? actionUrl)
    {
        ArgumentNullException.ThrowIfNull(notification);
        ArgumentNullException.ThrowIfNull(recipient);

        return new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            [UserNameVariable] = recipient.Name,
            [UserEmailVariable] = recipient.EmailAddress,
            [CompanyNameVariable] = companyName,
            [NotificationTitleVariable] = notification.Title,
            [NotificationMessageVariable] = notification.Message,
            [NotificationTypeVariable] = notification.Type,
            [ActionUrlVariable] = actionUrl,
        };
    }

    /// <param name="template">
    /// The row named by <c>notification.TemplateId</c> as loaded, or null when there is none to
    /// load. Deliberately handed in unfiltered -- inactive and cross-tenant rows included --
    /// so the decision and its log line live here rather than being lost in a query's
    /// <c>WHERE</c> clause.
    /// </param>
    public static ComposedNotificationEmail Compose(
        Notification notification,
        NotificationRecipient recipient,
        NotificationTemplateContent? template,
        string? companyName,
        string? preferencesUrl,
        string? actionUrl)
    {
        ArgumentNullException.ThrowIfNull(notification);
        ArgumentNullException.ThrowIfNull(recipient);

        var refusal = RefusalFor(notification, template);
        if (refusal is not null)
        {
            return new ComposedNotificationEmail(
                NotificationEmailComposer.Compose(notification, recipient, preferencesUrl, actionUrl),
                refusal);
        }

        try
        {
            var values = VariablesFor(notification, recipient, companyName, actionUrl);
            var rendering = NotificationTemplateComposition.Render(template!, values, recipient.Language);

            // A template's subject line is optional; its title is what an in-app template
            // carries, and it is a better subject than the product-name fallback.
            var subject = FirstNonBlank(rendering.Subject, rendering.Title);

            if (string.IsNullOrWhiteSpace(subject)
                && string.IsNullOrWhiteSpace(rendering.Content)
                && string.IsNullOrWhiteSpace(rendering.HtmlContent))
            {
                // Authored in the other language only, or authored empty. Either way there is
                // nothing here to send, and the notification's own text is not nothing.
                return new ComposedNotificationEmail(
                    NotificationEmailComposer.Compose(notification, recipient, preferencesUrl, actionUrl),
                    PathTemplateEmpty);
            }

            var body = new NotificationTemplateBody(subject, rendering.Content, rendering.HtmlContent);

            return new ComposedNotificationEmail(
                NotificationEmailComposer.Compose(notification, recipient, preferencesUrl, actionUrl, body),
                PathTemplate);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // A template is presentation. Losing the notification because its presentation
            // threw would be trading a message somebody needs for a body they would have
            // preferred, and the retry budget cannot fix a template that does not render.
            return new ComposedNotificationEmail(
                NotificationEmailComposer.Compose(notification, recipient, preferencesUrl, actionUrl),
                PathTemplateRenderFailed,
                exception);
        }
    }

    private static string? RefusalFor(Notification notification, NotificationTemplateContent? template)
    {
        if (notification.TemplateId is null) return PathNoTemplate;
        if (template is null || template.Id != notification.TemplateId.Value) return PathTemplateMissing;
        if (!template.IsActive) return PathTemplateInactive;

        // A global template (no company) is readable by every tenant by design; a company's
        // template is that company's only.
        if (template.CompanyId is not null && template.CompanyId.Value != notification.CompanyId)
        {
            return PathTemplateCrossTenant;
        }

        return null;
    }

    private static string? FirstNonBlank(string? first, string? second)
        => string.IsNullOrWhiteSpace(first) ? (string.IsNullOrWhiteSpace(second) ? null : second) : first;
}
