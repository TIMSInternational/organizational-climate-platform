using ClimateProject.Application.Scheduling;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Scheduling;

/// <summary>
/// The stub behind <see cref="IScheduledReportRunner"/>: it generates nothing and delivers
/// nothing, so the scheduling half of recurring reports -- due detection, catch-up, the
/// idempotent advance of <c>NextGeneration</c> -- can be exercised end to end before report
/// generation exists.
///
/// Mirrors <c>LoggingNotificationSender</c>, which is the established shape in this repository
/// for a seam that is not yet filled in. Replacing this is part of #91; nothing upstream of it
/// changes.
/// </summary>
public sealed class LoggingScheduledReportRunner(ILogger<LoggingScheduledReportRunner> logger)
    : IScheduledReportRunner
{
    public Task RunAsync(ScheduledReportOccurrence occurrence, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(occurrence);
        cancellationToken.ThrowIfCancellationRequested();

        logger.LogInformation(
            "Scheduled report generation stubbed -- report {ReportId} for company {CompanyId} came due for its " +
            "{RecurrencePattern} occurrence at {OccurrenceUtc:O} in format {Format}. No report was generated or " +
            "delivered; the schedule has been advanced.",
            occurrence.ReportId,
            occurrence.CompanyId,
            occurrence.RecurrencePattern,
            occurrence.OccurrenceUtc,
            occurrence.Format);

        return Task.CompletedTask;
    }
}
