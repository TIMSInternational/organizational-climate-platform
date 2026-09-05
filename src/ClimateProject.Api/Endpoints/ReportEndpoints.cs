using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Reports.Rendering;
using ClimateProject.Application.Scheduling;
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

        // The writer for `is_recurring` / `recurrence_pattern` / `next_generation` (#91).
        //
        // Until this existed, `ScheduledReportJob` swept every fifteen minutes against a
        // predicate nothing could satisfy: the three columns were on the entity, mapped by
        // `ReportConfiguration`, read by the job and delivered by
        // `DeliveringScheduledReportRunner` -- and set by no endpoint and no screen, with
        // `is_recurring` defaulting to false. The feature was complete at both ends and joined
        // at neither, so "schedule this report monthly" was a promise the product could not
        // keep and no test could catch, because every piece it was made of worked.
        //
        // A sub-resource rather than a PATCH on the report: `/admin/reports` has no update
        // verb at all, the legacy surface being replaced was `reports/[id]/schedule`
        // (RecurrenceSchedule's own summary says so), and a schedule has a lifecycle of its
        // own -- DELETE means "stop recurring", which is not the same as clearing two fields
        // on a report somebody is also editing.
        //
        // Both are mutating methods, so `AuditWritingMiddleware` records them off the verb and
        // `AuditCoverageTests` picks them up from the live route table without anyone adding
        // them to a list.
        group.MapPut("/{id:guid}/schedule", SetScheduleAsync);
        group.MapDelete("/{id:guid}/schedule", ClearScheduleAsync);
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
            .Select(r => new ReportListItem(
                r.Id, r.Title, r.Type, r.CompanyId, r.Status, r.Format, r.CreatedAt,
                r.IsRecurring, r.RecurrencePattern, r.NextGeneration))
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

    /// <summary>
    /// Sets, or replaces, a report's recurring schedule.
    /// </summary>
    /// <remarks>
    /// <para><b>The timezone is the company's, not the caller's</b> -- the same resolution
    /// <c>ScheduledReportJob</c> performs when it advances the schedule. If the two disagreed,
    /// a monthly report would land on a different day than the one the admin chose, and it
    /// would drift by an hour twice a year: the arithmetic in <see cref="RecurrenceSchedule"/>
    /// runs on the local wall clock precisely so that it does not. A report is an
    /// organisational artefact, so "the monthly report" means the tenant's month.</para>
    ///
    /// <para><b>A <c>startAt</c> in the past is refused, and that deliberately differs from the
    /// job's catch-up rule.</b> <see cref="RecurrenceSchedule.AdvancePast"/> skips a dormant
    /// schedule forward because the alternatives -- generating a hundred missed reports, or
    /// firing forever on a past date -- are both worse for a schedule that was already running.
    /// Silently applying that here would answer 200 to "start on the 1st" and schedule the 1st
    /// of some later month, and the admin would find out a month later. Refusing states the
    /// disagreement while they are still looking at the form. A start time that goes stale in
    /// the seconds between validation and the first sweep is still handled -- by the job, whose
    /// rule that is.</para>
    ///
    /// <para><b>This is the "re-saving" the job already promises.</b> When the sweep meets an
    /// unrecognised pattern it clears <c>next_generation</c> and deliberately leaves
    /// <c>is_recurring</c> alone, so the admin's intent survives, and its log line tells them
    /// re-saving a valid pattern resumes it. Nothing could re-save. This endpoint is what makes
    /// that sentence true.</para>
    /// </remarks>
    private static async Task<IResult> SetScheduleAsync(
        Guid id,
        SetReportScheduleRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var report = await db.Reports.FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (report is null) return Results.Json(new { message = "Report not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, report.CompanyId)) return Results.Forbid();

        // Named values, not a free string: the column is the job's only instruction and an
        // unrecognised one costs a sweep, an error log and a cleared schedule. The message
        // lists the vocabulary because a caller who guessed "fortnightly" cannot discover
        // "biweekly" from a bare 400 -- the same reasoning CreateAsync applies to `format`.
        var pattern = request.Pattern?.Trim();
        if (!RecurrenceSchedule.IsValid(pattern))
        {
            return Results.Json(
                new ErrorResponse(
                    $"Unsupported recurrence pattern '{request.Pattern}'. Use one of: {string.Join(", ", RecurrenceSchedule.All)}."),
                statusCode: 400);
        }

        var timezoneId = await db.Companies
            .Where(c => c.Id == report.CompanyId)
            .Select(c => c.Settings.Timezone)
            .FirstOrDefaultAsync(cancellationToken);
        var zone = SchedulingTimeZone.Resolve(timezoneId);

        var now = DateTimeOffset.UtcNow;
        DateTimeOffset firstOccurrence;

        if (request.StartAt is { } startAt)
        {
            if (startAt <= now)
            {
                return Results.Json(
                    new ErrorResponse("The first occurrence must be in the future."),
                    statusCode: 400);
            }

            firstOccurrence = startAt;
        }
        else
        {
            // One period from now. `Next` cannot return null here -- IsValid passed above and
            // that is its only null arm -- but the schedule is not written from a value the
            // compiler thinks might be absent: a recurring report with a null next_generation
            // is exactly the dormant row the job's error path produces, and reaching it from a
            // 200 would be indistinguishable from that failure.
            var computed = RecurrenceSchedule.Next(pattern, now, zone);
            if (computed is null)
            {
                return Results.Json(
                    new ErrorResponse($"Could not compute the first occurrence for '{pattern}'."),
                    statusCode: 400);
            }

            firstOccurrence = computed.Value;
        }

        report.IsRecurring = true;
        report.RecurrencePattern = pattern;
        report.NextGeneration = firstOccurrence;
        report.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(report));
    }

    /// <summary>
    /// Stops a report recurring.
    /// </summary>
    /// <remarks>
    /// All three columns are cleared, not just <c>is_recurring</c>. Clearing the flag alone
    /// would satisfy the job's due-query -- it filters on both -- but would leave a
    /// <c>next_generation</c> in the past attached to the row, so re-enabling the schedule
    /// months later would fire an occurrence dated to whenever it was switched off. The
    /// schedule goes away as a unit because that is what "stop recurring" means.
    /// </remarks>
    private static async Task<IResult> ClearScheduleAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var report = await db.Reports.FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (report is null) return Results.Json(new { message = "Report not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, report.CompanyId)) return Results.Forbid();

        report.IsRecurring = false;
        report.RecurrencePattern = null;
        report.NextGeneration = null;
        report.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(report));
    }

    private static ReportDetail ToDetail(Report r) => new(
        r.Id, r.Title, r.Description, r.Type, r.CompanyId, r.CreatedBy, r.TemplateId,
        r.Status, r.Format, r.ReportOutput, r.DownloadCount, r.GenerationStartedAt, r.GenerationCompletedAt, r.CreatedAt,
        r.IsRecurring, r.RecurrencePattern, r.NextGeneration);
}
