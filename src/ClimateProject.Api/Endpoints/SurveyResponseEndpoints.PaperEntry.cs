using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;

namespace ClimateProject.Api.Endpoints;

public static partial class SurveyResponseEndpoints
{
    /// <summary>
    /// A paper questionnaire typed by a TIMS operator, written as <paramref name="personId"/>'s own
    /// submission (ruled 2026-11-19, <c>docs/decisions/editable-respondent-content.md</c>): the
    /// same respondent the respond flow builds for that person signed in -- their department, the
    /// SURVEY's anonymity -- through the same write path, so validation, the response row, the
    /// answers, the licence seat, the snapshotted demographics, the invitation and the
    /// participation row are exactly what their own submit would leave.
    /// </summary>
    /// <remarks>
    /// <para>The caller (<c>PaperResponseEndpoints</c>) has already decided the operator may do
    /// this, the survey's status allows it and the person is in its population and has not
    /// completed. This only fixes what a paper entry is: complete, a fresh session id (the
    /// respondent's derived one still wins on an anonymous survey, as it does for them), no
    /// declared demographics and no participant -- and no device address or agent, because the
    /// device was the operator's, not the person's.</para>
    /// </remarks>
    internal static Task<IResult> SubmitPaperResponseAsync(
        Survey survey,
        Guid personId,
        Guid? personDepartmentId,
        PaperResponseRequest request,
        IConfiguration configuration,
        ClimateProjectDbContext db,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(survey);
        ArgumentNullException.ThrowIfNull(request);

        return SubmitAsRespondentAsync(
            survey,
            new Respondent(personId, personDepartmentId, survey.Settings.Anonymous),
            new SubmitSurveyResponseRequest(
                Answers: request.Answers,
                SessionId: Guid.NewGuid().ToString("N"),
                IsComplete: true,
                Language: request.Language),
            new SubmissionOrigin(RemoteIp: null, UserAgent: null, OperatorEntry: true),
            configuration,
            db,
            loggerFactory,
            cancellationToken);
    }
}
