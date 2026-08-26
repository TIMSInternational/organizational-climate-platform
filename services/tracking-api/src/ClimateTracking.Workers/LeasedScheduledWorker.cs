using ClimateTracking.Application.Scheduling;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateTracking.Workers;

/// <summary>
/// The job names, in one place, because each one is hashed into a Postgres advisory lock key
/// (<see cref="JobLockKey.For"/>). Changing a string here changes which lock a job contends
/// on, which during a rolling deploy means old and new instances briefly hold different locks
/// and can both run -- so these are stable identifiers, not labels.
/// </summary>
public static class TrackingJobs
{
    public const string CacheSync = "cache-sync";
    public const string DailySemaforo = "daily-semaforo";
}

/// <summary>
/// The shape both scheduled jobs in this service share: tick on an interval, take the
/// service-wide lease, do the work, log a heartbeat, never let a failure stop the timer.
///
/// <para>This is climate-project's <c>ScheduledJobWorker</c> reduced to what this service
/// actually has. It exists because #219 co-hosts these two workers inside the API image --
/// the API host calls <c>AddClimateTrackingWorkers</c>, so every deployed API instance runs
/// them -- and three things follow from that which did not matter while they ran in a
/// process nothing deployed:</para>
/// <list type="number">
/// <item><b>The lease.</b> <see cref="IJobLease"/> over a transaction-scoped Postgres
/// advisory lock, so one instance runs a given job at a time however many instances App
/// Runner has started. Without it <c>DailySemaforoWorker</c>'s read-then-write idempotency
/// check lets two instances both read "not sent" and both send, and the client gets
/// duplicate reminders about their own action plans.</item>
/// <item><b>A tick that cannot kill the host.</b> An exception out of
/// <c>BackgroundService.ExecuteAsync</c> stops the whole host on .NET's default
/// <c>BackgroundServiceExceptionBehavior</c>. In a dedicated worker process that is a
/// crash-loop somebody notices; in the API image it takes the HTTP API down with it, which
/// means one bad row in one plan would fail the App Runner health check and roll the
/// deployment back. <see cref="TickAsync"/> therefore logs and returns, and the next tick
/// recovers by itself the moment the cause clears.</item>
/// <item><b>An off switch read at host start.</b> <c>Workers:Enabled=false</c> registers the
/// jobs without ticking them, which is how the integration suite runs API hosts: a test host
/// that swept its own database and dialled a nonexistent climate-project on every boot would
/// be racing the test it is hosting. It is read from <c>IOptions</c> inside the hosted-service
/// factory -- i.e. at host start, not at registration -- because
/// <c>WebApplicationFactory</c>'s overrides only land at <c>builder.Build()</c>, so a
/// registration-time branch would ignore them and tick anyway.</item>
/// </list>
/// </summary>
public abstract class LeasedScheduledWorker : BackgroundService
{
    private readonly bool _enabled;
    private readonly ILogger _logger;

    protected LeasedScheduledWorker(
        string jobName,
        TimeSpan interval,
        bool enabled,
        IServiceScopeFactory scopeFactory,
        ILogger logger)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(jobName);
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(interval, TimeSpan.Zero);
        ArgumentNullException.ThrowIfNull(scopeFactory);
        ArgumentNullException.ThrowIfNull(logger);

        JobName = jobName;
        Interval = interval;
        _enabled = enabled;
        ScopeFactory = scopeFactory;
        _logger = logger;
        LockKey = JobLockKey.For(jobName);
    }

    /// <summary>The job's stable name. Hashed into its advisory lock key.</summary>
    public string JobName { get; }

    /// <summary>How often it ticks.</summary>
    public TimeSpan Interval { get; }

    /// <summary>The advisory lock key this job contends on, derived from <see cref="JobName"/>.</summary>
    public long LockKey { get; }

    /// <summary>Scopes for the lease and for the work. Protected so subclasses reuse the one factory.</summary>
    protected IServiceScopeFactory ScopeFactory { get; }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_enabled)
        {
            // Registered but switched off: no timer starts, so a disabled host neither dials
            // the database nor calls climate-project. The one log line is what makes "off on
            // purpose" distinguishable from "dead".
            _logger.LogInformation(
                "Background job {JobName} is registered but Workers:Enabled is false; it will not tick in this host.",
                JobName);
            return;
        }

        _logger.LogInformation(
            "Background job {JobName} starting on a {Interval} interval with advisory lock key {LockKey}.",
            JobName,
            Interval,
            LockKey);

        try
        {
            using var timer = new PeriodicTimer(Interval);
            do
            {
                await TickAsync(stoppingToken);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            _logger.LogInformation("Background job {JobName} stopping.", JobName);
        }
    }

    /// <summary>
    /// One tick: take the lease, run, record what happened.
    ///
    /// <para>Public so a test can drive exactly one tick against a real database instead of
    /// waiting out a 15-minute or 24-hour timer.</para>
    ///
    /// <para>It does not rethrow -- see the class remarks for why that is load-bearing in a
    /// co-hosted host rather than merely tidy.</para>
    /// </summary>
    public async Task TickAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = ScopeFactory.CreateScope();
            var lease = scope.ServiceProvider.GetRequiredService<IJobLease>();

            var ran = await lease.TryRunExclusivelyAsync(LockKey, RunTickAsync, cancellationToken);

            if (ran)
            {
                // The positive heartbeat, emitted on every tick including the ones that found
                // nothing to do. An alarm on the ABSENCE of this line is what catches the
                // process being gone, which by definition cannot log an error about itself --
                // and on App Runner it is also the measurement the service template asks for:
                // whether a throttled idle instance fires its timers at all.
                _logger.LogInformation(
                    "Heartbeat: background job {JobName} completed a run holding the lease.",
                    JobName);
            }
            else
            {
                _logger.LogInformation(
                    "Heartbeat: background job {JobName} ticked but another instance holds the lease.",
                    JobName);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(
                exception,
                "Background job {JobName} threw. The tick will be retried on the next interval.",
                JobName);
        }
    }

    /// <summary>The job body, run while this instance holds the lease.</summary>
    protected abstract Task RunTickAsync(CancellationToken cancellationToken);
}
