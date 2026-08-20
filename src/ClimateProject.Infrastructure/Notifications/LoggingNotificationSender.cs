using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Notifications;

/// <summary>
/// The sender that runs when no mail provider is configured. It delivers nothing, and it
/// says so: <see cref="NotificationDeliveryResult.PermanentFailure"/>, never success.
///
/// ## Why this used to return success, and why that was wrong
///
/// The original reading was that a stub should let the whole dispatch path -- authorization,
/// tenancy, consent suppression, persistence, status bookkeeping, retry accounting -- be
/// exercised end to end without a provider existing. That is a good goal and it is still
/// met; it is just not this type's job. A test that wants the delivered branch injects a
/// sender that delivers (see <c>ScriptedNotificationSender</c> in the notification endpoint
/// tests), which states the intent at the test rather than borrowing it from a production
/// default.
///
/// What the success return actually bought was a lie with a very long reach. This sender is
/// the registered default whenever <c>EmailOptions.IsConfigured</c> is false, which is the
/// state production has been in since it went live: the dispatch worker sweeps every minute,
/// takes <c>Delivered</c> at its word and writes <c>Status = sent</c> with a <c>SentAt</c>
/// (see <c>NotificationDelivery</c>). Nothing in the database then distinguished a delivered
/// notification from one that never left the process, and the admin screens reported success
/// in both languages for mail nobody received.
///
/// ## Why PERMANENT failure, and not an ordinary one
///
/// <see cref="NotificationDeliveryResult.Permanent"/> already means exactly this: another
/// attempt cannot possibly succeed. With no provider registered that is not an approximation,
/// it is the literal truth -- the next sweep would call this same stub. So the dispatch path
/// dead-letters the row by exhausting <c>RetryCount</c> instead of retrying a send that has
/// nowhere to go, which is the behaviour #100 asks for and costs no new status and no
/// migration.
///
/// The result is a signal the product already surfaces rather than a silence: the row stays
/// visible through <c>GET /notifications?status=failed</c>, and the dead-lettered counter on
/// the System Health screen becomes an honest reading of "mail is not armed" instead of
/// sitting at zero while nothing is delivered.
///
/// **It logs no message body.** A notification's <c>Message</c> is arbitrary user-authored
/// text that routinely names a person, a department or a survey answer, and application logs
/// are not a place to put that. Id, recipient, channel and type are enough to follow a
/// dispatch through the logs, and none of them is content.
/// </summary>
public class LoggingNotificationSender(ILogger<LoggingNotificationSender> logger) : INotificationSender
{
    /// <summary>
    /// Written verbatim to <c>Notification.FailureReason</c>, so an operator reading a failed
    /// row learns the cause without going to the logs. Names the configuration key, because
    /// the fix is a deployment change and not a retry.
    /// </summary>
    public const string NotConfiguredReason = "No email provider is configured (Email:Provider is 'none').";

    public Task<NotificationDeliveryResult> SendAsync(
        Notification notification,
        NotificationRecipient recipient,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(notification);
        ArgumentNullException.ThrowIfNull(recipient);
        cancellationToken.ThrowIfCancellationRequested();

        logger.LogWarning(
            "Notification {NotificationId} of type {NotificationType} to user {UserId} via {Channel} was NOT sent: "
                + "no email provider is configured. It is recorded as failed, not sent.",
            notification.Id,
            notification.Type,
            recipient.UserId,
            notification.Channel);

        return Task.FromResult(NotificationDeliveryResult.PermanentFailure(NotConfiguredReason));
    }
}
