namespace ClimateProject.Application.Surveys;

/// <summary>
/// Who has answered a survey and who has not -- never what anybody answered.
/// </summary>
/// <remarks>
/// <para>
/// There is no answer, score or free-text anywhere in this shape. What it does carry, since
/// the mass invite made a roster of 800 named accounts the thing an administrator watches all
/// launch day, is each invited person's <b>state</b> on this survey and the demographics that
/// were imported with them -- both already the administrator's to see, neither joined to a
/// single answer.
/// </para>
/// <para>
/// <see cref="Roster"/> is the one computation; <see cref="Answered"/> and <see cref="Pending"/>
/// are projections of it unioned with the accountless respondents in
/// <c>survey_participations</c>, kept because the Participación panel reads them. They cannot
/// drift from the roster because they are derived from it in the same pass.
/// </para>
/// </remarks>
/// <param name="CollectsParticipantIdentity">
/// The survey's own setting, so the screen can say why the list is empty when it is off.
/// </param>
/// <param name="Pending">
/// Everyone on the roster who has not completed, plus the company's other active users with an
/// email and no participation row. Matched on the lower-cased email, because that is the only
/// thing a respondent with no account and a user row have in common.
/// </param>
/// <param name="StartedCount">
/// People who opened the survey, answered something and did not finish. Counted separately
/// because they are the ones worth chasing: they are not refusing, they were interrupted.
/// </param>
/// <param name="TracksIndividuals">
/// Whether the FULL three states can be known: finished, started-and-stopped, never opened.
///
/// <para>
/// True for a survey that stores a <c>user_id</c> on its answers, and -- since 2026-10-15 --
/// for an ANONYMOUS one too, by a different route. This used to say started-and-stopped was
/// unknowable there, on the grounds that a half-finished anonymous response belongs to nobody.
/// That was wrong: it carries the DERIVED session id, because that is what lets the person
/// resume it on another device, and computing the same id per account finds the row again. See
/// <see cref="SurveyResumeSession"/>, including why this costs no more privacy than resume.
/// </para>
/// <para>
/// False when no resume key is configured, and false for an anonymous survey that is
/// answerable WITHOUT signing in. The second is decided from the data: a QR or public-link
/// respondent signs in to nothing, so their response carries a random session id matching no
/// account's derived id -- and while any such row exists, an account with no row of its own
/// might be one of them, so "never opened it" would invent the one fact an anonymous survey
/// cannot have. The roster then falls back whole to two states rather than serving a
/// <c>started</c> row with no <c>not_started</c> beside it, which is a filter set the screen
/// cannot render coherently.
/// </para>
/// <para>
/// It is self-correcting rather than a setting: a mass invite with nobody answering yet has no
/// unattributable rows and reports three states, and the moment somebody answers through a link
/// it drops back to two.
/// </para>
/// </param>
/// <param name="TracksCompletionOnly">
/// Whether COMPLETION alone can be known, which is a different question and on an anonymous
/// survey the answer is yes.
///
/// <para>
/// Completion is recorded in <c>survey_participations</c> -- a name, an email and a calendar
/// day, with no response id, no session id and no timestamp -- which is a separate table from
/// the answers with nothing to join them by. So an anonymous survey can tell an administrator
/// who has finished and who has not, which is the whole of what the client asked for ("ya
/// respondió sí o no"), while still keeping the promise the respondent was given:
/// *registramos que usted respondió, nunca qué respondió*.
/// </para>
/// <para>
/// When this is true and <see cref="SurveyParticipationView.TracksIndividuals"/> is false, the
/// roster carries two states and not three: <c>completed</c> and
/// <see cref="SurveyParticipantStatuses.NotCompleted"/>. Since 2026-10-15 that pairing means
/// one specific thing -- an anonymous survey with no resume key configured -- rather than every
/// anonymous survey.
/// </para>
/// </param>
/// <param name="CredentialMode">
/// How this survey's people sign in: <c>shared</c> (one account per person) or
/// <c>per_survey</c> (one key per person per survey), as frozen on the survey at create time.
/// The roster reads differently in each: a per-survey person has no account username and signs
/// in with <see cref="SurveyRosterRow.SurveyUsername"/>.
/// </param>
/// <param name="SurveyTitleEn">The survey's title, so a screen can name it in a confirmation without a second request.</param>
public sealed record SurveyParticipationView(
    Guid SurveyId,
    bool CollectsParticipantIdentity,
    int AnsweredCount,
    int PendingCount,
    IReadOnlyList<SurveyParticipantRow> Answered,
    IReadOnlyList<SurveyPendingParticipantRow> Pending,
    int StartedCount,
    int NotStartedCount,
    IReadOnlyList<SurveyRosterRow> Roster,
    bool TracksIndividuals,
    bool TracksCompletionOnly,
    string CredentialMode = "shared",
    string? SurveyTitleEn = null,
    string? SurveyTitleEs = null);

/// <param name="ParticipatedOn">A calendar day, never a time: the row holds no more.</param>
public sealed record SurveyParticipantRow(string Name, string? Email, DateOnly ParticipatedOn);

public sealed record SurveyPendingParticipantRow(string Name, string Email);

/// <summary>
/// Where one invited person stands on ONE survey.
/// </summary>
/// <remarks>
/// Three states and not two. "Pendiente" used to mean both "never opened it" and "answered
/// half of it and was interrupted", and those call for opposite actions: the first person
/// needs their sign-in details again, the second already has them and needs a nudge. An
/// administrator chasing 800 people cannot tell them apart from a single pending list.
/// </remarks>
public static class SurveyParticipantStatuses
{
    /// <summary>Has a complete response on this survey.</summary>
    public const string Completed = "completed";

    /// <summary>
    /// Has a response row that is not complete. Derived from <c>responses</c>, never from
    /// <c>survey_invitations.status</c>: that column's <c>started</c> is written only by the
    /// token-addressed route, which a respondent who signs in with a username never passes
    /// through, so for a mass invite it is never set.
    /// </summary>
    public const string Started = "started";

    /// <summary>Has no response row at all for this survey.</summary>
    public const string NotStarted = "not_started";

    /// <summary>
    /// Has not finished, and whether they started is <b>not known</b>. The state an ANONYMOUS
    /// survey can honestly report about somebody it has no completion record for.
    ///
    /// <para>
    /// It exists because <see cref="NotStarted"/> would be a lie there. An anonymous survey
    /// puts no <c>user_id</c> on its answers, so a half-finished response cannot be attributed
    /// to anyone -- but a COMPLETION can, because it is recorded in <c>survey_participations</c>
    /// apart from the answers. So "finished" and "did not finish" are both knowable while
    /// "opened it and stopped" is not, and this is the second of those two.
    /// </para>
    /// </summary>
    public const string NotCompleted = "not_completed";
}

/// <param name="Field">The stable key, e.g. <c>department</c>; the labels are for display.</param>
public sealed record SurveyRosterDemographic(string Field, string? LabelEn, string? LabelEs, string Value);

/// <summary>
/// One invited person's row: who they are, how they sign in, where they stand, and the
/// demographics that were imported with them.
/// </summary>
/// <remarks>
/// <para>
/// <paramref name="Username"/> is here for the launch-day phone call. The password is
/// discarded after hashing, so the username is the only half of a mass invite's credentials
/// anyone can read back; null for an account whose holder chose their own password.
/// </para>
/// <para>
/// <paramref name="Demographics"/> is this person's OWN imported profile
/// (<c>user_demographics</c>), not the cohort snapshotted onto any response. It is the
/// spreadsheet row the administrator uploaded, shown back to them, and carries no link to an
/// answer -- which is why the small-group floor does not apply to it: nothing here is a
/// result.
/// </para>
/// <para>
/// <paramref name="LastActivityOn"/> is a calendar DAY, never an instant, on an identified
/// survey too (ruled 2026-10-12): a per-person timestamp that lines up with
/// <c>responses.completion_time</c> is the join that would un-anonymise the response.
/// </para>
/// <para>
/// <paramref name="SurveyUsername"/>, <paramref name="CredentialIssuedOn"/> and
/// <paramref name="LastSignInOn"/> describe this person's KEY for this survey
/// (<c>survey_credentials</c>) and are filled only on a <c>per_survey</c> survey; all three are
/// null for somebody who holds no key. Days in the company's zone, never instants, for the
/// same reason as <paramref name="LastActivityOn"/>: a sign-in instant sits seconds before a
/// response's first save, and that is the join the 2026-10-12 ruling forbids. Answers
/// "was it mailed" and "did they ever get in" -- the question an anonymous survey otherwise
/// cannot answer -- and nothing finer.
/// </para>
/// </remarks>
public sealed record SurveyRosterRow(
    Guid UserId,
    string Name,
    string Email,
    string? Username,
    string Role,
    string Status,
    DateOnly? LastActivityOn,
    IReadOnlyList<SurveyRosterDemographic> Demographics,
    string? SurveyUsername = null,
    DateOnly? CredentialIssuedOn = null,
    DateOnly? LastSignInOn = null);
