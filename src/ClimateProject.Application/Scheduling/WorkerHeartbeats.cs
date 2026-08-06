using System.Collections.Concurrent;

namespace ClimateProject.Application.Scheduling;

/// <summary>
/// What each scheduled job last did, and when.
///
/// <para>#101 names the real risk directly: "a silently dead worker is the whole risk". A
/// scheduler that stops is indistinguishable, from the outside, from a scheduler with nothing
/// to do -- both produce no mail and no errors. Nobody notices until response rates have
/// already suffered, which is weeks.</para>
///
/// <para>So absence is made into a signal in two independent ways, on the principle that a
/// monitor sharing a fate with the thing it monitors is not a monitor:</para>
/// <list type="number">
/// <item><b>A positive heartbeat per tick.</b> Every job logs a structured line on every run,
/// including runs that did nothing and runs that lost the lease. That gives #158 something to
/// alarm on the *absence* of -- a CloudWatch metric filter with a "no data" treatment -- which
/// catches the process dying, the container being descheduled, and the whole service being
/// scaled to zero. None of those can emit an error, because nothing is running to emit it.</item>
/// <item><b>An in-process staleness check.</b> <see cref="StaleJobs"/> answers "which jobs
/// have not completed recently" against a clock passed in, so a monitor inside the host can
/// log an error when one job wedges while the others keep ticking -- a deadlocked query, a
/// lease never released. That one the process *can* see, and it is the failure mode the
/// external alarm is worst at, because the heartbeat log line keeps flowing from the healthy
/// jobs.</item>
/// </list>
///
/// <para>Kept here rather than in the worker host so the staleness rule is unit-testable
/// without waiting real time, which is the only way to test a thing about elapsed time.</para>
/// </summary>
public sealed class WorkerHeartbeats
{
    private readonly ConcurrentDictionary<string, WorkerHeartbeat> _beats = new(StringComparer.Ordinal);

    /// <summary>
    /// Declare a job before it first runs, so that a job which has *never* completed is
    /// visible as stale rather than simply absent from the report. A worker that throws on its
    /// very first tick is the case a "compare last-run times" check misses entirely.
    /// </summary>
    public void Register(string jobName, TimeSpan interval, DateTimeOffset startedAtUtc)
    {
        ArgumentNullException.ThrowIfNull(jobName);
        _beats[jobName] = new WorkerHeartbeat(jobName, interval, startedAtUtc, null, null, 0);
    }

    /// <summary>Record a tick that completed its work.</summary>
    public void RecordSuccess(string jobName, DateTimeOffset atUtc)
        => Record(jobName, beat => beat with { LastSuccessUtc = atUtc, LastAttemptUtc = atUtc, ConsecutiveFailures = 0 });

    /// <summary>
    /// Record a tick that ran but did not hold the lease.
    ///
    /// Counts as an attempt, not a success, and deliberately so. On a 25-instance cluster
    /// twenty-four instances lose the lease on every tick; if that counted as success, every
    /// instance would look healthy while the one instance actually doing the work was wedged.
    /// Staleness is therefore evaluated per instance and the alarm is on the *fleet* having no
    /// successful run, which is what <see cref="StaleJobs"/> reports and what the log line
    /// distinguishes.
    /// </summary>
    public void RecordSkipped(string jobName, DateTimeOffset atUtc)
        => Record(jobName, beat => beat with { LastAttemptUtc = atUtc });

    /// <summary>Record a tick that threw.</summary>
    public void RecordFailure(string jobName, DateTimeOffset atUtc)
        => Record(jobName, beat => beat with { LastAttemptUtc = atUtc, ConsecutiveFailures = beat.ConsecutiveFailures + 1 });

    private void Record(string jobName, Func<WorkerHeartbeat, WorkerHeartbeat> update)
    {
        ArgumentNullException.ThrowIfNull(jobName);
        ArgumentNullException.ThrowIfNull(update);

        _beats.AddOrUpdate(
            jobName,
            _ => update(new WorkerHeartbeat(jobName, TimeSpan.Zero, DateTimeOffset.MinValue, null, null, 0)),
            (_, existing) => update(existing));
    }

    /// <summary>Every registered job's current state, ordered by name so output is stable.</summary>
    public IReadOnlyList<WorkerHeartbeat> Snapshot()
        => [.. _beats.Values.OrderBy(beat => beat.JobName, StringComparer.Ordinal)];

    /// <summary>
    /// Jobs whose last successful run is older than <paramref name="tolerance"/> multiplied by
    /// their own interval.
    ///
    /// <para>Relative to each job's interval rather than one flat threshold, because the jobs
    /// run at wildly different cadences -- dispatch every few minutes, a monthly digest sweep
    /// hourly -- and a flat threshold is necessarily either deaf to the fast job or screaming
    /// about the slow one.</para>
    ///
    /// <para>A job that has never succeeded is measured from when it was registered, so it
    /// becomes stale on the same schedule as one that succeeded once and stopped.</para>
    /// </summary>
    public IReadOnlyList<WorkerHeartbeat> StaleJobs(DateTimeOffset nowUtc, double tolerance = 3.0)
    {
        if (tolerance <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(tolerance), tolerance, "Tolerance must be positive.");
        }

        return
        [
            .. _beats.Values
                .Where(beat => beat.Interval > TimeSpan.Zero
                               && nowUtc - (beat.LastSuccessUtc ?? beat.RegisteredAtUtc) > beat.Interval * tolerance)
                .OrderBy(beat => beat.JobName, StringComparer.Ordinal),
        ];
    }
}

/// <summary>One job's liveness state.</summary>
/// <param name="JobName">The job's stable name, as used for its advisory lock key.</param>
/// <param name="Interval">Its tick interval, which is what staleness is measured against.</param>
/// <param name="RegisteredAtUtc">When this instance started the job. The staleness baseline before any success.</param>
/// <param name="LastAttemptUtc">Last tick of any outcome, including ones that lost the lease.</param>
/// <param name="LastSuccessUtc">Last tick that held the lease and completed. Null if that has never happened.</param>
/// <param name="ConsecutiveFailures">Throws since the last success. Reset by a success, not by a skip.</param>
public sealed record WorkerHeartbeat(
    string JobName,
    TimeSpan Interval,
    DateTimeOffset RegisteredAtUtc,
    DateTimeOffset? LastAttemptUtc,
    DateTimeOffset? LastSuccessUtc,
    int ConsecutiveFailures);
