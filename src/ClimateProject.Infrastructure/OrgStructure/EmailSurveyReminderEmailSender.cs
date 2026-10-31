using ClimateProject.Application.Email;
using ClimateProject.Application.OrgStructure;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.OrgStructure;

/// <summary>
/// Real delivery of a no-password reminder, through the same transport, credential and rate
/// limit as every other mail. Nothing it logs carries the address or the username.
/// </summary>
public sealed class EmailSurveyReminderEmailSender(
    IEmailTransport transport,
    EmailOptions options,
    ILogger<EmailSurveyReminderEmailSender> logger) : ISurveyReminderEmailSender
{
    public async Task<EmailSendOutcome> SendAsync(
        string toEmail, string? recipientName, string username, string? companyLanguage,
        EmailBrand? brand, string? surveyName, CancellationToken cancellationToken)
    {
        // Refused before composing, for the credentials sender's reason: a reserved domain can
        // only hard-bounce, and the bounce rate is scored against a shared sending account.
        if (UndeliverableAddresses.ReservedDomainOf(toEmail) is { } reservedDomain)
        {
            logger.LogError(
                "A survey reminder was not sent: the address is on the reserved domain {ReservedDomain}.",
                reservedDomain);
            return EmailSendOutcome.PermanentFailure(UndeliverableAddresses.ReasonFor(toEmail));
        }

        var message = SurveyReminderEmailComposer.Compose(
            toEmail, recipientName, username, options.LinkTo(SurveyReminderEmailComposer.LoginPath),
            // The stored logo is a root-relative path; only this layer holds the base URL it has
            // to be resolved against before a mail client can fetch it.
            companyLanguage, brand?.ResolvedAgainst(options), surveyName);
        var outcome = await transport.SendAsync(message, cancellationToken).ConfigureAwait(false);

        if (!outcome.Delivered)
        {
            logger.Log(
                outcome.Permanent ? LogLevel.Error : LogLevel.Warning,
                "A survey reminder could not be emailed ({Disposition}): {Reason}",
                outcome.Permanent ? "permanent" : "transient",
                outcome.FailureReason);
        }

        return outcome;
    }
}
