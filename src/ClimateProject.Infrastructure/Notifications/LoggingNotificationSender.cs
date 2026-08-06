using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Notifications;

/// <summary>
/// The stub behind <see cref="INotificationSender"/>: it delivers nothing and reports
/// success, so the whole dispatch path -- authorization, tenancy, consent suppression,
/// persistence, status bookkeeping, retry accounting -- can be exercised end to end without
/// a mail, SMS or push provider existing.
///
/// Mirrors <c>LoggingInvitationEmailSender</c>, which is the established shape for a seam
/// this repo has not yet filled in.
///
/// **It logs no message body.** The invitation stub logs its token because the token is the
/// thing under test; a notification's <c>Message</c> is arbitrary user-authored text that
/// routinely names a person, a department or a survey answer, and application logs are not a
/// place to put that. Id, recipient, channel and type are enough to follow a dispatch through
/// the logs, and none of them is content.
///
/// Replacing this is the whole of #100: register a real sender in <c>Program.cs</c>; nothing
/// upstream changes.
/// </summary>
public class LoggingNotificationSender(ILogger<LoggingNotificationSender> logger) : INotificationSender
{
    public Task<NotificationDeliveryResult> SendAsync(Notification notification, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(notification);
        cancellationToken.ThrowIfCancellationRequested();

        logger.LogInformation(
            "Notification delivery stubbed -- would send notification {NotificationId} of type {NotificationType} " +
            "to user {UserId} via {Channel} at priority {Priority}. No message was actually sent.",
            notification.Id,
            notification.Type,
            notification.UserId,
            notification.Channel,
            notification.Priority);

        return Task.FromResult(NotificationDeliveryResult.Success());
    }
}
