using System.Security.Cryptography;
using System.Text;

namespace ClimateTracking.Application.Scheduling;

/// <summary>
/// Mutual exclusion for a named background job across every running instance of this
/// service.
///
/// <para><b>Why this service needs one now.</b> Until #219 the two workers ran in their own
/// process, which nothing deployed. Co-hosting them in the API image (the shape #275 chose
/// for climate-project, and the only shape App Runner supports for a host that never binds
/// a port) means every API instance starts its own copy of every
/// <c>BackgroundService</c>. Both workers are plain <c>PeriodicTimer</c> loops with no
/// coordination, so on N instances:</para>
/// <list type="bullet">
/// <item><c>CacheSyncWorker</c> runs N times per interval. Wasteful, and the upserts race
/// each other on the same rows.</item>
/// <item><c>DailySemaforoWorker</c> runs N times per day and it <b>sends notifications</b>.
/// Its idempotency is "has this trigger already been recorded Enviado for this plan" --
/// read-then-write with no lock -- so two instances ticking together both read "not sent"
/// and both send. The client receives duplicate 30-day and 15-day reminders about their own
/// action plans. That is a visible defect in front of a government client.</item>
/// </list>
/// <para>infra/aws/climate-tracking-api-prod-service.yml pins MaxSize 1 to avoid exactly
/// that, and says in so many words that the fix if horizontal scale is ever needed "is a
/// lease in the workers". This is that lease, so the pin is a cost decision rather than a
/// correctness one.</para>
///
/// <para>Deliberately the same contract as climate-project's
/// <c>ClimateProject.Application.Scheduling.IJobLease</c>. Copied rather than shared because
/// the two services own separate databases and separate solutions -- an advisory lock in one
/// Postgres says nothing about the other -- but the semantics are identical so that anyone
/// who has read one has read both.</para>
/// </summary>
public interface IJobLease
{
    /// <summary>
    /// Run <paramref name="work"/> once service-wide, if this instance wins the lease.
    ///
    /// <para>Returns <see langword="false"/> without running anything when another instance
    /// already holds it. That is an ordinary outcome, not an error: the holder is doing the
    /// work and the loser's correct behaviour is to go back to sleep until its next
    /// tick.</para>
    ///
    /// <para>Implementations must not block waiting for the lease. A worker that queues
    /// behind a slow run and then executes it again immediately afterwards has reintroduced
    /// the double-run the lease exists to prevent.</para>
    /// </summary>
    /// <param name="lockKey">The job's key, from <see cref="JobLockKey.For"/>.</param>
    /// <param name="work">The job body.</param>
    /// <param name="cancellationToken">Host shutdown.</param>
    Task<bool> TryRunExclusivelyAsync(long lockKey, Func<CancellationToken, Task> work, CancellationToken cancellationToken);
}

/// <summary>
/// Derives a job's advisory-lock key from its name.
///
/// Postgres advisory locks are keyed by a bare integer with no registry behind them, so two
/// unrelated pieces of code can silently contend on the same number. Deriving the key from
/// the job's name makes collisions between *our* jobs impossible by construction and makes
/// the number reproducible from the name during an incident, which a hand-assigned magic
/// constant is not.
/// </summary>
public static class JobLockKey
{
    /// <summary>
    /// The prefix is what keeps these keys distinct from climate-project's
    /// (<c>"climate-project.job:"</c>). Today the two services hold separate databases so
    /// they could not collide anyway; the day one of them is pointed at the other's
    /// Postgres, the prefix is what stops <c>cache-sync</c> here silently sharing a lock
    /// with a job over there.
    /// </summary>
    public static long For(string jobName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(jobName);

        var hash = SHA1.HashData(Encoding.UTF8.GetBytes("climate-tracking.job:" + jobName));
        return BitConverter.ToInt64(hash, 0);
    }
}
