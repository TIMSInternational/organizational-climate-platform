using ClimateProject.Application.Email;
using ClimateProject.Application.Surveys;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Surveys;

/// <summary>
/// Real delivery of a personal-link invitation, through the same transport, sender identity and
/// rate limit as every other mail. Sent INLINE by <c>POST /surveys/{id}/invitations</c> and by
/// the one-person resend, never queued -- see <c>docs/decisions/personal-link-invitations.md</c>.
///
/// <para><b>Nothing it logs carries the address, the token or the link.</b> The link opens the
/// survey as its holder, so a link in the application log is a key anybody with log access
/// holds -- CloudWatch application logs are readable by more people than the survey.</para>
///
/// <para><b>No reserved-domain check of its own.</b> The transport is the guarantee
/// (<c>SmtpEmailTransport</c> refuses every RFC 2606/6761 domain before SES is contacted, "a
/// guarantee that lives only in its callers is a convention"), and its failure reason names the
/// domain and nothing else. Checking here as well would also refuse the Development-only
/// <c>pickup</c> transport, which writes to a local folder and is the one way to read this
/// message for a seeded <c>@acme.test</c> person without any mail leaving the machine.</para>
/// </summary>
public sealed class EmailPersonalLinkEmailSender(
    IEmailTransport transport,
    EmailOptions options,
    ILogger<EmailPersonalLinkEmailSender> logger) : IPersonalLinkEmailSender
{
    public async Task<EmailSendOutcome> SendAsync(
        string toEmail, string invitationToken, SurveyPersonalLinkMail mail, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(invitationToken);
        ArgumentNullException.ThrowIfNull(mail);

        var link = options.LinkTo(SurveyAccessTokens.InvitationLinkPath(invitationToken));

        // The stored logo is a root-relative path; only this layer holds the base URL it has to
        // be resolved against before a mail client can fetch it.
        var message = PersonalLinkEmailComposer.Compose(
            toEmail, link, mail with { Brand = mail.Brand.ResolvedAgainst(options) });
        var outcome = await transport.SendAsync(message, cancellationToken).ConfigureAwait(false);

        if (!outcome.Delivered)
        {
            logger.Log(
                outcome.Permanent ? LogLevel.Error : LogLevel.Warning,
                "A personal survey link could not be emailed ({Disposition}): {Reason}",
                outcome.Permanent ? "permanent" : "transient",
                outcome.FailureReason);
        }

        return outcome;
    }
}
