using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace ClimateProject.UnitTests.Notifications;

/// <summary>
/// <c>Notification.Type</c>/<c>Channel</c>/<c>Priority</c>/<c>Status</c> were four free
/// <c>varchar</c> columns with no vocabulary constant anywhere (#97). These pin the constants
/// introduced for them against the two things that can silently disagree with them: the
/// legacy Mongoose enums that production rows contain, and the DDL defaults in
/// <c>NotificationConfiguration</c>.
///
/// The model is built offline -- no Docker, no connection ever opened -- exactly as
/// <c>NotificationPreferenceTests</c> does.
/// </summary>
public class NotificationVocabularyTests
{
    private static IEntityType NotificationEntityType()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql("Host=localhost;Database=model-only")
            .Options;
        using var db = new ClimateProjectDbContext(options);
        return db.Model.FindEntityType(typeof(Notification))!;
    }

    private static IProperty Property(string name) => NotificationEntityType().FindProperty(name)!;

    [Fact]
    public void Channels_are_exactly_the_four_legacy_values()
        => Assert.Equal(["email", "in_app", "push", "sms"], NotificationChannels.All);

    [Fact]
    public void Types_are_exactly_the_nine_legacy_values()
        => Assert.Equal(
            [
                "survey_invitation",
                "survey_reminder",
                "survey_completion",
                "microclimate_invitation",
                "user_invitation",
                "action_plan_alert",
                "deadline_reminder",
                "ai_insight_alert",
                "system_notification",
            ],
            NotificationTypes.All);

    [Fact]
    public void Priorities_are_exactly_the_four_legacy_values()
        => Assert.Equal(["low", "medium", "high", "critical"], NotificationPriorities.All);

    [Fact]
    public void Statuses_are_the_six_legacy_values_not_the_four_the_domain_plan_restated()
    {
        // The notifications domain plan says "pending, sent, delivered, failed". The schema
        // plan that actually produced the column records six, and "cancelled" in particular
        // is load-bearing here -- it is what a preference-suppressed notification becomes.
        Assert.Equal(["pending", "sent", "delivered", "opened", "failed", "cancelled"], NotificationStatuses.All);
        Assert.Contains(NotificationStatuses.Cancelled, NotificationStatuses.All);
        Assert.Contains(NotificationStatuses.Opened, NotificationStatuses.All);
    }

    [Fact]
    public void Push_is_a_known_channel_but_is_not_dispatchable()
    {
        // Same decision as holding PushNotifications off the self-service API: the channel
        // exists in the schema and on templates, but there is no delivery path, so dispatch
        // must refuse it rather than report a send that did not happen.
        Assert.True(NotificationChannels.IsKnown(NotificationChannels.Push));
        Assert.False(NotificationChannels.IsDispatchable(NotificationChannels.Push));
        Assert.DoesNotContain(NotificationChannels.Push, NotificationChannels.Dispatchable);
    }

    [Fact]
    public void Dispatchable_is_derived_from_All_so_a_new_channel_cannot_leave_it_stale()
        => Assert.Equal(
            NotificationChannels.All.Where(channel => channel != NotificationChannels.Push),
            NotificationChannels.Dispatchable);

    [Fact]
    public void Retryable_statuses_exclude_cancelled_so_an_opt_out_is_never_retried_into_a_send()
    {
        Assert.Equal([NotificationStatuses.Pending, NotificationStatuses.Failed], NotificationStatuses.Retryable);
        Assert.DoesNotContain(NotificationStatuses.Cancelled, NotificationStatuses.Retryable);
    }

    [Theory]
    [InlineData("Email")]     // the vocabulary is case-sensitive, as the legacy enums were
    [InlineData("EMAIL")]
    [InlineData("webhook")]
    [InlineData("")]
    [InlineData(null)]
    public void Anything_outside_the_channel_vocabulary_is_rejected(string? channel)
    {
        Assert.False(NotificationChannels.IsKnown(channel));
        Assert.False(NotificationChannels.IsDispatchable(channel));
    }

    [Theory]
    [InlineData("open_text")]
    [InlineData("survey")]
    [InlineData("Survey_Invitation")]
    [InlineData("")]
    [InlineData(null)]
    public void Anything_outside_the_type_vocabulary_is_rejected(string? type)
        => Assert.False(NotificationTypes.IsKnown(type));

    [Fact]
    public void The_priority_constant_default_matches_the_ddl_default()
    {
        var property = Property(nameof(Notification.Priority));

        Assert.Equal("priority", property.GetColumnName());
        Assert.Equal(NotificationPriorities.Default, property.GetDefaultValue());
        Assert.Contains(NotificationPriorities.Default, NotificationPriorities.All);
    }

    [Fact]
    public void The_status_constant_default_matches_the_ddl_default()
    {
        var property = Property(nameof(Notification.Status));

        Assert.Equal("status", property.GetColumnName());
        Assert.Equal(NotificationStatuses.Default, property.GetDefaultValue());
        Assert.Contains(NotificationStatuses.Default, NotificationStatuses.All);
    }

    [Fact]
    public void Every_vocabulary_value_fits_the_column_it_is_stored_in()
    {
        // varchar(32) for type, varchar(20) for the other three. A value longer than its
        // column would only fail on the INSERT, in production, for one unlucky type.
        Assert.All(NotificationTypes.All, type => Assert.True(type.Length <= Property(nameof(Notification.Type)).GetMaxLength()));
        Assert.All(NotificationChannels.All, channel => Assert.True(channel.Length <= Property(nameof(Notification.Channel)).GetMaxLength()));
        Assert.All(NotificationPriorities.All, priority => Assert.True(priority.Length <= Property(nameof(Notification.Priority)).GetMaxLength()));
        Assert.All(NotificationStatuses.All, status => Assert.True(status.Length <= Property(nameof(Notification.Status)).GetMaxLength()));
    }
}
