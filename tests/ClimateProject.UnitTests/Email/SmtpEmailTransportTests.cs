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
