using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.OrgStructure;

/// <summary>
/// The invitation sender that runs when no mail provider is configured. It delivers nothing.
///
/// ## It logs neither the address nor the token, and the token is the point
///
/// This line used to read "would send to {Email} ... token {Token}, expires {ExpiresAt}".
/// An invitation token is not merely PII: <c>POST /invitations/accept</c> takes it and
/// creates a working account from it, so it is a bearer credential with a long life. Writing
/// live credentials to application logs puts account access wherever those logs go and
/// keeps it there for as long as they are retained -- which in production had no retention
/// policy at all, so: indefinitely.
///
/// The invitation id is enough to follow one through the logs, and it grants nothing. Whether
/// an address exists at all is worth recording, because a shareable link legitimately has
/// none and that distinguishes the two flows -- but the address itself is not logged either,
/// since an invitee list is exactly the kind of thing this product exists to protect.
/// </summary>
public class LoggingInvitationEmailSender(ILogger<LoggingInvitationEmailSender> logger) : IInvitationEmailSender
{
    public Task SendAsync(UserInvitation invitation, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(invitation);

        logger.LogWarning(
            "Invitation {InvitationId} (type {InvitationType}, {Addressing}) was NOT sent: "
                + "no email provider is configured.",
            invitation.Id,
            invitation.InvitationType,
            invitation.Email is null ? "shareable link" : "addressed");

        return Task.CompletedTask;
    }
}
