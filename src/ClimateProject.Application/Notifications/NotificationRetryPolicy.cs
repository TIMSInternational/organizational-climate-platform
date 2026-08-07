using System.Linq.Expressions;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Notifications;

/// <summary>
/// How long a failed notification waits before <c>POST /notifications/process</c> may try it
/// again.
///
/// <para>
/// Before #100 the sweep retried a failed row on the very next call. With a stub sender that
/// was harmless; with a real provider it is the wrong behaviour twice over -- a provider that
/// is rate-limiting or greylisting gets hammered by the exact traffic it just refused, and
/// each retry is a fresh connection to a host that has already said "not now".
/// </para>
/// <para>
/// **No new column, deliberately.** The obvious shape is a <c>next_attempt_at</c> timestamp,
/// which is a migration. <c>Notification.FailedAt</c> and <c>RetryCount</c> are already
/// persisted and between them say everything a backoff needs: when the last attempt failed,
/// and how many have failed. The delay is derived from those rather than stored, which also
/// means changing the schedule is a code change and not a data migration.
/// </para>
/// <para>
/// The schedule is short on purpose. These are minutes, not hours: <c>MaxRetries</c> is 3, so
/// the whole ladder is spent inside six minutes, and a notification that a provider will
/// never accept reaches its dead letter while the admin who dispatched it is still looking at
/// the screen. A longer ladder would be better for a provider outage and much worse for the
/// feedback loop this platform actually needs.
/// </para>
/// </summary>
public static class NotificationRetryPolicy
{
    /// <summary>Wait after the first failed attempt (<c>RetryCount == 1</c>).</summary>
    public static readonly TimeSpan FirstRetryDelay = TimeSpan.FromMinutes(1);

    /// <summary>Wait after every later failed attempt (<c>RetryCount &gt;= 2</c>).</summary>
    public static readonly TimeSpan SubsequentRetryDelay = TimeSpan.FromMinutes(5);

    /// <summary>The <c>RetryCount</c> at which <see cref="SubsequentRetryDelay"/> takes over.</summary>
    public const int SubsequentRetryThreshold = 2;

    /// <summary>
    /// The delay owed after <paramref name="retryCount"/> failed attempts. Zero for a row
    /// that has never been attempted, so a freshly scheduled notification is due the moment
    /// its <c>ScheduledFor</c> passes.
    /// </summary>
    public static TimeSpan DelayAfter(int retryCount) => retryCount switch
    {
        <= 0 => TimeSpan.Zero,
        < SubsequentRetryThreshold => FirstRetryDelay,
        _ => SubsequentRetryDelay,
    };

    /// <summary>
    /// The earliest moment a retry may be attempted, or null when the notification has never
    /// failed and is therefore due as soon as it is scheduled.
    /// </summary>
    public static DateTimeOffset? EarliestRetryAt(DateTimeOffset? failedAt, int retryCount)
        => failedAt is null ? null : failedAt.Value + DelayAfter(retryCount);

    /// <summary>
    /// The same rule as <see cref="IsDue"/>, as an expression the database can run.
    ///
    /// <para>
    /// It has to exist twice because EF Core cannot translate a call to a custom static method
    /// inside a <c>Where</c> -- the constraint that also forced <c>DetailProjection</c> in
    /// <c>NotificationEndpoints</c> to be an <c>Expression</c>. What it must not do is exist
    /// twice in two *files*: the sweep's predicate living inline in the endpoint while the
    /// policy lived here is how the two drift apart. Both statements are here, side by side,
    /// and a unit test asserts they agree -- including that this one really does translate to
    /// SQL, which is the half that cannot be caught by reading it.
    /// </para>
    /// <para>
    /// The cutoffs are computed here, in C#, so what reaches SQL is a plain timestamp
    /// comparison against a constant. The retry-count arms are written as an OR chain rather
    /// than a conditional because the OR form is unambiguously translatable.
    /// </para>
    /// </summary>
    public static Expression<Func<Notification, bool>> DueAt(DateTimeOffset now)
    {
        var firstRetryCutoff = now - FirstRetryDelay;
        var laterRetryCutoff = now - SubsequentRetryDelay;

        return n =>
            NotificationStatuses.Retryable.Contains(n.Status)
            && n.ScheduledFor <= now
            && n.RetryCount < n.MaxRetries
            && (n.FailedAt == null
                || (n.RetryCount < SubsequentRetryThreshold && n.FailedAt <= firstRetryCutoff)
                || (n.RetryCount >= SubsequentRetryThreshold && n.FailedAt <= laterRetryCutoff));
    }

    /// <summary>
    /// Whether a delivery attempt on <paramref name="notification"/> is due at
    /// <paramref name="now"/>. The in-memory statement of the rule; see
    /// <see cref="DueAt"/> for the database's copy of it and why there are two.
    /// </summary>
    public static bool IsDue(Notification notification, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(notification);

        if (Array.IndexOf(NotificationStatuses.Retryable, notification.Status) < 0) return false;
        if (notification.ScheduledFor > now) return false;
        if (notification.RetryCount >= notification.MaxRetries) return false;

        var earliest = EarliestRetryAt(notification.FailedAt, notification.RetryCount);
        return earliest is null || earliest.Value <= now;
    }
}
