using ClimateProject.Application.Auth;
using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Scheduling;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Surveys;

/// <summary>
/// The company columns a per-survey credentials email is composed from. A record so a query
/// can project straight into it and both callers read the same five columns.
/// </summary>
/// <param name="Timezone">The company's zone, which the survey's close is printed in.</param>
public sealed record SurveyCredentialCompany(
    string Name, string? Language, string? LogoUrl, string? PrimaryColor, string? Timezone);

/// <summary>
/// Everything about ONE survey's credentials email that does not depend on the person: the
/// company's language, its brand, the survey's title in that language, and the day it closes
/// in the company's zone.
/// </summary>
public sealed record SurveyCredentialMail(
    string? CompanyLanguage, EmailBrand Brand, string? SurveyTitle, string UsernamePrefix, DateOnly SurveyClosesOn);

/// <summary>
/// Minting and mailing a per-survey key (<see cref="SurveyCredential"/>), shared by the two
/// routes that do it: the invite step (<c>POST /surveys/{id}/invitations</c>), which mints a
/// key for somebody who holds none, and the reissue
/// (<c>POST /surveys/{id}/credentials/{userId}/reissue</c>), which replaces the password of
/// a key that was mailed and never used.
///
/// <para>
/// One helper rather than two copies because the two must not drift: a reissued key that was
/// generated, hashed or mailed differently from an invited one is a second kind of key, and
/// the person holding it cannot tell which one they have.
/// </para>
///
/// <para>
/// Nothing here touches the database -- the Application layer has no context -- so the
/// callers own the rows and the order of save and send. Both save before they send: a
/// password that no row backs would sign nobody in.
/// </para>
/// </summary>
public static class SurveyCredentialIssuance
{
    /// <summary>The person-independent half of the email, resolved once per request.</summary>
    public static SurveyCredentialMail MailFor(Survey survey, SurveyCredentialCompany? company)
    {
        ArgumentNullException.ThrowIfNull(survey);

        var locale = ContentLanguages.SingleLocaleOf(company?.Language) ?? ContentLanguages.FallbackLocale;
        return new SurveyCredentialMail(
            company?.Language,
            company is null ? EmailBrand.None : new EmailBrand(company.LogoUrl, company.Name, company.PrimaryColor),
            LocalizedContent.ResolveText(survey.TitleEn, survey.TitleEs, locale, survey.Language),
            MassInviteCredentials.PrefixFor(company?.Name ?? string.Empty),
            // The DAY it closes on the company's clock, never the UTC date: `EndDate` is an
            // instant, and a close at or after 18:00 in Costa Rica is the next day in UTC --
            // the respondent screens' R2 defect (audit 2026-10-22), which this mail must not
            // reintroduce. A blank or unknown zone resolves to UTC, as every scheduler here does.
            DateOnly.FromDateTime(SchedulingTimeZone.ToLocal(survey.EndDate, SchedulingTimeZone.Resolve(company?.Timezone))));
    }

    /// <summary>
    /// A username not in <paramref name="taken"/>, which it is then added to. The caller loads
    /// <paramref name="taken"/> from BOTH namespaces (<c>users.Username</c> and
    /// <c>survey_credentials.Username</c>): a collision between them would make sign-in
    /// ambiguous about which person and which survey.
    /// </summary>
    public static string NewUsername(string prefix, ISet<string> taken)
    {
        ArgumentNullException.ThrowIfNull(taken);
        string username;
        do
        {
            username = MassInviteCredentials.Username(prefix);
        }
        while (!taken.Add(username));

        return username;
    }

    /// <summary>
    /// A fresh password and its hash. The plaintext must live only until it is mailed; it is
    /// never written anywhere, which is why the send is inline rather than queued.
    /// </summary>
    public static (string Password, string Hash) NewPassword(IPasswordHasher passwordHasher)
    {
        ArgumentNullException.ThrowIfNull(passwordHasher);
        var password = MassInviteCredentials.Password();
        return (password, passwordHasher.Hash(password));
    }

    /// <summary>
    /// Mails one key. The survey's name is always passed: this person may be receiving a second
    /// one of these for another survey, and the subject is the only thing in an inbox that
    /// tells the two apart.
    /// </summary>
    public static Task<EmailSendOutcome> SendAsync(
        ICredentialsEmailSender sender,
        SurveyCredentialMail mail,
        string toEmail,
        string? recipientName,
        string username,
        string password,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(sender);
        ArgumentNullException.ThrowIfNull(mail);
        return sender.SendAsync(
            toEmail, recipientName, username, password, mail.CompanyLanguage,
            mail.Brand, CredentialsEmailPurpose.Invitation, mail.SurveyTitle, mail.SurveyClosesOn, cancellationToken);
    }
}
