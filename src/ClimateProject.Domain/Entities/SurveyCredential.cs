namespace ClimateProject.Domain.Entities;

/// <summary>
/// One person's sign-in for ONE survey: the key that opens a single survey and nothing else.
///
/// <para>
/// ESPH asked, on 2026-10-19, that a person in two surveys receive two emails with two
/// different usernames and two different passwords, because Clima and Teletrabajo have
/// different leaders. The platform's account is the opposite shape: one
/// <c>users.Username</c> and one <c>users.PasswordHash</c>, opening every survey that
/// person is targeted by.
/// </para>
///
/// <para><b>Why a credential row and not a second user row.</b> "One email, several
/// usernames" reads like several rows in <c>users</c>, and that is exactly what it must not
/// be: <c>users.Email</c> carries a GLOBAL unique index (<c>UserConfiguration</c>), relied
/// on by signup, by login, by the bulk importer's duplicate detection and by invitation
/// minting. Three real ESPH roster rows are already burned because that uniqueness is
/// global and a rehearsal consumed their addresses. Relaxing it to buy a second row per
/// person would pay a constraint the product depends on for nothing a row here does not
/// already give.
/// </para>
///
/// <para>
/// It does not have to be paid, because the respondent path <b>already authenticates by
/// username</b> — <c>AuthEndpoints</c> matches an identifier against <c>users.Email</c> OR
/// <c>users.Username</c>, and the credentials mail a mass-invited respondent receives
/// prints <c>Usuario</c>, never their address. So identity stays on the user, one row per
/// person, one email address; the KEY moves to the survey.
/// </para>
///
/// <para><b>The uniqueness that matters.</b> <c>(SurveyId, UserId)</c> — one key per person
/// per survey, the same grain as <c>SurveyInvitation</c> — and <c>Username</c>, which
/// shares a namespace with <c>users.Username</c> so that a single lookup at sign-in can
/// never be ambiguous. <b>Email appears in neither</b>, which is precisely what lets one
/// address carry as many credentials as it has surveys.
/// </para>
///
/// <para>
/// Only companies (or surveys) in <c>per_survey</c> credential mode mint these. In
/// <c>shared</c> mode — the default, and what every client before ESPH asked for — nothing
/// is written here and the account on <c>users</c> keeps opening everything.
/// </para>
///
/// <para>⚠️ Session invalidation is the user's, not the credential's. A JWT carries
/// <c>user.SecurityStamp</c>, so rotating ONE survey credential cannot by itself end a
/// session opened with it without ending that person's other sessions too. No caller
/// rotates a survey credential yet; whoever adds one has to decide that, and the choice is
/// not implied by this table.</para>
/// </summary>
public class SurveyCredential
{
    public Guid SurveyId { get; set; }

    public Guid UserId { get; set; }

    /// <summary>
    /// The identifier the respondent types. Minted by <c>MassInviteCredentials.Username</c>,
    /// the same generator the account username uses, and deduped against both namespaces —
    /// a collision with a <c>users.Username</c> would make sign-in ambiguous.
    /// </summary>
    public string Username { get; set; } = string.Empty;

    /// <summary>bcrypt, work factor 12, as everywhere else. The plaintext never lands here.</summary>
    public string PasswordHash { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>
    /// Null until it is first used. Not security state — it is how an administrator can see
    /// that a credential arrived and was used, on a survey where responses are anonymous and
    /// cannot answer that question.
    /// </summary>
    public DateTimeOffset? LastSignInAt { get; set; }
}

/// <summary>
/// How a company (or one survey) hands out sign-ins. Ruled 2026-10-19; the default is
/// <see cref="Shared"/>, which is what the product did before the ruling existed.
/// </summary>
public static class CredentialModes
{
    /// <summary>
    /// One account per person, opening every survey they are targeted by. One credentials
    /// email, total. The product's behaviour since mass invites existed.
    /// </summary>
    public const string Shared = "shared";

    /// <summary>
    /// One <see cref="SurveyCredential"/> per person per survey, and one credentials email
    /// per survey, each naming its survey in the subject.
    /// </summary>
    public const string PerSurvey = "per_survey";

    public static readonly IReadOnlyList<string> All = [Shared, PerSurvey];

    public static bool IsValid(string? mode) => mode is not null && All.Contains(mode);

    /// <summary>
    /// A survey's own mode, else the company's, else <see cref="Shared"/>. Resolved once at
    /// survey-create time and frozen onto the row, which is how <c>Language</c> does it —
    /// the one company-default-survey-override in this codebase that is actually wired.
    /// Resolving at read time would let a company settings change silently re-shape a survey
    /// whose credentials have already been mailed.
    /// </summary>
    public static string Resolve(string? surveyMode, string? companyMode)
        => IsValid(surveyMode) ? surveyMode!
         : IsValid(companyMode) ? companyMode!
         : Shared;
}
