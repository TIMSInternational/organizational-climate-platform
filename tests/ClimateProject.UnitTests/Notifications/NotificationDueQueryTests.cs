using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.UnitTests.Notifications;

/// <summary>
/// <c>NotificationRetryPolicy.DueAt</c> is the predicate <c>POST /notifications/process</c>
/// hands to EF Core, and <c>NotificationRetryPolicy.IsDue</c> is the same rule in memory. Two
/// statements of one rule can disagree in two ways, and this covers both:
///
/// 1. **It might not translate at all.** EF's "could not be translated" is a *runtime*
///    exception, so an untranslatable predicate compiles cleanly and fails on the first sweep
///    in production. <c>ToQueryString()</c> forces the translation without needing a database
///    to connect to, which is what lets this be a unit test rather than a Docker one.
/// 2. **It might translate to something that means something else.** The agreement tests below
///    run the identical fixtures through both statements.
/// </summary>
public class NotificationDueQueryTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 5, 12, 0, 0, TimeSpan.Zero);

    /// <summary>
    /// A context that is configured but never opened. <c>ToQueryString()</c> compiles the
    /// query and returns the SQL; nothing dials the host.
    /// </summary>
    private static ClimateProjectDbContext OfflineContext() => new(
        new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql("Host=unreachable.invalid;Database=unused;Username=unused;Password=unused")
            .Options);

    private static Notification Notification(Action<Notification> adjust)
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

        adjust(notification);
        return notification;
    }

    [Fact]
    public void The_due_predicate_translates_to_sql()
    {
        using var db = OfflineContext();

        var sql = db.Notifications.Where(NotificationRetryPolicy.DueAt(Now)).ToQueryString();

        // Every arm of the predicate has to reach the database. If any of them silently
        // evaluated client-side the sweep would load the whole table on every call.
        Assert.Contains("scheduled_for", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("retry_count", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("max_retries", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("failed_at", sql, StringComparison.OrdinalIgnoreCase);
    }

    public static TheoryData<string, Notification> Fixtures() => new()
    {
        { "never attempted", Notification(_ => { }) },
        { "scheduled for later", Notification(n => n.ScheduledFor = Now.AddHours(1)) },
        {
            "failed a moment ago",
            Notification(n =>
            {
                n.Status = NotificationStatuses.Failed;
                n.RetryCount = 1;
                n.FailedAt = Now.AddSeconds(-5);
            })
        },
        {
            "failed longer ago than the first delay",
            Notification(n =>
            {
                n.Status = NotificationStatuses.Failed;
                n.RetryCount = 1;
                n.FailedAt = Now - NotificationRetryPolicy.FirstRetryDelay;
            })
        },
        {
            "failed twice, inside the longer delay",
            Notification(n =>
            {
                n.Status = NotificationStatuses.Failed;
                n.RetryCount = 2;
                n.FailedAt = Now - NotificationRetryPolicy.FirstRetryDelay;
            })
        },
        {
            "failed twice, past the longer delay",
            Notification(n =>
            {
                n.Status = NotificationStatuses.Failed;
                n.RetryCount = 2;
                n.FailedAt = Now - NotificationRetryPolicy.SubsequentRetryDelay;
            })
        },
        {
            "dead-lettered",
            Notification(n =>
            {
                n.Status = NotificationStatuses.Failed;
                n.RetryCount = n.MaxRetries;
                n.FailedAt = Now.AddYears(-1);
            })
        },
        { "suppressed by an opt-out", Notification(n => n.Status = NotificationStatuses.Cancelled) },
        { "already sent", Notification(n => n.Status = NotificationStatuses.Sent) },
    };

    [Theory]
    [MemberData(nameof(Fixtures))]
    public void The_query_predicate_and_the_in_memory_rule_agree(string description, Notification notification)
    {
        var byQuery = NotificationRetryPolicy.DueAt(Now).Compile()(notification);
        var byPolicy = NotificationRetryPolicy.IsDue(notification, Now);

        Assert.True(byQuery == byPolicy, $"the two statements of the due rule disagree for: {description}");
    }
}
