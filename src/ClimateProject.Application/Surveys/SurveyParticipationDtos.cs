namespace ClimateProject.Application.Surveys;

/// <summary>
/// Who has answered a survey and who has not -- never what anybody answered.
/// </summary>
/// <remarks>
/// Built from <c>survey_participations</c> and the company's user rows only. There is no
/// response, answer or demographic anywhere in this shape, and the endpoint that serves it
/// reads none: the guarantee is that there is nothing here to leak, not that it is filtered.
/// </remarks>
/// <param name="CollectsParticipantIdentity">
/// The survey's own setting, so the screen can say why the list is empty when it is off.
/// </param>
/// <param name="Pending">
/// The company's ACTIVE users with an email who have no participation row for this survey.
/// Matched on the lower-cased email, because that is the only thing a respondent with no
/// account and a user row have in common.
/// </param>
public sealed record SurveyParticipationView(
    Guid SurveyId,
    bool CollectsParticipantIdentity,
    int AnsweredCount,
    int PendingCount,
    IReadOnlyList<SurveyParticipantRow> Answered,
    IReadOnlyList<SurveyPendingParticipantRow> Pending);

/// <param name="ParticipatedOn">A calendar day, never a time: the row holds no more.</param>
public sealed record SurveyParticipantRow(string Name, string? Email, DateOnly ParticipatedOn);

public sealed record SurveyPendingParticipantRow(string Name, string Email);
