using System.Net;
using System.Net.Mail;
using ClimateProject.Application.Email;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Email;

/// <summary>
/// The real mail transport: SMTP submission over STARTTLS.
///
/// <para>
/// **Why SMTP and not the AWS SES SDK**, which #100 suggested. The suggestion's argument was
/// credential surface -- App Runner already has an instance role, so the SES API needs no new
/// secret. That argument is real, and it is the one thing SMTP gives up: SES's SMTP interface
/// needs an SMTP username/password pair derived from an IAM key, which is a secret this repo
/// would then have to hold. Against it: SMTP is in the BCL, so it adds nothing to a
/// dependency list that is currently five packages long; it works unchanged against SES,
/// SendGrid, Postmark, Mailgun and a local capture server, so the provider decision stays
/// reversible; and it can be exercised in development against MailHog without an AWS account.
/// Given that no provider is chosen or provisioned yet, keeping the choice open was worth one
/// secret. If SES is confirmed, replacing this class with an SDK-backed
/// <see cref="IEmailTransport"/> changes one registration and no caller.
/// </para>
/// <para>
/// **A new <c>SmtpClient</c> per send, deliberately.** <c>SmtpClient</c> is not thread-safe
/// and holds a connection whose server-side idle timeout this code cannot see; reusing one
/// across requests is how "the first mail of the hour always fails" bugs happen. Submission
/// connections are cheap and the rate limiter has already spaced the sends out.
/// </para>
/// </summary>
public sealed class SmtpEmailTransport(
    EmailOptions options,
    EmailSendRateLimiter rateLimiter,
    ILogger<SmtpEmailTransport> logger) : IEmailTransport
{
    /// <summary>
    /// SMTP reply codes that mean "this address will never accept mail from us". Retrying
    /// any of these is how a sending domain's reputation is burned -- see
    /// <c>NotificationDeliveryResult.Permanent</c>.
    ///
    /// 5xx is permanent as a class in RFC 5321, but the enum only names some of them, so the
    /// numeric check below is the primary rule and this set exists for the codes .NET
    /// surfaces without a numeric status.
    /// </summary>
    private static readonly SmtpStatusCode[] PermanentStatusCodes =
    [
        SmtpStatusCode.MailboxNameNotAllowed,
        SmtpStatusCode.MailboxUnavailable,
        SmtpStatusCode.UserNotLocalTryAlternatePath,
        SmtpStatusCode.TransactionFailed,
        SmtpStatusCode.ClientNotPermitted,
        SmtpStatusCode.MustIssueStartTlsFirst,
    ];

    public async Task<EmailSendOutcome> SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);

        // Checked before the provider is contacted, and reported as permanent: a malformed
        // address is a data problem, and three round trips to SES to confirm it is still
        // malformed help nobody.
        if (!TryBuildMailAddress(message.ToAddress, message.ToName, out var to))
        {
            return EmailSendOutcome.PermanentFailure("The recipient address is not a valid email address.");
        }

        // The backstop, and the only check on this path that is true for EVERY caller. Both
        // senders refuse a reserved domain before they get here, which is where the useful log
        // line and the cheap early exit belong; this one exists so that the guarantee -- no
        // address the RFCs say cannot exist is ever offered to SES -- survives a third sender
        // being written by someone who does not know the rule. A guarantee that lives only in
        // its callers is a convention, not a guarantee.
        if (UndeliverableAddresses.IsUndeliverable(message.ToAddress))
        {
            return EmailSendOutcome.PermanentFailure(UndeliverableAddresses.ReasonFor(message.ToAddress));
        }

        if (EmailMessage.HasHeaderInjection(message.Subject))
        {
            // Should be unreachable: every composer runs the subject through
            // EmailMessage.ToHeaderValue. Fail closed anyway rather than trusting that a
            // future caller will, because the failure mode is header injection.
            return EmailSendOutcome.PermanentFailure("The message subject contains a line break and cannot be sent.");
        }

        await rateLimiter.WaitForTurnAsync(cancellationToken).ConfigureAwait(false);

        using var client = new SmtpClient(options.SmtpHost, options.SmtpPort)
        {
            EnableSsl = options.SmtpUseStartTls,
            Timeout = options.TimeoutSeconds * 1000,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            // Explicitly off: the default picks up the machine's ambient network credentials,
            // which on a misconfigured host silently authenticates as something nobody chose.
            UseDefaultCredentials = false,
            Credentials = string.IsNullOrWhiteSpace(options.SmtpUsername)
                ? null
                : new NetworkCredential(options.SmtpUsername, options.SmtpPassword),
        };

        using var mail = new MailMessage
        {
            From = BuildFromAddress(),
            Subject = message.Subject,
            Body = message.TextBody,
            IsBodyHtml = false,
            SubjectEncoding = System.Text.Encoding.UTF8,
            BodyEncoding = System.Text.Encoding.UTF8,
        };
        mail.To.Add(to);

        using var htmlView = AlternateView.CreateAlternateViewFromString(
            message.HtmlBody, System.Text.Encoding.UTF8, "text/html");
        mail.AlternateViews.Add(htmlView);

        ApplySesConfigurationSet(mail.Headers);

        try
        {
            await client.SendMailAsync(mail, cancellationToken).ConfigureAwait(false);
            return EmailSendOutcome.Success();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (SmtpFailedRecipientException exception)
        {
            return Classify(exception, exception.StatusCode, "recipient rejected");
        }
        catch (SmtpException exception)
        {
            return Classify(exception, exception.StatusCode, "submission failed");
        }
        catch (InvalidOperationException exception)
        {
            // Thrown for a client the runtime cannot configure at all -- e.g. no host. That
            // is configuration, not a transient network condition, so retrying it is pointless.
            logger.LogError(exception, "SMTP transport is misconfigured; mail cannot be submitted.");
            return EmailSendOutcome.PermanentFailure("The mail provider is not configured correctly.");
        }
    }

    /// <summary>
    /// Maps a provider exception onto an outcome, logging the detail and persisting only a
    /// code.
    ///
    /// The exception message is logged and never returned. An SMTP failure message routinely
    /// contains the submission host, the authenticating username, and the recipient address;
    /// the returned reason lands in <c>Notification.FailureReason</c>, which any company
    /// admin of the tenant can read through <c>GET /notifications</c>.
    /// </summary>
    private EmailSendOutcome Classify(Exception exception, SmtpStatusCode statusCode, string what)
    {
        var permanent = IsPermanent(statusCode);

        logger.Log(
            permanent ? LogLevel.Warning : LogLevel.Information,
            exception,
            "SMTP {What} with status {StatusCode} ({StatusNumber}); treated as {Disposition}.",
            what,
            statusCode,
            (int)statusCode,
            permanent ? "permanent" : "transient");

        var reason = $"The mail provider rejected the message (SMTP {(int)statusCode}).";
        return permanent ? EmailSendOutcome.PermanentFailure(reason) : EmailSendOutcome.Transient(reason);
    }

    /// <summary>
    /// 5xx is a permanent failure in RFC 5321 and 4xx is an invitation to try later, so the
    /// numeric range is the rule. <see cref="PermanentStatusCodes"/> only backstops codes
    /// .NET reports outside that range.
    /// </summary>
    private static bool IsPermanent(SmtpStatusCode statusCode)
    {
        var numeric = (int)statusCode;
        if (numeric is >= 500 and < 600) return true;
        if (numeric is >= 400 and < 500) return false;

        return Array.IndexOf(PermanentStatusCodes, statusCode) >= 0;
    }

    /// <summary>
    /// Adds the <c>X-SES-CONFIGURATION-SET</c> header when one is configured, and adds nothing
    /// at all when one is not.
    ///
    /// <para>
    /// SES reads this header off an SMTP submission and attributes the message's bounces and
    /// complaints to the named configuration set. Without it, every send from this service is
    /// scored only against the shared AWS account -- which five other TIMS products also send
    /// from -- so a hard bounce here is a reputation cost none of them can see, attribute or
    /// defend against.
    /// </para>
    /// <para>
    /// **Absent means absent.** A blank setting adds no header, which is what every non-SES
    /// destination needs: MailHog, CI and the integration suite would otherwise carry a header
    /// naming a configuration set that does not exist where they send. Any other provider that
    /// ever replaces SES ignores an unknown <c>X-</c> header, so the header being present is
    /// harmless -- but the setting being optional is what keeps the local capture story true.
    /// </para>
    /// <para>
    /// The value cannot contain a line break: <c>EmailOptions.Validate</c> refuses to start
    /// the host on one, so header injection through the deploy template fails at boot rather
    /// than in every message.
    /// </para>
    /// </summary>
    private void ApplySesConfigurationSet(System.Collections.Specialized.NameValueCollection headers)
    {
        var configurationSet = options.SesConfigurationSet?.Trim();
        if (string.IsNullOrEmpty(configurationSet))
        {
            return;
        }

        headers.Add(SesConfigurationSetHeader, configurationSet);
    }

    /// <summary>The SMTP header SES reads a configuration set name from.</summary>
    public const string SesConfigurationSetHeader = "X-SES-CONFIGURATION-SET";

    private MailAddress BuildFromAddress()
        => string.IsNullOrWhiteSpace(options.FromName)
            ? new MailAddress(options.FromAddress!)
            : new MailAddress(options.FromAddress!, EmailMessage.ToHeaderValue(options.FromName), System.Text.Encoding.UTF8);

    private static bool TryBuildMailAddress(string address, string? displayName, out MailAddress mailAddress)
    {
        mailAddress = null!;

        if (string.IsNullOrWhiteSpace(address) || EmailMessage.HasHeaderInjection(address))
        {
            return false;
        }

        try
        {
            mailAddress = string.IsNullOrWhiteSpace(displayName)
                ? new MailAddress(address.Trim())
                : new MailAddress(address.Trim(), displayName, System.Text.Encoding.UTF8);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }
}
