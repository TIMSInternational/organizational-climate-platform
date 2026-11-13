namespace ClimateProject.Domain.Entities;

/// <summary>
/// One recipient's bad outcome for one email this product sent: a bounce, a complaint or a
/// rejection, as Amazon SES reported it through SNS (<c>POST /webhooks/ses</c>).
/// </summary>
/// <remarks>
/// <para>
/// <b>Why it exists.</b> On 20 Oct 2026, 10 of the 865 ESPH credential emails bounced and the
/// product could not see a single one of them: the roster said "Código enviado" for each, because
/// the mail server had accepted the message, and that is all a send can know. Finding out took
/// reading AWS by hand. This table is where those outcomes land so the delivery audit can say
/// who never received the email and what the receiving server answered.
/// </para>
/// <para>
/// <b>Only people this database knows.</b> A row is written only when the recipient is a user here
/// (<see cref="UserId"/> is required), and only for mail the product tagged as its own: the SES
/// configuration set is shared with five other products, and their recipients are not ours to keep.
/// </para>
/// <para>
/// <b>Personal data.</b> The address and the server's reply (which often repeats the address) are
/// the subject's. The row is exported with them and deleted on erasure — see
/// <c>SubjectDataMap</c>.
/// </para>
/// </remarks>
public class EmailDeliveryEvent
{
    public Guid Id { get; set; }

    /// <summary>The person the address belonged to when the event arrived.</summary>
    public Guid UserId { get; set; }

    /// <summary>The address SES reported, lower-cased. Kept because a person's address can change later.</summary>
    public required string Email { get; set; }

    /// <summary><c>bounce</c>, <c>complaint</c> or <c>reject</c>.</summary>
    public required string EventType { get; set; }

    /// <summary>SES's words: <c>Permanent</c>, <c>Transient</c> or <c>Undetermined</c>; null for a non-bounce.</summary>
    public string? BounceType { get; set; }

    public string? BounceSubType { get; set; }

    /// <summary>The receiving server's reply as SES relays it, capped at 500 characters.</summary>
    public string? Diagnostic { get; set; }

    /// <summary>When SES says it happened.</summary>
    public DateTimeOffset OccurredAt { get; set; }

    public string? SesMessageId { get; set; }

    /// <summary>The SNS delivery it came in. With the address and type, what makes a redelivery a no-op.</summary>
    public required string SnsMessageId { get; set; }

    public DateTimeOffset ReceivedAt { get; set; }
}
