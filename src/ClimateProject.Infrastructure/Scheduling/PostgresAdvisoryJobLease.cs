using ClimateProject.Application.Scheduling;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Scheduling;

/// <summary>
/// <see cref="IJobLease"/> over Postgres <c>pg_try_advisory_xact_lock</c>.
///
/// <para><b>Why an advisory lock and not a leases table.</b> A row-based lease needs a table,
/// a migration, an expiry, and a story for the holder that dies without releasing it -- and
/// that story is always "expire it after N seconds", which means picking an N that is longer
/// than the slowest legitimate run and shorter than the longest tolerable outage. Advisory
/// locks have none of that: the lock is owned by the transaction, so it is released by commit,
/// by rollback, by the connection dropping, and by the container being killed, with no timeout
/// to tune and nothing to clean up. There is also no schema change, which matters here
/// because the migration chain is contended.</para>
///
/// <para><b>Why the transaction-scoped variant specifically.</b> <c>pg_advisory_lock</c> and
/// <c>pg_try_advisory_lock</c> are *session*-scoped: they outlive the transaction and are
/// released either explicitly or when the session ends. Under Npgsql's connection pool a
/// session is reused, so a session lock leaked by a code path that forgot to unlock stays held
/// by whatever runs on that pooled connection next -- and under Supabase's Supavisor
/// transaction pooler (#220 documents that production is pointed at it) the notion of a
/// durable session does not survive at all, so a session lock can be taken on one backend and
/// "released" against another. <c>pg_try_advisory_xact_lock</c> is the only variant that is
/// correct under both.</para>
///
/// <para><b>Why <c>try</c> and not the blocking form.</b> Twenty-four instances blocking on a
/// lock held by the twenty-fifth would each hold a pooled connection open for the duration of
/// the run, and would then execute the job themselves the instant it was released -- turning
/// one run into twenty-five sequential runs and reintroducing exactly the double-send this
/// prevents. Losing the race is a normal outcome, and the correct response to it is to do
/// nothing until the next tick.</para>
/// </summary>
public sealed class PostgresAdvisoryJobLease(ClimateProjectDbContext db) : IJobLease
{
    public async Task<bool> TryRunExclusivelyAsync(
        long lockKey,
        Func<CancellationToken, Task> work,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(work);

        // The lock lives and dies with this transaction, and every write the job performs is
        // inside it. That is what makes "took the lease" and "the work landed" the same event:
        // there is no window in which the lease is released but the work is uncommitted, and
        // none in which the work is committed under a lease somebody else also held.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // "AS \"Value\"" is not decoration -- EF Core's scalar SqlQuery requires the single
        // projected column to be named Value, and Postgres would otherwise name it after the
        // function.
        var acquired = await db.Database
            .SqlQueryRaw<bool>("SELECT pg_try_advisory_xact_lock({0}) AS \"Value\"", lockKey)
            .SingleAsync(cancellationToken);

        if (!acquired)
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }

        await work(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }
}
