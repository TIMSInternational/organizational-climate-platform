using System.Text.Json;

namespace ClimateProject.Application.Notifications;

/// <summary>
/// The <c>notifications.data</c> payload a microclimate invitation carries -- written by
/// <c>MicroclimateInvitationEndpoints</c> when the row is queued, read back by
/// <c>EmailNotificationSender</c> when the mail is actually composed.
///
/// <para>
/// <b>A separate class from <see cref="SurveyNotificationData"/>, and this is the single most
/// load-bearing decision in #130.</b> The two payloads look identical -- an id and a parent
/// id -- and they are not interchangeable in the slightest.
/// <see cref="SurveyNotificationData.SurveyInvitationIdKey"/> names a row in
/// <c>survey_invitations</c>; this one names a row in <c>microclimate_invitations</c>. They
/// are different tables with different primary keys behind different foreign keys. Writing a
/// microclimate invitation's id under <c>surveyInvitationId</c> would not fail loudly: the
/// column is jsonb, the value is a well-formed GUID, and
/// <c>ISurveyInvitationTokens.LiveTokenAsync</c> would simply find no such
/// <c>survey_invitations</c> row and degrade to a link-less mail. Every test would pass and
/// every invitee would receive an email with no way into their pulse. So the key is
/// different, the class is different, and <see cref="LinkCarryingTypes"/> here names only the
/// microclimate type -- three separate reasons a mix-up has to be deliberate.
/// </para>
/// <para>
/// <b>The token is deliberately absent, and this is the class that has to keep it absent.</b>
/// <c>GET /notifications?companyId=</c> returns <c>data</c> verbatim to any CompanyAdmin, so
/// a token persisted here would hand every one of them a bearer credential for every
/// employee's invitation -- enough to mark a non-anonymous microclimate's invitation
/// <c>completed</c>, irreversibly, locking the real invitee out and corrupting the
/// participation rate. Not enough to answer as them: see
/// <c>IMicroclimateInvitationTokens</c>. Only the invitation's <b>id</b> travels; the sender
/// resolves the token from <c>microclimate_invitations</c> at send time, which also makes
/// revocation real -- an invitation revoked between queueing and sending has no live token
/// left to find.
/// </para>
/// <para>
/// <b>Every read failure is null, never an exception.</b> <c>data</c> is a jsonb column and
/// <c>POST /notifications</c> lets a company admin write one verbatim, so this reads whatever
/// is there: nothing, a JSON array, a number, a truncated object, a key whose value is an
/// object where a string was expected. All of those mean "no invitation named here", which
/// degrades to the link-less mail rather than to a row marked <c>failed</c> that burns its
/// three retries on a payload no retry can fix.
/// </para>
/// </summary>
public static class MicroclimateNotificationData
{
    /// <summary>The microclimate the notification is about.</summary>
    public const string MicroclimateIdKey = "microclimateId";

    /// <summary>
    /// The <c>microclimate_invitations</c> row this recipient's link is built from. An id,
    /// never a token -- see the class remarks. And spelled differently from
    /// <see cref="SurveyNotificationData.SurveyInvitationIdKey"/> so that a payload written
    /// for one surface is inert on the other rather than plausible.
    /// </summary>
    public const string MicroclimateInvitationIdKey = "microclimateInvitationId";

    /// <summary>
    /// The notification types whose mail carries a microclimate link. Exactly one today:
    /// there is no <c>microclimate_reminder</c> type in <see cref="NotificationTypes"/>, and
    /// inventing one here would be inventing a vocabulary member the rest of the product does
    /// not know.
    /// </summary>
    public static readonly string[] LinkCarryingTypes = [NotificationTypes.MicroclimateInvitation];

    /// <summary>Whether a notification of this type should carry a link to its microclimate invitation.</summary>
    public static bool CarriesAnInvitationLink(string? type)
        => type is not null && Array.IndexOf(LinkCarryingTypes, type) >= 0;

    /// <summary>
    /// The payload to persist in <c>notifications.data</c>. Serialised, never concatenated:
    /// the column is jsonb and a microclimate title has already been through a user's
    /// keyboard.
    /// </summary>
    public static string Serialize(Guid microclimateId, Guid microclimateInvitationId)
        => JsonSerializer.Serialize(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [MicroclimateIdKey] = microclimateId.ToString(),
            [MicroclimateInvitationIdKey] = microclimateInvitationId.ToString(),
        });

    /// <summary>
    /// The invitation id a payload names, or null when it names none that can be trusted.
    ///
    /// <para>
    /// <see cref="Guid.Empty"/> is rejected alongside the unparseable. It parses, so nothing
    /// downstream would object, but it can only ever miss, and a lookup guaranteed to miss is
    /// a database round trip spent proving the payload was junk.
    /// </para>
    /// </summary>
    /// <param name="data">The raw <c>data</c> column. Arbitrary JSON, or not JSON at all.</param>
    public static Guid? InvitationIdOrNull(string? data)
    {
        if (string.IsNullOrWhiteSpace(data))
        {
            return null;
        }

        try
        {
            using var payload = JsonDocument.Parse(data);
            if (payload.RootElement.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            return payload.RootElement.TryGetProperty(MicroclimateInvitationIdKey, out var value)
                   && value.ValueKind == JsonValueKind.String
                   && Guid.TryParse(value.GetString(), out var invitationId)
                   && invitationId != Guid.Empty
                ? invitationId
                : null;
        }
        catch (JsonException)
        {
            // Not JSON, or nested past the reader's depth limit. Either way there is no
            // payload to read and the mail still has to go out.
            return null;
        }
    }
}
