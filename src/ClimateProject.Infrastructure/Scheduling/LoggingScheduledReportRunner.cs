using ClimateProject.Application.Scheduling;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Scheduling;

/// <summary>
/// The stub behind <see cref="IScheduledReportRunner"/>: it generates nothing and delivers
/// nothing, so the scheduling half of recurring reports -- due detection, catch-up, the
/// idempotent advance of <c>NextGeneration</c> -- runs end to end without claiming anything
/// about a report.
///
/// Mirrors <c>LoggingNotificationSender</c>, including in what it became once the seam was
/// filled (#91): the real runner exists (<c>DeliveringScheduledReportRunner</c>, in the API
/// host), but this stub stays selected wherever no mail provider is configured -- local
/// development, CI, the integration suite, the standalone worker host. Deliberately: with no
/// way to send the "your report is ready" mail, generating the document and letting the stub
/// notification sender mark the notice "sent" would record a delivery that never happened.
/// The schedule still advances, announced loudly here and by the startup email WARNING, and
/// nothing anywhere says "delivered".
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
