using ClimateProject.Application.Scheduling;
using ClimateProject.Infrastructure.Notifications;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Workers;

/// <summary>
/// The shape every scheduled job in this host shares: tick on an interval, take the
/// cluster-wide lease, do the work in one transaction, emit a heartbeat, never let a failure
/// stop the timer.
///
/// <para><b>Execution model, decided explicitly (#101 asks for this in so many words).</b> Each
/// job is a <see cref="BackgroundService"/>, and every instance of the host runs every job.
/// Nothing is pinned to one instance, because App Runner has no way to express that and pinning
/// would make the scheduler a single point of failure with no failover. Instead, correctness
/// under N instances is built in at three levels:</para>
/// <list type="number">
/// <item><b>The lease.</b> <see cref="IJobLease"/> over a Postgres transaction-scoped advisory
/// lock means one instance runs a given job at a time. The other twenty-four lose the race in
/// a single round trip and go back to sleep.</item>
/// <item><b>Deterministic ids.</b> Every notification a job creates is keyed by
/// <see cref="DeterministicNotificationId"/> on what it *is*, so a duplicate is a primary key
/// violation rather than a second email. This holds even if the lease does not.</item>
/// <item><b>Persisted send state.</b> Status transitions and reminder ordinals are written in
/// the same transaction as the lease, so "did we already do this" is a stored fact, never
/// inferred from how long ago a timestamp was.</item>
/// </list>
/// <para>Any one of those would usually be enough. All three are here because "usually" is the
/// word that produces the incident.</para>
///
/// <para>The same registration also works inside the API host, which is why the jobs are
/// wired up by an extension method rather than inline in <c>Program.cs</c>. #275 took that
/// choice: the API host calls <c>AddClimateProjectScheduling</c>, so every deployed API
/// instance runs these jobs, and the lease is what makes the instance count irrelevant.</para>
/// </summary>
public abstract class ScheduledJobWorker : BackgroundService
{
    private readonly bool _enabled;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly WorkerHeartbeats _heartbeats;
    private readonly ILogger _logger;
    private readonly long _lockKey;

    protected ScheduledJobWorker(
        string jobName,
        TimeSpan interval,
        bool enabled,
        IServiceScopeFactory scopeFactory,
        WorkerHeartbeats heartbeats,
        ILogger logger)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(jobName);
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(interval, TimeSpan.Zero);

        JobName = jobName;
        Interval = interval;
        _enabled = enabled;
        _scopeFactory = scopeFactory ?? throw new ArgumentNullException(nameof(scopeFactory));
        _heartbeats = heartbeats ?? throw new ArgumentNullException(nameof(heartbeats));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _lockKey = DeterministicNotificationId.LockKey(jobName);
    }

    /// <summary>The job's stable name. Hashed into its lock key -- see <see cref="WorkerJobs"/>.</summary>
    public string JobName { get; }

    /// <summary>How often it ticks.</summary>
    public TimeSpan Interval { get; }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_enabled)
        {
            // Registered but switched off (Scheduling:Enabled=false): no heartbeat is declared
            // and no timer starts, so a disabled host neither dials the database nor reports
            // its idle jobs as stale. The integration suite runs every API host this way; the
            // one log line is what makes "off on purpose" distinguishable from "dead".
            _logger.LogInformation(
                "Scheduled job {JobName} is registered but Scheduling:Enabled is false; it will not tick in this host.",
                JobName);
            return;
        }

        _heartbeats.Register(JobName, Interval, NotificationDelivery.UtcNow());

        _logger.LogInformation(
            "Scheduled job {JobName} starting on a {Interval} interval with advisory lock key {LockKey}.",
            JobName,
            Interval,
            _lockKey);

        try
        {
            // A short random delay before the first tick. The lease already makes simultaneous
            // starts harmless, so this is not a correctness measure -- it just stops twenty-five
            // instances opening twenty-five transactions on the same key in the same
            // millisecond every time the service scales or redeploys.
            await Task.Delay(StartupDelay(), stoppingToken);

            using var timer = new PeriodicTimer(Interval);
            do
            {
                await TickAsync(stoppingToken);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            _logger.LogInformation("Scheduled job {JobName} stopping.", JobName);
        }
    }

    /// <summary>
    /// One tick: take the lease, run, record what happened.
    ///
    /// <para>Public so a test can drive exactly one tick against a real database instead of
    /// waiting for a timer -- the same reason <c>DailySemaforoWorker</c> in the tracking service
    /// exposes its <c>RunOnceAsync</c>.</para>
    ///
    /// <para>It does not rethrow. A job that dies on its first bad row stops ticking forever,
    /// and the failure is invisible until someone notices the absence of mail; a job that logs
    /// and ticks again recovers by itself the moment the cause clears. The heartbeat carries the
    /// consecutive-failure count so that "still ticking, still failing" is distinguishable from
    /// "healthy" -- which is the distinction a bare try/catch would destroy.</para>
    /// </summary>
    public async Task TickAsync(CancellationToken cancellationToken)
    {
        var now = NotificationDelivery.UtcNow();

        try
        {
            using var scope = _scopeFactory.CreateScope();
            var lease = scope.ServiceProvider.GetRequiredService<IJobLease>();

            var ran = await lease.TryRunExclusivelyAsync(
                _lockKey,
                token => RunOnceAsync(scope.ServiceProvider, now, token),
                cancellationToken);

            if (ran)
            {
                _heartbeats.RecordSuccess(JobName, now);

                // The positive heartbeat. Every tick, including the ones that found nothing to
                // do -- an alarm on the absence of this line is what catches the process being
                // gone, which by definition cannot log an error about itself (#158).
                _logger.LogInformation(
                    WorkerLogLines.HeartbeatCompleted,
                    JobName,
                    now);
            }
            else
            {
                _heartbeats.RecordSkipped(JobName, now);
                _logger.LogInformation(
                    WorkerLogLines.HeartbeatSkipped,
                    JobName,
                    now);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _heartbeats.RecordFailure(JobName, now);
            _logger.LogError(
                exception,
                WorkerLogLines.JobThrew,
                JobName,
                now);
        }
    }

    /// <summary>
    /// The job body, run inside the lease's transaction. Implementations resolve what they need
    /// from <paramref name="services"/> and must not begin or commit a transaction of their own.
    /// </summary>
    protected abstract Task RunOnceAsync(
        IServiceProvider services,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken);

    private TimeSpan StartupDelay()
    {
        var ceiling = Interval < TimeSpan.FromSeconds(30) ? Interval : TimeSpan.FromSeconds(30);
        return TimeSpan.FromMilliseconds(Random.Shared.Next((int)ceiling.TotalMilliseconds));
    }
}
