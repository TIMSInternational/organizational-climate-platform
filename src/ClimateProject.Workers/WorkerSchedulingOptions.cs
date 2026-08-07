using ClimateProject.Infrastructure.Notifications;
using ClimateProject.Infrastructure.Scheduling;

namespace ClimateProject.Workers;

/// <summary>
/// How often each job ticks, and how much it does per tick. Bound from the
/// <c>Scheduling</c> configuration section.
///
/// <para>Every interval is configurable and every one has a default that is correct without
/// configuration, because a worker whose schedule depends on a value someone has to remember
/// to set is a worker that will one day be deployed with no schedule at all.</para>
///
/// <para>The defaults are not arbitrary:</para>
/// <list type="bullet">
/// <item><b>Dispatch, 1 minute.</b> This is the latency between a notification being raised
/// and leaving the building. It is the only interval a user can feel.</item>
/// <item><b>Reminders, 15 minutes.</b> Matches the legacy <c>vercel.json</c> cadence exactly.
/// The reminder *cadence* is days, set per survey, so this only governs how promptly a
/// reminder that has come due is noticed -- but keeping the number identical to the schedule
/// being replaced means the cutover changes no observable behaviour.</item>
/// <item><b>Digests, 15 minutes.</b> Digests are due at a fixed local hour, and users span
/// every timezone -- including the ones offset by 30 and 45 minutes, which an hourly sweep
/// would serve up to 45 minutes late.</item>
/// <item><b>Reports, 5 minutes.</b> Recurring reports are daily at their most frequent, so
/// this is only about promptness, and a report that arrives five minutes after its hour is
/// indistinguishable from one that arrives on it.</item>
/// </list>
/// </summary>
public sealed class WorkerSchedulingOptions
{
    public const string SectionName = "Scheduling";

    /// <summary>
    /// Master switch. Set false to run the host with every job idle -- useful for a deploy that
    /// needs the process up (health checks, log pipeline) before the schedule is trusted.
    /// </summary>
    public bool Enabled { get; set; } = true;

    public TimeSpan NotificationDispatchInterval { get; set; } = TimeSpan.FromMinutes(1);

    public TimeSpan InvitationReminderInterval { get; set; } = TimeSpan.FromMinutes(15);

    public TimeSpan DigestInterval { get; set; } = TimeSpan.FromMinutes(15);

    public TimeSpan ScheduledReportInterval { get; set; } = TimeSpan.FromMinutes(5);

    /// <summary>How often the in-process liveness check runs. See <c>WorkerHeartbeatMonitor</c>.</summary>
    public TimeSpan HeartbeatMonitorInterval { get; set; } = TimeSpan.FromMinutes(5);

    /// <summary>
    /// How many of a job's own intervals may elapse with no successful run before the monitor
    /// calls it stale. Three rather than one so that a single lost lease, a slow tick or a
    /// rolling deploy does not produce an alert nobody should act on.
    /// </summary>
    public double HeartbeatStaleTolerance { get; set; } = 3.0;

    public int NotificationBatchSize { get; set; } = NotificationDelivery.DefaultBatchSize;

    public int ReminderBatchSize { get; set; } = InvitationReminderJob.DefaultBatchSize;

    public int DigestPageSize { get; set; } = DigestJob.DefaultPageSize;

    public int DigestMaxUsersPerRun { get; set; } = DigestJob.DefaultMaxUsersPerRun;

    public int ScheduledReportBatchSize { get; set; } = ScheduledReportJob.DefaultBatchSize;

    /// <summary>
    /// Fail the host at startup on a configuration that cannot work, rather than at the first
    /// tick. #189 established that principle for the API: a process that boots misconfigured
    /// reports a healthy deploy and then does nothing useful. A zero interval is worse here
    /// than there -- <see cref="PeriodicTimer"/> throws on it, from inside a background thread,
    /// where the exception stops that one job and leaves the rest of the host looking fine.
    /// </summary>
    public void Validate()
    {
        Require(NotificationDispatchInterval, nameof(NotificationDispatchInterval));
        Require(InvitationReminderInterval, nameof(InvitationReminderInterval));
        Require(DigestInterval, nameof(DigestInterval));
        Require(ScheduledReportInterval, nameof(ScheduledReportInterval));
        Require(HeartbeatMonitorInterval, nameof(HeartbeatMonitorInterval));

        Require(NotificationBatchSize, nameof(NotificationBatchSize));
        Require(ReminderBatchSize, nameof(ReminderBatchSize));
        Require(DigestPageSize, nameof(DigestPageSize));
        Require(DigestMaxUsersPerRun, nameof(DigestMaxUsersPerRun));
        Require(ScheduledReportBatchSize, nameof(ScheduledReportBatchSize));

        if (HeartbeatStaleTolerance <= 0)
        {
            throw new InvalidOperationException(
                $"Scheduling:{nameof(HeartbeatStaleTolerance)} must be greater than zero.");
        }
    }

    private static void Require(TimeSpan value, string name)
    {
        if (value <= TimeSpan.Zero)
        {
            throw new InvalidOperationException($"Scheduling:{name} must be greater than zero.");
        }
    }

    private static void Require(int value, string name)
    {
        if (value < 1)
        {
            throw new InvalidOperationException($"Scheduling:{name} must be at least 1.");
        }
    }
}
