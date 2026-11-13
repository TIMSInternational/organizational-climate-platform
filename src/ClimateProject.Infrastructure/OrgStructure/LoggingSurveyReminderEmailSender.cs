using ClimateProject.Application.Email;
using ClimateProject.Application.OrgStructure;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.OrgStructure;

/// <summary>
/// The stand-in when no mail provider is configured. It reports a permanent failure, so the
/// route tells the admin the reminder did not go rather than counting it as sent.
/// </summary>
public sealed class LoggingSurveyReminderEmailSender(
    ILogger<LoggingSurveyReminderEmailSender> logger) : ISurveyReminderEmailSender
{
    public Task<EmailSendOutcome> SendAsync(
        string toEmail, string? recipientName, string username, string? companyLanguage,
        EmailBrand? brand, string? surveyName, CancellationToken cancellationToken)
    {
        logger.LogWarning("A survey reminder was NOT sent: no email provider is configured.");
        return Task.FromResult(EmailSendOutcome.PermanentFailure(LoggingInvitationEmailSender.NotConfiguredReason));
    }
}
