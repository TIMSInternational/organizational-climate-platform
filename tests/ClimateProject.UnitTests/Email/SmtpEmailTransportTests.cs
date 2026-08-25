using ClimateProject.Application.Email;
using ClimateProject.Infrastructure.Email;
using Microsoft.Extensions.Logging.Abstractions;

namespace ClimateProject.UnitTests.Email;

/// <summary>
/// The transport's pre-flight checks -- the branches reachable without a mail server, and the
/// ones that matter most.
///
/// Everything asserted here happens *before* a connection is opened, which is the point: an
/// address that cannot possibly be delivered to should not cost three round trips to a
/// provider to establish that, and a subject carrying a line break should never reach a
/// provider at all. The connected paths (5xx permanent, 4xx transient) are covered by
/// <c>EmailNotificationSenderTests</c> against a recording transport, because exercising them
/// here would mean standing up an SMTP server in a unit test.
/// </summary>
public class SmtpEmailTransportTests
{
    private static SmtpEmailTransport Transport()
    {
        var options = new EmailOptions
        {
            Provider = EmailOptions.ProviderSmtp,
            // Unreachable on purpose. No test here gets far enough to dial it.
            SmtpHost = "smtp.invalid",
            FromAddress = "no-reply@example.com",
            AppBaseUrl = "https://app.example.com",
        };

        return new SmtpEmailTransport(
            options,
            new EmailSendRateLimiter(options.MaxSendsPerSecond),
            NullLogger<SmtpEmailTransport>.Instance);
    }

    private static EmailMessage Message(string to, string subject = "Subject")
        => new(to, "Ana", subject, "text", "<p>html</p>");

    /// <summary>
    /// This class is the only one that holds a composed message AND a logger, and it had no
    /// assertion about what it writes. A survey invitation's body carries a bearer token, and
    /// the pre-flight rejections below are exactly the branches where logging "the message we
    /// could not send" would feel helpful -- so this pins that the body never reaches a log.
    ///
    /// Driven through every reachable pre-flight rejection rather than one, for the reason
    /// EmailNotificationSenderTests gives: the failure branches are where the detail gets
    /// added.
    /// </summary>
    /// <param name="host">
    /// Blank reaches the <c>InvalidOperationException</c> handler -- the transport's one branch
    /// that actually WRITES a log while holding the composed body. The first version of this
    /// test drove only malformed addresses, every one of which is rejected pre-flight before a
    /// client is built, so the logging branch was never entered and a mutation that logged the
    /// body there passed. A guard that cannot reach the code it guards is not a guard.
    /// </param>
    [Theory]
    [InlineData("smtp.invalid", "")]
    [InlineData("smtp.invalid", "not-an-address")]
    [InlineData("smtp.invalid", "ana@example.com\r\nBcc: attacker@example.com")]
    [InlineData("", "ana@example.com")]
    public async Task The_message_body_never_reaches_a_log(string host, string address)
    {
        const string Token = "invitation-token-for-test-not-a-real-secret";
        var logger = new CapturingLogger();
        var options = new EmailOptions
        {
            Provider = EmailOptions.ProviderSmtp,
            SmtpHost = host,
            FromAddress = "no-reply@example.com",
            AppBaseUrl = "https://app.example.com",
        };

        var transport = new SmtpEmailTransport(
            options, new EmailSendRateLimiter(options.MaxSendsPerSecond), logger);

        await transport.SendAsync(
            new EmailMessage(
                address,
                "Ana",
                "Subject",
                $"Open the survey: https://app.example.com/survey-invitations/{Token}",
                $"""<a href="https://app.example.com/survey-invitations/{Token}">Open</a>"""),
            CancellationToken.None);

        Assert.DoesNotContain(logger.Lines, line => line.Contains(Token, StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(logger.Lines, line => line.Contains("survey-invitations", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// The instrument: the blank-host row above really does enter a logging branch. Without
    /// this, every row could be reaching nothing and the assertions would all hold vacuously --
    /// which is exactly how the first version of this test passed a mutation that logged the
    /// body.
    /// </summary>
    [Fact]
    public async Task The_misconfigured_host_branch_really_is_reached_and_really_does_log()
    {
        var logger = new CapturingLogger();
        var options = new EmailOptions
        {
            Provider = EmailOptions.ProviderSmtp,
            SmtpHost = string.Empty,
            FromAddress = "no-reply@example.com",
            AppBaseUrl = "https://app.example.com",
        };

        var outcome = await new SmtpEmailTransport(
                options, new EmailSendRateLimiter(options.MaxSendsPerSecond), logger)
            .SendAsync(Message("ana@example.com"), CancellationToken.None);

        // Transient, not permanent: SmtpClient wraps "the SMTP host was not specified" in an
        // SmtpException, so this lands in Classify rather than in the InvalidOperationException
        // handler. Classify IS the transport's real logging path -- it writes the status and
        // the exception on every rejected submission -- which is precisely the branch the
        // theory above needs to be entering.
        Assert.False(outcome.Delivered);
        Assert.Contains(logger.Lines, line => line.Contains("SMTP submission failed", StringComparison.Ordinal));
    }

    /// <summary>Every formatted log line the transport wrote, plus the raw state a structured sink would emit.</summary>
    private sealed class CapturingLogger : Microsoft.Extensions.Logging.ILogger<SmtpEmailTransport>
    {
        public List<string> Lines { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(Microsoft.Extensions.Logging.LogLevel logLevel) => true;

        public void Log<TState>(
            Microsoft.Extensions.Logging.LogLevel logLevel,
            Microsoft.Extensions.Logging.EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            ArgumentNullException.ThrowIfNull(formatter);
            Lines.Add(formatter(state, exception));
            Lines.Add(state?.ToString() ?? string.Empty);
            Lines.Add(exception?.ToString() ?? string.Empty);
        }
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not-an-address")]
    [InlineData("two@addresses@example.com")]
    public async Task An_unsendable_address_is_a_permanent_failure_before_the_provider_is_contacted(string address)
    {
        var outcome = await Transport().SendAsync(Message(address), CancellationToken.None);

        Assert.False(outcome.Delivered);
        Assert.True(outcome.Permanent);
        Assert.Contains("not a valid email address", outcome.FailureReason);
    }

    [Fact]
    public async Task An_address_containing_a_line_break_is_rejected()
    {
        var outcome = await Transport().SendAsync(
            Message("ana@example.com\r\nBcc: attacker@example.com"), CancellationToken.None);

        Assert.True(outcome.Permanent);
    }

    [Fact]
    public async Task A_subject_containing_a_line_break_is_rejected_rather_than_submitted()
    {
        // Unreachable through the composers, which collapse line breaks -- kept as a
        // fail-closed backstop because the failure mode is header injection.
        var outcome = await Transport().SendAsync(
            Message("ana@example.com", "Subject\r\nBcc: attacker@example.com"), CancellationToken.None);

        Assert.False(outcome.Delivered);
        Assert.True(outcome.Permanent);
        Assert.Contains("line break", outcome.FailureReason);
    }

    [Fact]
    public async Task A_failure_reason_never_repeats_the_recipient_address()
    {
        // FailureReason is persisted to Notification.FailureReason and readable by any company
        // admin of the tenant, so it must stay free of PII and of provider detail.
        var outcome = await Transport().SendAsync(Message("bad-address"), CancellationToken.None);

        Assert.DoesNotContain("bad-address", outcome.FailureReason);
    }
}
