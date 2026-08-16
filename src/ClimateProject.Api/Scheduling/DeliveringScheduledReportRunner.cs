using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Scheduling;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Notifications;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Scheduling;

/// <summary>
/// The real <see cref="IScheduledReportRunner"/> (#91), replacing
/// <c>LoggingScheduledReportRunner</c> wherever a mail provider is configured.
///
/// <para><b>Generation</b> is <see cref="ReportGeneration.GenerateAsync"/> -- the exact method
/// <c>POST /admin/reports</c> runs, never a copy -- so a scheduled document carries the same
/// shared aggregation and the same suppression decisions as the results screens (#88/#320).
/// A protected group's count is absent from the stored document because the aggregation never
/// handed it over, not because this class remembered to hide it.</para>
///
/// <para><b>Delivery</b> is the notification path: one <c>notifications</c> row, email
/// channel, addressed to the report's creator, which <c>NotificationDispatchWorker</c> drains
/// through <c>EmailNotificationSender</c> and <c>IEmailTransport</c> within a minute. Going
/// through the row rather than calling the transport here buys everything the dispatch path
/// already guarantees -- delivery-time consent, retry accounting with permanent-failure
/// retirement, truthful status bookkeeping -- and this class must not reimplement any of it.
/// The row says the report is READY and names no number from inside it; the numbers stay
/// behind the authorised download.</para>
///
/// <para><b>It lives in the API project</b> because generation does: SurveyAggregateLoader is
/// the API's, and #275 co-hosts the scheduler in the API process, so the runner and the
/// generator it must share code with are finally in the same host. The standalone worker host
/// keeps the logging stub -- it cannot reach this code, and nothing deploys it any more.</para>
///
/// <para><b>Idempotent on <see cref="ScheduledReportOccurrence.OccurrenceUtc"/></b>, as the
/// seam requires: the delivery row's id is <see cref="DeterministicNotificationId.ForScheduledReport"/>
/// of (report, occurrence), so a replayed occurrence -- a lost lease, a manual re-run --
/// produces a primary-key violation rather than a second email, and the guard below turns even
/// that into a quiet no-op. Regeneration of the document is idempotent by nature: it overwrites
/// the same row with the same computation.</para>
///
/// <para><b>Failure = throw.</b> Anything that throws out of this method rolls back the
/// sweep's transaction, schedule advance included, so the occurrence is retried on the next
/// tick. That is the seam's contract and the reason nothing here catches.</para>
/// </summary>
internal sealed class DeliveringScheduledReportRunner(
    ClimateProjectDbContext db,
    ILogger<DeliveringScheduledReportRunner> logger) : IScheduledReportRunner
{
    public async Task RunAsync(ScheduledReportOccurrence occurrence, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(occurrence);

        // Inside the sweep this resolves to the instance ScheduledReportJob is already
        // tracking (same scoped DbContext, identity resolution), so the mutations below and
        // the schedule advance land in one SaveChanges. The null arm is for a caller outside
        // the sweep naming a report that no longer exists.
        var report = await db.Reports.FirstOrDefaultAsync(r => r.Id == occurrence.ReportId, cancellationToken);
        if (report is null)
        {
            logger.LogError(
                "Scheduled report occurrence at {OccurrenceUtc:O} names report {ReportId}, which does not exist. " +
                "Nothing was generated.",
                occurrence.OccurrenceUtc,
                occurrence.ReportId);
            return;
        }

        var nowUtc = NotificationDelivery.UtcNow();
        report.GenerationStartedAt = nowUtc;
        report.GenerationError = null;

        await ReportGeneration.GenerateAsync(db, report, nowUtc, cancellationToken);

        var creator = await db.Users.FirstOrDefaultAsync(u => u.Id == report.CreatedBy, cancellationToken);
        if (creator is null || !creator.IsActive)
        {
            // The document is generated and downloadable either way; what is skipped is the
            // notice. A deactivated (possibly GDPR-erased) account must not be mailed, and
            // DigestJob draws the same line with the same IsActive test. Logged, because a
            // recurring report whose only audience has left is a schedule an admin should
            // retire -- this line is how they find out it is still burning cycles.
            logger.LogWarning(
                "Scheduled report {ReportId} was generated for its occurrence at {OccurrenceUtc:O}, but its creator " +
                "{CreatedBy} is {CreatorState}, so no delivery notification was raised.",
                report.Id,
                occurrence.OccurrenceUtc,
                report.CreatedBy,
                creator is null ? "missing" : "deactivated");
            return;
        }

        var notificationId = DeterministicNotificationId.ForScheduledReport(report.Id, occurrence.OccurrenceUtc);
        if (await db.Notifications.AnyAsync(n => n.Id == notificationId, cancellationToken))
        {
            // This occurrence was already delivered by an earlier attempt whose schedule
            // advance did not survive -- the replay case the deterministic id exists for.
            return;
        }

        db.Notifications.Add(new Notification
        {
            Id = notificationId,
            UserId = creator.Id,
            CompanyId = report.CompanyId,

            // system_notification, for the digest's reasons (see DigestJob): the nine legacy
            // types are pinned, and the consent that governs this mail is the schedule itself
            // -- an admin configured this report to recur. The recipient's channel opt-outs
            // are still consulted at delivery time by NotificationDispatchPolicy.
            Type = NotificationTypes.SystemNotification,
            Channel = NotificationChannels.Email,
            Priority = NotificationPriorities.Low,
            Status = NotificationStatuses.Pending,
            Title = ScheduledNotificationCopy.ReportReadyTitleFor(creator.Preferences.Language),
            Message = ScheduledNotificationCopy.ReportReadyBodyFor(
                creator.Preferences.Language, report.Title, occurrence.OccurrenceUtc),

            // The occurrence's own instant, so every instance computes the same value and the
            // stored row says when the report was owed rather than when a tick fired.
            ScheduledFor = occurrence.OccurrenceUtc,
            RetryCount = 0,
            MaxRetries = 3,
            CreatedAt = nowUtc,
            UpdatedAt = nowUtc,
        });
    }
}
