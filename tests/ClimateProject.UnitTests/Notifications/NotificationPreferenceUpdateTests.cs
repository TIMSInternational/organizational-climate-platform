using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Notifications;

/// <summary>
/// The rules behind the self-service preferences endpoint (#103).
///
/// These run without Postgres, so the two properties that actually protect the user --
/// "an omitted flag is rejected rather than read as false" and "push is neither read nor
/// written by the public API" -- are proved by the unit suite rather than only by the
/// container suite.
/// </summary>
public class NotificationPreferenceUpdateTests
{
    private static UpdateNotificationPreferencesRequest Complete(
        bool emailSurveys = true,
        bool emailMicroclimates = true,
        bool emailActionPlans = true,
        bool emailReminders = true,
        string digestFrequency = "weekly")
        => new(emailSurveys, emailMicroclimates, emailActionPlans, emailReminders, digestFrequency);

    [Fact]
    public void A_complete_request_validates()
        => Assert.Empty(NotificationPreferenceUpdate.Validate(Complete()));

    [Theory]
    [InlineData("daily")]
    [InlineData("weekly")]
    [InlineData("monthly")]
    [InlineData("never")]
    public void Every_legacy_digest_frequency_is_accepted(string frequency)
        => Assert.Empty(NotificationPreferenceUpdate.Validate(Complete(digestFrequency: frequency)));

    [Theory]
    [InlineData("Weekly")]
    [InlineData("yearly")]
    [InlineData("")]
    public void A_digest_frequency_outside_the_vocabulary_is_rejected(string frequency)
    {
        var errors = NotificationPreferenceUpdate.Validate(Complete(digestFrequency: frequency));
        Assert.Contains(errors, e => e.Contains("digestFrequency", StringComparison.Ordinal));
    }

    public static TheoryData<UpdateNotificationPreferencesRequest, string> IncompleteRequests() => new()
    {
        { new(null, true, true, true, "weekly"), "emailSurveys" },
        { new(true, null, true, true, "weekly"), "emailMicroclimates" },
        { new(true, true, null, true, "weekly"), "emailActionPlans" },
        { new(true, true, true, null, "weekly"), "emailReminders" },
        { new(true, true, true, true, null), "digestFrequency" },
    };

    [Theory]
    [MemberData(nameof(IncompleteRequests))]
    public void An_omitted_preference_is_an_error_rather_than_a_silent_opt_out(
        UpdateNotificationPreferencesRequest request, string expectedField)
    {
        // If these were plain bools, System.Text.Json would fill a missing key with false and
        // a partial payload would unsubscribe the user from mail they never asked to stop.
        var errors = NotificationPreferenceUpdate.Validate(request);
        Assert.Contains(errors, e => e.Contains(expectedField, StringComparison.Ordinal));
    }

    [Fact]
    public void Apply_persists_exactly_what_was_submitted()
    {
        var stored = new NotificationPreferences();

        NotificationPreferenceUpdate.Apply(
            stored,
            Complete(
                emailSurveys: false,
                emailMicroclimates: true,
                emailActionPlans: false,
                emailReminders: false,
                digestFrequency: "never"));

        Assert.False(stored.EmailSurveys);
        Assert.True(stored.EmailMicroclimates);
        Assert.False(stored.EmailActionPlans);
        Assert.False(stored.EmailReminders);
        Assert.Equal("never", stored.DigestFrequency);
    }

    [Fact]
    public void Apply_leaves_the_unexposed_push_preference_untouched()
    {
        // Push is stored consent state the API neither shows nor accepts. A round-trip
        // through the preferences page must not overwrite whatever the ETL imported.
        var optedIntoPush = new NotificationPreferences { PushNotifications = true };
        NotificationPreferenceUpdate.Apply(optedIntoPush, Complete(emailSurveys: false));
        Assert.True(optedIntoPush.PushNotifications);

        var optedOutOfPush = new NotificationPreferences { PushNotifications = false };
        NotificationPreferenceUpdate.Apply(optedOutOfPush, Complete(emailSurveys: false));
        Assert.False(optedOutOfPush.PushNotifications);
    }

    [Fact]
    public void Apply_refuses_an_unvalidated_request()
        => Assert.Throws<ArgumentException>(
            () => NotificationPreferenceUpdate.Apply(
                new NotificationPreferences(),
                new UpdateNotificationPreferencesRequest(null, true, true, true, "weekly")));

    [Fact]
    public void The_response_exposes_five_preferences_and_never_push()
    {
        // Five exposed, six stored. This asserts the shape rather than a value, so adding a
        // sixth field to the DTO fails here instead of silently advertising a channel with
        // no delivery path (#82).
        var names = typeof(NotificationPreferencesResponse)
            .GetProperties()
            .Select(p => p.Name)
            .Where(n => n != "EqualityContract")
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(
            [
                nameof(NotificationPreferencesResponse.DigestFrequency),
                nameof(NotificationPreferencesResponse.EmailActionPlans),
                nameof(NotificationPreferencesResponse.EmailMicroclimates),
                nameof(NotificationPreferencesResponse.EmailReminders),
                nameof(NotificationPreferencesResponse.EmailSurveys),
            ],
            names);
        Assert.DoesNotContain(
            names,
            n => n.Contains("Push", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void The_request_accepts_five_preferences_and_never_push()
    {
        var names = typeof(UpdateNotificationPreferencesRequest)
            .GetProperties()
            .Select(p => p.Name)
            .Where(n => n != "EqualityContract")
            .ToArray();

        Assert.Equal(5, names.Length);
        Assert.DoesNotContain(names, n => n.Contains("Push", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void The_response_of_an_untouched_user_is_the_legacy_default_state()
    {
        var response = NotificationPreferenceUpdate.ToResponse(new NotificationPreferences());

        Assert.True(response.EmailSurveys);
        Assert.True(response.EmailMicroclimates);
        Assert.True(response.EmailActionPlans);
        Assert.True(response.EmailReminders);
        Assert.Equal("weekly", response.DigestFrequency);
    }
}
