namespace ClimateProject.Application.Email;

/// <summary>
/// The one place mail actually leaves this process.
///
/// Deliberately narrower than <c>INotificationSender</c>: this knows nothing about
/// notifications, preferences, tenancy or retries -- it takes a rendered
/// <see cref="EmailMessage"/> and reports what the provider said. That split is what lets
/// the notification path and the invitation path (#100 retrofits both) share one provider,
/// one credential, and one rate limit, without either of them learning SMTP.
/// </summary>
public interface IEmailTransport
{
    Task<EmailSendOutcome> SendAsync(EmailMessage message, CancellationToken cancellationToken);
}

/// <summary>
/// What one delivery attempt did.
/// </summary>
/// <param name="Delivered">The provider accepted the message for delivery.</param>
/// <param name="Permanent">
/// True when retrying is pointless: the address does not exist, the mailbox is closed, the
/// provider has suppressed it. A caller that retries a permanent failure is not being
/// resilient, it is generating spam complaints against its own sending domain -- which is
/// exactly the reputation damage #100 asks to avoid.
/// </param>
/// <param name="FailureReason">
/// Short, safe-to-persist text. Implementations must **never** put the provider exception
/// message in here: it routinely carries the SMTP host, the username, and the recipient
/// address. It is written verbatim into <c>Notification.FailureReason</c>, which is readable
/// by any company admin of the tenant.
/// </param>
public sealed record EmailSendOutcome(bool Delivered, bool Permanent, string? FailureReason)
{
    public static EmailSendOutcome Success() => new(true, false, null);

    /// <summary>A failure worth another attempt: timeout, connection refused, 4xx greylisting.</summary>
    public static EmailSendOutcome Transient(string reason) => new(false, false, reason);

    /// <summary>
    /// A failure no number of attempts will change: bad address, 5xx rejection.
    /// Named <c>PermanentFailure</c> rather than <c>Permanent</c> because the record already
    /// has a <c>Permanent</c> member -- and it matches
    /// <c>NotificationDeliveryResult.PermanentFailure</c>, which this maps onto.
    /// </summary>
    public static EmailSendOutcome PermanentFailure(string reason) => new(false, true, reason);
}
