using System.Globalization;
using System.Text.Json;

namespace ClimateProject.Application.Email;

/// <summary>One recipient's outcome from one SES event.</summary>
/// <param name="EventType"><c>bounce</c>, <c>complaint</c> or <c>reject</c>.</param>
/// <param name="BounceType">
/// SES's own words: <c>Permanent</c> (the address does not exist or refuses for good),
/// <c>Transient</c> (a full mailbox, a server that gave up retrying), <c>Undetermined</c>.
/// </param>
/// <param name="Diagnostic">The receiving server's reply, as SES relays it, capped.</param>
public sealed record SesDeliveryEvent(
    string Recipient,
    string EventType,
    string? BounceType,
    string? BounceSubType,
    string? Diagnostic,
    DateTimeOffset OccurredAt,
    string? SesMessageId);

/// <summary>
/// Reads the SES event inside an SNS notification's <c>Message</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Only this application's mail.</b> The configuration set the app sends through is shared:
/// the sending account carries timssuite.com, altostrats.com and nexadev.ai identities besides
/// timsint.com. The app stamps every message with the SES tag <see cref="AppTagName"/> =
/// <see cref="AppTagValue"/>; an event without it is another product's and is dropped here,
/// so this database never stores somebody else's recipients.
/// </para>
/// <para>
/// Both shapes SES publishes are read — configuration-set events (<c>eventType</c>) and identity
/// notifications (<c>notificationType</c>) — because which one arrives is decided by AWS
/// configuration, not by this code.
/// </para>
/// </remarks>
public static class SesDeliveryEvents
{
    public const string AppTagName = "app";
    public const string AppTagValue = "climate";

    /// <summary>A server reply is a line or two; a page of one is not kept.</summary>
    public const int MaxDiagnosticLength = 500;

    public static IReadOnlyList<SesDeliveryEvent> Parse(string message)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(message);
        }
        catch (JsonException)
        {
            return [];
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("mail", out var mail)
                || mail.ValueKind != JsonValueKind.Object
                || !IsThisApplications(mail))
            {
                return [];
            }

            var kind = (String(root, "eventType") ?? String(root, "notificationType"))?.ToLowerInvariant();
            var messageId = String(mail, "messageId");
            var events = new List<SesDeliveryEvent>();

            switch (kind)
            {
                case "bounce" when root.TryGetProperty("bounce", out var bounce):
                    var at = Time(bounce) ?? Time(mail) ?? DateTimeOffset.UtcNow;
                    foreach (var recipient in Array(bounce, "bouncedRecipients"))
                    {
                        if (String(recipient, "emailAddress") is { } address)
                        {
                            events.Add(new SesDeliveryEvent(
                                Normalise(address), "bounce", String(bounce, "bounceType"), String(bounce, "bounceSubType"),
                                Cap(String(recipient, "diagnosticCode") ?? String(recipient, "status")), at, messageId));
                        }
                    }

                    break;

                case "complaint" when root.TryGetProperty("complaint", out var complaint):
                    var when = Time(complaint) ?? Time(mail) ?? DateTimeOffset.UtcNow;
                    foreach (var recipient in Array(complaint, "complainedRecipients"))
                    {
                        if (String(recipient, "emailAddress") is { } address)
                        {
                            events.Add(new SesDeliveryEvent(
                                Normalise(address), "complaint", null, String(complaint, "complaintFeedbackType"), null, when, messageId));
                        }
                    }

                    break;

                case "reject":
                    var rejectedAt = Time(mail) ?? DateTimeOffset.UtcNow;
                    var reason = root.TryGetProperty("reject", out var reject) ? String(reject, "reason") : null;
                    foreach (var destination in Array(mail, "destination"))
                    {
                        if (destination.ValueKind == JsonValueKind.String && destination.GetString() is { } address)
                        {
                            events.Add(new SesDeliveryEvent(Normalise(address), "reject", null, null, Cap(reason), rejectedAt, messageId));
                        }
                    }

                    break;
            }

            return events;
        }
    }

    private static bool IsThisApplications(JsonElement mail)
        => mail.TryGetProperty("tags", out var tags)
            && tags.ValueKind == JsonValueKind.Object
            && tags.TryGetProperty(AppTagName, out var values)
            && values.ValueKind == JsonValueKind.Array
            && values.EnumerateArray().Any(v => v.ValueKind == JsonValueKind.String && v.GetString() == AppTagValue);

    private static string Normalise(string address) => address.Trim().ToLowerInvariant();

    private static string? Cap(string? text)
        => text is null ? null : text.Length <= MaxDiagnosticLength ? text : text[..MaxDiagnosticLength];

    private static string? String(JsonElement element, string name)
        => element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;

    private static IEnumerable<JsonElement> Array(JsonElement element, string name)
        => element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.Array
                ? value.EnumerateArray().ToList()
                : [];

    private static DateTimeOffset? Time(JsonElement element)
        => String(element, "timestamp") is { } text
            && DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var at)
                ? at
                : null;
}
