using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Reports.Rendering;
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
        //
        // It stays a POST now that it returns a file, and that is a decision rather than
        // inertia: it MUTATES (`download_count`), so a GET would be a lie about the verb, and
        // `AuditWritingMiddleware` audits by method -- a GET would need an explicit
        // [AuditSensitiveRead] marker to keep the record, which is a coverage claim resting on
        // an attribute somebody can drop. The cost is that the browser cannot use a plain
        // <a href>, which it could not anyway: the route is authorized, and an anchor sends
        // cookies rather than the bearer header (web/src/features/surveys/api/surveyExport.ts
        // records the same finding for the survey export).
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

        // `format` used to be copied through unfiltered into a 10-character column nothing
        // branched on, so the row held whatever a caller sent -- "excel", "docx", "" -- and
        // download handed back JSON regardless. Now that DownloadAsync renders the column, an
        // unrenderable value stored here is a promise the download cannot keep, so it is
        // refused at the door rather than downgraded silently. `excel` in particular was
        // offered by the web for a year and never produced a spreadsheet; see
        // docs/decisions/report-rendering.md.
        var format = ReportFormats.Normalise(request.Format);
        if (format is null)
        {
            return Results.Json(
                new ErrorResponse(
                    $"Unsupported report format '{request.Format}'. Use '{ReportFormats.Pdf}' or '{ReportFormats.Csv}'."),
                statusCode: 400);
        }

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
            Format = format,
            GenerationStartedAt = now,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Reports.Add(report);
        await db.SaveChangesAsync(cancellationToken);

        // The document itself -- AI insights (#152), one section of shared aggregation per
        // non-draft survey (#88), suppression carried verbatim -- is computed by
        // ReportGeneration, the ONE generator this codebase has. The scheduled runner (#91)
        // calls the same method, which is what makes "the emailed report and the results page
        // disagree" impossible rather than unlikely.
        await ReportGeneration.GenerateAsync(db, report, now, cancellationToken);
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

    /// <summary>
    /// The report as a file.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Everything before the render is unchanged and deliberately so: the same verb, the same
    /// 404-then-403 order (missing is 404; another tenant's report is <b>403</b> -- measured,
    /// not assumed: <c>ReportShareEndpoints</c> answers 404 for a foreign report precisely so a
    /// 403 cannot confirm the id exists, and this endpoint has never done that. Changing a
    /// status code is a decision with its own tests, not a side effect of adding a renderer),
    /// the same 400 for a report that is not
    /// <c>completed</c>, and the same <c>download_count</c> increment. What used to return
    /// <c>Results.Ok(ToDetail(report))</c> now returns the rendered document -- so the web's
    /// download-count toast lost its only source, which is why
    /// <c>ReportsListPage</c> stopped reporting a count.
    /// </para>
    /// <para>
    /// <b>The increment is committed before the render.</b> A file that reached the reader while
    /// the counter said nothing happened is the failure worth avoiding here -- #143 wants the
    /// answer to "who exported this data", and the audit row is written by the middleware off
    /// the method either way. The render cannot fail: an unreadable stored document produces a
    /// document that says so (<see cref="ReportRenderer"/>), not an exception.
    /// </para>
    /// </remarks>
    private static async Task<IResult> DownloadAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
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

        var logger = loggerFactory.CreateLogger(typeof(ReportEndpoints));
        var csv = ReportFormats.IsCsv(report.Format);

        // Rows created before CreateAsync validated the column hold values no renderer knows --
        // the integration suite's own fixtures wrote "type" and "excel" into it. Those render as
        // the PDF, which is the format the web defaulted to and the one a document reader
        // expects, and the substitution is logged so the row is findable without an
        // administrator being the one who finds it. A 500 here would turn a year-old data defect
        // into an outage on the screen an admin uses to get their report out.
        if (!csv && !string.Equals(report.Format, ReportFormats.Pdf, StringComparison.Ordinal))
        {
            logger.LogWarning(
                "Report {ReportId} stores format '{StoredFormat}', which no renderer honours; served as {ServedFormat}.",
                report.Id,
                report.Format,
                ReportFormats.Pdf);
        }

        var context = new ReportRenderContext(
            report.Id,
            report.Title,
            report.Description,
            report.Type,
            // The instant the numbers are true as of, not "now": restamping the document on
            // every download would make two copies of one report disagree about their own date.
            report.GenerationCompletedAt ?? report.CreatedAt,
            ReportDocumentReader.Parse(report.ReportOutput));

        var bytes = csv
            ? ReportRenderer.BuildCsv(context).ToBytes()
            : ReportRenderer.BuildPdf(context).ToBytes();

        return Results.File(bytes, ReportFormats.ContentType(csv), ReportFormats.FileName(report.Title, report.Id, csv));
    }

    private static ReportDetail ToDetail(Report r) => new(
        r.Id, r.Title, r.Description, r.Type, r.CompanyId, r.CreatedBy, r.TemplateId,
        r.Status, r.Format, r.ReportOutput, r.DownloadCount, r.GenerationStartedAt, r.GenerationCompletedAt, r.CreatedAt);
}
