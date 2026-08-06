using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Notifications;

/// <summary>
/// The consent rule. Four of the six preferences #192 carried across are email opt-outs live
/// users have already exercised, and these pin that dispatch actually honours them -- an
/// opt-out the send path ignores is worse than no opt-out at all.
/// </summary>
public class NotificationDispatchPolicyTests
{
    private static NotificationPreferences AllOn() => new();

    [Theory]
    [InlineData(NotificationTypes.SurveyInvitation)]
    [InlineData(NotificationTypes.SurveyReminder)]
    [InlineData(NotificationTypes.SurveyCompletion)]
    public void Survey_email_is_suppressed_when_EmailSurveys_is_off(string type)
    {
        var preferences = AllOn();
        preferences.EmailSurveys = false;

        var decision = NotificationDispatchPolicy.Decide(NotificationChannels.Email, type, preferences);

        Assert.False(decision.ShouldDeliver);
        Assert.Contains(nameof(NotificationPreferences.EmailSurveys), decision.SuppressionReason);
    }

    [Fact]
    public void Microclimate_email_is_suppressed_when_EmailMicroclimates_is_off()
    {
        var preferences = AllOn();
        preferences.EmailMicroclimates = false;

        Assert.False(NotificationDispatchPolicy
            .Decide(NotificationChannels.Email, NotificationTypes.MicroclimateInvitation, preferences).ShouldDeliver);
    }

    [Fact]
    public void Action_plan_email_is_suppressed_when_EmailActionPlans_is_off()
    {
        var preferences = AllOn();
        preferences.EmailActionPlans = false;

        Assert.False(NotificationDispatchPolicy
            .Decide(NotificationChannels.Email, NotificationTypes.ActionPlanAlert, preferences).ShouldDeliver);
    }

    [Fact]
    public void Deadline_email_is_suppressed_when_EmailReminders_is_off()
    {
        var preferences = AllOn();
        preferences.EmailReminders = false;

        Assert.False(NotificationDispatchPolicy
            .Decide(NotificationChannels.Email, NotificationTypes.DeadlineReminder, preferences).ShouldDeliver);
    }

    [Fact]
    public void Turning_one_preference_off_suppresses_only_the_types_it_governs()
    {
        // The failure this guards against is a mapping typo that quietly widens one opt-out
        // into a blanket unsubscribe -- which looks like "the emails stopped" to a user who
        // only ever turned off surveys.
        var preferences = AllOn();
        preferences.EmailSurveys = false;

        Assert.False(NotificationDispatchPolicy
            .Decide(NotificationChannels.Email, NotificationTypes.SurveyInvitation, preferences).ShouldDeliver);
        Assert.True(NotificationDispatchPolicy
            .Decide(NotificationChannels.Email, NotificationTypes.MicroclimateInvitation, preferences).ShouldDeliver);
        Assert.True(NotificationDispatchPolicy
            .Decide(NotificationChannels.Email, NotificationTypes.ActionPlanAlert, preferences).ShouldDeliver);
        Assert.True(NotificationDispatchPolicy
            .Decide(NotificationChannels.Email, NotificationTypes.DeadlineReminder, preferences).ShouldDeliver);
    }

    [Fact]
    public void A_brand_new_user_receives_every_type_of_email()
    {
        // The legacy defaults are all opt-in, so nobody is accidentally silenced by never
        // having touched their settings.
        Assert.All(
            NotificationTypes.All,
            type => Assert.True(
                NotificationDispatchPolicy.Decide(NotificationChannels.Email, type, AllOn()).ShouldDeliver,
                $"a default user should still receive '{type}' email"));
    }

    [Theory]
    [InlineData(NotificationChannels.InApp)]
    [InlineData(NotificationChannels.Sms)]
    public void Non_email_channels_are_never_gated_by_the_email_preferences(string channel)
    {
        // Every stored preference is named Email*, and legacy only ever applied them to mail.
        // Suppressing the in-app inbox would hide notifications the user can only see by
        // opening the product -- something nobody opted out of.
        var preferences = new NotificationPreferences
        {
            EmailSurveys = false,
            EmailMicroclimates = false,
            EmailActionPlans = false,
            EmailReminders = false,
        };

        Assert.All(
            NotificationTypes.All,
            type => Assert.True(NotificationDispatchPolicy.Decide(channel, type, preferences).ShouldDeliver));
    }

    [Theory]
    [InlineData(NotificationTypes.UserInvitation)]
    [InlineData(NotificationTypes.SystemNotification)]
    [InlineData(NotificationTypes.AiInsightAlert)]
    public void Transactional_types_are_delivered_even_with_every_preference_off(string type)
    {
        // user_invitation especially: the recipient has not accepted yet, so there is no
        // preference expressing a choice, and suppressing it leaves the account unreachable.
        var preferences = new NotificationPreferences
        {
            EmailSurveys = false,
            EmailMicroclimates = false,
            EmailActionPlans = false,
            EmailReminders = false,
        };

        Assert.True(NotificationDispatchPolicy.Decide(NotificationChannels.Email, type, preferences).ShouldDeliver);
        Assert.Null(NotificationDispatchPolicy.GoverningPreference(type));
        Assert.Contains(type, NotificationDispatchPolicy.Ungoverned);
    }

    [Fact]
    public void Every_type_is_either_governed_or_deliberately_ungoverned()
    {
        // Derived, so adding a type to NotificationTypes.All lands in exactly one bucket and
        // cannot be silently forgotten by the policy.
        var governed = NotificationTypes.All.Where(type => NotificationDispatchPolicy.GoverningPreference(type) is not null);

        Assert.Equal(
            NotificationTypes.All.OrderBy(type => type, StringComparer.Ordinal),
            governed.Concat(NotificationDispatchPolicy.Ungoverned).OrderBy(type => type, StringComparer.Ordinal));
    }

    [Fact]
    public void The_governed_map_names_only_preferences_that_actually_exist_on_the_entity()
    {
        // A typo in a nameof-free string here would fall through to the switch's fail-closed
        // default and silently suppress every email of that type.
        var properties = typeof(NotificationPreferences).GetProperties().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);

        foreach (var type in NotificationTypes.All)
        {
            var governing = NotificationDispatchPolicy.GoverningPreference(type);
            if (governing is not null)
            {
                Assert.Contains(governing, properties);
            }
        }
    }

    [Fact]
    public void PushNotifications_governs_nothing_because_push_cannot_be_dispatched()
    {
        // The sixth stored preference is consent state only. If it ever starts governing a
        // dispatch decision, that is the change that must also expose it on the API.
        Assert.All(
            NotificationTypes.All,
            type => Assert.NotEqual(
                nameof(NotificationPreferences.PushNotifications),
                NotificationDispatchPolicy.GoverningPreference(type)));
    }

    [Fact]
    public void An_unknown_type_on_the_email_channel_is_delivered_rather_than_silently_dropped()
    {
        // Dispatch already rejects unknown types with a 400, so anything reaching the policy
        // with one came from a stored row. Dropping it here would make an imported legacy row
        // vanish with no trace; the visible failure belongs at the API boundary.
        Assert.True(NotificationDispatchPolicy.Decide(NotificationChannels.Email, "not_a_real_type", AllOn()).ShouldDeliver);
    }
}
