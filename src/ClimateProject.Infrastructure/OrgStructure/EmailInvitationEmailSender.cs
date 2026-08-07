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
/// **Failures are logged, not thrown, and not surfaced to the caller.**
/// <c>IInvitationEmailSender.SendAsync</c> returns a bare <c>Task</c>, so it has no vocabulary
/// for "the provider refused this address" -- and as of #100 the endpoints call it *after* the
/// invitation row is committed. Throwing would turn a persisted invitation into a 500 on a
/// request that had already succeeded, leaving the admin unable to tell what state anything is
/// in; the invitation is still redeemable through its link, and <c>POST
/// /invitations/{id}/resend</c> exists precisely for a retry. Giving invitations the same
/// persisted delivery status notifications have is a schema change and therefore a separate
/// issue -- see the PR for why it is not smuggled in here.
/// </para>
/// </summary>
public sealed class EmailInvitationEmailSender(
    IEmailTransport transport,
    EmailOptions options,
    ILogger<EmailInvitationEmailSender> logger) : IInvitationEmailSender
{
    public async Task SendAsync(UserInvitation invitation, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(invitation);

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
            return;
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
            return;
        }

        logger.Log(
            outcome.Permanent ? LogLevel.Error : LogLevel.Warning,
            "Invitation {InvitationId} could not be emailed ({Disposition}): {Reason} " +
            "The invitation row is committed and remains redeemable; POST /invitations/{InvitationId}/resend retries delivery.",
            invitation.Id,
            outcome.Permanent ? "permanent" : "transient",
            outcome.FailureReason,
            invitation.Id);
    }
}
