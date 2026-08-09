using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Scheduling;

/// <summary>
/// Reclaims <c>survey_drafts</c> rows that <see cref="SurveyDraftRetention"/> has already
/// expired.
///
/// <para><b>Why this exists as a job (#272).</b> The sweep was implemented as
/// <c>DELETE /surveys/drafts/expired</c> and nothing ever called it. Because expiry is
/// enforced at read time, an expired draft is invisible to the product whether or not the
/// sweep runs -- so nothing looked broken while the rows accumulated. Since #266 the wizard
/// autosaves a <c>draft_data</c> blob per authoring session, so the table only grows. A
/// hosted service was chosen over a cron call into the HTTP route because that route is
/// SuperAdmin-gated and scheduling it would mean keeping a super-admin token in a runner to
/// perform a purely internal maintenance action.</para>
///
/// <para><b>Scheduled, not yet running.</b> <c>SurveyDraftRetentionWorker</c> is registered in
/// <c>ClimateProject.Workers</c>, but that host is built by no workflow and deployed as no
/// service, so nothing ticks it in production today -- the same is true of the four workers
/// that preceded it. Until #275 deploys the workers host (or co-hosts these jobs in the API),
/// the only thing that actually reclaims a row is a human calling
/// <c>DELETE /surveys/drafts/expired</c>.</para>
///
/// <para><b>Cadence: hourly</b> (<c>Scheduling:SurveyDraftRetentionInterval</c>). Nothing
/// observable depends on how soon a row goes: the TTL is 30 days and the read filters hide
/// the row the instant it expires, so this interval only governs how quickly disk comes
/// back. Hourly rather than daily so that each tick's delete is small and steady-state work
/// is a handful of rows, and rather than every few minutes because there is nothing to be
/// prompt about. The sweep is idempotent and deletes strictly by <c>expires_at</c>, so a
/// missed tick costs nothing and a doubled one deletes nothing twice.</para>
///
/// <para><b>Bounded per run.</b> The worker passes a row cap so the first sweep over a
/// backlog cannot become one enormous transaction held under the job lease; whatever it does
/// not reach is taken by the next tick, an hour later, and no draft is at risk in the
/// meantime because it is already invisible. The HTTP route passes no cap -- a human asking
/// for the sweep by hand is asking it to finish.</para>
///
/// <para><b>Known cost: the predicate is unindexed.</b> <c>survey_drafts</c> is indexed on
/// <c>company_id</c> and <c>user_id</c> only, so <c>WHERE expires_at &lt;= now</c> is a
/// sequential scan every run, on a table whose whole premise is unbounded growth. Accepted
/// rather than overlooked: an index on <c>expires_at</c> needs a migration, migrations are
/// rationed here, and the scan is cheap while the table is small. It stops being cheap as the
/// table grows -- see the scheduling design doc and the follow-up issue it names.</para>
/// </summary>
public static class SurveyDraftRetentionJob
{
    /// <summary>
    /// Rows reclaimed per scheduled run. Generous relative to the steady state -- a tenant
    /// would have to abandon a thousand wizard sessions in an hour to reach it -- and small
    /// enough that the initial backlog drains over ticks rather than in one transaction.
    /// </summary>
    public const int DefaultBatchSize = 1000;

    private const string LogCategory = "ClimateProject.Workers.SurveyDraftRetention";

    /// <summary>
    /// Runs the sweep and logs what it reclaimed.
    /// </summary>
    public static async Task<SurveyDraftRetentionResult> RunAsync(
        ClimateProjectDbContext db,
        ILoggerFactory loggerFactory,
        DateTimeOffset nowUtc,
        int batchSize,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(loggerFactory);
        ArgumentOutOfRangeException.ThrowIfLessThan(batchSize, 1);

        var result = await PurgeAsync(db, nowUtc, batchSize, cancellationToken);

        if (result.Deleted > 0)
        {
            loggerFactory.CreateLogger(LogCategory).LogInformation(
                "Survey draft retention sweep reclaimed {Deleted} expired drafts as of {NowUtc:O}. " +
                "More remaining: {MoreRemaining}.",
                result.Deleted,
                nowUtc,
                result.MoreRemaining);
        }

        return result;
    }

    /// <summary>
    /// The delete itself, in one place so the worker and
    /// <c>DELETE /surveys/drafts/expired</c> cannot disagree about which rows are expired --
    /// the same reason notification dispatch has one shared method behind its endpoint and
    /// its worker.
    ///
    /// <para>Expired means <c>expires_at &lt;= now</c>, matching
    /// <see cref="SurveyDraftRetention.IsExpired"/> and the inverse of the
    /// <c>expires_at &gt; now</c> filter every read applies, so a row is never both invisible
    /// and unreclaimable. It reads no draft content, which is what keeps a cross-tenant sweep
    /// compatible with drafts being private to their author.</para>
    /// </summary>
    /// <param name="maxRows">
    /// At most this many rows, in no particular order; <c>null</c> for no cap.
    /// </param>
    public static async Task<SurveyDraftRetentionResult> PurgeAsync(
        ClimateProjectDbContext db,
        DateTimeOffset nowUtc,
        int? maxRows,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        if (maxRows is int requested)
        {
            ArgumentOutOfRangeException.ThrowIfLessThan(requested, 1);
        }

        var expired = db.SurveyDrafts.Where(d => d.ExpiresAt <= nowUtc);

        if (maxRows is not int cap)
        {
            return new SurveyDraftRetentionResult(await expired.ExecuteDeleteAsync(cancellationToken), false);
        }

        // Two statements rather than a limited DELETE: `Take` inside `ExecuteDelete` is not
        // translatable on every provider, and the ids are cheap because the cap bounds them.
        //
        // Deliberately unordered. An earlier draft sorted by `expires_at, id` so a backlog
        // drained in the order it accumulated, but nothing can observe that order -- every row
        // in this set is already hidden by the read filters, so "which expired row went first"
        // has no consumer. What the sort did cost is real: `survey_drafts` has no index on
        // `expires_at` (see the retention section of the scheduling design doc), so ordering
        // forces the whole table to be scanned and top-N sorted on every tick, whereas an
        // unordered LIMIT lets Postgres stop as soon as it has found its capful. Progress is
        // still monotone without it -- the rows it takes are deleted, so the next tick cannot
        // be handed the same ones and no row can be starved.
        var ids = await expired
            .Select(d => d.Id)
            // One more than the cap, purely to answer "is there more behind this?" exactly.
            // `ids.Count == cap` would have claimed a backlog whenever the number of expired
            // rows happened to land on the cap, which is the one case where there is none.
            .Take(cap + 1)
            .ToListAsync(cancellationToken);

        if (ids.Count == 0)
        {
            return new SurveyDraftRetentionResult(0, false);
        }

        var moreRemaining = ids.Count > cap;
        if (moreRemaining)
        {
            ids.RemoveAt(ids.Count - 1);
        }

        var deleted = await db.SurveyDrafts
            .Where(d => ids.Contains(d.Id))
            .ExecuteDeleteAsync(cancellationToken);

        // Reported rather than looped: the next tick is the retry, and a loop here would defeat
        // the cap it just honoured.
        return new SurveyDraftRetentionResult(deleted, moreRemaining);
    }
}

/// <summary>
/// What one sweep did. <paramref name="MoreRemaining"/> is true when the run hit its cap and
/// expired rows may still be waiting for the next tick.
/// </summary>
public sealed record SurveyDraftRetentionResult(int Deleted, bool MoreRemaining);
