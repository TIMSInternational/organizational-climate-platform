namespace ClimateProject.Application.Scheduling;

/// <summary>
/// Mutual exclusion for a named scheduled job across every running instance of the platform.
///
/// <para>The problem this solves is stated plainly in #101: App Runner's default autoscaling
/// configuration allows 25 instances, each of which would otherwise start its own copy of
/// every <c>BackgroundService</c> and sweep the same rows on the same schedule. The three
/// ways out are: pin the scheduler to a single instance (App Runner cannot express that, and
/// it makes the scheduler a single point of failure with no failover), give it its own
/// single-instance service (an extra deployment unit and an extra thing to forget to deploy),
/// or take a lock. This is the lock.</para>
///
/// <para>Note what it is *not*: it is not the idempotency mechanism. A lock that is held
/// almost always is not a correctness argument, because "almost always" is exactly what a
/// connection reset, a paused container or a manual re-run defeats. Idempotency comes from
/// <see cref="DeterministicNotificationId"/> and from persisted send state; the lease is what
/// stops twenty-five instances doing the same work and contending on the same rows in the
/// first place. Both layers exist because each one covers the other's failure mode.</para>
/// </summary>
public interface IJobLease
{
    /// <summary>
    /// Run <paramref name="work"/> exactly once cluster-wide, if this instance wins the lease.
    ///
    /// <para>Returns <see langword="false"/> without running anything when another instance
    /// already holds it. That is an ordinary outcome on a busy cluster, not an error: the
    /// instance that holds the lease is doing the work, and the loser's correct behaviour is
    /// to go back to sleep until its next tick.</para>
    ///
    /// <para>Implementations must not block waiting for the lease. A worker that queues behind
    /// a slow run and then executes it again immediately afterwards has reintroduced the
    /// double-run the lease exists to prevent.</para>
    /// </summary>
    /// <param name="lockKey">
    /// The job's key, from <see cref="DeterministicNotificationId.LockKey"/>. Derived from the
    /// job name so that two jobs cannot silently share one.
    /// </param>
    /// <param name="work">The job body. Any persistence it performs must be committed by the implementation.</param>
    Task<bool> TryRunExclusivelyAsync(long lockKey, Func<CancellationToken, Task> work, CancellationToken cancellationToken);
}
