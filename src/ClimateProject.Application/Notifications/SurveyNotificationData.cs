using System.Text.Json;

namespace ClimateProject.Application.Notifications;

/// <summary>
/// The <c>notifications.data</c> payload a survey invitation or reminder carries -- written
/// by <c>SurveyDistributionEndpoints</c> when the row is queued, read back by
/// <c>EmailNotificationSender</c> when the mail is actually composed.
///
/// <para>
/// <b>One class because the two halves live in different projects.</b> The producer is in
/// <c>ClimateProject.Api</c> and the consumer in <c>ClimateProject.Infrastructure</c>, so
/// nothing in a compiler or a test suite connects the string <c>"surveyInvitationId"</c>
/// written in one to the string read in the other. A key typed out twice is how a sender
/// ships green while reading a key the payload never had -- an email that looks composed and
/// arrives without its link, which is precisely the failure this module already had once.
/// Referenced through this class the two move together.
/// </para>
/// <para>
/// <b>The token is deliberately absent, and this is the class that has to keep it absent.</b>
/// <c>GET /notifications?companyId=</c> returns <c>data</c> verbatim to any CompanyAdmin, so
/// a token persisted here would hand every one of them a bearer credential for every
/// employee's invitation -- enough to mark it <c>completed</c> on a non-anonymous survey,
/// irreversibly, locking the real invitee out with a 409 and corrupting the response rate. Not
/// enough to answer as them: see <c>ISurveyInvitationTokens</c>. Only the invitation's
/// <b>id</b> travels; the sender resolves the token
/// from <c>survey_invitations</c> at send time, which also makes revocation real -- an
/// invitation revoked between queueing and sending has no live token left to find.
/// </para>
/// <para>
/// <b>Every read failure is null, never an exception.</b> <c>data</c> is a jsonb column and
/// <c>POST /notifications</c> lets a company admin write one verbatim, so this reads
/// whatever is there: nothing, a JSON array, a number, a truncated object, a key whose value
/// is an object where a string was expected. All of those mean "no invitation named here",
/// which degrades to the link-less mail rather than to a row marked <c>failed</c> that
/// burns its three retries on a payload no retry can fix.
/// </para>
/// </summary>
public static class SurveyNotificationData
{
    /// <summary>The survey the notification is about.</summary>
    public const string SurveyIdKey = "surveyId";

    /// <summary>
    /// The <c>survey_invitations</c> row this recipient's link is built from. An id, never a
    /// token -- see the class remarks.
    /// </summary>
    public const string SurveyInvitationIdKey = "surveyInvitationId";

    /// <summary>
    /// The notification types whose mail carries a survey link. Both are addressed to one
    /// invitee about one invitation; nothing else in <see cref="NotificationTypes"/> is, and
    /// a type not listed here is never looked up in the database at all.
    /// </summary>
    public static readonly string[] LinkCarryingTypes =
    [
        NotificationTypes.SurveyInvitation,
        NotificationTypes.SurveyReminder,
    ];

    /// <summary>Whether a notification of this type should carry a link to its invitation.</summary>
    public static bool CarriesAnInvitationLink(string? type)
        => type is not null && Array.IndexOf(LinkCarryingTypes, type) >= 0;

    /// <summary>
    /// The payload to persist in <c>notifications.data</c>. Serialised, never concatenated:
    /// the column is jsonb and a survey title has already been through a user's keyboard.
    /// </summary>
    public static string Serialize(Guid surveyId, Guid surveyInvitationId)
        => JsonSerializer.Serialize(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [SurveyIdKey] = surveyId.ToString(),
            [SurveyInvitationIdKey] = surveyInvitationId.ToString(),
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

            return payload.RootElement.TryGetProperty(SurveyInvitationIdKey, out var value)
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
