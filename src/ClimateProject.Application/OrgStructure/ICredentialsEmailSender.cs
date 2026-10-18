using ClimateProject.Application.Email;

namespace ClimateProject.Application.OrgStructure;

/// <summary>
/// Delivers a mass invite's generated username and password (<see cref="CredentialsEmailComposer"/>).
/// Returns what the attempt did, like <see cref="IInvitationEmailSender"/>, so the import can tell
/// the admin which people did not get their email.
/// </summary>
public interface ICredentialsEmailSender
{
    /// <param name="purpose">
    /// Which message to carry. Required, with no default: the bulk resend behind the roster is a
    /// <see cref="CredentialsEmailPurpose.Reminder"/> and the import is an
    /// <see cref="CredentialsEmailPurpose.Invitation"/>, and a caller that did not have to choose
    /// would quietly send the wrong one -- which is precisely the defect this parameter fixes.
    /// </param>
    /// <param name="recipientName">
    /// Who to greet, as the roster spells it, or null for an account carrying no name. Already
    /// on the account, so nothing is asked of anybody to obtain it.
    /// </param>
    /// <param name="brand">
    /// The company's logo, name and accent, as the columns hold them -- the logo path is
    /// resolved against the app's base URL by the implementation, which is the only layer that
    /// knows the host. Required, with no default, for <paramref name="purpose"/>'s reason: a
    /// caller that already has the company row in hand should not be able to send its people an
    /// unbranded message by leaving an argument off. Pass
    /// <see cref="ClimateProject.Application.Email.EmailBrand.None"/> to mean it deliberately.
    /// </param>
    Task<EmailSendOutcome> SendAsync(
        string toEmail, string? recipientName, string username, string password, string? companyLanguage,
        EmailBrand? brand, CredentialsEmailPurpose purpose, CancellationToken cancellationToken);
}
