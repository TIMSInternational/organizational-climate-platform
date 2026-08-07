using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Notifications;

/// <summary>
/// The backoff (#100). Before it, <c>POST /notifications/process</c> re-attempted a row the
/// instant after it failed -- harmless against a stub, and against a real provider a way of
/// answering "not right now" by immediately asking again.
///
/// <c>ProcessDueAsync</c> restates this rule as a LINQ predicate because EF cannot translate a
/// call to a custom static method inside a <c>Where</c>. These tests pin the rule; an
/// integration test pins that the query agrees with it.
/// </summary>
public class NotificationRetryPolicyTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 5, 12, 0, 0, TimeSpan.Zero);

    private static Notification Pending(Action<Notification>? adjust = null)
    {
        var notification = new Notification
        {
            Id = Guid.NewGuid(),
            UserId = Guid.NewGuid(),
            CompanyId = Guid.NewGuid(),
            Type = NotificationTypes.SystemNotification,
            Channel = NotificationChannels.Email,
            Status = NotificationStatuses.Pending,
            Title = "Title",
            Message = "Message",
            ScheduledFor = Now.AddMinutes(-1),
            MaxRetries = 3,
        };

        adjust?.Invoke(notification);
        return notification;
    }

    [Fact]
    public void A_never_attempted_notification_is_due_as_soon_as_it_is_scheduled()
    {
        Assert.True(NotificationRetryPolicy.IsDue(Pending(), Now));
        Assert.Equal(TimeSpan.Zero, NotificationRetryPolicy.DelayAfter(0));
        Assert.Null(NotificationRetryPolicy.EarliestRetryAt(null, 0));
    }

    [Fact]
    public void A_future_dated_notification_is_not_due()
    {
        Assert.False(NotificationRetryPolicy.IsDue(Pending(n => n.ScheduledFor = Now.AddHours(1)), Now));
    }

    [Fact]
    public void A_row_that_just_failed_is_not_due_until_the_first_delay_has_passed()
    {
        var justFailed = Pending(n =>
        {
            n.Status = NotificationStatuses.Failed;
            n.RetryCount = 1;
            n.FailedAt = Now.AddSeconds(-30);
        });

        Assert.False(NotificationRetryPolicy.IsDue(justFailed, Now));

        justFailed.FailedAt = Now - NotificationRetryPolicy.FirstRetryDelay;
        Assert.True(NotificationRetryPolicy.IsDue(justFailed, Now));
    }

    [Fact]
    public void The_delay_lengthens_after_the_first_retry()
    {
        Assert.Equal(NotificationRetryPolicy.FirstRetryDelay, NotificationRetryPolicy.DelayAfter(1));
        Assert.Equal(NotificationRetryPolicy.SubsequentRetryDelay, NotificationRetryPolicy.DelayAfter(2));
        Assert.Equal(NotificationRetryPolicy.SubsequentRetryDelay, NotificationRetryPolicy.DelayAfter(9));
        Assert.True(NotificationRetryPolicy.SubsequentRetryDelay > NotificationRetryPolicy.FirstRetryDelay);
    }

    [Fact]
    public void A_second_failure_waits_the_longer_delay()
    {
        var twiceFailed = Pending(n =>
        {
            n.Status = NotificationStatuses.Failed;
            n.RetryCount = 2;
            n.FailedAt = Now - NotificationRetryPolicy.FirstRetryDelay;
        });

        Assert.False(NotificationRetryPolicy.IsDue(twiceFailed, Now));

        twiceFailed.FailedAt = Now - NotificationRetryPolicy.SubsequentRetryDelay;
        Assert.True(NotificationRetryPolicy.IsDue(twiceFailed, Now));
    }

    [Fact]
    public void An_exhausted_retry_budget_is_never_due_however_long_it_waits()
    {
        // This is the dead letter: a permanent failure sets RetryCount to MaxRetries in one
        // step, and no amount of elapsed time brings the row back into the sweep.
        var deadLettered = Pending(n =>
        {
            n.Status = NotificationStatuses.Failed;
            n.RetryCount = n.MaxRetries;
            n.FailedAt = Now.AddYears(-1);
        });

        Assert.False(NotificationRetryPolicy.IsDue(deadLettered, Now));
    }

    [Theory]
    [InlineData(NotificationStatuses.Sent)]
    [InlineData(NotificationStatuses.Delivered)]
    [InlineData(NotificationStatuses.Opened)]
    [InlineData(NotificationStatuses.Cancelled)]
    public void A_non_retryable_status_is_never_due(string status)
    {
        // Cancelled in particular: it is a consent decision, not an outcome, and a sweep that
        // picked it up would mail someone who opted out.
        Assert.False(NotificationRetryPolicy.IsDue(Pending(n => n.Status = status), Now));
    }

    [Fact]
    public void The_whole_ladder_is_spent_within_the_default_retry_budget_in_minutes_not_hours()
    {
        // MaxRetries is 3, so a message the provider will never accept reaches its dead letter
        // while the admin who dispatched it is still looking at the screen.
        var total = NotificationRetryPolicy.DelayAfter(1) + NotificationRetryPolicy.DelayAfter(2);

        Assert.True(total < TimeSpan.FromMinutes(10), $"the retry ladder spans {total}, which is too long to be a useful feedback loop");
    }
}
