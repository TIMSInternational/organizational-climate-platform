using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;

namespace ClimateProject.IntegrationTests.Notifications;

/// <summary>
/// <b>The template an admin attaches to a notification is the text the recipient reads.</b>
///
/// <para>
/// The unit suite covers the decision table without a container
/// (<c>ClimateProject.UnitTests.Notifications.NotificationTemplateDispatchTests</c>). What only
/// this class can prove is the wiring: that the template row written by the real
/// <c>POST /notification-templates</c> endpoint, attached by the real <c>POST /notifications</c>
/// endpoint, is loaded by the sender the container actually hands out, through the real DI of
/// the API host -- and lands in the body of the message a transport was given. That last link
/// is where the gap was: the renderer had exactly one caller in the whole solution, the preview
/// route, and every test upstream stayed green while the mail ignored the template.
/// </para>
/// </summary>
[Collection("Postgres")]
public class NotificationTemplateDispatchTests : IAsyncLifetime, IClassFixture<CapturingMailHostFixture>
{
    /// <summary>
    /// A domain TIMS owns. Not <c>.test</c>: the sender refuses RFC 2606/6761 reserved domains
    /// before the transport is reached, so a <c>.test</c> recipient would make every assertion
    /// here about what a recipient READS assert nothing. No mail is sent by any test.
    /// </summary>
    private const string RecipientDomain = "fixtures.timsint.com";

    private const string CompanyName = "Template Mail Co";

    /// <summary>The notification's own text, and deliberately unlike anything in the template.</summary>
    private const string RawTitle = "RAW-TITLE-not-from-a-template";

    private const string RawMessage = "RAW-MESSAGE-not-from-a-template";

    private readonly CapturingMailHostFixture _mail;
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;

    public NotificationTemplateDispatchTests(PostgresContainerFixture postgres, CapturingMailHostFixture mail)
    {
        _mail = mail;
        _factory = mail.HostFor(postgres.ConnectionString);
        _harness = new SurveyTestHarness(_factory, $"tmplmail-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync() => _companyId = await _harness.SeedCompanyAsync(CompanyName);

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> AdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

    /// <summary>A recipient row. Seeded directly: these never authenticate, they only receive.</summary>
    private Task<(Guid Id, string Email)> SeedRecipientAsync()
        => _harness.WithDbAsync(async db =>
        {
            var user = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Email = $"{Guid.NewGuid():N}@recipient.{RecipientDomain}",
                Name = "Ana",
                Role = Roles.Employee,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            return (user.Id, user.Email);
        });

    private static async Task<NotificationTemplateDetail> CreateTemplateAsync(HttpClient client, Guid companyId)
    {
        var response = await client.PostAsJsonAsync("/notification-templates", new CreateNotificationTemplateRequest(
            "Dispatch fixture",
            NotificationTypes.SystemNotification,
            "email",
            LocalizedInput.FromBare("TEMPLATE-SUBJECT for {{userName}}"),
            LocalizedInput.FromBare("TEMPLATE-TITLE"),
            LocalizedInput.FromBare("TEMPLATE-BODY for {{userName}} at {{companyName}}"),
            LocalizedInput.FromBare("<p>TEMPLATE-HTML for {{userName}}</p>"),
            companyId,
            IsDefault: false,
            Variables: null,
            Rules: null));

        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<NotificationTemplateDetail>())!;
    }

    private async Task SendAsync(HttpClient client, Guid recipientId, Guid? templateId)
    {
        // No ScheduledFor, so the endpoint delivers inline rather than leaving it for a sweep.
        var response = await client.PostAsJsonAsync("/notifications", new CreateNotificationRequest(
            recipientId,
            _companyId,
            NotificationTypes.SystemNotification,
            NotificationChannels.Email,
            null,
            RawTitle,
            RawMessage,
            Data: null,
            TemplateId: templateId));

        response.EnsureSuccessStatusCode();
    }

    // ------------------------------------------------------------------

    /// <summary>
    /// <b>G1.</b> A notification carrying a <c>templateId</c> is mailed as the RENDERED
    /// template -- subject, text part and HTML part -- and its own title and message appear
    /// nowhere in the message. The second half is what fails if the template is loaded and
    /// then ignored, which is exactly what dispatch did.
    /// </summary>
    [Fact]
    public async Task A_notification_with_a_template_is_mailed_as_the_rendered_template()
    {
        var client = await AdminAsync();
        var (recipientId, recipientEmail) = await SeedRecipientAsync();
        var template = await CreateTemplateAsync(client, _companyId);

        await SendAsync(client, recipientId, template.Id);

        var message = Assert.Single(_mail.Mailbox.To(recipientEmail));

        Assert.Equal("TEMPLATE-SUBJECT for Ana", message.Subject);
        Assert.Contains($"TEMPLATE-BODY for Ana at {CompanyName}", message.TextBody, StringComparison.Ordinal);
        Assert.Contains("<p>TEMPLATE-HTML for Ana</p>", message.HtmlBody, StringComparison.Ordinal);

        Assert.DoesNotContain(RawTitle, message.Subject, StringComparison.Ordinal);
        Assert.DoesNotContain(RawMessage, message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(RawMessage, message.HtmlBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>G2.</b> The admin's preview of a template and the body the recipient receives are the
    /// same characters. This is the assertion that says the two are one code path, and it is
    /// the property the whole change exists to establish: before it, the preview was the only
    /// caller of the renderer in the solution.
    /// </summary>
    [Fact]
    public async Task The_preview_and_the_delivered_body_are_the_same_text()
    {
        var client = await AdminAsync();
        var (recipientId, recipientEmail) = await SeedRecipientAsync();
        var template = await CreateTemplateAsync(client, _companyId);

        await SendAsync(client, recipientId, template.Id);
        var message = Assert.Single(_mail.Mailbox.To(recipientEmail));

        // The same variable names the send path derives, supplied by hand -- which is the only
        // way an admin can preview them, and the reason they are public constants.
        var previewed = await client.PostAsJsonAsync(
            $"/notification-templates/{template.Id}/preview",
            new NotificationTemplatePreviewRequest(
                new Dictionary<string, string?>
                {
                    [NotificationTemplateDispatch.UserNameVariable] = "Ana",
                    [NotificationTemplateDispatch.CompanyNameVariable] = CompanyName,
                },
                Lang: ContentLanguages.English));

        previewed.EnsureSuccessStatusCode();
        var preview = (await previewed.Content.ReadFromJsonAsync<NotificationTemplatePreview>())!;

        Assert.Equal(preview.Subject, message.Subject);
        Assert.Contains(preview.Content!, message.TextBody, StringComparison.Ordinal);
        Assert.Contains(preview.HtmlContent!, message.HtmlBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>G3.</b> Deactivating a template takes it out of service for mail that has not gone
    /// out yet: the next notification is delivered from its own title and message, not dropped
    /// and not mailed from a template an admin retired.
    /// </summary>
    [Fact]
    public async Task A_deactivated_template_is_not_what_the_recipient_reads()
    {
        var client = await AdminAsync();
        var (recipientId, recipientEmail) = await SeedRecipientAsync();
        var template = await CreateTemplateAsync(client, _companyId);

        var deactivated = await client.PutAsJsonAsync(
            $"/notification-templates/{template.Id}",
            new UpdateNotificationTemplateRequest(null, null, null, null, null, IsActive: false, null, null));
        deactivated.EnsureSuccessStatusCode();

        await SendAsync(client, recipientId, template.Id);

        var message = Assert.Single(_mail.Mailbox.To(recipientEmail));
        Assert.Equal(RawTitle, message.Subject);
        Assert.Contains(RawMessage, message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("TEMPLATE-BODY", message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>G4.</b> A notification with no template is unchanged -- the behaviour every other
    /// notification in the product depends on.
    /// </summary>
    [Fact]
    public async Task A_notification_without_a_template_is_mailed_from_its_own_title_and_message()
    {
        var client = await AdminAsync();
        var (recipientId, recipientEmail) = await SeedRecipientAsync();

        await SendAsync(client, recipientId, templateId: null);

        var message = Assert.Single(_mail.Mailbox.To(recipientEmail));
        Assert.Equal(RawTitle, message.Subject);
        Assert.Contains(RawMessage, message.TextBody, StringComparison.Ordinal);
    }
}
