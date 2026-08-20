using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Notifications;
using Microsoft.Extensions.Logging.Abstractions;

namespace ClimateProject.UnitTests.Notifications;

/// <summary>
/// The real sender's channel routing and its mapping of provider outcomes onto the statuses
/// the dispatch path records (#100).
/// </summary>
public class EmailNotificationSenderTests
{
    private static EmailOptions Options() => new()
    {
        Provider = EmailOptions.ProviderSmtp,
        SmtpHost = "smtp.example.com",
        FromAddress = "no-reply@example.com",
        AppBaseUrl = "https://app.example.com",
    };

    private static Notification Notification(string channel, string? data = null) => new()
    {
        Id = Guid.NewGuid(),
        UserId = Guid.NewGuid(),
        CompanyId = Guid.NewGuid(),
        Type = NotificationTypes.SurveyInvitation,
        Channel = channel,
        Status = NotificationStatuses.Pending,
        Title = "Title",
        Message = "Message",
        Data = data,
    };

    private static NotificationRecipient Recipient()
        => new(Guid.NewGuid(), "ana@example.com", "Ana", ContentLanguages.Spanish);

    private static EmailNotificationSender Sender(RecordingTransport transport)
        => new(transport, Options(), NullLogger<EmailNotificationSender>.Instance);

    [Fact]
    public async Task An_email_notification_is_handed_to_the_transport_and_reported_sent()
    {
        var transport = new RecordingTransport(EmailSendOutcome.Success());

        var result = await Sender(transport).SendAsync(
            Notification(NotificationChannels.Email), Recipient(), CancellationToken.None);

        Assert.True(result.Delivered);
        var sent = Assert.Single(transport.Sent);
        Assert.Equal("ana@example.com", sent.ToAddress);

        // Composed in the recipient's language, resolved at delivery time.
        Assert.Contains("Hola Ana", sent.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_preferences_link_is_built_from_the_configured_app_base_url()
    {
        var transport = new RecordingTransport(EmailSendOutcome.Success());

        await Sender(transport).SendAsync(Notification(NotificationChannels.Email), Recipient(), CancellationToken.None);

        Assert.Contains(
            $"https://app.example.com/{NotificationEmailComposer.PreferencesPath}",
            Assert.Single(transport.Sent).TextBody,
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_survey_link_is_built_from_the_same_configured_app_base_url()
    {
        // The composer chooses the path; only the sender knows the origin. This pins the two
        // halves together -- the reason a survey link cannot be hardcoded to one host. The
        // payload is the one SurveyDistributionEndpoints writes, so this fails if either end
        // of the seam moves: the sender withholding EmailOptions.LinkTo, or the composer
        // reading a key the queueing side does not produce.
        var surveyId = Guid.NewGuid();
        var transport = new RecordingTransport(EmailSendOutcome.Success());

        await Sender(transport).SendAsync(
            Notification(
                NotificationChannels.Email,
                $$"""{"surveyId":"{{surveyId}}","surveyInvitationId":"{{Guid.NewGuid()}}"}"""),
            Recipient(),
            CancellationToken.None);

        Assert.Contains(
            $"https://app.example.com{SurveyWebPaths.Respond(surveyId)}",
            Assert.Single(transport.Sent).TextBody,
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_survey_link_never_carries_a_host_this_deployment_is_not_configured_for()
    {
        // Options.AppBaseUrl is the only origin in play. If any part of the link path ever
        // grew a literal host, staging mail would walk a recipient into production data.
        var transport = new RecordingTransport(EmailSendOutcome.Success());

        await Sender(transport).SendAsync(
            Notification(NotificationChannels.Email, $$"""{"surveyId":"{{Guid.NewGuid()}}"}"""),
            Recipient(),
            CancellationToken.None);

        var sent = Assert.Single(transport.Sent);
        foreach (var body in new[] { sent.TextBody, sent.HtmlBody })
        {
            Assert.Equal(
                body.Split("://", StringSplitOptions.None).Length - 1,
                body.Split("https://app.example.com", StringSplitOptions.None).Length - 1);
        }
    }

    [Fact]
    public async Task An_in_app_notification_needs_no_transport_at_all()
    {
        // Persisting the row *is* the delivery; the recipient reads it through
        // GET /notifications/mine. Contacting a mail provider for it would be nonsense.
        var transport = new RecordingTransport(EmailSendOutcome.Success());

        var result = await Sender(transport).SendAsync(
            Notification(NotificationChannels.InApp), Recipient(), CancellationToken.None);

        Assert.True(result.Delivered);
        Assert.Empty(transport.Sent);
    }

    [Fact]
    public async Task A_channel_with_no_provider_is_a_permanent_failure_not_a_reported_send()
    {
        // There is no SMS provider in this repo. Reporting `sent` would assert a delivery that
        // provably did not happen -- the failure mode NotificationChannels.Dispatchable exists
        // to prevent, and worse than a visible failure because it is invisible.
        var transport = new RecordingTransport(EmailSendOutcome.Success());

        var result = await Sender(transport).SendAsync(
            Notification(NotificationChannels.Sms), Recipient(), CancellationToken.None);

        Assert.False(result.Delivered);
        Assert.True(result.Permanent);
        Assert.Empty(transport.Sent);
    }

    [Fact]
    public async Task A_transient_provider_failure_stays_retryable()
    {
        var transport = new RecordingTransport(EmailSendOutcome.Transient("SMTP 451"));

        var result = await Sender(transport).SendAsync(
            Notification(NotificationChannels.Email), Recipient(), CancellationToken.None);

        Assert.False(result.Delivered);
        Assert.False(result.Permanent);
        Assert.Equal("SMTP 451", result.FailureReason);
    }

    [Fact]
    public async Task A_permanent_provider_failure_is_marked_permanent()
    {
        var transport = new RecordingTransport(EmailSendOutcome.PermanentFailure("SMTP 550"));

        var result = await Sender(transport).SendAsync(
            Notification(NotificationChannels.Email), Recipient(), CancellationToken.None);

        Assert.False(result.Delivered);
        Assert.True(result.Permanent);
        Assert.Equal("SMTP 550", result.FailureReason);
    }

    [Fact]
    public async Task A_failure_with_no_reason_still_records_something_readable()
    {
        var transport = new RecordingTransport(new EmailSendOutcome(false, false, null));

        var result = await Sender(transport).SendAsync(
            Notification(NotificationChannels.Email), Recipient(), CancellationToken.None);

        Assert.False(string.IsNullOrWhiteSpace(result.FailureReason));
    }

    [Fact]
    public void A_delivery_result_is_transient_unless_it_says_otherwise()
    {
        // Permanent is an init property rather than a fourth positional parameter precisely so
        // every pre-existing construction site keeps meaning "retryable".
        Assert.False(NotificationDeliveryResult.Failure("nope").Permanent);
        Assert.False(NotificationDeliveryResult.Success().Permanent);
        Assert.True(NotificationDeliveryResult.PermanentFailure("nope").Permanent);
    }

    private sealed class RecordingTransport(EmailSendOutcome outcome) : IEmailTransport
    {
        public List<EmailMessage> Sent { get; } = [];

        public Task<EmailSendOutcome> SendAsync(EmailMessage message, CancellationToken cancellationToken)
        {
            Sent.Add(message);
            return Task.FromResult(outcome);
        }
    }
}
