using ClimateProject.Application.Localization;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Notifications;

/// <summary>
/// A notification template's renderable content, in both authored locales, together with
/// the variables it declares.
///
/// <para>
/// It exists so that the two callers that render a template -- the admin preview
/// (<c>POST /notification-templates/{id}/preview</c>) and the send path
/// (<c>EmailNotificationSender</c>) -- hand the same shape to the same function. Before #96's
/// dispatch gap was closed the preview was the *only* caller, and the mail that actually went
/// out was composed from <c>Notification.Title</c>/<c>Message</c>: a company that authored a
/// template got a preview and a foreign key. Two independent render sites would have made
/// that drift possible again in a subtler way -- a preview that shows one body and a mailbox
/// that receives another -- so there is one.
/// </para>
/// </summary>
/// <param name="ContentLanguage">
/// The language the template is authored in. <c>NotificationTemplate</c> has no
/// <c>Language</c> column, so it is derived exactly as the template endpoints derive it: a
/// company template inherits <c>Company.Settings.Language</c>, a global template
/// (<c>CompanyId == null</c>, readable by every tenant) is <c>both</c>.
/// </param>
/// <param name="DeclaredVariables">
/// Declared variable name to its <c>jsonb</c> default, as stored. Unwrapped by
/// <see cref="NotificationTemplateRenderer.BuildValues"/>, never here.
/// </param>
public sealed record NotificationTemplateContent(
    Guid Id,
    Guid? CompanyId,
    bool IsActive,
    string? SubjectEn,
    string? SubjectEs,
    string? TitleEn,
    string? TitleEs,
    string? ContentEn,
    string? ContentEs,
    string? HtmlContentEn,
    string? HtmlContentEs,
    string ContentLanguage,
    IReadOnlyDictionary<string, string?> DeclaredVariables)
{
    public static NotificationTemplateContent From(
        NotificationTemplate template,
        string contentLanguage,
        IReadOnlyDictionary<string, string?> declaredVariables)
    {
        ArgumentNullException.ThrowIfNull(template);

        return new NotificationTemplateContent(
            template.Id,
            template.CompanyId,
            template.IsActive,
            template.SubjectEn,
            template.SubjectEs,
            template.TitleEn,
            template.TitleEs,
            template.ContentEn,
            template.ContentEs,
            template.HtmlContentEn,
            template.HtmlContentEs,
            contentLanguage,
            declaredVariables);
    }
}

/// <summary>
/// One template rendered for one locale.
/// </summary>
/// <param name="Values">
/// The effective substitution map the fields above were rendered against. Returned rather
/// than kept private because the preview reports on it -- which personalization rules matched,
/// which required variables ended up empty -- and recomputing it there is precisely the
/// second answer this type exists to prevent.
/// </param>
/// <param name="FallbackFields">
/// Fields that had to reach for another language to produce a value. Every fallback
/// self-reports; see <see cref="LocalizedContent"/>.
/// </param>
public sealed record NotificationTemplateRendering(
    string? Subject,
    string? Title,
    string? Content,
    string? HtmlContent,
    IReadOnlyDictionary<string, string?> Values,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields);

/// <summary>
/// The single render path for a notification template: locale resolution, variable
/// resolution, and substitution, in that order.
/// </summary>
public static class NotificationTemplateComposition
{
    /// <param name="requestedLocale">
    /// The locale to render. The preview passes the caller's <c>?lang=</c>; the send path
    /// passes the recipient's own locale, which is the same setting
    /// <see cref="NotificationEmailComposer"/> already uses to choose the chrome, so the
    /// template and the chrome around it can never end up in different languages.
    /// Anything unrecognised falls back to the template's own single language and then to
    /// <see cref="ContentLanguages.FallbackLocale"/>.
    /// </param>
    /// <param name="supplied">
    /// Values to substitute. Wins over a declared default; a null value does not.
    /// </param>
    public static NotificationTemplateRendering Render(
        NotificationTemplateContent template,
        IReadOnlyDictionary<string, string?>? supplied,
        string? requestedLocale)
    {
        ArgumentNullException.ThrowIfNull(template);

        var locale = ContentLanguages.NormaliseLocale(requestedLocale)
                     ?? ContentLanguages.SingleLocaleOf(template.ContentLanguage)
                     ?? ContentLanguages.FallbackLocale;

        var values = NotificationTemplateRenderer.BuildValues(template.DeclaredVariables, supplied);

        var fallbackFields = new List<string>();
        var subject = Resolve(template.SubjectEn, template.SubjectEs, locale, template.ContentLanguage, "subject", fallbackFields);
        var title = Resolve(template.TitleEn, template.TitleEs, locale, template.ContentLanguage, "title", fallbackFields);
        var content = Resolve(template.ContentEn, template.ContentEs, locale, template.ContentLanguage, "content", fallbackFields);
        var htmlContent = Resolve(template.HtmlContentEn, template.HtmlContentEs, locale, template.ContentLanguage, "htmlContent", fallbackFields);

        return new NotificationTemplateRendering(
            NotificationTemplateRenderer.Render(subject, values, escapeHtml: false),
            NotificationTemplateRenderer.Render(title, values, escapeHtml: false),
            NotificationTemplateRenderer.Render(content, values, escapeHtml: false),
            // The only field whose substituted values are HTML-encoded: an admin's own markup
            // in the template body is markup, a value out of a user row is text.
            NotificationTemplateRenderer.Render(htmlContent, values, escapeHtml: true),
            values,
            locale,
            fallbackFields);
    }

    private static string? Resolve(
        string? en,
        string? es,
        string locale,
        string contentLanguage,
        string fieldPath,
        List<string> fallbackFields)
    {
        var resolved = LocalizedContent.Resolve(en, es, locale, contentLanguage);
        if (resolved.IsFallback)
        {
            fallbackFields.Add(fieldPath);
        }

        return resolved.Text;
    }
}
