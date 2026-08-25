using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Notifications;
using Microsoft.Extensions.Logging;
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

    /// <summary>The survey and invitation every link-carrying notification here names.</summary>
    private static readonly Guid SurveyId = Guid.NewGuid();

    private static readonly Guid InvitationId = Guid.NewGuid();

    /// <summary>
    /// A token of the right SHAPE -- 43 base64url characters, the length
    /// <c>SurveyAccessTokens.Mint</c> produces -- and deliberately of the wrong KIND: it is
    /// readable English, so no scanner and no reader mistakes a test fixture for a leaked
    /// credential. Nothing on this path validates the shape, but a fixture that could not be
    /// a real token would quietly stop resembling what production composes.
    /// </summary>
    private const string Token = "invitation-token-for-test-not-a-real-secret";

    private static Notification Notification(string channel, string type = NotificationTypes.SurveyInvitation) => new()
    {
        Id = Guid.NewGuid(),
        UserId = RecipientUserId,
        CompanyId = CompanyId,
        Type = type,
        Channel = channel,
        Status = NotificationStatuses.Pending,
        Title = "Title",
        Message = "Message",
        Data = SurveyNotificationData.Serialize(SurveyId, InvitationId),
    };

    /// <summary>The addressee. Stable, so the scope the sender passes can be asserted.</summary>
    private static readonly Guid RecipientUserId = Guid.NewGuid();

    private static readonly Guid CompanyId = Guid.NewGuid();

    private static NotificationRecipient Recipient()
        => new(RecipientUserId, "ana@example.com", "Ana", ContentLanguages.Spanish);

    private static EmailNotificationSender Sender(RecordingTransport transport, ISurveyInvitationTokens? tokens = null)
        => new(transport, Options(), tokens ?? new RecordingTokens(Token), NullLogger<EmailNotificationSender>.Instance);

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

    // ------------------------------------------------------------------
    // The survey link -- the half of #100 that was missing
    // ------------------------------------------------------------------

    [Theory]
    [InlineData(NotificationTypes.SurveyInvitation)]
    [InlineData(NotificationTypes.SurveyReminder)]
    public async Task An_invitation_carries_an_absolute_link_built_from_the_token_resolved_at_send_time(string type)
    {
        var transport = new RecordingTransport(EmailSendOutcome.Success());
        var tokens = new RecordingTokens(Token);

        await Sender(transport, tokens).SendAsync(
            Notification(NotificationChannels.Email, type), Recipient(), CancellationToken.None);

        // Keyed by the id the payload carried -- and scoped to the mailbox this is addressed
        // to and to the notification's own tenant, which is what stops the caller's choice of
        // id from being a choice of victim.
        Assert.Equal(new Lookup(InvitationId, RecipientUserId, CompanyId), Assert.Single(tokens.Lookups));

        var expected = $"https://app.example.com/survey-invitations/{Token}";
        var sent = Assert.Single(transport.Sent);
        Assert.Contains(expected, sent.TextBody, StringComparison.Ordinal);
        Assert.Contains(expected, sent.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_test_token_has_the_shape_a_minted_one_does()
    {
        // Otherwise the fixture above could drift to any string and these tests would go on
        // passing against a link production could never produce.
        Assert.True(SurveyAccessTokens.HasExpectedShape(Token));
    }

    [Fact]
    public async Task The_link_addresses_the_invitation_token_and_not_the_survey_id()
    {
        // The design that was overruled, pinned so it cannot come back: `/surveys/{id}/respond`
        // sits behind RequireAuth, and RequireAuth destroys the destination on redirect -- so a
        // recipient who clicked it landed on the dashboard rather than on their survey. The
        // token route is unauthenticated by design and opens the survey itself.
        var transport = new RecordingTransport(EmailSendOutcome.Success());

        await Sender(transport).SendAsync(
            Notification(NotificationChannels.Email), Recipient(), CancellationToken.None);

        var sent = Assert.Single(transport.Sent);
        Assert.Contains($"https://app.example.com/survey-invitations/{Token}", sent.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("/respond", sent.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(SurveyId.ToString(), sent.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(SurveyId.ToString(), sent.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_revoked_or_missing_invitation_sends_the_mail_without_a_link_rather_than_failing_it()
    {
        // The row is gone, or was revoked between queueing and this sweep. The recipient must
        // still get the message; a row marked `failed` would burn three retries on a condition
        // no retry can change, and a link built from an empty token is a 404 with a button on it.
        var transport = new RecordingTransport(EmailSendOutcome.Success());

        var result = await Sender(transport, new RecordingTokens(token: null)).SendAsync(
            Notification(NotificationChannels.Email), Recipient(), CancellationToken.None);

        Assert.True(result.Delivered);
        var sent = Assert.Single(transport.Sent);
        Assert.DoesNotContain("survey-invitations", sent.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("survey-invitations", sent.HtmlBody, StringComparison.Ordinal);

        // And nothing that looks like a link with nothing behind it.
        Assert.DoesNotContain("Abrir la encuesta", sent.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("href=\"\"", sent.HtmlBody, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not json at all")]
    [InlineData("[1,2,3]")]
    [InlineData("""{"surveyInvitationId": "not-a-guid"}""")]
    [InlineData("""{"surveyInvitationId": {"nested": true}}""")]
    [InlineData("""{"surveyInvitationId": "00000000-0000-0000-0000-000000000000"}""")]
    [InlineData("""{"surveyId": "8f14e45f-ceea-467a-9575-2f3d4a1b2c3d"}""")]
    public async Task An_unusable_payload_sends_a_link_less_mail_and_does_not_throw(string? data)
    {
        // notifications.data is jsonb that POST /notifications lets a company admin write
        // verbatim. Every shape of junk means "no link", never an exception.
        var transport = new RecordingTransport(EmailSendOutcome.Success());
        var tokens = new RecordingTokens(Token);
        var notification = Notification(NotificationChannels.Email);
        notification.Data = data;

        var result = await Sender(transport, tokens).SendAsync(notification, Recipient(), CancellationToken.None);

        Assert.True(result.Delivered);
        Assert.Empty(tokens.Lookups);
        Assert.DoesNotContain("survey-invitations", Assert.Single(transport.Sent).TextBody, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(NotificationTypes.SystemNotification)]
    [InlineData(NotificationTypes.ActionPlanAlert)]
    [InlineData(NotificationTypes.UserInvitation)]
    [InlineData(NotificationTypes.SurveyCompletion)]
    public async Task A_notification_that_is_not_about_a_survey_never_touches_the_database(string type)
    {
        // Two assertions, and the second is the one worth having: a sender that looked the
        // invitation up and then declined to render it would satisfy "no link" while spending
        // a round trip on every non-survey mail in a dispatch batch.
        var transport = new RecordingTransport(EmailSendOutcome.Success());
        var tokens = new RecordingTokens(Token);

        await Sender(transport, tokens).SendAsync(
            Notification(NotificationChannels.Email, type), Recipient(), CancellationToken.None);

        Assert.Empty(tokens.Lookups);

        var sent = Assert.Single(transport.Sent);
        Assert.DoesNotContain("survey-invitations", sent.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("survey-invitations", sent.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_lookup_that_throws_is_not_swallowed()
    {
        // The complement of the tests above, and the line between them: a payload this sender
        // cannot use is an ordinary outcome, but a database that will not answer is not. It
        // must reach NotificationDelivery's catch, which records a retryable failure -- not be
        // turned into a cheerful link-less "delivered".
        var transport = new RecordingTransport(EmailSendOutcome.Success());

        await Assert.ThrowsAsync<InvalidOperationException>(() => Sender(transport, new ThrowingTokens())
            .SendAsync(Notification(NotificationChannels.Email), Recipient(), CancellationToken.None));

        Assert.Empty(transport.Sent);
    }

    [Fact]
    public async Task An_invitation_that_is_not_this_recipients_yields_no_link()
    {
        // The lookup answers null for "not yours" exactly as it does for "revoked" -- and the
        // sender must not distinguish them. This is the sender's half of the cross-tenant
        // defect; the scope it PASSES is asserted above, and the scope being ENFORCED is
        // asserted against the real database in InvitationEmailLinkTests.
        var transport = new RecordingTransport(EmailSendOutcome.Success());

        var result = await Sender(transport, new RecordingTokens(token: null)).SendAsync(
            Notification(NotificationChannels.Email), Recipient(), CancellationToken.None);

        Assert.True(result.Delivered);
        Assert.DoesNotContain("survey-invitations", Assert.Single(transport.Sent).TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// `SurveyAccessTokens` states these are never logged, and until this test nothing enforced
    /// it: logging the composed URL compiled and survived the whole suite. A token in an
    /// application log is a bearer credential in a log aggregator, readable by everyone who can
    /// read operational logs and outliving the survey itself.
    ///
    /// <para>
    /// <b>Every outcome, not just the happy one.</b> A first version drove only the delivered
    /// path, and a `LogWarning` on the `!outcome.Delivered` branch slipped straight past it --
    /// writing the whole URL on every transport failure, which is exactly when logs get read.
    /// The failure branches are where a tired author reaches for "log more detail", so they are
    /// the branches that need pinning most.
    /// </para>
    /// </summary>
    [Theory]
    [MemberData(nameof(EveryTransportOutcome))]
    public async Task The_token_is_never_written_to_a_log(EmailSendOutcome outcome)
    {
        var transport = new RecordingTransport(outcome);
        var logger = new CapturingLogger();

        await new EmailNotificationSender(transport, Options(), new RecordingTokens(Token), logger)
            .SendAsync(Notification(NotificationChannels.Email), Recipient(), CancellationToken.None);

        // The mail really did carry it -- otherwise this passes for the wrong reason.
        Assert.Contains(Token, Assert.Single(transport.Sent).TextBody, StringComparison.Ordinal);

        Assert.DoesNotContain(logger.Lines, line => line.Contains(Token, StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(logger.Lines, line => line.Contains("survey-invitations", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// The instrument, checked separately rather than as a `NotEmpty` inside the theory above.
    ///
    /// <para>
    /// The sender writes NOTHING on its failure branches -- measured, not assumed -- so
    /// asserting "some line was written" there fails against correct code and would have to be
    /// deleted, taking the non-vacuity guard with it. Splitting them keeps both properties: the
    /// logger provably captures what the sender writes, and no branch writes a token.
    /// </para>
    /// </summary>
    [Fact]
    public async Task The_capturing_logger_really_does_observe_what_the_sender_writes()
    {
        var logger = new CapturingLogger();

        await new EmailNotificationSender(
                new RecordingTransport(EmailSendOutcome.Success()), Options(), new RecordingTokens(Token), logger)
            .SendAsync(Notification(NotificationChannels.Email), Recipient(), CancellationToken.None);

        Assert.Contains(logger.Lines, line => line.Contains("Delivered notification", StringComparison.Ordinal));
    }

    public static TheoryData<EmailSendOutcome> EveryTransportOutcome() =>
    [
        EmailSendOutcome.Success(),
        EmailSendOutcome.Transient("SMTP 451"),
        EmailSendOutcome.PermanentFailure("SMTP 550"),
        new EmailSendOutcome(false, false, null),
    ];

    [Fact]
    public void A_delivery_result_is_transient_unless_it_says_otherwise()
    {
        // Permanent is an init property rather than a fourth positional parameter precisely so
        // every pre-existing construction site keeps meaning "retryable".
        Assert.False(NotificationDeliveryResult.Failure("nope").Permanent);
        Assert.False(NotificationDeliveryResult.Success().Permanent);
        Assert.True(NotificationDeliveryResult.PermanentFailure("nope").Permanent);
    }

    /// <summary>
    /// A token source that counts. The count is the assertion in
    /// <see cref="A_notification_that_is_not_about_a_survey_never_touches_the_database"/>:
    /// "no link was rendered" is satisfied by a sender that queried and then discarded the
    /// answer, and that sender costs a round trip on every non-survey mail in the batch.
    /// </summary>
    /// <summary>
    /// One call to the lookup, recorded whole. The SCOPE is recorded, not just the id: the id
    /// is caller-controlled, so "which invitation" is the least interesting third of the
    /// question and "whose, in which tenant" is the part that stops it being an exfiltration
    /// primitive.
    /// </summary>
    private sealed record Lookup(Guid InvitationId, Guid RecipientUserId, Guid CompanyId);

    private sealed class RecordingTokens(string? token) : ISurveyInvitationTokens
    {
        public List<Lookup> Lookups { get; } = [];

        public Task<string?> LiveTokenAsync(
            Guid invitationId,
            Guid recipientUserId,
            Guid companyId,
            CancellationToken cancellationToken)
        {
            Lookups.Add(new Lookup(invitationId, recipientUserId, companyId));
            return Task.FromResult(token);
        }
    }

    private sealed class ThrowingTokens : ISurveyInvitationTokens
    {
        public Task<string?> LiveTokenAsync(
            Guid invitationId,
            Guid recipientUserId,
            Guid companyId,
            CancellationToken cancellationToken)
            => throw new InvalidOperationException("The database is not reachable.");
    }

    /// <summary>Every formatted log line the sender wrote, so a leak is assertable.</summary>
    private sealed class CapturingLogger : ILogger<EmailNotificationSender>
    {
        public List<string> Lines { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            ArgumentNullException.ThrowIfNull(formatter);

            // The formatted message AND the raw state: a structured logging sink writes the
            // property values too, so asserting only on the rendered string would miss a token
            // smuggled in as a named property.
            Lines.Add(formatter(state, exception));
            Lines.Add(state?.ToString() ?? string.Empty);
        }
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
