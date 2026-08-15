using System.Security.Claims;
using System.Text.Json;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class ReportEndpoints
{
    public static void MapReportEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/reports").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);

        // "Who read this report" is one of the three questions #143 exists to answer, and a
        // read answers to nothing by default -- auditing every GET would bury the trail under
        // dashboard polling, so the ones that matter say so. The list above is not marked: it
        // returns metadata, not a report's contents.
        group.MapGet("/{id:guid}", GetAsync)
            .WithMetadata(new AuditSensitiveReadAttribute(AuditVerbs.Read));

        // Already a POST, so already audited. Left here as the answer to "who exported this
        // data" -- it is audited by the method, not by this comment.
        group.MapPost("/{id:guid}/download", DownloadAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    // PersonaExternalId first, then Id -- see ActingUserResolver for why the order is
    // load-bearing. The Guid.Empty fallback for an unresolvable caller is pre-existing
    // behaviour, deliberately left alone by #285: `reports.created_by` is a required FK to
    // `users` (ReportConfiguration), so it fails the insert rather than filing the row
    // against a real account. Fixing that is a separate change with its own status code.
    private static async Task<Guid> ResolveCurrentUserIdAsync(CurrentUser currentUser, ClimateProjectDbContext db, CancellationToken cancellationToken)
        => await ActingUserResolver.ResolveIdAsync(currentUser, db, cancellationToken) ?? Guid.Empty;

    private static async Task<IResult> ListAsync(Guid companyId, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId)) return Results.Forbid();

        var reports = await db.Reports
            .Where(r => r.CompanyId == companyId)
            .OrderByDescending(r => r.CreatedAt)
            .Select(r => new ReportListItem(r.Id, r.Title, r.Type, r.CompanyId, r.Status, r.Format, r.CreatedAt))
            .ToListAsync(cancellationToken);

        return Results.Ok(reports);
    }

    private static async Task<IResult> CreateAsync(CreateReportRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, request.CompanyId)) return Results.Forbid();

        var title = request.Title?.Trim();
        if (string.IsNullOrWhiteSpace(title)) return Results.Json(new { message = "Title is required" }, statusCode: 400);

        var createdBy = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var report = new Report
        {
            Id = Guid.NewGuid(),
            Title = title,
            Description = request.Description,
            Type = request.Type,
            CompanyId = request.CompanyId,
            CreatedBy = createdBy,
            TemplateId = request.TemplateId,
            Status = "generating",
            Format = request.Format,
            GenerationStartedAt = now,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Reports.Add(report);
        await db.SaveChangesAsync(cancellationToken);

        // The AI insights section is read through ReportAIInsights, the one path (#152)
        // so that a report never silently omits insights by reading the wrong entity.
        var insights = await ReportAIInsights
            .ForCompany(db.AIInsights.AsNoTracking(), report.CompanyId, now)
            .ToListAsync(cancellationToken);

        // The survey sections (#88): one per non-draft survey, each the SAME aggregation
        // the results screens serve, loaded through the shared SurveyAggregateLoader and
        // projected by ReportSurveySections -- so the report and /surveys/{id}/results
        // cannot disagree about the same survey, and every suppression decision
        // (SurveyResultsPrivacy's floors) is the aggregation's own, carried verbatim.
        // Drafts are excluded because content is only editable while no responses exist:
        // a draft has nothing to aggregate, only noise rows of zeros.
        //
        // Generation stays synchronous. It streams every answer of every completed
        // response per survey, which is a page-load-sized cost per survey; a company
        // with enough surveys and responses for that to hurt is the trigger for making
        // generation a background job (the status column already models "generating"),
        // not for a cheaper aggregation.
        var surveys = await db.Surveys
            .AsNoTracking()
            .Where(s => s.CompanyId == report.CompanyId && s.Status != SurveyStatuses.Draft)
            .OrderByDescending(s => s.CreatedAt)
            .ThenBy(s => s.Id)
            .ToListAsync(cancellationToken);

        var sections = new List<ReportSurveySection>(surveys.Count);
        foreach (var survey in surveys)
        {
            // A report is a company document, not a browser request: content resolves
            // for the survey's own language, with no ?lang to honour. The fallback list
            // is per-survey plumbing the report does not print -- question text never
            // reaches the document, only category names and department names do.
            var locale = SurveyContent.ResolveRequestLocale(null, survey.Language);
            var fallbackFields = new List<string>();
            var aggregate = await SurveyAggregateLoader.ComputeAsync(db, survey, locale, fallbackFields, cancellationToken);
            var surveyTitle = SurveyContent.Resolve(survey.TitleEn, survey.TitleEs, locale, survey.Language, "title", fallbackFields);
            sections.Add(ReportSurveySections.ToSection(survey.Id, surveyTitle, survey.Status, aggregate));
        }

        report.Status = "completed";
        report.GenerationCompletedAt = DateTimeOffset.UtcNow;
        // ReportOutput is mapped as jsonb (ReportConfiguration.cs) -- Npgsql requires the
        // stored text to already be valid JSON, so the document must be serialized (same
        // pattern as MicroclimateEndpoints.cs's WordCloudData), not assigned raw.
        // JsonSerializerOptions.Web so the stored document is camelCase like every other
        // payload this API hands a browser -- reportOutput is delivered verbatim to the web app.
        report.ReportOutput = JsonSerializer.Serialize(
            new ReportOutputDocument(
                // Honest scope (#88): what the document still does not carry. Each item
                // is issue-sized on its own; none may be faked in the meantime.
                // TODO(#88 follow-up): per-question distributions and open-text word
                //   clouds per survey (SurveyAggregate.Questions, projected like
                //   ReportSurveySections does departments).
                // TODO(#88 follow-up): demographic breakdowns beyond department
                //   (SurveyAggregate.Breakdowns already computes and suppresses them;
                //   the projection just does not print them yet).
                // TODO(#88 follow-up): benchmark comparisons (#61's boundary applies:
                //   reuse BenchmarkEndpoints' source, do not re-derive).
                "Sections not yet generated: per-question distributions, word clouds, demographic breakdowns, benchmark comparisons.",
                sections,
                ReportAIInsights.ToSection(insights)),
            JsonSerializerOptions.Web);
        report.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(ToDetail(report), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var report = await db.Reports.FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (report is null) return Results.Json(new { message = "Report not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, report.CompanyId)) return Results.Forbid();

        return Results.Ok(ToDetail(report));
    }

    private static async Task<IResult> DownloadAsync(Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var report = await db.Reports.FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (report is null) return Results.Json(new { message = "Report not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, report.CompanyId)) return Results.Forbid();

        if (report.Status != "completed")
        {
            return Results.Json(new { message = "Report is not ready for download" }, statusCode: 400);
        }

        report.DownloadCount += 1;
        report.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(report));
    }

    private static ReportDetail ToDetail(Report r) => new(
        r.Id, r.Title, r.Description, r.Type, r.CompanyId, r.CreatedBy, r.TemplateId,
        r.Status, r.Format, r.ReportOutput, r.DownloadCount, r.GenerationStartedAt, r.GenerationCompletedAt, r.CreatedAt);
}
