using ClimateProject.Application.Email;

namespace ClimateProject.Application.OrgStructure;

/// <summary>
/// Delivers a reminder that carries no password (<see cref="SurveyReminderEmailComposer"/>).
/// Returns what the attempt did, like <see cref="ICredentialsEmailSender"/>, so the route can
/// tell the admin which people did not get their mail.
///
/// <para>
/// Separate from <see cref="ICredentialsEmailSender"/> because it must be IMPOSSIBLE to reach
/// this message with a password in hand: there is no parameter for one. The credentials sender
/// mints and mails a new pair on every call, which is the one thing a reminder to somebody
/// mid-survey must not do.
/// </para>
/// </summary>
public interface ISurveyReminderEmailSender
{
    /// <param name="username">
    /// Printed, and put on the sign-in link so the field arrives filled. Not a secret; the
    /// credentials mail already prints it, and alone it signs nobody in.
    /// </param>
    /// <param name="recipientName">
    /// Accepted and never rendered, as on the credentials path -- see the composer's remarks.
    /// </param>
    /// <param name="surveyName">
    /// Which survey is unfinished, so two reminders in one inbox are distinguishable. Null only
    /// in `shared` mode, where naming one survey would be a lie.
    /// </param>
    Task<EmailSendOutcome> SendAsync(
        string toEmail, string? recipientName, string username, string? companyLanguage,
        EmailBrand? brand, string? surveyName, CancellationToken cancellationToken);
}
