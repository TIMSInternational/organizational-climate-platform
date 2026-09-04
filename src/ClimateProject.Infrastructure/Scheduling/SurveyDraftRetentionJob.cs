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
/// <para><b>Running since #275.</b> <c>SurveyDraftRetentionWorker</c> is registered by
/// <c>SchedulingServiceCollectionExtensions.AddClimateProjectScheduling</c> and the API host
/// calls that at <c>Program.cs</c> (<c>AddClimateProjectScheduling</c>), so the job ticks in
/// every API instance, on a Postgres advisory lease so N instances make one scheduler
/// (<c>Jobs.cs</c>, <c>survey-draft-retention</c>, default interval one hour). An earlier
/// version of this comment said nothing ticked it in production; measured 2026-09-03, it
/// does.</para>
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
/// <para><b>The predicate is indexed (#278).</b> It was not when this job landed:
/// <c>survey_drafts</c> carried <c>company_id</c> and <c>user_id</c> only, so
/// <c>WHERE expires_at &lt;= now</c> was a sequential scan every run, on a table whose whole
/// premise is unbounded growth. <c>20260810180421_AddSurveyDraftExpiresAtIndex</c> added
/// <c>IX_survey_drafts_expires_at</c> and both statements below now plan as index scans --
/// asserted, on the plan rather than on the catalogue, by
/// <c>SurveyDraftExpiryIndexTests</c>. Keep the predicate a bare comparison on the column:
/// wrapping <c>expires_at</c> in a function or comparing it to a computed expression puts the
/// sequential scan back with nothing to show for it.</para>
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
        // has no consumer. That is the whole reason, and it is the one that has not moved.
        //
        // The cost argument that accompanied it has moved, and is recorded here so nobody
        // re-derives it from a stale premise: when the sort was removed, `expires_at` was
        // unindexed, so ordering meant a full scan plus a top-N sort every tick. Since #278
        // added `IX_survey_drafts_expires_at`, an `ORDER BY expires_at` would be servable from
        // the index and would cost far less than it used to. It stays removed anyway, on the
        // "no consumer" ground alone. Progress is monotone without it either way -- the rows a
        // tick takes are deleted, so the next tick cannot be handed the same ones and no row
        // can be starved.
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

        // `d.ExpiresAt <= nowUtc` is repeated here, not just in the harvest above, and it is
        // load-bearing rather than belt-and-braces. Between the SELECT and this DELETE, a
        // draft can be saved -- and every save pushes ExpiresAt out (SurveyDraftEndpoints
        // re-stamps it on write). Deleting by id alone would therefore reclaim a draft
        // somebody had just resumed, which is precisely the loss this job's own safety
        // argument says it can never cause: "it deletes strictly by expires_at and every
        // save pushes that out, so it can never take a draft someone is working on."
        //
        // With the predicate restated, a row rescued in that window simply fails to match
        // and survives; the count returned is what was actually deleted, so the log does not
        // overstate either.
        var deleted = await db.SurveyDrafts
            .Where(d => ids.Contains(d.Id) && d.ExpiresAt <= nowUtc)
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
