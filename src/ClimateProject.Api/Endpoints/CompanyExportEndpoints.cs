using System.Globalization;
using System.IO.Compression;
using System.Security.Claims;
using System.Text;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Exports;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Scheduling;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The «Descargar en Excel» wizard's one route: any mix of the four workbooks, for any of a
/// company's surveys, as one file -- the workbook itself when one is asked for, a .zip of them
/// when several are.
///
/// ## Four files, three of which already existed
///
/// <list type="bullet">
/// <item><b>responses</b> -- the super-admin response workbook (<see cref="ResponseExportEndpoints"/>),
/// the ONE place verbatim answers are returned (ruled 2026-10-16). Refused with 403 to anyone
/// but a super administrator, exactly as its own route refuses it; a company admin's wizard
/// never offers it.</item>
/// <item><b>status</b> -- the company status workbook (<see cref="SurveyParticipationEndpoints"/>),
/// built by the same code its own route uses.</item>
/// <item><b>questionnaire</b> -- new: <see cref="QuestionnaireWorkbook"/>.</item>
/// <item><b>results</b> -- new: <see cref="ResultsWorkbook"/>, aggregates only.</item>
/// </list>
///
/// ## Who
///
/// The company's administrators and TIMS (<see cref="SurveyEndpoints.CanAdminister"/>), as for
/// every results surface; <c>responses</c> additionally needs super_admin. Every download is
/// audited as an export against the company whose data it carries, and one that includes the
/// response workbook is recorded under that workbook's own action, so "who read the answers"
/// has one answer however it was downloaded.
/// </summary>
public static class CompanyExportEndpoints
{
    public const string ResponsesFile = "responses";
    public const string QuestionnaireFile = "questionnaire";
    public const string StatusFile = "status";
    public const string ResultsFile = "results";

    /// <summary>The files, in the order the wizard lists them and the zip holds them.</summary>
    public static readonly IReadOnlyList<string> Files = [ResponsesFile, QuestionnaireFile, StatusFile, ResultsFile];

    private const string XlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    public static void MapCompanyExportEndpoints(this WebApplication app)
    {
        app.MapGet("/admin/companies/{companyId:guid}/exports/bundle", BundleAsync)
            .RequireAuthorization()
            .WithMetadata(new AuditSensitiveReadAttribute(AuditVerbs.Export));
    }

    private static async Task<IResult> BundleAsync(
        Guid companyId,
        [Microsoft.AspNetCore.Mvc.FromQuery(Name = "survey")] Guid[]? surveyIds,
        [Microsoft.AspNetCore.Mvc.FromQuery(Name = "file")] string[]? files,
        [Microsoft.AspNetCore.Mvc.FromQuery(Name = "group")] string[]? groups,
        [Microsoft.AspNetCore.Mvc.FromQuery(Name = "format")] string? statusFormat,
        [Microsoft.AspNetCore.Mvc.FromQuery(Name = "answers")] bool? includeAnswers,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IConfiguration configuration,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var actor = principal.GetCurrentUser();
        if (!SurveyEndpoints.CanAdminister(actor, companyId))
        {
            return Results.Forbid();
        }

        var wanted = (files ?? []).Where(f => !string.IsNullOrWhiteSpace(f)).Select(f => f.Trim()).Distinct(StringComparer.Ordinal).ToList();
        if (wanted.Count == 0)
        {
            return BadRequest($"Name at least one file: {string.Join(", ", Files)}.");
        }

        var unknownFile = wanted.FirstOrDefault(f => !Files.Contains(f, StringComparer.Ordinal));
        if (unknownFile is not null)
        {
            return BadRequest($"Unknown file '{unknownFile}'. Use any of: {string.Join(", ", Files)}.");
        }

        // The response workbook keeps its own door: super_admin only, whatever route reaches it.
        if (wanted.Contains(ResponsesFile, StringComparer.Ordinal) && actor.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var company = await db.Companies
            .AsNoTracking()
            .Where(c => c.Id == companyId)
            .Select(c => new { c.Name, c.Settings.Language, c.Settings.Timezone, c.Settings.ResultScale })
            .FirstOrDefaultAsync(cancellationToken);
        if (company is null)
        {
            return Results.Json(new { message = "Company not found" }, statusCode: 404);
        }

        // The row is the client's: whose data left, whoever took it. A TIMS operator's user row
        // may carry no company, and audit_logs.company_id cannot be null, so without this the
        // middleware would drop the row for exactly the downloads that reach furthest -- found
        // by CompanyExportEndpointsTests on 14 Nov 2026.
        if (await SurveyEndpoints.ResolveActingUserIdAsync(actor, db, cancellationToken) is { } actorId)
        {
            audit.AttributeTo(actorId, companyId);
        }

        var spanish = (ContentLanguages.NormaliseLocale(lang) ?? ContentLanguages.NormaliseLocale(company.Language) ?? "es") == "es";

        // A draft has nothing to download in any of the four: no answers, no roster sent, and a
        // questionnaire still being written. The wizard greys drafts out; the route refuses them.
        var distributed = await db.Surveys
            .AsNoTracking()
            .Where(s => s.CompanyId == companyId && s.Status != SurveyStatuses.Draft)
            .OrderBy(s => s.CreatedAt)
            .Select(s => new { s.Id, s.TitleEn, s.TitleEs, s.Language, s.Status, s.StartDate, s.EndDate })
            .ToListAsync(cancellationToken);

        var chosen = distributed;
        if (surveyIds is { Length: > 0 })
        {
            var asked = surveyIds.ToHashSet();
            if (asked.Any(id => distributed.All(s => s.Id != id)))
            {
                return BadRequest(spanish
                    ? "Alguna de las encuestas elegidas no es de esta empresa o todavía es un borrador."
                    : "One of the chosen surveys is not this company's or is still a draft.");
            }

            chosen = distributed.Where(s => asked.Contains(s.Id)).ToList();
        }

        if (chosen.Count == 0)
        {
            return BadRequest(spanish
                ? "Esta empresa todavía no tiene encuestas distribuidas."
                : "This company has no distributed surveys yet.");
        }

        var groupList = (groups ?? []).Where(g => !string.IsNullOrWhiteSpace(g)).Select(g => g.Trim()).Distinct(StringComparer.Ordinal).ToList();
        if (wanted.Contains(ResultsFile, StringComparer.Ordinal) && groupList.Count > 0)
        {
            var fields = await db.DemographicFields
                .AsNoTracking()
                .Where(f => f.CompanyId == companyId)
                .Select(f => f.Field)
                .ToListAsync(cancellationToken);
            var unknownGroup = groupList.FirstOrDefault(g =>
                !string.Equals(g, SurveySegmentSelector.DepartmentField, StringComparison.Ordinal) && !fields.Contains(g));
            if (unknownGroup is not null)
            {
                return BadRequest($"Unknown group '{unknownGroup}'. Use 'department' or one of this company's demographic fields.");
            }
        }

        var ids = chosen.Select(s => s.Id).ToList();
        var today = DateOnly.FromDateTime(
            SchedulingTimeZone.ToLocal(DateTimeOffset.UtcNow, SchedulingTimeZone.Resolve(company.Timezone)));
        var slug = Slug(company.Name);
        var date = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        var built = new List<(string Name, byte[] Bytes)>();
        foreach (var file in Files.Where(f => wanted.Contains(f, StringComparer.Ordinal)))
        {
            switch (file)
            {
                case ResponsesFile:
                {
                    audit.Describe(ResponseExportEndpoints.ExportAction, ResponseExportEndpoints.ExportResource);
                    var bytes = await ResponseExportEndpoints.BuildWorkbookAsync(
                        actor, companyId, ids, includeAnswers != false, db, configuration, cancellationToken);
                    if (bytes is not null)
                    {
                        built.Add((FileName(spanish ? "respuestas" : "responses", slug, date, "xlsx"), bytes));
                    }

                    break;
                }

                case QuestionnaireFile:
                {
                    var surveys = await LoadQuestionnairesAsync(db, chosen.Select(s => (s.Id, Title(s.TitleEs, s.TitleEn, spanish), s.Status, (DateTimeOffset?)s.StartDate, (DateTimeOffset?)s.EndDate)).ToList(), cancellationToken);
                    built.Add((FileName(spanish ? "cuestionario" : "questionnaire", slug, date, "xlsx"), QuestionnaireWorkbook.Build(surveys, spanish)));
                    break;
                }

                case StatusFile:
                {
                    var (workbook, failure) = await SurveyParticipationEndpoints.BuildCompanyWorkbookAsync(
                        companyId, ids, statusFormat, spanish, principal, db, configuration, cancellationToken);
                    if (failure is not null)
                    {
                        return failure;
                    }

                    built.Add((FileName(spanish ? "estado" : "status", slug, date, "xlsx"), workbook!.Bytes));
                    break;
                }

                case ResultsFile:
                {
                    var locale = spanish ? "es" : "en";
                    var labels = await SurveyExportEndpoints.LoadLabelsAsync(companyId, locale, db, cancellationToken);
                    var sheets = new List<ResultsWorkbookSurvey>(chosen.Count);
                    foreach (var summary in chosen)
                    {
                        var survey = await db.Surveys.AsNoTracking().FirstAsync(s => s.Id == summary.Id, cancellationToken);
                        var fallbackFields = new List<string>();
                        var aggregate = await SurveyAggregateLoader.ComputeAsync(
                            db, survey, SurveyContent.ResolveRequestLocale(locale, survey.Language), fallbackFields, cancellationToken);
                        sheets.Add(new ResultsWorkbookSurvey(
                            Title(summary.TitleEs, summary.TitleEn, spanish),
                            summary.Status,
                            aggregate,
                            labels,
                            groupList));
                    }

                    built.Add((
                        FileName(spanish ? "resultados" : "results", slug, date, "xlsx"),
                        ResultsWorkbook.Build(sheets, ScoreScales.Parse(company.ResultScale), spanish, today)));
                    break;
                }
            }
        }

        if (built.Count == 1)
        {
            return Results.File(built[0].Bytes, XlsxType, built[0].Name);
        }

        using var buffer = new MemoryStream();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (name, bytes) in built)
            {
                var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
                await using var stream = entry.Open();
                await stream.WriteAsync(bytes, cancellationToken);
            }
        }

        return Results.File(buffer.ToArray(), "application/zip", FileName(spanish ? "descargas" : "downloads", slug, date, "zip"));
    }

    private static async Task<List<QuestionnaireSurvey>> LoadQuestionnairesAsync(
        ClimateProjectDbContext db,
        IReadOnlyList<(Guid Id, string Title, string Status, DateTimeOffset? StartDate, DateTimeOffset? EndDate)> surveys,
        CancellationToken cancellationToken)
    {
        var ids = surveys.Select(s => s.Id).ToList();
        var questions = await db.Questions
            .AsNoTracking()
            .Where(q => ids.Contains(q.SurveyId))
            .OrderBy(q => q.SurveyId).ThenBy(q => q.Order)
            .ToListAsync(cancellationToken);
        var options = await SurveyContent.LoadOptionsAsync(db, questions.Select(q => q.Id).ToList(), cancellationToken);

        return [.. surveys.Select(s => new QuestionnaireSurvey(
            s.Title,
            s.Status,
            s.StartDate,
            s.EndDate,
            [.. questions.Where(q => q.SurveyId == s.Id).Select(q => new QuestionnaireQuestion(
                q.Order,
                q.Type,
                q.Category,
                q.Required,
                q.TextEs,
                q.TextEn,
                q.ScaleMin,
                q.ScaleMax,
                q.ScaleLabelMinEs,
                q.ScaleLabelMinEn,
                q.ScaleLabelMaxEs,
                q.ScaleLabelMaxEn,
                options.TryGetValue(q.Id, out var list)
                    ? [.. list.Select(o => new QuestionnaireOption(o.Order, o.Value, o.LabelEs, o.LabelEn))]
                    : []))]))];
    }

    private static string Title(string? spanishTitle, string? englishTitle, bool spanish)
        => (spanish ? spanishTitle ?? englishTitle : englishTitle ?? spanishTitle) ?? string.Empty;

    private static string FileName(string kind, string slug, string date, string extension)
        => slug.Length == 0 ? $"{kind}-{date}.{extension}" : $"{kind}-{slug}-{date}.{extension}";

    /// <summary>
    /// A name as lowercase ASCII words joined by hyphens: «Clima Organizacional 2026» becomes
    /// «clima-organizacional-2026». A download name with accents or spaces is a file a Windows
    /// share or a mail gateway renames, and a reader then cannot tell two exports apart.
    /// </summary>
    internal static string Slug(string? text, int max = 60)
    {
        var decomposed = (text ?? string.Empty).Normalize(NormalizationForm.FormD);
        var slug = new StringBuilder();
        foreach (var character in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            if (char.IsAsciiLetterOrDigit(character))
            {
                slug.Append(char.ToLowerInvariant(character));
            }
            else if (slug.Length > 0 && slug[^1] != '-')
            {
                slug.Append('-');
            }
        }

        var result = slug.ToString().Trim('-');
        return result.Length > max ? result[..max].Trim('-') : result;
    }

    private static IResult BadRequest(string message) => Results.Json(new ErrorResponse(message), statusCode: 400);
}
