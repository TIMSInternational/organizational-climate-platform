using ClimateProject.Application.Notifications;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Notifications;

/// <summary>
/// The self-service preferences contract (#97).
///
/// Two things are pinned here and neither is cosmetic:
///
/// 1. **Five of six are exposed.** <c>NotificationPreferenceTests</c> asserts six columns are
///    stored; this asserts the API shape exposes exactly five and never names push. They are
///    two halves of one decision, so a failure in either is a signal to check the other, not
///    to relax the one that failed.
/// 2. **A partial update changes nothing it was not asked to change.** These are consent
///    flags; an omitted field that quietly reverts to a default would either unsubscribe or
///    re-subscribe someone who said nothing about it in this request.
/// </summary>
public class NotificationPreferenceUpdateTests
{
    [Fact]
    public void The_response_exposes_exactly_five_preferences()
    {
        var exposed = typeof(NotificationPreferencesResponse).GetProperties()
            .Select(p => p.Name)
            .Where(name => name != "EqualityContract")
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(
            [
                nameof(NotificationPreferences.DigestFrequency),
                nameof(NotificationPreferences.EmailActionPlans),
                nameof(NotificationPreferences.EmailMicroclimates),
                nameof(NotificationPreferences.EmailReminders),
                nameof(NotificationPreferences.EmailSurveys),
            ],
            exposed);
    }

    [Fact]
    public void Neither_the_response_nor_the_request_mentions_push()
    {
        // Stored for consent fidelity, not exposed: this repo has no push infrastructure and
        // no device-token storage, so the API must not advertise a channel it cannot deliver
        // on. Wire it in the same change that ships push delivery, once #82 decides on the PWA.
        Assert.DoesNotContain(
            typeof(NotificationPreferencesResponse).GetProperties(),
            p => p.Name.Contains("Push", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(
            typeof(UpdateNotificationPreferencesRequest).GetProperties(),
            p => p.Name.Contains("Push", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void The_stored_type_still_carries_all_six()
        => Assert.Equal(
            6,
            typeof(NotificationPreferences).GetProperties().Length);

    [Fact]
    public void Every_boolean_on_the_update_request_is_nullable()
    {
        // Non-nullable bools would deserialise an omitted field as false and silently
        // unsubscribe the user from everything they did not restate in the request.
        var booleans = typeof(UpdateNotificationPreferencesRequest).GetProperties()
            .Where(p => p.PropertyType == typeof(bool) || p.PropertyType == typeof(bool?))
            .ToArray();

        Assert.Equal(4, booleans.Length);
        Assert.All(booleans, p => Assert.Equal(typeof(bool?), p.PropertyType));
    }

    [Fact]
    public void An_empty_update_changes_nothing()
    {
        var target = new NotificationPreferences
        {
            EmailSurveys = false,
            EmailMicroclimates = false,
            EmailActionPlans = true,
            EmailReminders = false,
            PushNotifications = true,
            DigestFrequency = NotificationPreferenceValidation.DigestNever,
        };

        Assert.True(NotificationPreferenceUpdate.TryApply(target, new UpdateNotificationPreferencesRequest(), out var error));

        Assert.Null(error);
        Assert.False(target.EmailSurveys);
        Assert.False(target.EmailMicroclimates);
        Assert.True(target.EmailActionPlans);
        Assert.False(target.EmailReminders);
        Assert.True(target.PushNotifications);
        Assert.Equal(NotificationPreferenceValidation.DigestNever, target.DigestFrequency);
    }

    [Fact]
    public void Changing_one_field_leaves_every_other_opt_out_exactly_as_stored()
    {
        var target = new NotificationPreferences
        {
            EmailSurveys = false,
            EmailMicroclimates = false,
            EmailActionPlans = false,
            EmailReminders = false,
            DigestFrequency = NotificationPreferenceValidation.DigestNever,
        };

        Assert.True(NotificationPreferenceUpdate.TryApply(
            target,
            new UpdateNotificationPreferencesRequest(EmailSurveys: true),
            out _));

        Assert.True(target.EmailSurveys);
        Assert.False(target.EmailMicroclimates);
        Assert.False(target.EmailActionPlans);
        Assert.False(target.EmailReminders);
        Assert.Equal(NotificationPreferenceValidation.DigestNever, target.DigestFrequency);
    }

    [Fact]
    public void An_opt_out_can_be_turned_off_and_is_persisted_verbatim()
    {
        var target = new NotificationPreferences();

        Assert.True(NotificationPreferenceUpdate.TryApply(
            target,
            new UpdateNotificationPreferencesRequest(EmailReminders: false),
            out _));

        Assert.False(target.EmailReminders);
        Assert.True(target.EmailSurveys);
    }

    [Fact]
    public void Push_is_never_written_by_a_self_service_update()
    {
        var optedIn = new NotificationPreferences { PushNotifications = true };
        var optedOut = new NotificationPreferences { PushNotifications = false };

        var request = new UpdateNotificationPreferencesRequest(
            EmailSurveys: false,
            EmailMicroclimates: false,
            EmailActionPlans: false,
            EmailReminders: false,
            DigestFrequency: NotificationPreferenceValidation.DigestDaily);

        Assert.True(NotificationPreferenceUpdate.TryApply(optedIn, request, out _));
        Assert.True(NotificationPreferenceUpdate.TryApply(optedOut, request, out _));

        Assert.True(optedIn.PushNotifications);
        Assert.False(optedOut.PushNotifications);
    }

    [Theory]
    [InlineData("daily")]
    [InlineData("weekly")]
    [InlineData("monthly")]
    [InlineData("never")]
    public void The_four_legacy_digest_frequencies_are_accepted(string value)
    {
        var target = new NotificationPreferences();

        Assert.True(NotificationPreferenceUpdate.TryApply(
            target, new UpdateNotificationPreferencesRequest(DigestFrequency: value), out _));
        Assert.Equal(value, target.DigestFrequency);
    }

    [Theory]
    [InlineData("Weekly")]
    [InlineData("yearly")]
    [InlineData("")]
    public void An_invalid_digest_frequency_is_rejected(string value)
    {
        var target = new NotificationPreferences();

        Assert.False(NotificationPreferenceUpdate.TryApply(
            target, new UpdateNotificationPreferencesRequest(DigestFrequency: value), out var error));
        Assert.NotNull(error);
    }

    [Fact]
    public void A_rejected_update_leaves_the_stored_preferences_completely_untouched()
    {
        // Validation runs before the first assignment on purpose. A half-applied consent
        // change is not something the user can see, and not something they can correct.
        var target = new NotificationPreferences();

        Assert.False(NotificationPreferenceUpdate.TryApply(
            target,
            new UpdateNotificationPreferencesRequest(EmailSurveys: false, DigestFrequency: "yearly"),
            out _));

        Assert.True(target.EmailSurveys);
        Assert.Equal(NotificationPreferenceValidation.DefaultDigestFrequency, target.DigestFrequency);
    }

    [Fact]
    public void The_rejection_message_lists_the_one_shared_vocabulary()
    {
        var target = new NotificationPreferences();

        NotificationPreferenceUpdate.TryApply(
            target, new UpdateNotificationPreferencesRequest(DigestFrequency: "yearly"), out var error);

        Assert.All(
            NotificationPreferenceValidation.ValidDigestFrequencies,
            frequency => Assert.Contains(frequency, error));
    }

    [Fact]
    public void ToResponse_reads_the_five_exposed_values_verbatim()
    {
        var stored = new NotificationPreferences
        {
            EmailSurveys = false,
            EmailMicroclimates = true,
            EmailActionPlans = false,
            EmailReminders = true,
            PushNotifications = true,
            DigestFrequency = NotificationPreferenceValidation.DigestMonthly,
        };

        var response = NotificationPreferenceUpdate.ToResponse(stored);

        Assert.False(response.EmailSurveys);
        Assert.True(response.EmailMicroclimates);
        Assert.False(response.EmailActionPlans);
        Assert.True(response.EmailReminders);
        Assert.Equal(NotificationPreferenceValidation.DigestMonthly, response.DigestFrequency);
    }
}
