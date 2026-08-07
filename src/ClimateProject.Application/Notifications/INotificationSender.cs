using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Notifications;

/// <summary>
/// The delivery seam. Everything upstream of this interface -- authorization, tenancy,
/// consent, persistence, status bookkeeping -- is built and tested; what sits behind it is
/// either the logging stub or, once a provider is configured, a real sender (#100).
///
/// Mirrors <c>IInvitationEmailSender</c>, with one deliberate difference: this returns a
/// <see cref="NotificationDeliveryResult"/> instead of a bare <c>Task</c>. A real mail or
/// SMS provider rejects individual recipients routinely (hard bounce, suppression list,
/// unroutable number), and that is an ordinary outcome the caller must record in
/// <c>FailedAt</c>/<c>FailureReason</c>/<c>RetryCount</c> -- not an exception. Callers still
/// catch exceptions on top of this, for the genuinely unexpected.
/// </summary>
public interface INotificationSender
{
    /// <param name="recipient">
    /// The addressee. Passed in rather than looked up, because the notification row holds a
    /// user id and no address -- see <see cref="NotificationRecipient"/> for why the lookup
    /// stays out of the sender.
    /// </param>
    Task<NotificationDeliveryResult> SendAsync(
        Notification notification,
        NotificationRecipient recipient,
        CancellationToken cancellationToken);
}

/// <summary>
/// The outcome of one delivery attempt. <see cref="FailureReason"/> is written verbatim to
/// <c>Notification.FailureReason</c> (varchar(1000)), so senders must keep it short and must
/// not put provider credentials or recipient PII in it.
/// </summary>
public sealed record NotificationDeliveryResult(bool Delivered, string? FailureReason)
{
    /// <summary>
    /// True when another attempt cannot possibly succeed -- the address does not exist, the
    /// mailbox is closed, the provider has suppressed it.
    ///
    /// The dispatch path dead-letters these by exhausting <c>RetryCount</c> rather than by
    /// inventing a status: the row stays <c>failed</c> and visible through
    /// <c>GET /notifications?status=failed</c>, but <c>POST /notifications/process</c> never
    /// picks it up again. Retrying a hard bounce is how a sending domain's reputation gets
    /// burned, which is the thing #100 explicitly asks not to do.
    ///
    /// An init property rather than a fourth positional parameter so that every existing
    /// construction site -- and every test that pattern-matches on the record -- keeps
    /// compiling and keeps meaning "transient".
    /// </summary>
    public bool Permanent { get; init; }

    public static NotificationDeliveryResult Success() => new(true, null);

    /// <summary>A failure worth retrying. The default reading of any failure.</summary>
    public static NotificationDeliveryResult Failure(string reason) => new(false, reason);

    /// <summary>A failure that must never be retried.</summary>
    public static NotificationDeliveryResult PermanentFailure(string reason) => new(false, reason) { Permanent = true };
}
