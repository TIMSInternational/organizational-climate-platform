using ClimateProject.Application.Email;
using ClimateProject.Application.OrgStructure;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.OrgStructure;

/// <summary>
/// Real delivery of a mass invite's credentials, through the same transport, credential and
/// rate limit as every other mail. Nothing it logs carries the address, the username or the
/// password: a credential in the application log is a credential anyone with log access holds.
/// </summary>
public sealed class EmailCredentialsEmailSender(
    IEmailTransport transport,
    EmailOptions options,
    ILogger<EmailCredentialsEmailSender> logger) : ICredentialsEmailSender
{
    public async Task<EmailSendOutcome> SendAsync(
        string toEmail, string? recipientName, string username, string password, string? companyLanguage,
        EmailBrand? brand, CredentialsEmailPurpose purpose, CancellationToken cancellationToken)
    {
        // Refused before composing, for InvitationEmailComposer's reason: a reserved domain can
        // only hard-bounce, and the bounce rate is scored against a shared sending account.
        if (UndeliverableAddresses.ReservedDomainOf(toEmail) is { } reservedDomain)
        {
            logger.LogError(
                "Sign-in details for a mass-invite account were not sent: the address is on the reserved domain {ReservedDomain}.",
                reservedDomain);
            return EmailSendOutcome.PermanentFailure(UndeliverableAddresses.ReasonFor(toEmail));
        }

        var message = CredentialsEmailComposer.Compose(
            toEmail, recipientName, username, password, options.LinkTo(CredentialsEmailComposer.LoginPath),
            // The stored logo is a root-relative path; only this layer holds the base URL it has
            // to be resolved against before a mail client can fetch it.
            companyLanguage, purpose, brand?.ResolvedAgainst(options));
        var outcome = await transport.SendAsync(message, cancellationToken).ConfigureAwait(false);

        if (!outcome.Delivered)
        {
            logger.Log(
                outcome.Permanent ? LogLevel.Error : LogLevel.Warning,
                "Sign-in details for a mass-invite account could not be emailed ({Disposition}): {Reason}",
                outcome.Permanent ? "permanent" : "transient",
                outcome.FailureReason);
        }

        return outcome;
    }
}
