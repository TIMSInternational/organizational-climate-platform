using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Notifications;

/// <summary>
/// The delivery half of notification dispatch: find what is due, consult consent, hand it to
/// <see cref="INotificationSender"/>, and record the outcome.
///
/// <para><b>Why this moved out of <c>NotificationEndpoints</c> (#101).</b> This logic arrived
/// with #97 as private statics behind <c>POST /notifications/process</c>, which was correct
/// while an HTTP request was the only thing that triggered it. The scheduler is now a second
/// trigger, and a scheduler that reimplemented the rules would be a second, quietly divergent
/// answer to "may we email this person" -- the one question in this codebase where two
/// answers is strictly worse than one wrong one. So the rules live here, at the layer both
/// callers already depend on, and the endpoint keeps exactly what is actually its own:
/// authorization and the HTTP shape.</para>
///
/// <para>Static rather than an injected service to keep the move behaviour-preserving -- the
/// endpoint's call sites change shape and nothing else. It has no state and reads nothing
/// ambient; every dependency, including the clock, arrives as a parameter.</para>
/// </summary>
public static class NotificationDelivery
{
    /// <summary>
    /// Notifications one sweep will attempt. Bounded so an HTTP call stays inside a sane
    /// timeout and a scheduled sweep stays inside a sane transaction; call it again for more.
    /// </summary>
    public const int DefaultBatchSize = 200;

    private const int FailureReasonMaxLength = 1000;

    private const string LogCategory = "ClimateProject.Notifications.Delivery";

    /// <summary>
    /// Deliver everything that is now due -- notifications scheduled for the future whose time
    /// has come, and earlier attempts that failed and still have retries left.
    ///
    /// <para>Bounded the same way bulk dispatch is: one SELECT for the due batch, one SELECT
    /// for the distinct recipients, one save. There is no per-notification query.</para>
    ///
    /// <para><b>Idempotency.</b> The batch is selected on
    /// <see cref="NotificationStatuses.Retryable"/>, and a successful attempt moves the row to
    /// <c>sent</c> (or <c>cancelled</c>), which is not retryable. So a second sweep -- the next
    /// tick, another instance, a replayed request -- finds nothing to redo. The state that
    /// makes that true is the row's own <c>status</c>, persisted, rather than anything inferred
    /// from timestamps: #101 calls that out specifically, and it is why a delivered row is not
    /// identified by "sent_at is recent".</para>
    ///
    /// <para>The caller owns the transaction. This method calls <c>SaveChangesAsync</c> but
    /// never begins or commits, so a scheduled run can wrap the whole sweep in the same
    /// transaction that holds its advisory lease.</para>
    /// </summary>
    /// <param name="companyId">Restrict to one tenant, or null to sweep every tenant.</param>
    /// <param name="now">The clock, passed in so callers agree on one instant and tests need none.</param>
    public static async Task<NotificationProcessResult> ProcessDueAsync(
        ClimateProjectDbContext db,
        INotificationSender sender,
        ILoggerFactory loggerFactory,
        Guid? companyId,
        DateTimeOffset now,
        int batchSize,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentOutOfRangeException.ThrowIfLessThan(batchSize, 1);

        // Due-ness -- retryable status, scheduled time reached, retry budget left, and (#100)
        // the backoff since the last failure elapsed -- lives in NotificationRetryPolicy so the
        // endpoint's sweep, this one and the unit tests that pin the rule cannot drift apart.
        // Restating the predicate here is exactly the second divergent answer this class exists
        // to prevent.
        var query = db.Notifications.Where(NotificationRetryPolicy.DueAt(now));

        if (companyId is not null)
        {
            query = query.Where(n => n.CompanyId == companyId.Value);
        }

        var due = await query
            .OrderBy(n => n.ScheduledFor)
            .Take(batchSize)
            .ToListAsync(cancellationToken);

        if (due.Count == 0)
        {
            return new NotificationProcessResult(0, 0, 0, 0);
        }

        var recipientIds = due.Select(n => n.UserId).Distinct().ToList();

        // The whole user row, not just its preferences: a real sender (#100) needs the address
        // and the language as well as the opt-outs, and the preferences are owned columns on
        // this same row -- so this is the identical single query it was before.
        var recipients = await db.Users
            .Where(u => recipientIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, cancellationToken);

        var attempted = 0;
        foreach (var notification in due)
        {
            if (!recipients.TryGetValue(notification.UserId, out var recipient))
            {
                // Cannot happen while the user_id FK holds; skipping rather than assuming a
                // default preference set, because assuming would mean mailing someone whose
                // opt-outs we could not read.
                continue;
            }

            attempted++;
            await AttemptDeliveryAsync(notification, recipient, sender, loggerFactory, UtcNow(), cancellationToken);
        }

        await db.SaveChangesAsync(cancellationToken);

        return new NotificationProcessResult(
            attempted,
            due.Count(n => n.Status == NotificationStatuses.Sent),
            due.Count(n => n.Status == NotificationStatuses.Cancelled),
            due.Count(n => n.Status == NotificationStatuses.Failed));
    }

    /// <summary>
    /// Deliver now if the notification is due now; otherwise leave it
    /// <see cref="NotificationStatuses.Pending"/> for a later sweep.
    ///
    /// A future-dated notification deliberately does **not** get its consent decision made
    /// here: preferences are consulted at delivery time, so a recipient who opts out between
    /// scheduling and sending is honoured.
    /// </summary>
    public static async Task DeliverIfDueAsync(
        Notification notification,
        User recipient,
        INotificationSender sender,
        ILoggerFactory loggerFactory,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(notification);

        if (notification.ScheduledFor > now) return;

        await AttemptDeliveryAsync(notification, recipient, sender, loggerFactory, now, cancellationToken);
    }

    /// <summary>
    /// One delivery attempt, with its consent check and its status bookkeeping.
    /// </summary>
    /// <param name="recipient">
    /// The whole user row rather than just its preferences (#100): the consent decision needs
    /// the opt-outs, and a real sender needs the address and language that sit on the same row.
    /// Both are read here, at delivery time, which is what makes an opt-out taken between
    /// scheduling and sending take effect.
    /// </param>
    public static async Task AttemptDeliveryAsync(
        Notification notification,
        User recipient,
        INotificationSender sender,
        ILoggerFactory loggerFactory,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(notification);
        ArgumentNullException.ThrowIfNull(sender);
        ArgumentNullException.ThrowIfNull(loggerFactory);

        var decision = NotificationDispatchPolicy.Decide(notification.Channel, notification.Type, recipient.Notifications);
        if (!decision.ShouldDeliver)
        {
            // "cancelled", never "failed": nothing broke, the recipient asked not to receive
            // this. Marking it failed would put it back in the retry sweep and mail them anyway.
            notification.Status = NotificationStatuses.Cancelled;
            notification.FailureReason = Truncate(decision.SuppressionReason);
            notification.UpdatedAt = now;
            return;
        }

        NotificationDeliveryResult result;
        try
        {
            result = await sender.SendAsync(notification, NotificationRecipient.From(recipient), cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            // A sender that throws must not take the whole batch down with it, and must not
            // leave the row claiming "sent". The exception text is logged, never echoed to
            // the caller or stored -- a provider exception routinely carries endpoint URLs
            // and credentials.
            loggerFactory.CreateLogger(LogCategory).LogError(
                exception,
                "Notification sender threw while delivering notification {NotificationId} via {Channel}.",
                notification.Id,
                notification.Channel);
            result = NotificationDeliveryResult.Failure("The delivery provider reported an unexpected error.");
        }

        if (result.Delivered)
        {
            notification.Status = NotificationStatuses.Sent;
            notification.SentAt = now;
            notification.FailedAt = null;
            notification.FailureReason = null;
        }
        else
        {
            notification.Status = NotificationStatuses.Failed;
            notification.FailedAt = now;
            notification.FailureReason = Truncate(result.FailureReason) ?? "Delivery failed.";

            // The dead letter (#100). A permanent failure -- the address does not exist, the
            // mailbox is closed, the provider suppressed it -- is retired by exhausting
            // RetryCount rather than by inventing a status: the row stays `failed` and stays
            // visible through GET /notifications?status=failed, but no sweep will pick it up
            // again. Retrying a hard bounce is how a sending domain's reputation gets burned,
            // and no number of attempts changes a 550.
            notification.RetryCount = result.Permanent
                ? notification.MaxRetries
                : notification.RetryCount + 1;
        }

        notification.UpdatedAt = now;
    }

    /// <summary>
    /// UTC now, truncated to microseconds -- the precision Postgres <c>timestamptz</c>
    /// actually stores.
    ///
    /// A .NET tick is 100ns, so an untruncated timestamp written here comes back from a
    /// later read up to nine ticks smaller than the value an endpoint echoed in its
    /// response. That made <c>POST /notifications/{id}/read</c> look non-idempotent: the
    /// first call returned its in-memory <c>OpenedAt</c> and every later call returned the
    /// round-tripped one, so a client diffing the two saw the "first opened at" timestamp
    /// move. It was never actually moving in the database -- but a response that does not
    /// equal what was stored is a bug whichever way round it is. Truncating at the source
    /// makes what we return equal to what we persist, for every timestamp on this surface.
    /// Caught by CI, not by reasoning: it needs a real Postgres round trip to show up.
    ///
    /// The scheduler needs the same truncation for a second reason: a notification's
    /// <c>ScheduledFor</c> is compared against a stored value on the next tick, and a
    /// sub-microsecond difference between what was written and what is read back is exactly
    /// the kind of thing that makes a boundary comparison flip.
    /// </summary>
    public static DateTimeOffset UtcNow()
    {
        var now = DateTimeOffset.UtcNow;
        return now.AddTicks(-(now.Ticks % TimeSpan.TicksPerMicrosecond));
    }

    /// <summary>Clamp to the <c>failure_reason</c> column's width.</summary>
    public static string? Truncate(string? value)
        => value is null || value.Length <= FailureReasonMaxLength
            ? value
            : value[..FailureReasonMaxLength];
}
