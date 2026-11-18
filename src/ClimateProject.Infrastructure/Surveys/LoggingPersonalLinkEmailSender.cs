using ClimateProject.Application.Email;
using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.OrgStructure;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Surveys;

/// <summary>
/// The stand-in when no mail provider is configured. It reports a permanent failure, so the
/// operator is told the link did not go and the invitation stays unsent, and it logs nothing
/// that would open anybody's survey -- not the token, not the link, not the address.
/// </summary>
public sealed class LoggingPersonalLinkEmailSender(ILogger<LoggingPersonalLinkEmailSender> logger) : IPersonalLinkEmailSender
{
    public Task<EmailSendOutcome> SendAsync(
        string toEmail, string invitationToken, SurveyPersonalLinkMail mail, CancellationToken cancellationToken)
    {
        logger.LogWarning("A personal survey link was NOT sent: no email provider is configured.");
        return Task.FromResult(EmailSendOutcome.PermanentFailure(LoggingInvitationEmailSender.NotConfiguredReason));
    }
}
