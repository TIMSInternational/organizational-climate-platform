using ClimateProject.Application.Email;

namespace ClimateProject.Application.OrgStructure;

/// <summary>
/// Delivers a mass invite's generated username and password (<see cref="CredentialsEmailComposer"/>).
/// Returns what the attempt did, like <see cref="IInvitationEmailSender"/>, so the import can tell
/// the admin which people did not get their email.
/// </summary>
public interface ICredentialsEmailSender
{
    Task<EmailSendOutcome> SendAsync(
        string toEmail, string username, string password, string? companyLanguage, CancellationToken cancellationToken);
}
