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
/// <item><b>Survey draft retention, 1 hour.</b> The only interval nothing observable depends
/// on. Drafts expire after 30 days and the read filters hide an expired draft the instant it
/// expires, so this governs when disk comes back and nothing else. Hourly rather than daily
/// so each tick's delete stays small; not faster, because there is nothing to be prompt
/// about.</item>
/// <item><b>Survey lifecycle, 5 minutes.</b> The lag between a survey's start or end date
/// arriving and its status agreeing. It is felt in both directions -- a respondent seeing a
/// survey that has not opened yet, and one whose answer is accepted after the deadline -- but
/// the dates admins pick are hours and days, so five minutes is well inside the noise, and
/// each tick is a sequential scan of <c>surveys</c> that there is no reason to run every
/// minute.</item>
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

    public TimeSpan SurveyDraftRetentionInterval { get; set; } = TimeSpan.FromHours(1);

    /// <summary>
    /// How often the GDPR storage-limitation sweep runs (#144). Daily: every window it
    /// enforces is measured in days or months, so nothing observable depends on it being
    /// prompt, and a daily tick keeps each run's delete small.
    /// </summary>
    public TimeSpan RetentionCleanupInterval { get; set; } = TimeSpan.FromDays(1);

    /// <summary>
    /// How often a survey's dates are compared against its status. Five minutes; see the class
    /// remarks, and <c>SurveyLifecycleJob</c> for why the window is a tick rather than a hard
    /// cutoff.
    /// </summary>
    public TimeSpan SurveyLifecycleInterval { get; set; } = TimeSpan.FromMinutes(5);

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
    /// Expired drafts reclaimed per tick. A cap, not a target: it exists so the first sweep
    /// over an accumulated backlog is not one enormous transaction. Whatever it does not
    /// reach waits an hour, invisible to the product the whole time.
    /// </summary>
    public int SurveyDraftRetentionBatchSize { get; set; } = SurveyDraftRetentionJob.DefaultBatchSize;

    /// <summary>
    /// Rows deleted per retention-cleanup category per tick. A cap, not a target, for the same
    /// reason as the draft cap: the first sweep over an accumulated backlog must not become one
    /// enormous transaction. Whatever a tick does not reach waits a day, and nothing in the
    /// product can see the difference.
    /// </summary>
    public int RetentionCleanupBatchSize { get; set; } = RetentionCleanupJob.DefaultBatchSize;

    /// <summary>
    /// Status transitions applied per category per tick. A cap on one transaction, not on what
    /// the job will ever do -- but unlike the retention caps, whatever a tick does not reach is
    /// a survey that stays shut, or open, for another five minutes. Sized so that only the
    /// first sweep after deploy can reach it.
    /// </summary>
    public int SurveyLifecycleBatchSize { get; set; } = SurveyLifecycleJob.DefaultBatchSize;

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
        Require(SurveyDraftRetentionInterval, nameof(SurveyDraftRetentionInterval));
        Require(RetentionCleanupInterval, nameof(RetentionCleanupInterval));
        Require(SurveyLifecycleInterval, nameof(SurveyLifecycleInterval));
        Require(HeartbeatMonitorInterval, nameof(HeartbeatMonitorInterval));

        Require(NotificationBatchSize, nameof(NotificationBatchSize));
        Require(ReminderBatchSize, nameof(ReminderBatchSize));
        Require(DigestPageSize, nameof(DigestPageSize));
        Require(DigestMaxUsersPerRun, nameof(DigestMaxUsersPerRun));
        Require(ScheduledReportBatchSize, nameof(ScheduledReportBatchSize));
        Require(SurveyDraftRetentionBatchSize, nameof(SurveyDraftRetentionBatchSize));
        Require(RetentionCleanupBatchSize, nameof(RetentionCleanupBatchSize));
        Require(SurveyLifecycleBatchSize, nameof(SurveyLifecycleBatchSize));

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
