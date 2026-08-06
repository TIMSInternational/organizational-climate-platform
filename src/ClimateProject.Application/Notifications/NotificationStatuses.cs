namespace ClimateProject.Application.Notifications;

/// <summary>
/// <c>Notification.Status</c>'s vocabulary -- the six legacy Mongoose values.
///
/// Note the notifications *domain* plan (<c>2026-08-01-notifications.md</c>) lists only
/// four ("pending, sent, delivered, failed"). That restatement is incomplete: the schema
/// plan that actually produced the column records six, and the extra two are load-bearing
/// here. <see cref="Cancelled"/> in particular is what a preference-suppressed notification
/// becomes -- see <see cref="NotificationDispatchPolicy"/>. Never mark such a row
/// <see cref="Failed"/>: nothing failed, the recipient asked not to receive it, and
/// conflating the two would make an opt-out look like an outage worth retrying.
/// </summary>
public static class NotificationStatuses
{
    /// <summary>Persisted, not yet attempted. The DDL default.</summary>
    public const string Pending = "pending";

    /// <summary>Handed to <c>INotificationSender</c> and accepted by it.</summary>
    public const string Sent = "sent";

    /// <summary>Confirmed by the delivery provider. No sender reports this yet.</summary>
    public const string Delivered = "delivered";

    /// <summary>Recipient opened it. Tracked through <c>OpenedAt</c> rather than this value today.</summary>
    public const string Opened = "opened";

    /// <summary>Delivery was attempted and did not succeed. Eligible for retry while <c>RetryCount &lt; MaxRetries</c>.</summary>
    public const string Failed = "failed";

    /// <summary>Deliberately not delivered. Never retried.</summary>
    public const string Cancelled = "cancelled";

    public static readonly string[] All = [Pending, Sent, Delivered, Opened, Failed, Cancelled];

    /// <summary>Must stay equal to the DDL default in <c>NotificationConfiguration</c>; a unit test asserts it.</summary>
    public const string Default = Pending;

    /// <summary>
    /// Statuses a further delivery attempt may still move off. Derived, not re-listed:
    /// only <see cref="Pending"/> and <see cref="Failed"/> qualify, because
    /// <see cref="Cancelled"/> is a decision rather than an outcome and the rest are terminal.
    /// </summary>
    public static readonly string[] Retryable = [Pending, Failed];

    public static bool IsKnown(string? status)
        => status is not null && Array.IndexOf(All, status) >= 0;
}
