using ClimateProject.Application.Email;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Surveys;
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
/// <para>
/// **The one thing it is not thin about: the survey link.** A <c>survey_invitation</c> or
/// <c>survey_reminder</c> row carries the invitation's <b>id</b> and deliberately not its
/// token, because <c>notifications.data</c> is readable by any CompanyAdmin through
/// <c>GET /notifications?companyId=</c> -- and a leaked token lets its holder mark another
/// employee's invitation <c>completed</c>, irreversibly, which locks the real invitee out of
/// their own survey with a 409 and falsifies the response rate. (It does not let them answer
/// AS that employee; see <see cref="ISurveyInvitationTokens"/> for why, and for what the
/// token does and does not buy.) So this class makes the trip to <c>survey_invitations</c> that
/// turns the id into <c>/survey-invitations/{token}</c>, and it makes it <b>here</b>, at send
/// time, rather than at queue time. That placement is the whole security argument: an
/// invitation revoked in the minutes between the row being queued and the sweep picking it up
/// has no live token left to find, so revocation is real rather than eventual.
/// </para>
/// <para>
/// **A failed lookup is a link-less mail, never a failed send.** Everything about resolving
/// the link degrades to null -- a missing row, a revoked row, an unparseable payload -- and
/// null means the recipient gets the message they were sent minus its button. Throwing, or
/// returning a failure, would mark the row <c>failed</c> and spend its three retries on a
/// condition no retry can change.
/// </para>
/// </summary>
public sealed class EmailNotificationSender(
    IEmailTransport transport,
    EmailOptions options,
    ISurveyInvitationTokens invitationTokens,
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
            await SurveyUrlAsync(notification, recipient, cancellationToken).ConfigureAwait(false));

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

    /// <summary>
    /// The absolute URL this notification's recipient should follow, or null when there is
    /// none to give them.
    ///
    /// <para>
    /// **The type check comes first, and it is a guard on the database, not a tidy-up.**
    /// Everything that is not a survey invitation or reminder returns before the payload is
    /// even parsed, so an <c>action_plan_alert</c> or a <c>system_notification</c> costs no
    /// query. The dispatch sweep sends in batches; one wasted round trip per mail is a
    /// wasted round trip per mail.
    /// </para>
    /// <para>
    /// **The URL is built from a resolved token, never from caller text.** The only thing
    /// the payload contributes is which invitation to look up, as a parsed
    /// <see cref="Guid"/>; the characters in the mailed link come from
    /// <c>survey_invitations.invitation_token</c>, a column nothing but
    /// <c>SurveyAccessTokens.Mint</c> ever writes. So no <c>data</c> blob -- and
    /// <c>POST /notifications</c> lets a company admin write one verbatim -- can change the
    /// host or the shape of a URL mailed under this platform's own sending domain.
    /// </para>
    /// <para>
    /// **That is not on its own enough, and saying only that is how this method was wrong
    /// once.** A caller who cannot change the shape of the URL can still change *whose* token
    /// is in it, because the id is theirs to choose. The defence is not here at all: it is the
    /// scope passed to <see cref="ISurveyInvitationTokens.LiveTokenAsync"/>, which refuses to
    /// return a token that does not belong to the recipient this mail is addressed to, in this
    /// notification's own tenant.
    /// </para>
    /// </summary>
    private async Task<string?> SurveyUrlAsync(
        Notification notification,
        NotificationRecipient recipient,
        CancellationToken cancellationToken)
    {
        if (!SurveyNotificationData.CarriesAnInvitationLink(notification.Type))
        {
            return null;
        }

        if (SurveyNotificationData.InvitationIdOrNull(notification.Data) is not { } invitationId)
        {
            logger.LogWarning(
                "Notification {NotificationId} of type {NotificationType} names no usable invitation in its data payload; "
                + "sending it without a survey link.",
                notification.Id,
                notification.Type);

            return null;
        }

        // Scoped to the mailbox this message is addressed to and to the notification's own
        // tenant. The id above is caller-controlled -- POST /notifications writes `data`
        // verbatim -- so without these two the choice of id would be a choice of victim: a
        // CompanyAdmin could name any employee's, or any other tenant's, invitation and have
        // this method mail them that person's token. See ISurveyInvitationTokens.
        var token = await invitationTokens
            .LiveTokenAsync(invitationId, recipient.UserId, notification.CompanyId, cancellationToken)
            .ConfigureAwait(false);
        if (token is null)
        {
            // Revoked, deleted, or never this recipient's to begin with -- one outcome, because
            // from the recipient's side they are one outcome. Information-only, and the id
            // never the token, for the reason the delivery log below states.
            logger.LogInformation(
                "Survey invitation {SurveyInvitationId} has no live token for the recipient of notification "
                + "{NotificationId}, which is therefore being sent without a survey link.",
                invitationId,
                notification.Id);

            return null;
        }

        // The same configured AppBaseUrl the preferences link uses, so staging mail cannot
        // send a recipient into production.
        return options.LinkTo(SurveyAccessTokens.InvitationLinkPath(token));
    }
}
