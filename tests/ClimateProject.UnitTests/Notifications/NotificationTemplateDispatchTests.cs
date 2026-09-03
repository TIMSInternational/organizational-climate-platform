using System.Collections;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Notifications;

/// <summary>
/// <b>What a recipient actually reads when their notification names a template.</b>
///
/// <para>
/// Every assertion here is on the composed <c>EmailMessage</c>, never on a path name alone.
/// The defect these tests close was invisible precisely because everything upstream was green:
/// the endpoint validated the <c>templateId</c>, stored it, the sweep marked the row
/// <c>sent</c>, and the body the recipient read had nothing to do with the template. So a test
/// that only checked which branch ran would have been able to pass while the mail was still
/// composed from <c>Title</c>/<c>Message</c>.
/// </para>
/// </summary>
public class NotificationTemplateDispatchTests
{
    private static readonly Guid CompanyId = Guid.NewGuid();

    private static readonly Guid OtherCompanyId = Guid.NewGuid();

    private static readonly Guid TemplateId = Guid.NewGuid();

    /// <summary>
    /// The notification's own text. Deliberately unlike anything in the template fixtures, so
    /// "the template was used" and "the fallback was used" are distinguishable by reading the
    /// body rather than by trusting a flag.
    /// </summary>
    private const string RawTitle = "RAW-TITLE-from-the-notification-row";

    private const string RawMessage = "RAW-MESSAGE-from-the-notification-row";

    private static Notification Notification(Guid? templateId, Guid? companyId = null) => new()
    {
        Id = Guid.NewGuid(),
        UserId = Guid.NewGuid(),
        CompanyId = companyId ?? CompanyId,
        Type = NotificationTypes.SystemNotification,
        Channel = NotificationChannels.Email,
        Status = NotificationStatuses.Pending,
        Title = RawTitle,
        Message = RawMessage,
        TemplateId = templateId,
    };

    private static NotificationRecipient Recipient(string language = ContentLanguages.English)
        => new(Guid.NewGuid(), "ana@fixtures.timsint.com", "Ana", language);

    /// <summary>
    /// A template whose every field names a variable, so a body that contains the rendered text
    /// proves substitution ran and not merely that a column was copied.
    /// </summary>
    private static NotificationTemplateContent Template(
        bool isActive = true,
        Guid? companyId = null,
        string contentLanguage = ContentLanguages.English,
        string? subjectEn = "TEMPLATE-SUBJECT for {{userName}}",
        string? contentEn = "TEMPLATE-BODY for {{userName}} at {{companyName}}",
        string? contentEs = null,
        string? htmlContentEn = "<p>TEMPLATE-HTML for {{userName}}</p>",
        string? titleEn = null,
        IReadOnlyDictionary<string, string?>? declared = null)
        => new(
            TemplateId,
            companyId ?? CompanyId,
            isActive,
            SubjectEn: subjectEn,
            SubjectEs: subjectEn is null ? null : "ASUNTO-PLANTILLA para {{userName}}",
            TitleEn: titleEn,
            TitleEs: null,
            ContentEn: contentEn,
            ContentEs: contentEs,
            HtmlContentEn: htmlContentEn,
            HtmlContentEs: null,
            contentLanguage,
            declared ?? new Dictionary<string, string?>(StringComparer.Ordinal));

    private static ComposedNotificationEmail Compose(
        NotificationTemplateContent? template,
        Notification? notification = null,
        NotificationRecipient? recipient = null,
        string? companyName = "Acme Costa Rica")
        => NotificationTemplateDispatch.Compose(
            notification ?? Notification(template is null ? null : TemplateId),
            recipient ?? Recipient(),
            template,
            companyName,
            preferencesUrl: "https://app.example.com/settings/notifications",
            actionUrl: null);

    // ------------------------------------------------------------------

    /// <summary>
    /// <b>G1.</b> With an active, in-tenant template the subject and both bodies are the
    /// RENDERED template -- and the notification's own title and message are nowhere in the
    /// mail. The second half is the half that fails if the template is merely consulted.
    /// </summary>
    [Fact]
    public void An_active_template_composes_the_subject_and_both_bodies()
    {
        var composed = Compose(Template());

        Assert.Equal(NotificationTemplateDispatch.PathTemplate, composed.Path);
        Assert.Equal("TEMPLATE-SUBJECT for Ana", composed.Message.Subject);
        Assert.Contains("TEMPLATE-BODY for Ana at Acme Costa Rica", composed.Message.TextBody, StringComparison.Ordinal);
        Assert.Contains("<p>TEMPLATE-HTML for Ana</p>", composed.Message.HtmlBody, StringComparison.Ordinal);

        Assert.DoesNotContain(RawTitle, composed.Message.Subject, StringComparison.Ordinal);
        Assert.DoesNotContain(RawMessage, composed.Message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(RawMessage, composed.Message.HtmlBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>G2.</b> The chrome is untouched by a template: the greeting and the preferences link
    /// are product UI in the recipient's language and a template governs the message inside
    /// them, not the envelope.
    /// </summary>
    [Fact]
    public void A_template_does_not_displace_the_chrome()
    {
        var composed = Compose(Template(), recipient: Recipient(ContentLanguages.Spanish));

        Assert.Contains("Hola Ana", composed.Message.TextBody, StringComparison.Ordinal);
        Assert.Contains("https://app.example.com/settings/notifications", composed.Message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>G3.</b> A notification that names no template is composed exactly as it was before
    /// templates were rendered at all.
    /// </summary>
    [Fact]
    public void A_notification_without_a_template_is_composed_from_its_own_title_and_message()
    {
        var composed = Compose(template: null);

        Assert.Equal(NotificationTemplateDispatch.PathNoTemplate, composed.Path);
        Assert.Equal(RawTitle, composed.Message.Subject);
        Assert.Contains(RawMessage, composed.Message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>G4.</b> A deactivated template is not what the recipient reads. An admin who
    /// deactivates a template has taken it out of service, and a notification queued before
    /// that must not keep using it.
    /// </summary>
    [Fact]
    public void An_inactive_template_falls_back_to_the_notifications_own_text()
    {
        var composed = Compose(Template(isActive: false));

        Assert.Equal(NotificationTemplateDispatch.PathTemplateInactive, composed.Path);
        Assert.Equal(RawTitle, composed.Message.Subject);
        Assert.Contains(RawMessage, composed.Message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("TEMPLATE-BODY", composed.Message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>G5.</b> Another tenant's template never renders into this tenant's mail, whatever the
    /// FK says. The queue-time check cannot cover this on its own: the row is read at SEND
    /// time, and a template's company can change in between.
    /// </summary>
    [Fact]
    public void A_cross_tenant_template_falls_back_to_the_notifications_own_text()
    {
        var composed = Compose(Template(companyId: OtherCompanyId));

        Assert.Equal(NotificationTemplateDispatch.PathTemplateCrossTenant, composed.Path);
        Assert.DoesNotContain("TEMPLATE-BODY", composed.Message.TextBody, StringComparison.Ordinal);
        Assert.Contains(RawMessage, composed.Message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>G6.</b> A GLOBAL template (no company) is readable by every tenant by design, so it
    /// renders. The pair with G5 is what makes the tenant rule a rule rather than a rejection
    /// of everything that is not an exact match.
    /// </summary>
    [Fact]
    public void A_global_template_renders_for_any_tenant()
    {
        var composed = Compose(Template(companyId: null));

        Assert.Equal(NotificationTemplateDispatch.PathTemplate, composed.Path);
        Assert.Contains("TEMPLATE-BODY for Ana", composed.Message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>G7.</b> A template id that resolves to no row -- deleted since the notification was
    /// queued -- sends the notification rather than dropping it.
    /// </summary>
    [Fact]
    public void A_template_id_that_resolves_to_no_row_falls_back()
    {
        var composed = NotificationTemplateDispatch.Compose(
            Notification(TemplateId), Recipient(), template: null, "Acme", null, null);

        Assert.Equal(NotificationTemplateDispatch.PathTemplateMissing, composed.Path);
        Assert.Contains(RawMessage, composed.Message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>G8.</b> A template that renders to nothing in this recipient's locale is not an empty
    /// email. The notification's own text is not nothing.
    /// </summary>
    [Fact]
    public void A_template_that_renders_to_nothing_falls_back()
    {
        var composed = Compose(Template(subjectEn: null, contentEn: null, htmlContentEn: null));

        Assert.Equal(NotificationTemplateDispatch.PathTemplateEmpty, composed.Path);
        Assert.Equal(RawTitle, composed.Message.Subject);
        Assert.Contains(RawMessage, composed.Message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>G9.</b> A renderer that throws costs the recipient the template's styling and not the
    /// message. A notification is a thing somebody decided a person needs to be told; a
    /// template is how it is dressed, and no retry can fix a template that does not render.
    /// </summary>
    [Fact]
    public void A_renderer_that_throws_falls_back_and_still_produces_a_message()
    {
        var composed = Compose(Template(declared: new ThrowingVariables()));

        Assert.Equal(NotificationTemplateDispatch.PathTemplateRenderFailed, composed.Path);
        Assert.IsType<InvalidOperationException>(composed.Failure);

        // The message exists and carries the notification, which is the guarantee.
        Assert.Equal(RawTitle, composed.Message.Subject);
        Assert.Contains(RawMessage, composed.Message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>G10.</b> The recipient's own locale selects the template's language -- the same
    /// setting <c>NotificationEmailComposer</c> uses for the chrome, so the two halves of one
    /// mail cannot end up in different languages.
    /// </summary>
    [Fact]
    public void The_recipients_locale_selects_the_template_language()
    {
        var bilingual = Template(
            contentLanguage: ContentLanguages.Both,
            contentEn: "TEMPLATE-BODY-EN for {{userName}}",
            contentEs: "TEMPLATE-BODY-ES para {{userName}}");

        var spanish = Compose(bilingual, recipient: Recipient(ContentLanguages.Spanish));
        Assert.Contains("TEMPLATE-BODY-ES para Ana", spanish.Message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("TEMPLATE-BODY-EN", spanish.Message.TextBody, StringComparison.Ordinal);

        var english = Compose(bilingual, recipient: Recipient(ContentLanguages.English));
        Assert.Contains("TEMPLATE-BODY-EN for Ana", english.Message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("TEMPLATE-BODY-ES", english.Message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>G11.</b> A declared default fills a variable the send path cannot derive, exactly as
    /// it does in the preview -- the two go through one <c>BuildValues</c>.
    /// </summary>
    [Fact]
    public void A_declared_default_fills_a_variable_the_send_path_cannot_derive()
    {
        var template = Template(
            contentEn: "TEMPLATE-BODY {{userName}} / {{department}}",
            declared: new Dictionary<string, string?>(StringComparer.Ordinal) { ["department"] = "\"Operaciones\"" });

        var composed = Compose(template);

        // Unwrapped from its jsonb document: the quotes are not in the email.
        Assert.Contains("TEMPLATE-BODY Ana / Operaciones", composed.Message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// A declared-variable map that throws when the renderer reads it. The one way to make the
    /// render path fail without reaching into the renderer itself, and it fails where a real
    /// fault would: while the substitution map is being built.
    /// </summary>
    private sealed class ThrowingVariables : IReadOnlyDictionary<string, string?>
    {
        public string? this[string key] => throw new InvalidOperationException("Template variables are unreadable.");

        public IEnumerable<string> Keys => throw new InvalidOperationException("Template variables are unreadable.");

        public IEnumerable<string?> Values => throw new InvalidOperationException("Template variables are unreadable.");

        public int Count => throw new InvalidOperationException("Template variables are unreadable.");

        public bool ContainsKey(string key) => throw new InvalidOperationException("Template variables are unreadable.");

        public IEnumerator<KeyValuePair<string, string?>> GetEnumerator()
            => throw new InvalidOperationException("Template variables are unreadable.");

        public bool TryGetValue(string key, out string? value)
            => throw new InvalidOperationException("Template variables are unreadable.");

        IEnumerator IEnumerable.GetEnumerator()
            => throw new InvalidOperationException("Template variables are unreadable.");
    }
}
