using System.Globalization;
using ClimateProject.Application.Email;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.OrgStructure;

/// <summary>
/// Real invitation delivery (#100), retiring <see cref="LoggingInvitationEmailSender"/>
/// wherever a mail provider is configured.
///
/// <para>
/// The invitation stub is the reason #100 blocks UAT: an invite flow that never sends an
/// invite cannot be tested end to end by a human. It shares the transport, the credential
/// and the rate limit with notification delivery -- one provider, configured once.
/// </para>
/// <para>
/// **Failures are still not thrown — they are now returned.** Throwing would turn a persisted
/// invitation into a 500 on a request that had already succeeded, leaving the admin unable to
/// tell what state anything is in; the invitation is still redeemable through its link, and
/// <c>POST /invitations/{id}/resend</c> exists precisely for a retry. What changed is that
/// <c>IInvitationEmailSender.SendAsync</c> now returns an <see cref="EmailSendOutcome"/>, so
/// the endpoint can decline to record a send that did not happen.
/// </para>
/// <para>
/// This type's own doc used to call that fix "a schema change and therefore a separate
/// issue". It was wrong, and the correction is worth keeping: the honest state after a failed
/// send is <c>pending</c>, which is the state the row was created in, which the users screen
/// already renders. No new status, no column, no migration — only a return value.
/// </para>
/// </summary>
public sealed class EmailInvitationEmailSender(
    IEmailTransport transport,
    EmailOptions options,
    ILogger<EmailInvitationEmailSender> logger) : IInvitationEmailSender
{
    public async Task<EmailSendOutcome> SendAsync(UserInvitation invitation, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(invitation);

        // Refused before the accept link is even built. `.test`, `.invalid` and `example.com`
        // are reserved by RFC precisely so that no mailbox exists behind them, so SES's only
        // possible answer is a hard bounce -- and this platform's bounce rate is scored against
        // an AWS account shared with five other TIMS products. The seeded demo tenant is full
        // of exactly these addresses.
        //
        // Permanent, so the endpoint leaves the row `pending` and POST /invitations/{id}/resend
        // stays available once someone fixes the address. Composing first would also mint a
        // live invitation token into a message with nowhere to go.
        if (UndeliverableAddresses.ReservedDomainOf(invitation.Email) is { } reservedDomain)
        {
            logger.LogError(
                "Invitation {InvitationId} is addressed to the reserved domain {ReservedDomain}, which can never receive "
                + "mail; no send was attempted. The invitation row is committed and remains redeemable through its link.",
                invitation.Id,
                reservedDomain);

            return EmailSendOutcome.PermanentFailure(UndeliverableAddresses.ReasonFor(invitation.Email));
        }

        var acceptUrl = options.LinkTo(string.Format(
            CultureInfo.InvariantCulture,
            InvitationEmailComposer.AcceptPathTemplate,
            Uri.EscapeDataString(invitation.InvitationToken)));

        var message = InvitationEmailComposer.Compose(invitation, acceptUrl);
        if (message is null)
        {
            // A shareable self-signup link has no addressee; the admin distributes it. Not a
            // failure, and not silent either -- it is the one case where "no mail was sent"
            // is the correct outcome and should be recognisable in the logs as such.
            logger.LogInformation(
                "Invitation {InvitationId} has no email address (type {InvitationType}); it is a shareable link and no mail was sent.",
                invitation.Id,
                invitation.InvitationType);

            // Defensive: the endpoints check for an addressee before calling, precisely so a
            // link-type invitation is never recorded as sent. If this is ever reached from a
            // new caller, `Delivered: false` is the truthful answer -- no mail was delivered
            // -- and permanent because no retry gives this invitation an address.
            return EmailSendOutcome.PermanentFailure(
                "The invitation has no email address; it is a shareable link and is distributed by the admin.");
        }

        var outcome = await transport.SendAsync(message, cancellationToken).ConfigureAwait(false);

        if (outcome.Delivered)
        {
            // The token is not logged. LoggingInvitationEmailSender logs it because under the
            // stub the token is the only way to complete the flow; once mail actually goes
            // out, an invitation token in the application log is a credential in the
            // application log.
            logger.LogInformation(
                "Sent invitation {InvitationId} (type {InvitationType}) by email; it expires {ExpiresAt}.",
                invitation.Id,
                invitation.InvitationType,
                invitation.ExpiresAt);
            return outcome;
        }

        logger.Log(
            outcome.Permanent ? LogLevel.Error : LogLevel.Warning,
            "Invitation {InvitationId} could not be emailed ({Disposition}): {Reason} " +
            "The invitation row is committed and remains redeemable; POST /invitations/{InvitationId}/resend retries delivery.",
            invitation.Id,
            outcome.Permanent ? "permanent" : "transient",
            outcome.FailureReason,
            invitation.Id);

        return outcome;
    }
}
