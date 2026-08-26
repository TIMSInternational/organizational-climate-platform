using ClimateTracking.Application.Scheduling;
using ClimateTracking.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateTracking.Infrastructure.Scheduling;

/// <summary>
/// <see cref="IJobLease"/> over Postgres <c>pg_try_advisory_xact_lock</c>. The same
/// implementation as climate-project's <c>PostgresAdvisoryJobLease</c>, for the same reasons,
/// against this service's own database.
///
/// <para><b>Why an advisory lock and not a leases table.</b> A row-based lease needs a table,
/// a migration, an expiry, and a story for the holder that dies without releasing it -- and
/// that story is always "expire it after N seconds", which means picking an N longer than the
/// slowest legitimate run and shorter than the longest tolerable outage. Advisory locks have
/// none of that: the lock is owned by the transaction, so it is released by commit, by
/// rollback, by the connection dropping, and by the container being killed, with no timeout to
/// tune and nothing to clean up. It also needs no migration, which matters here because adding
/// one to this service means adding it to a chain that a production deploy will apply.</para>
///
/// <para><b>Why the transaction-scoped variant specifically.</b> <c>pg_advisory_lock</c> and
/// <c>pg_try_advisory_lock</c> are *session*-scoped: they outlive the transaction and are
/// released either explicitly or when the session ends. Under Npgsql's connection pool a
/// session is reused, so a session lock leaked by a code path that forgot to unlock stays held
/// by whatever runs on that pooled connection next -- and this service is pointed at Supabase's
/// Supavisor pooler (see DatabaseConnectionStringSecretArn in the service template), where the
/// notion of a durable session does not survive at all, so a session lock can be taken on one
/// backend and "released" against another. <c>pg_try_advisory_xact_lock</c> is the only variant
/// that is correct under both.</para>
///
/// <para><b>Why <c>try</c> and not the blocking form.</b> Instances blocking on a lock held by
/// another would each hold a pooled connection open for the duration of the run and would then
/// execute the job themselves the instant it was released -- turning one run into N sequential
/// runs and reintroducing exactly the double-send this prevents. Losing the race is a normal
/// outcome, and the correct response is to do nothing until the next tick.</para>
///
/// <para><b>What the transaction here does and does not cover.</b> The lock is held for the
/// whole of <paramref name="work"/> and released when this transaction commits, so no two
/// instances can be inside the same job at once. The workers' own writes go through their own
/// scoped <see cref="ClimateTrackingDbContext"/> and therefore commit on their own connections,
/// not this one -- deliberately, because both workers already save per entity type and per plan
/// so that one bad row cannot roll back the notifications already dispatched earlier in the
/// same run (see the comments in <c>DailySemaforoWorker.RunOnceAsync</c>). Folding them into
/// this transaction would silently undo that. Mutual exclusion does not depend on sharing the
/// connection: the lock is held for the whole run either way, and if the work throws, the
/// <c>await using</c> disposes this transaction -- rolling it back and releasing the lock --
/// on the way out.</para>
/// </summary>
public sealed class PostgresAdvisoryJobLease(ClimateTrackingDbContext db) : IJobLease
{
    public async Task<bool> TryRunExclusivelyAsync(
        long lockKey,
        Func<CancellationToken, Task> work,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(work);

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
