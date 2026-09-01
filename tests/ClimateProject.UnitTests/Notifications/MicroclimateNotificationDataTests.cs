using ClimateProject.Application.Notifications;

namespace ClimateProject.UnitTests.Notifications;

/// <summary>
/// The microclimate notification payload (#130), and above all its separation from the survey
/// one.
///
/// <para>
/// <b>Why the separation gets its own tests.</b> The brief for this slice named exactly one
/// trap: <c>SurveyNotificationData</c> names a <c>survey_invitations</c> id, so writing one
/// for a microclimate would be a foreign key into the wrong table. It would not throw. jsonb
/// accepts any object, a GUID parses as a GUID, and
/// <c>ISurveyInvitationTokens.LiveTokenAsync</c> answers "no such row" with a null that the
/// sender is designed to treat as ordinary. The result is a green build and an invitation
/// email with no link in it, for every invitee, forever. So the property under test is not
/// "Serialize round-trips" -- it is "each reader is blind to the other's payload".
/// </para>
/// </summary>
public class MicroclimateNotificationDataTests
{
    private static readonly Guid MicroclimateId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private static readonly Guid InvitationId = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Fact]
    public void A_serialized_payload_round_trips_its_invitation_id()
        => Assert.Equal(
            InvitationId,
            MicroclimateNotificationData.InvitationIdOrNull(
                MicroclimateNotificationData.Serialize(MicroclimateId, InvitationId)));

    /// <summary>
    /// The trap, asserted from the microclimate side: a payload written for a microclimate
    /// names NO survey invitation. If it did, <c>EmailNotificationSender</c> would look this
    /// id up in <c>survey_invitations</c> -- a table it is not in -- and silently mail a
    /// linkless invitation.
    /// </summary>
    [Fact]
    public void A_microclimate_payload_names_no_survey_invitation()
    {
        var payload = MicroclimateNotificationData.Serialize(MicroclimateId, InvitationId);

        Assert.Null(SurveyNotificationData.InvitationIdOrNull(payload));
        Assert.DoesNotContain(SurveyNotificationData.SurveyInvitationIdKey, payload, StringComparison.Ordinal);
    }

    /// <summary>And from the survey side, because the mistake is symmetrical.</summary>
    [Fact]
    public void A_survey_payload_names_no_microclimate_invitation()
    {
        var payload = SurveyNotificationData.Serialize(MicroclimateId, InvitationId);

        Assert.Null(MicroclimateNotificationData.InvitationIdOrNull(payload));
        Assert.DoesNotContain(MicroclimateNotificationData.MicroclimateInvitationIdKey, payload, StringComparison.Ordinal);
    }

    /// <summary>
    /// The two keys differ as STRINGS, which is the mechanism the two assertions above rely
    /// on. Asserted directly so that a rename which happened to make them equal fails here,
    /// with the reason, rather than three tests away.
    /// </summary>
    [Fact]
    public void The_two_payload_keys_are_different_strings()
        => Assert.NotEqual(
            SurveyNotificationData.SurveyInvitationIdKey,
            MicroclimateNotificationData.MicroclimateInvitationIdKey);

    /// <summary>
    /// The link-carrying type sets are disjoint. This is the second of the three independent
    /// guards: even given a mixed-up payload, a <c>microclimate_invitation</c> notification
    /// never enters the survey branch and vice versa.
    /// </summary>
    [Fact]
    public void The_two_link_carrying_type_sets_are_disjoint()
    {
        Assert.Empty(MicroclimateNotificationData.LinkCarryingTypes.Intersect(SurveyNotificationData.LinkCarryingTypes));

        Assert.True(MicroclimateNotificationData.CarriesAnInvitationLink(NotificationTypes.MicroclimateInvitation));
        Assert.False(MicroclimateNotificationData.CarriesAnInvitationLink(NotificationTypes.SurveyInvitation));
        Assert.False(MicroclimateNotificationData.CarriesAnInvitationLink(NotificationTypes.SurveyReminder));
        Assert.False(SurveyNotificationData.CarriesAnInvitationLink(NotificationTypes.MicroclimateInvitation));
        Assert.False(MicroclimateNotificationData.CarriesAnInvitationLink(null));
    }

    /// <summary>
    /// Every malformed payload is a null, never an exception. <c>notifications.data</c> is a
    /// jsonb column a company admin can write verbatim through <c>POST /notifications</c>, so
    /// this reader meets arbitrary input; throwing would mark the row failed and burn its
    /// three retries on a condition no retry can change.
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not json at all")]
    [InlineData("[1, 2, 3]")]
    [InlineData("42")]
    [InlineData("{\"microclimateInvitationId\":")]
    [InlineData("{\"microclimateInvitationId\": 7}")]
    [InlineData("{\"microclimateInvitationId\": {\"id\": \"22222222-2222-2222-2222-222222222222\"}}")]
    [InlineData("{\"microclimateInvitationId\": \"not-a-guid\"}")]
    [InlineData("{\"microclimateId\": \"11111111-1111-1111-1111-111111111111\"}")]
    // Parses, and can only ever miss. Rejected here rather than spending a round trip
    // proving the payload was junk.
    [InlineData("{\"microclimateInvitationId\": \"00000000-0000-0000-0000-000000000000\"}")]
    public void An_unusable_payload_is_null_and_never_an_exception(string? data)
        => Assert.Null(MicroclimateNotificationData.InvitationIdOrNull(data));

    /// <summary>
    /// The token is not in the payload and must never be. <c>GET /notifications?companyId=</c>
    /// returns <c>data</c> verbatim to any CompanyAdmin, so a token here is a bearer credential
    /// for every employee's invitation handed to every administrator.
    /// </summary>
    [Fact]
    public void The_payload_carries_two_ids_and_nothing_else()
    {
        var payload = MicroclimateNotificationData.Serialize(MicroclimateId, InvitationId);

        using var parsed = System.Text.Json.JsonDocument.Parse(payload);
        Assert.Equal(
            [MicroclimateNotificationData.MicroclimateIdKey, MicroclimateNotificationData.MicroclimateInvitationIdKey],
            parsed.RootElement.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
    }
}
