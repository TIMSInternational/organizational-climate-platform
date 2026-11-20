using ClimateProject.Application.Localization;

namespace ClimateProject.Application.Surveys;

// ---------------------------------------------------------------------------
// Paper questionnaires entered by a TIMS operator (ruled 2026-11-19,
// docs/decisions/editable-respondent-content.md, ruling 1).
// ---------------------------------------------------------------------------

/// <summary>
/// What the operator-entry screen draws for one roster person: the survey as that person would
/// be served it (<see cref="SurveyRespondView"/>, built by the same code as the respond GET), and
/// who they are, so the screen can say whose questionnaire is being typed.
/// </summary>
/// <param name="Survey">The respond view for this person: their anonymity, their account (so no self-declared demographics).</param>
/// <param name="UserId">The roster person.</param>
/// <param name="Name">Their name, as the roster shows it.</param>
/// <param name="Email">Their email, as the roster shows it. Read, never written.</param>
public sealed record PaperResponseForm(SurveyRespondView Survey, Guid UserId, string Name, string Email);

/// <summary>
/// The body of <c>POST /surveys/{surveyId}/paper-responses/{userId}</c>: the answers on the
/// paper, in the shape the respondent's own submit takes them, and the language the paper was in.
/// </summary>
/// <remarks>
/// Deliberately not <see cref="SubmitSurveyResponseRequest"/>: an operator entry is always a
/// COMPLETE response, has no session of its own, declares no demographics (the person's account
/// carries them, exactly as when they answer signed in) and names no participant.
/// </remarks>
public sealed record PaperResponseRequest(IReadOnlyList<SurveyAnswerInput>? Answers, string? Language = null);

/// <summary>
/// What an operator entry returns. No response id, on purpose: on an anonymous survey that id
/// would be the link between the person on the roster and their answers.
/// </summary>
/// <param name="Status">The roster status the person now has: always <c>completed</c>.</param>
public sealed record PaperResponseResult(Guid SurveyId, Guid UserId, string Status);

// ---------------------------------------------------------------------------
// Wording-only corrections on a survey with answers (ruled 2026-11-19, ruling 2).
// ---------------------------------------------------------------------------

/// <summary>One option as the editor holds it: the stable value it already has, and its words.</summary>
public sealed record SurveyWordingOptionInput(string? Value, LocalizedInput? Label);

/// <summary>
/// One question of <c>PUT /surveys/{surveyId}/wording</c>: the same shape the questions editor
/// saves, plus the question's id. Everything that is not a word must equal what is stored.
/// </summary>
/// <remarks>
/// A locale left out of a text means "leave it as it is"; an empty string clears it (as on every
/// other survey write, <see cref="LocalizedInput.TryResolve"/>).
/// </remarks>
public sealed record SurveyWordingQuestionInput(
    Guid Id,
    string Type,
    LocalizedInput? Text,
    List<SurveyWordingOptionInput>? Options = null,
    int? ScaleMin = null,
    int? ScaleMax = null,
    LocalizedInput? ScaleLabelMin = null,
    LocalizedInput? ScaleLabelMax = null,
    bool Required = false,
    bool CommentRequired = true,
    LocalizedInput? CommentPrompt = null,
    int Order = 0,
    string? Category = null,
    bool KeepAtEnd = false);

/// <summary>The body of <c>PUT /surveys/{surveyId}/wording</c>: every question of the survey.</summary>
public sealed record SurveyWordingRequest(List<SurveyWordingQuestionInput>? Questions);

/// <param name="ChangedQuestionIds">The questions whose words moved. Empty when nothing did.</param>
/// <param name="Version">The survey's version after the correction (unchanged when nothing moved).</param>
public sealed record SurveyWordingResult(Guid SurveyId, int Version, IReadOnlyList<Guid> ChangedQuestionIds);
