using System.Globalization;
using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Exports;
using ClimateProject.Application.Gdpr;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// <c>GET /admin/exports/responses</c> — every response of every climate, as one workbook.
///
/// ## Why this exists, and what it is not
///
/// Ruled 2026-10-15 by Federico, recorded in
/// <c>docs/decisions/who-may-see-an-individual-answer.md</c>: TIMS builds its work plan on a
/// spreadsheet, not on the product's screens, and needs one row per respondent with their
/// demographics and their answers. That is "Mode C" in that file, and the file's earlier
/// recommendation was against it. The ruling overrides the recommendation; the reasoning the
/// file gives is unchanged and still worth reading before anyone widens this surface.
///
/// What the ruling does NOT do is change what an anonymous survey stored. This endpoint cannot
/// attribute an anonymous response to anybody, because <c>SurveyResponseEndpoints.StoredUserId</c>
/// wrote no user id and there is no column to join on. A sheet for an anonymous climate
/// therefore has no identity columns at all, and RESUMEN says so in words.
///
/// ## Super admin only, and audited every time
///
/// The narrowest role that can serve the purpose. A company admin reading their own tenant's
/// attributable answers is a bigger change to the product's promises than TIMS's own analyst
/// reading them, and nobody has asked for it. <see cref="AuditSensitiveReadAttribute"/> puts a
/// row in <c>audit_logs</c> for every call, as <c>GET /audit/export</c> and <c>GET /gdpr/access</c>
/// already do: a surface that can read one person's answers is one whose use must be reviewable.
/// </summary>
public static class ResponseExportEndpoints
{
    public const string ExportAction = "responses.export";
    public const string ExportResource = "survey_responses";

    /// <summary>
    /// Ceilings, because this runs inside App Runner's 120-second request limit (which is not
    /// configurable — see <c>docs/runbooks/</c>). 800 people x 40 questions is 32,000 answers
    /// for one climate and well inside it; an unbounded platform-wide export is not.
    /// </summary>
    private const int MaxSurveys = 25;
    private const int MaxResponses = 50_000;

    public static void MapResponseExportEndpoints(this WebApplication app)
    {
        app.MapGet("/admin/exports/responses", ExportAsync)
            .RequireAuthorization()
            .WithMetadata(new AuditSensitiveReadAttribute(AuditVerbs.Export));
    }

    /// <summary>
    /// A type whose answer is a choice rather than something the respondent typed. An
    /// unrecognised type counts as OPEN: erring closed is the only direction that cannot print
    /// someone's words, and it is the direction <c>SubjectAccessExport</c> already errs in.
    /// </summary>
    private static bool IsClosedType(string type)
        => QuestionTypes.All.Contains(type, StringComparer.Ordinal)
            && !QuestionTypes.FreeText.Contains(type, StringComparer.Ordinal);

    /// <summary>
    /// Replaced, never removed. A missing cell reads as "this person did not answer", which is
    /// a false statement about the record; the marker says an answer exists and is not shown.
    /// </summary>
    private static string? Withheld(string? value)
        => string.IsNullOrWhiteSpace(value) ? value : SubjectDataMap.WithheldAnswerMarker;

    private static async Task<IResult> ExportAsync(
        Guid? companyId,
        Guid? surveyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IConfiguration configuration,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var actor = principal.GetCurrentUser();
        if (actor.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        audit.Describe(ExportAction, ExportResource);

        var surveyQuery = db.Surveys.AsNoTracking();
        if (companyId is { } company)
        {
            surveyQuery = surveyQuery.Where(s => s.CompanyId == company);
        }

        if (surveyId is { } single)
        {
            surveyQuery = surveyQuery.Where(s => s.Id == single);
        }

        var surveys = await surveyQuery
            .OrderByDescending(s => s.CreatedAt)
            .Take(MaxSurveys)
            .Select(s => new
            {
                s.Id,
                s.CompanyId,
                s.TitleEs,
                s.TitleEn,
                s.Status,
                s.Language,
                s.StartDate,
                s.EndDate,
                Anonymous = s.Settings.Anonymous,
            })
            .ToListAsync(cancellationToken);

        if (surveys.Count == 0)
        {
            return Results.NotFound(new { message = "No surveys matched." });
        }

        var surveyIds = surveys.Select(s => s.Id).ToList();
        var companyIds = surveys.Select(s => s.CompanyId).Distinct().ToList();

        var companies = await db.Companies.AsNoTracking()
            .Where(c => companyIds.Contains(c.Id))
            .ToDictionaryAsync(c => c.Id, c => c.Name, cancellationToken);

        var questions = await db.Questions.AsNoTracking()
            .Where(q => surveyIds.Contains(q.SurveyId))
            .OrderBy(q => q.SurveyId).ThenBy(q => q.Order)
            .Select(q => new { q.Id, q.SurveyId, q.Order, q.Type, q.Category, q.TextEs, q.TextEn })
            .ToListAsync(cancellationToken);

        var questionTypes = questions.ToDictionary(q => q.Id, q => q.Type);

        var responses = await db.Responses.AsNoTracking()
            .Where(r => surveyIds.Contains(r.SurveyId))
            .OrderBy(r => r.SurveyId).ThenBy(r => r.StartTime)
            .Take(MaxResponses)
            .Select(r => new
            {
                r.Id,
                r.SurveyId,
                r.UserId,
                r.DepartmentId,
                r.StartTime,
                r.CompletionTime,
                r.IsComplete,
                r.TotalTimeSeconds,
            })
            .ToListAsync(cancellationToken);

        var responseIds = responses.Select(r => r.Id).ToList();

        var answers = await db.QuestionResponses.AsNoTracking()
            .Where(a => responseIds.Contains(a.ResponseId))
            .Select(a => new { a.ResponseId, a.QuestionId, a.ResponseValue, a.ResponseText })
            .ToListAsync(cancellationToken);

        var demographics = await db.ResponseDemographics.AsNoTracking()
            .Where(d => responseIds.Contains(d.ResponseId))
            .Select(d => new { d.ResponseId, d.Field, d.Value })
            .ToListAsync(cancellationToken);

        var departmentIds = responses.Where(r => r.DepartmentId is not null)
            .Select(r => r.DepartmentId!.Value).Distinct().ToList();
        var departments = await db.Departments.AsNoTracking()
            .Where(d => departmentIds.Contains(d.Id))
            .ToDictionaryAsync(d => d.Id, d => d.Name, cancellationToken);

        // Only for surveys that are NOT anonymous. An anonymous response has no user id to
        // look up, so this set is empty for them by construction rather than by filtering.
        var userIds = responses.Where(r => r.UserId is not null)
            .Select(r => r.UserId!.Value).Distinct().ToList();
        var users = await db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .Select(u => new { u.Id, u.Name, u.Email, u.Username })
            .ToDictionaryAsync(u => u.Id, u => u, cancellationToken);

        var answersByResponse = answers.GroupBy(a => a.ResponseId)
            .ToDictionary(g => g.Key, g => g.ToList());
        // `response_demographics.value` is jsonb, exactly like `question_responses.response_value`
        // — the write side serialises through `JsonSerializer.Serialize`, so the stored payload is
        // a JSON string and not a bare one. The aggregate loader passes it through raw because
        // SurveyAggregation owns the decoding; a spreadsheet has no such owner, so it is decoded
        // here or the reader sees `"4_a_6_anos"` with the quotes in the cell.
        var demographicsByResponse = demographics.GroupBy(d => d.ResponseId)
            .ToDictionary(
                g => g.Key,
                g => g.ToDictionary(
                    d => d.Field,
                    d => SurveyResponseValues.Read(d.Value).Value ?? d.Value,
                    StringComparer.Ordinal));

        // The roster's own derivation of who has not finished, reused rather than restated —
        // `SurveyParticipationEndpoints.BuildRosterAsync` is what the Distribución screen reads,
        // and the status report has to agree with the screen somebody is looking at.
        var resumeKey = SurveyResumeSessionConfiguration.KeyFrom(configuration);

        var model = new List<ResponseExportSurvey>(surveys.Count);
        foreach (var survey in surveys)
        {
            var (roster, _) = await SurveyParticipationEndpoints.BuildRosterAsync(
                survey.Id, survey.CompanyId, survey.Anonymous, resumeKey, db, cancellationToken);
            var pending = roster
                .Where(r => r.Status != SurveyParticipantStatuses.Completed)
                .OrderBy(r => r.Name, SurveyParticipationEndpoints.NameOrder)
                .Select(r => new ResponseExportPending(r.Name, r.Email, r.Username, r.Status, r.LastActivityOn))
                .ToList();

            var spanish = survey.Language != "en";
            var surveyQuestions = questions.Where(q => q.SurveyId == survey.Id).ToList();
            var exportQuestions = surveyQuestions
                .Select((q, index) => new ResponseExportQuestion(
                    q.Id,
                    q.Order,
                    "P" + (index + 1).ToString("00", CultureInfo.InvariantCulture),
                    q.Category,
                    q.Type,
                    (spanish ? q.TextEs ?? q.TextEn : q.TextEn ?? q.TextEs) ?? ""))
                .ToList();

            var rows = responses.Where(r => r.SurveyId == survey.Id)
                .Select(r =>
                {
                    var user = r.UserId is { } id && users.TryGetValue(id, out var found) ? found : null;
                    var rowAnswers = answersByResponse.GetValueOrDefault(r.Id, [])
                        .Select(a =>
                        {
                            // The SAME withholding rule `GET /gdpr/access` applies when an
                            // administrator reads somebody else's record, reused rather than
                            // restated: ruled 2026-10-12 in
                            // docs/decisions/who-may-see-an-individual-answer.md. Two surfaces
                            // that both decide what a reader may see, each with its own copy of
                            // the rule, are one edit away from disagreeing -- and the direction
                            // they disagree in is somebody's words in a spreadsheet.
                            var closed = questionTypes.TryGetValue(a.QuestionId, out var type) && IsClosedType(type);
                            var value = SurveyResponseValues.Read(a.ResponseValue).Value;
                            return new ResponseExportAnswer(
                                a.QuestionId,
                                closed ? value : Withheld(value),
                                Withheld(a.ResponseText));
                        })
                        .ToList();

                    return new ResponseExportRow(
                        r.Id,
                        user?.Name,
                        user?.Email,
                        user?.Username,
                        r.DepartmentId is { } department ? departments.GetValueOrDefault(department) : null,
                        demographicsByResponse.GetValueOrDefault(r.Id, new Dictionary<string, string>(StringComparer.Ordinal)),
                        r.StartTime,
                        r.CompletionTime,
                        r.IsComplete,
                        r.TotalTimeSeconds,
                        rowAnswers);
                })
                .ToList();

            model.Add(new ResponseExportSurvey(
                survey.Id,
                companies.GetValueOrDefault(survey.CompanyId, ""),
                (spanish ? survey.TitleEs ?? survey.TitleEn : survey.TitleEn ?? survey.TitleEs) ?? "",
                survey.Status,
                survey.Anonymous,
                survey.StartDate,
                survey.EndDate,
                exportQuestions,
                rows,
                pending));
        }

        // Said in the file, not only in this comment. A reader who is handed a workbook has no
        // way to know a ceiling was reached unless it tells them, and the failure mode is an
        // analysis presented as the whole platform when it is the newest 25 climates of it.
        var notes = new List<string>();
        if (surveys.Count == MaxSurveys)
        {
            notes.Add($"Solo se incluyen los {MaxSurveys} climas más recientes. Filtre por empresa o por clima para ver los demás.");
        }

        if (responses.Count == MaxResponses)
        {
            notes.Add($"Se alcanzó el límite de {MaxResponses} respuestas; faltan respuestas más recientes. Filtre por clima.");
        }

        var bytes = ResponseWorkbook.Build(
            model, DateTimeOffset.UtcNow, notes.Count == 0 ? null : string.Join(" ", notes));
        return Results.File(
            bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "respuestas-clima.xlsx");
    }
}
