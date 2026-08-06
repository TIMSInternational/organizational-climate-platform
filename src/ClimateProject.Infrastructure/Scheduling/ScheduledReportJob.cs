using ClimateProject.Application.Scheduling;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Scheduling;

/// <summary>
/// Fires recurring report schedules and advances them.
///
/// <para>Replaces legacy <c>api/cron/scheduled-reports</c>. It is deliberately the *only*
/// scheduler for reports: #91 asks for scheduled delivery to run "from Workers, not a second
/// scheduler", so generation plugs into <see cref="IScheduledReportRunner"/> rather than
/// growing its own timer. Everything about *when* lives here; everything about *what* lives
/// behind that interface.</para>
///
/// <para><b>Idempotency.</b> The advance of <c>next_generation</c> and the call to the runner
/// happen in the same transaction, under the same advisory lease. A second tick sees the
/// advanced value and finds nothing due; a crash mid-run rolls both back together, so the
/// occurrence is retried rather than lost. That is why the advance is not committed first as an
/// optimistic claim -- doing so would convert every runner failure into a silently skipped
/// report, which is the failure this issue exists to prevent, one layer up.</para>
/// </summary>
public static class ScheduledReportJob
{
    /// <summary>Occurrences fired per sweep. Bounded so one sweep is one bounded transaction.</summary>
    public const int DefaultBatchSize = 100;

    private const string LogCategory = "ClimateProject.Workers.ScheduledReports";

    public static async Task<ScheduledReportSweepResult> RunAsync(
        ClimateProjectDbContext db,
        IScheduledReportRunner runner,
        ILoggerFactory loggerFactory,
        DateTimeOffset nowUtc,
        int batchSize,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(runner);
        ArgumentNullException.ThrowIfNull(loggerFactory);
        ArgumentOutOfRangeException.ThrowIfLessThan(batchSize, 1);

        var logger = loggerFactory.CreateLogger(LogCategory);

        var due = await db.Reports
            .Where(report => report.IsRecurring
                             && report.NextGeneration != null
                             && report.NextGeneration <= nowUtc)
            .OrderBy(report => report.NextGeneration)
            .Take(batchSize)
            .ToListAsync(cancellationToken);

        if (due.Count == 0)
        {
            return new ScheduledReportSweepResult(0, 0, 0);
        }

        // The company's timezone, not the viewer's: a report is an organisational artefact and
        // "the monthly report" means the tenant's month. Users pick their own zone for digests
        // (see DigestJob) because a digest is personal; this is not.
        var companyIds = due.Select(report => report.CompanyId).Distinct().ToList();
        var timezones = await db.Companies
            .Where(company => companyIds.Contains(company.Id))
            .ToDictionaryAsync(company => company.Id, company => company.Settings.Timezone, cancellationToken);

        var fired = 0;
        var disabled = 0;
        var skipped = 0;

        foreach (var report in due)
        {
            var zone = SchedulingTimeZone.Resolve(timezones.GetValueOrDefault(report.CompanyId));
            var occurrenceUtc = report.NextGeneration!.Value;
            var advance = RecurrenceSchedule.AdvancePast(report.RecurrencePattern, occurrenceUtc, nowUtc, zone);

            if (advance is null)
            {
                // An unrecognised or non-advancing pattern. Left as-is, this row matches the due
                // query on every tick forever and the log fills with the same complaint every
                // fifteen minutes. Clearing next_generation takes it out of the sweep while
                // deliberately leaving is_recurring alone -- the admin's intent to have a
                // recurring report is preserved and visible, and re-saving the schedule with a
                // valid pattern restores it. Deleting their intent to silence a log line would
                // be the wrong trade.
                logger.LogError(
                    "Report {ReportId} is recurring with pattern '{RecurrencePattern}', which is not one of " +
                    "{ValidPatterns}. Its schedule has been cleared so it stops re-firing; is_recurring is " +
                    "unchanged, so re-saving the schedule with a valid pattern resumes it.",
                    report.Id,
                    report.RecurrencePattern,
                    string.Join(", ", RecurrenceSchedule.All));

                report.NextGeneration = null;
                report.GenerationError =
                    $"Unrecognised recurrence pattern '{report.RecurrencePattern}'. Schedule cleared; expected one of: "
                    + string.Join(", ", RecurrenceSchedule.All) + ".";
                report.UpdatedAt = nowUtc;
                disabled++;
                continue;
            }

            if (advance.SkippedOccurrences > 0)
            {
                // Not an error -- see RecurrenceSchedule.AdvancePast for why catching up by
                // skipping is the only bounded option -- but the number is the size of the gap,
                // which is worth having in the logs when someone asks where their reports went.
                logger.LogWarning(
                    "Report {ReportId} was due at {OccurrenceUtc:O} and had {SkippedOccurrences} further occurrences " +
                    "in the past. Firing once and resuming at {NextOccurrenceUtc:O}; the intermediate occurrences are " +
                    "not backfilled.",
                    report.Id,
                    occurrenceUtc,
                    advance.SkippedOccurrences,
                    advance.NextOccurrenceUtc);
                skipped += advance.SkippedOccurrences;
            }

            await runner.RunAsync(
                new ScheduledReportOccurrence(
                    report.Id,
                    report.CompanyId,
                    occurrenceUtc,
                    report.RecurrencePattern,
                    report.Format),
                cancellationToken);

            report.NextGeneration = advance.NextOccurrenceUtc;
            report.UpdatedAt = nowUtc;
            fired++;
        }

        await db.SaveChangesAsync(cancellationToken);

        return new ScheduledReportSweepResult(fired, disabled, skipped);
    }
}

/// <summary>What one scheduled-report sweep did.</summary>
/// <param name="Fired">Occurrences handed to <see cref="IScheduledReportRunner"/>.</param>
/// <param name="SchedulesCleared">Recurring reports taken out of the sweep for an invalid pattern.</param>
/// <param name="OccurrencesSkipped">Past occurrences passed over while catching up. Non-zero means an outage.</param>
public sealed record ScheduledReportSweepResult(int Fired, int SchedulesCleared, int OccurrencesSkipped);
