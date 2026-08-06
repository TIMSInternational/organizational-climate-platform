using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace ClimateProject.UnitTests.OrgStructure;

// #192 carries the six legacy notification_settings preferences onto users. Four of them
// are email opt-outs that live users have already exercised, so the defaults are not a
// stylistic choice -- a default that differs from legacy User.ts NotificationSettingsSchema
// silently re-subscribes everyone who turned one off the moment the ETL (#154) imports them.
//
// The DB-level proof is the raw-SQL pair in UserProfileTests, which needs Docker. These
// tests pin the same contract off the EF model, which needs nothing: model building is
// entirely offline, so a dropped HasDefaultValue is caught by the unit suite too rather
// than only by the container suite.
public class NotificationPreferenceTests
{
    private static IEntityType NotificationsEntityType()
    {
        // A connection string is required to build the Npgsql model but never opened --
        // nothing here touches a database.
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql("Host=localhost;Database=model-only")
            .Options;
        using var db = new ClimateProjectDbContext(options);
        return db.Model.FindEntityType(typeof(User))!
            .FindNavigation(nameof(User.Notifications))!
            .TargetEntityType;
    }

    private static IProperty Property(string name) => NotificationsEntityType().FindProperty(name)!;

    [Theory]
    [InlineData(nameof(NotificationPreferences.EmailSurveys), "notifications_email_surveys", true)]
    [InlineData(nameof(NotificationPreferences.EmailMicroclimates), "notifications_email_microclimates", true)]
    [InlineData(nameof(NotificationPreferences.EmailActionPlans), "notifications_email_action_plans", true)]
    [InlineData(nameof(NotificationPreferences.EmailReminders), "notifications_email_reminders", true)]
    [InlineData(nameof(NotificationPreferences.PushNotifications), "notifications_push", false)]
    public void Every_boolean_preference_is_not_null_with_the_legacy_default_in_the_ddl(
        string propertyName, string columnName, bool legacyDefault)
    {
        var property = Property(propertyName);

        Assert.Equal(columnName, property.GetColumnName());
        Assert.False(property.IsNullable);
        // GetDefaultValue() is the DDL default. A CLR object-initializer default would leave
        // this null, and would never reach a row written by the ETL or by raw SQL.
        Assert.Equal(legacyDefault, property.GetDefaultValue());
    }

    [Fact]
    public void Digest_frequency_is_not_null_with_the_legacy_weekly_default_in_the_ddl()
    {
        var property = Property(nameof(NotificationPreferences.DigestFrequency));

        Assert.Equal("notifications_digest_frequency", property.GetColumnName());
        Assert.False(property.IsNullable);
        Assert.Equal("weekly", property.GetDefaultValue());
        Assert.Equal(20, property.GetMaxLength());
    }

    [Fact]
    public void All_six_legacy_preferences_are_stored_even_though_only_five_are_exposed()
    {
        // Push is stored for consent fidelity but deliberately held off #97's self-service
        // API until #82 decides whether the PWA ships -- there is no push infrastructure and
        // no device-token storage in this repo, so the API must not advertise a channel with
        // no delivery path. Dropping the column instead would lose the legacy value on import
        // and later default everyone to something they never chose. This test exists so that
        // "we only expose five" never quietly decays into "we only store five".
        var stored = NotificationsEntityType().GetProperties()
            .Select(p => p.GetColumnName())
            .Where(c => c.StartsWith("notifications_", StringComparison.Ordinal))
            .OrderBy(c => c, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(
            [
                "notifications_digest_frequency",
                "notifications_email_action_plans",
                "notifications_email_microclimates",
                "notifications_email_reminders",
                "notifications_email_surveys",
                "notifications_push",
            ],
            stored);
    }

    [Fact]
    public void The_clr_initialiser_agrees_with_the_ddl_default_for_a_brand_new_user()
    {
        // The two defaults are written in different files and could drift. A new user created
        // through the app must land on exactly the same six values a legacy row imported by
        // the ETL lands on, or "never touched their settings" would mean two different things
        // depending on how the row got there.
        var fresh = new NotificationPreferences();

        Assert.Equal(Property(nameof(NotificationPreferences.EmailSurveys)).GetDefaultValue(), fresh.EmailSurveys);
        Assert.Equal(Property(nameof(NotificationPreferences.EmailMicroclimates)).GetDefaultValue(), fresh.EmailMicroclimates);
        Assert.Equal(Property(nameof(NotificationPreferences.EmailActionPlans)).GetDefaultValue(), fresh.EmailActionPlans);
        Assert.Equal(Property(nameof(NotificationPreferences.EmailReminders)).GetDefaultValue(), fresh.EmailReminders);
        Assert.Equal(Property(nameof(NotificationPreferences.PushNotifications)).GetDefaultValue(), fresh.PushNotifications);
        Assert.Equal(Property(nameof(NotificationPreferences.DigestFrequency)).GetDefaultValue(), fresh.DigestFrequency);
        Assert.Equal(NotificationPreferenceValidation.DefaultDigestFrequency, fresh.DigestFrequency);
    }

    [Fact]
    public void A_new_user_holds_the_legacy_opt_in_state_verbatim()
    {
        // Lifted straight from legacy User.ts NotificationSettingsSchema.
        var fresh = new NotificationPreferences();

        Assert.True(fresh.EmailSurveys);
        Assert.True(fresh.EmailMicroclimates);
        Assert.True(fresh.EmailActionPlans);
        Assert.True(fresh.EmailReminders);
        Assert.False(fresh.PushNotifications);
        Assert.Equal("weekly", fresh.DigestFrequency);
    }

    [Theory]
    [InlineData("daily")]
    [InlineData("weekly")]
    [InlineData("monthly")]
    [InlineData("never")]
    public void Legacy_digest_frequencies_are_accepted(string value)
        => Assert.True(NotificationPreferenceValidation.IsValidDigestFrequency(value));

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("Weekly")]     // the vocabulary is case-sensitive, as legacy's enum was
    [InlineData("yearly")]     // plausible, but not a value legacy ever wrote
    [InlineData("real_time")]
    public void Anything_outside_the_legacy_vocabulary_is_rejected(string? value)
        => Assert.False(NotificationPreferenceValidation.IsValidDigestFrequency(value));

    [Fact]
    public void The_vocabulary_is_exactly_the_four_legacy_values()
        => Assert.Equal(
            ["daily", "weekly", "monthly", "never"],
            NotificationPreferenceValidation.ValidDigestFrequencies);
}
