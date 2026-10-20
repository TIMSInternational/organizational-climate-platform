using ClimateProject.Application.Email;
using ClimateProject.Application.OrgStructure;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.OrgStructure;

/// <summary>
/// The stand-in when no mail provider is configured. It reports a permanent failure, so the
/// import tells the admin the email did not go, and it logs nothing that signs anyone in.
/// </summary>
public sealed class LoggingCredentialsEmailSender(ILogger<LoggingCredentialsEmailSender> logger) : ICredentialsEmailSender
{
    public Task<EmailSendOutcome> SendAsync(
        string toEmail, string? recipientName, string username, string password, string? companyLanguage,
        EmailBrand? brand, CredentialsEmailPurpose purpose, string? surveyName, CancellationToken cancellationToken)
    {
        logger.LogWarning("Sign-in details for a mass-invite account were NOT sent: no email provider is configured.");
        return Task.FromResult(EmailSendOutcome.PermanentFailure(LoggingInvitationEmailSender.NotConfiguredReason));
    }
}
