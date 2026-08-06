using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Notifications;

/// <summary>
/// The delivery seam. Everything upstream of this interface -- authorization, tenancy,
/// consent, persistence, status bookkeeping -- is built and tested; everything downstream
/// of it is a stub until #100 wires a real provider in. Swapping the registration in
/// <c>Program.cs</c> is the entire change.
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
    Task<NotificationDeliveryResult> SendAsync(Notification notification, CancellationToken cancellationToken);
}

/// <summary>
/// The outcome of one delivery attempt. <see cref="FailureReason"/> is written verbatim to
/// <c>Notification.FailureReason</c> (varchar(1000)), so senders must keep it short and must
/// not put provider credentials or recipient PII in it.
/// </summary>
public sealed record NotificationDeliveryResult(bool Delivered, string? FailureReason)
{
    public static NotificationDeliveryResult Success() => new(true, null);

    public static NotificationDeliveryResult Failure(string reason) => new(false, reason);
}
