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
public sealed record SurveyParticipationView(
    Guid SurveyId,
    bool CollectsParticipantIdentity,
    int AnsweredCount,
    int PendingCount,
    IReadOnlyList<SurveyParticipantRow> Answered,
    IReadOnlyList<SurveyPendingParticipantRow> Pending,
    int StartedCount,
    int NotStartedCount,
    IReadOnlyList<SurveyRosterRow> Roster);

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
/// </remarks>
public sealed record SurveyRosterRow(
    Guid UserId,
    string Name,
    string Email,
    string? Username,
    string Role,
    string Status,
    DateOnly? LastActivityOn,
    IReadOnlyList<SurveyRosterDemographic> Demographics);
