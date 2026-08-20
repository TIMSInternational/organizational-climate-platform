using ClimateProject.Application.Email;
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Notifications;

/// <summary>
/// Real notification delivery (#100), replacing <see cref="LoggingNotificationSender"/>
/// wherever a mail provider is configured.
///
/// <para>
/// It is deliberately thin. Everything that decides *whether* to send lives upstream --
/// <c>NotificationDispatchPolicy</c> holds the consent rule and is consulted at delivery
/// time, and the endpoint owns status, retries and persistence. This class turns a
/// notification into an email and reports what the provider said. Adding a second channel
/// later means a second sender, not a branch in this one.
/// </para>
/// <para>
/// **Only email is delivered.** A dispatchable notification can also be <c>in_app</c> or
/// <c>sms</c>. <c>in_app</c> needs no transport at all -- persisting the row *is* the
/// delivery, and the recipient reads it through <c>GET /notifications/mine</c> -- so it is
/// reported as delivered without a send. <c>sms</c> has no provider in this repo and is
/// reported as a permanent failure rather than as success, because a row claiming
/// <c>sent</c> for a message that provably did not go is the failure mode
/// <c>NotificationChannels.Dispatchable</c> was written to prevent. <c>push</c> cannot reach
/// here: it is not dispatchable, and #100 explicitly does not add it.
/// </para>
/// </summary>
public sealed class EmailNotificationSender(
    IEmailTransport transport,
    EmailOptions options,
    ILogger<EmailNotificationSender> logger) : INotificationSender
{
    public async Task<NotificationDeliveryResult> SendAsync(
        Notification notification,
        NotificationRecipient recipient,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(notification);
        ArgumentNullException.ThrowIfNull(recipient);

        if (string.Equals(notification.Channel, NotificationChannels.InApp, StringComparison.Ordinal))
        {
            // The row itself is the artefact. Nothing to transmit, and nothing that can fail.
            return NotificationDeliveryResult.Success();
        }

        if (!string.Equals(notification.Channel, NotificationChannels.Email, StringComparison.Ordinal))
        {
            logger.LogWarning(
                "Notification {NotificationId} targets channel {Channel}, which has no delivery provider. " +
                "Recording a permanent failure rather than reporting a send that did not happen.",
                notification.Id,
                notification.Channel);

            return NotificationDeliveryResult.PermanentFailure(
                $"No delivery provider is configured for the '{notification.Channel}' channel.");
        }

        var message = NotificationEmailComposer.Compose(
            notification,
            recipient,
            options.LinkTo(NotificationEmailComposer.PreferencesPath),
            // The composer picks the survey path out of the notification's payload; this
            // supplies the only thing it must not know, which is the origin to hang it off.
            // Passing the method rather than a resolved URL is what keeps the payload
            // reading in one place instead of half here and half there.
            options.LinkTo);

        var outcome = await transport.SendAsync(message, cancellationToken).ConfigureAwait(false);

        if (outcome.Delivered)
        {
            // Id, channel and recipient id only. The message body is user-authored text that
            // routinely names a person, a department or a survey answer, and application logs
            // are not a place to put that -- the same rule LoggingNotificationSender states.
            logger.LogInformation(
                "Delivered notification {NotificationId} of type {NotificationType} to user {UserId} by email.",
                notification.Id,
                notification.Type,
                recipient.UserId);

            return NotificationDeliveryResult.Success();
        }

        var reason = outcome.FailureReason ?? "The mail provider did not accept the message.";
        return outcome.Permanent
            ? NotificationDeliveryResult.PermanentFailure(reason)
            : NotificationDeliveryResult.Failure(reason);
    }
}
