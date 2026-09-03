using ClimateProject.Application.Scheduling;
using ClimateProject.Infrastructure.Notifications;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ClimateProject.Workers;

/// <summary>
/// Watches the other workers and complains when one stops.
///
/// <para>#101: "a silently dead worker is the whole risk". The two ways a worker goes quiet
/// need two different detectors, because neither one catches the other's case:</para>
/// <list type="bullet">
/// <item><b>The whole process is gone</b> -- crashed, OOM-killed, descheduled, scaled to zero,
/// or never deployed at all. Nothing inside the process can report this, by definition. It is
/// caught externally, by alarming on the *absence* of the per-tick heartbeat log line that
/// <see cref="ScheduledJobWorker"/> emits. Wiring that alarm is #158's; emitting something
/// unambiguous to alarm on is this code's.</item>
/// <item><b>One job wedges while the host stays up</b> -- a query that never returns, a lease
/// that is never released, an exception loop. The process is healthy, the log is still busy
/// with the other three jobs, and an external "is anything logging" alarm sees nothing wrong.
/// That is what this monitor is for.</item>
/// </list>
///
/// <para>It logs at Error rather than throwing or stopping the host. A stale job is a reason to
/// page someone, not a reason to take down the three jobs that are still working -- and killing
/// the process would take the heartbeat with it, turning a specific, actionable signal into the
/// generic one.</para>
/// </summary>
public sealed class WorkerHeartbeatMonitor(
    WorkerHeartbeats heartbeats,
    IOptions<WorkerSchedulingOptions> options,
    ILogger<WorkerHeartbeatMonitor> logger) : BackgroundService
{
    private readonly bool _enabled = options.Value.Enabled;
    private readonly TimeSpan _interval = options.Value.HeartbeatMonitorInterval;
    private readonly double _tolerance = options.Value.HeartbeatStaleTolerance;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_enabled)
        {
            // Scheduling:Enabled=false: the jobs register no heartbeats (see
            // ScheduledJobWorker), so there is nothing to monitor and every job would
            // otherwise be absent rather than stale. Idle alongside them.
            return;
        }

        try
        {
            using var timer = new PeriodicTimer(_interval);

            // Deliberately waits one interval before the first check rather than checking
            // immediately: at startup no job has completed a run yet, and every one of them
            // would be reported stale.
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                Check(NotificationDelivery.UtcNow());
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down.
        }
    }

    /// <summary>
    /// Report any stale job once. Public and clock-parameterised so a test can assert the
    /// behaviour without waiting minutes for it.
    /// </summary>
    public void Check(DateTimeOffset nowUtc)
    {
        foreach (var stale in heartbeats.StaleJobs(nowUtc, _tolerance))
        {
            logger.LogError(
                WorkerLogLines.JobStale,
                stale.JobName,
                stale.LastSuccessUtc?.ToString("O") ?? "never",
                stale.Interval,
                _tolerance,
                stale.LastAttemptUtc?.ToString("O") ?? "never",
                stale.ConsecutiveFailures);
        }
    }
}
