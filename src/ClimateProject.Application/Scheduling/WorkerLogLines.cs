namespace ClimateProject.Application.Scheduling;

/// <summary>
/// The structured-log message templates the scheduler emits, held in one place because
/// <c>infra/aws/climate-project-observability.yml</c> filters production logs for literal
/// substrings of them. A reword here that the template does not follow silences a
/// CloudWatch alarm with no error anywhere — the job keeps running, the metric filter
/// stops matching, and the "job stopped" alarm never fires again.
///
/// <c>tests/ClimateProject.UnitTests/Scheduling/HeartbeatAlarmLiteralsTests.cs</c> renders
/// each template for every job in <see cref="WorkerJobs.All"/> and asserts the quoted
/// substring in every <c>FilterPattern</c> of that file still appears in the rendered line.
/// Change either side and CI says so.
/// </summary>
public static class WorkerLogLines
{
    /// <summary>Emitted on every tick that ran the job while holding the lease (`ScheduledJobWorker`).</summary>
    public const string HeartbeatCompleted =
        "Heartbeat: scheduled job {JobName} completed a run at {RunAtUtc:O} holding the lease.";

    /// <summary>Emitted on a tick that found another instance holding the lease.</summary>
    public const string HeartbeatSkipped =
        "Heartbeat: scheduled job {JobName} ticked at {RunAtUtc:O} but another instance holds the lease.";

    /// <summary>Emitted when a job's tick throws (`ScheduledJobWorker`).</summary>
    public const string JobThrew =
        "Scheduled job {JobName} threw at {RunAtUtc:O}. The transaction was rolled back and the tick will be " +
        "retried on the next interval.";

    /// <summary>Emitted by the in-process monitor for a job past its staleness tolerance (`WorkerHeartbeatMonitor`).</summary>
    public const string JobStale =
        "Scheduled job {JobName} has not completed a run since {LastSuccessUtc}. Its interval is {Interval} " +
        "and the staleness tolerance is {Tolerance}x. Last attempt of any kind was {LastAttemptUtc}, with " +
        "{ConsecutiveFailures} consecutive failures. Reminders and digests are not being produced.";
}
