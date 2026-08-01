using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.OrgStructure;

public class LoggingInvitationEmailSender(ILogger<LoggingInvitationEmailSender> logger) : IInvitationEmailSender
{
    public Task SendAsync(UserInvitation invitation, CancellationToken cancellationToken)
    {
        logger.LogInformation(
            "Invitation email stubbed -- would send to {Email} (type {InvitationType}), token {Token}, expires {ExpiresAt}",
            invitation.Email ?? "(no email -- shareable link)",
            invitation.InvitationType,
            invitation.InvitationToken,
            invitation.ExpiresAt);
        return Task.CompletedTask;
    }
}
