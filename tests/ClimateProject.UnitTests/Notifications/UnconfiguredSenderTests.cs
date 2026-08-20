using ClimateProject.Application.Notifications;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Notifications;
using ClimateProject.Infrastructure.OrgStructure;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace ClimateProject.UnitTests.Notifications;

/// <summary>
/// What the product says when no mail provider is configured — which is the state production
/// has been in since it went live.
///
/// These two senders are the registered defaults whenever <c>EmailOptions.IsConfigured</c> is
/// false. The notification one used to return <c>Success()</c>, so the dispatch path wrote
/// <c>Status = sent</c> with a <c>SentAt</c> for mail that never left the process, and the
/// admin screens reported success in both languages. The invitation one used to log the live
/// invitation token, which <c>POST /invitations/accept</c> turns into a working account.
///
/// Both are the kind of defect that no amount of green tests finds, because the tests
/// asserted the lie. These pin the truth instead.
/// </summary>
public class UnconfiguredSenderTests
{
    private static Notification NewNotification() => new()
    {
        Id = Guid.NewGuid(),
        UserId = Guid.NewGuid(),
        CompanyId = Guid.NewGuid(),
        Type = NotificationTypes.SurveyInvitation,
        Channel = NotificationChannels.Email,
        Priority = NotificationPriorities.Default,
        Status = NotificationStatuses.Default,
        Title = "Your feedback has been requested",
        Message = "Ana in Finance rated her workload 2",
    };

    private static NotificationRecipient NewRecipient() =>
        NotificationRecipient.From(new User
        {
            Id = Guid.NewGuid(),
            Email = "ana@acme.test",
            Name = "Ana Ramos",
            Role = "employee",
        });

    [Fact]
    public async Task An_unconfigured_provider_reports_failure_and_never_claims_a_send()
    {
        var sender = new LoggingNotificationSender(NullLogger<LoggingNotificationSender>.Instance);

        var result = await sender.SendAsync(NewNotification(), NewRecipient(), default);

        // The whole point. `Delivered` is what NotificationDelivery reads to decide between
        // Status=sent and Status=failed, so a true here is the database lying.
        Assert.False(result.Delivered);
        Assert.Equal(LoggingNotificationSender.NotConfiguredReason, result.FailureReason);
    }

    [Fact]
    public async Task The_failure_is_permanent_so_a_send_with_nowhere_to_go_is_not_retried_forever()
    {
        // `Permanent` means "another attempt cannot possibly succeed", which with no provider
        // registered is literally true — the next sweep calls this same sender. The dispatch
        // path then dead-letters by exhausting RetryCount instead of re-attempting every
        // minute for MaxRetries, which is what #100 asks for.
        var sender = new LoggingNotificationSender(NullLogger<LoggingNotificationSender>.Instance);

        var result = await sender.SendAsync(NewNotification(), NewRecipient(), default);

        Assert.True(result.Permanent);
    }

    [Fact]
    public void The_failure_reason_names_the_setting_and_carries_no_recipient_data()
    {
        // It is written verbatim to Notification.FailureReason (varchar(1000)) and read by an
        // operator, so it must name the fix and must not carry PII.
        var reason = LoggingNotificationSender.NotConfiguredReason;

        Assert.Contains("Email:Provider", reason, StringComparison.Ordinal);
        Assert.True(reason.Length <= 1000);
    }

    [Fact]
    public async Task The_invitation_sender_logs_neither_the_token_nor_the_address()
    {
        // An invitation token is a bearer credential: POST /invitations/accept turns it into a
        // working account. It was being written to application logs at Information level, in a
        // production log group with no retention policy — so, kept indefinitely.
        var log = new CapturingLoggerProvider();
        var sender = new LoggingInvitationEmailSender(
            new LoggerFactory([log]).CreateLogger<LoggingInvitationEmailSender>());

        var invitation = new UserInvitation
        {
            Id = Guid.NewGuid(),
            Email = "ana@acme.test",
            InvitationToken = "fixture-invitation-token-addressed",
            InvitationType = "employee",
            Role = "employee",
            Status = "pending",
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
        };

        await sender.SendAsync(invitation, default);

        var written = string.Join("\n", log.Messages);
        Assert.DoesNotContain(invitation.InvitationToken, written, StringComparison.Ordinal);
        Assert.DoesNotContain("ana@acme.test", written, StringComparison.OrdinalIgnoreCase);
        // The id is enough to follow one through the logs, and it grants nothing.
        Assert.Contains(invitation.Id.ToString(), written, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_shareable_link_is_distinguishable_from_an_addressed_invitation()
    {
        // Legitimately has no address, and the two flows are worth telling apart in a log —
        // without printing the address of the one that has one.
        var log = new CapturingLoggerProvider();
        var sender = new LoggingInvitationEmailSender(
            new LoggerFactory([log]).CreateLogger<LoggingInvitationEmailSender>());

        await sender.SendAsync(
            new UserInvitation
            {
                Id = Guid.NewGuid(),
                Email = null,
                InvitationToken = "fixture-invitation-token-shareable",
                InvitationType = "employee",
                Role = "employee",
                Status = "pending",
                ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
            },
            default);

        Assert.Contains("shareable link", string.Join("\n", log.Messages), StringComparison.Ordinal);
    }

    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        public List<string> Messages { get; } = [];

        public ILogger CreateLogger(string categoryName) => new Capturing(Messages);

        public void Dispose() { }

        private sealed class Capturing(List<string> sink) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter)
                => sink.Add(formatter(state, exception));
        }
    }
}
