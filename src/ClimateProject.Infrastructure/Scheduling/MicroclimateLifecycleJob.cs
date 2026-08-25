using System.Text.Json;
using ClimateProject.Application.Microclimates;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Scheduling;

/// <summary>
/// Closes a microclimate when its <c>EndTime</c> passes. The scheduled half of the microclimate
/// lifecycle, which until now did not exist.
///
/// <para><b>What was broken.</b> A microclimate's <c>StartTime</c> and <c>EndTime</c> were
/// decoration: nothing on the server read them to decide whether the session was open, and no
/// job ever closed one. <see cref="MicroclimateStatuses.AcceptsResponses"/> is
/// <c>status == active</c>, full stop, and <c>MicroclimateEndpoints.SubmitResponseAsync</c>
/// checks that and nothing else, so an activated microclimate kept taking answers indefinitely
/// past its deadline unless a human remembered to send <c>PUT /microclimates/{id}/status</c>.
/// The same defect <see cref="SurveyLifecycleJob"/> fixed for surveys, on the surface where it
/// costs more.</para>
///
/// <para><b>Why it costs more here.</b> A survey's late responses can at least be found: they
/// are rows with timestamps. A microclimate's are folded straight into <c>ResponseCount</c>,
/// <c>LiveResults.SentimentScore</c> and <c>LiveResults.WordCloudData</c> with no per-response
/// row, so there is nothing to key on and a late answer cannot be identified or unpicked
/// afterwards. And the rest of the product already behaved as though the window were real,
/// which is what made the gap misleading rather than merely absent:
/// <see cref="InvitationReminderJob"/> stops nagging respondents once <c>EndTime</c> has passed
/// (<c>microclimate.Scheduling.EndTime &gt; nowUtc</c>), so the product stopped inviting people
/// to a session it was still collecting into -- late answers arrived from whoever kept the link
/// and only from them; and <c>MicroclimateExportProjection.ToCsv</c> writes <c>end_time</c> next
/// to <c>response_count</c>, so an admin reading a CSV whose deadline was last month had no way
/// to know the count beside it was still moving.</para>
///
/// <para><b>One transition, and the refusal is the argued part.</b> The whole rule is
/// <see cref="MicroclimateLifecycleSchedule"/>, in Application, where it is unit-testable
/// without Docker: <c>active -&gt; closed</c> on <c>EndTime</c>, and never
/// <c>draft -&gt; active</c> on <c>StartTime</c> even though the transition map permits it.
/// That is not a straight port of the survey job, which opens out of <c>scheduled</c> -- a
/// status whose meaning is "an admin has already said publish". A microclimate has no such
/// status; its <c>draft</c> means "still being authored", and publishing runs the #195
/// translation gate inside the endpoint, which a background job can neither run usefully nor
/// report back. Opening one on a timer would put half-translated content in front of
/// respondents with no way back, since <c>active -&gt; draft</c> does not exist. Closing that
/// half needs a <c>scheduled</c> status added to the vocabulary; this class is the plumbing for
/// the half that loses data, and <see cref="MicroclimateLifecycleSchedule"/> is the
/// decision.</para>
///
/// <para><b>The SQL is a pre-filter, not the rule.</b> The query below selects only rows that
/// could possibly need a move, and then every candidate is put back through
/// <see cref="MicroclimateLifecycleSchedule.NextStatusFor"/> and through
/// <see cref="MicroclimateStatuses.CanTransition"/> before anything is written. Two checks on a
/// decision the query already made looks redundant and is not: this job writes status
/// transitions to live customer data from a background thread, where a wrong one is discovered
/// by a customer rather than by a build. The predicate can be optimised freely without any of
/// that being able to change what the job does, and a transition the domain's own map forbids
/// becomes an error log and a skipped row rather than an UPDATE.</para>
///
/// <para><b>A human always wins.</b> Every write is conditional on both facts the decision was
/// made from -- the status this sweep read and the deadline it judged to have passed
/// (<c>UPDATE ... WHERE id = ? AND status = ? AND scheduling_end_time = ?</c>). The job lease
/// serialises this job against itself; nothing serialises it against a person, and
/// <c>PUT /microclimates/{id}/status</c>, <c>PUT /microclimates/{id}</c> and
/// <c>POST /microclimates/bulk</c> can land at any moment in the seconds between this sweep's
/// SELECT and its UPDATE -- including a <c>PUT /microclimates/{id}</c> that extends
/// <c>EndTime</c> on a session whose deadline is seconds away, which is exactly when an admin
/// extends one. Unconditionally the scheduler would win every one of those races, because it is
/// the one holding a transaction open -- and closing is terminal here in a way it is not for a
/// survey: <c>closed</c> has no outgoing edges at all, so a microclimate closed out from under
/// an administrator cannot be reopened, re-dated or returned to draft by anybody, and there is
/// no <c>duplicate</c> route to run it again. Losing that update is not a lost write; it is a
/// session nobody can ever run. So a row that changed underneath the sweep is left alone and
/// logged, and the next tick re-reads it and re-decides on what it finds.</para>
///
/// <para><b>Cadence: five minutes</b> (<c>Scheduling:MicroclimateLifecycleInterval</c>), the
/// same as the survey lifecycle and for the same reason -- this is about promptness, not
/// correctness. It does mean the window is a scheduler tick rather than a hard cutoff: an answer
/// submitted three minutes after the deadline is still accepted. That is a deliberate, bounded
/// regression from perfect and an enormous improvement on unbounded. Microclimates are
/// shorter-lived than surveys (hours to days rather than weeks), which is an argument for a
/// tighter tick and not for a different mechanism; five minutes is still small against a window
/// an admin sets in hours, and matching the survey cadence keeps one number to reason about.</para>
///
/// <para><b>No index, deliberately no migration.</b> The predicate is
/// <c>status = 'active' AND scheduling_end_time &lt;= ?</c> against <c>microclimates</c>, which
/// carries an index on <c>(company_id, status)</c> -- unusable here, because this sweep is
/// deployment-wide and names no company -- so each tick is a sequential scan. That is the right
/// trade today: <c>microclimates</c> holds tens of rows per tenant, and a status transition is
/// not worth a schema change on a contended migration chain. If it ever becomes one, the shape
/// to add is a partial index on <c>(status, scheduling_end_time)</c> restricted to <c>active</c>,
/// and the predicate must stay a bare comparison on the column so it can be used.</para>
///
/// <para><b>The anonymity floor is untouched.</b> This job writes <c>microclimates.status</c>,
/// <c>microclimates.updated_at</c> and an <c>audit_logs</c> row. It reads no response, no
/// respondent and no count, and it never lowers
/// <c>RealtimeSettings.ParticipationThreshold</c> -- the microclimate floor is a
/// respondent-count rule and nothing here can change a respondent count. Closing can only ever
/// reduce the number of answers a session will ever have, so it cannot lift a suppressed group
/// above the threshold.</para>
///
/// <para><b>Attribution.</b> Every transition writes one <c>audit_logs</c> row with a null
/// <c>user_id</c> -- the "system entry" the column is nullable for. There is no per-microclimate
/// audit table to write to at all (unlike <c>survey_audit_logs</c>), so <c>GET /audit</c>
/// filtered on <c>?resource=microclimates.status</c> is the whole trail, and the null actor is
/// what distinguishes the scheduler from a person.</para>
/// </summary>
public static class MicroclimateLifecycleJob
{
    /// <summary>
    /// Transitions applied per tick. Bounded so one sweep is one bounded transaction under the
    /// job lease -- the same reason the retention sweeps are capped.
    ///
    /// <para>A hundred is generous against the steady state by orders of magnitude: a
    /// microclimate closes once in its life, so reaching this cap in five minutes would take a
    /// hundred sessions ending in the same minute. It is sized for the first tick after deploy,
    /// which has to work through every microclimate that has been sitting past its <c>EndTime</c>
    /// since the product launched, and which drains over consecutive ticks rather than taking one
    /// enormous transaction.</para>
    /// </summary>
    public const int DefaultBatchSize = 100;

    /// <summary>
    /// <c>audit_logs.resource</c> for a lifecycle transition.
    ///
    /// <para>Deliberately the same value <c>AuditPolicy</c> derives for
    /// <c>PUT /microclimates/{id}/status</c>, so that one filter --
    /// <c>?resource=microclimates.status</c> -- returns every status change a microclimate ever
    /// had, whoever made it, and the null <c>user_id</c> is what distinguishes the scheduler from
    /// a person. Hard-coded here because this writer has no route to derive it from; a test pins
    /// it against the live derivation so the two cannot drift.</para>
    /// </summary>
    public const string AuditResource = "microclimates.status";

    /// <summary>
    /// <c>audit_logs.action</c> for an automatic close. Distinct from the endpoint's derived
    /// <c>microclimates.status.update</c> on purpose: an operator reading the trail should be
    /// able to tell "the scheduler closed this on its end time" from "somebody sent a PUT", and a
    /// row that merely says <c>update</c> with no actor invites the conclusion that a token was
    /// misconfigured.
    /// </summary>
    public const string ClosedAction = "microclimates.status.closed";

    private const string LogCategory = "ClimateProject.Workers.MicroclimateLifecycle";

    /// <summary>The most stranded ids one warning will name. The count is what alarms; the ids are a starting point.</summary>
    private const int MaxStrandedIdsLogged = 10;

    /// <summary>
    /// One sweep. Writes through the caller's <see cref="ClimateProjectDbContext"/> -- one
    /// conditional UPDATE per transition, then a single save for the audit rows; the lease's
    /// transaction is what commits the lot, so a throw anywhere leaves every status exactly where
    /// it was.
    /// </summary>
    public static async Task<MicroclimateLifecycleSweepResult> RunAsync(
        ClimateProjectDbContext db,
        ILoggerFactory loggerFactory,
        DateTimeOffset nowUtc,
        int batchSize,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(loggerFactory);
        ArgumentOutOfRangeException.ThrowIfLessThan(batchSize, 1);

        var logger = loggerFactory.CreateLogger(LogCategory);

        // Only rows that need a write. Oldest deadline first, and that is not cosmetic: with a
        // cap in play, ordering is what makes progress monotone. An unordered page could hand a
        // later tick the same rows it just skipped while a session that ended on Tuesday goes on
        // collecting answers.
        var (toClose, more) = await TakeAsync(
            db.Microclimates
                // Read-only on purpose. Nothing below assigns to a tracked entity: the write is
                // the conditional UPDATE in AdvanceAsync, and a tracked copy would only offer a
                // second, unconditional way to write the same column.
                .AsNoTracking()
                .Where(m => m.Status == MicroclimateStatuses.Active && m.Scheduling.EndTime <= nowUtc)
                .OrderBy(m => m.Scheduling.EndTime)
                .ThenBy(m => m.Id),
            batchSize,
            cancellationToken);

        var closed = await AdvanceAsync(db, toClose, nowUtc, logger, cancellationToken);

        // Nothing here is written -- see MicroclimateLifecycleSchedule.WindowElapsedWhileDraft
        // for why a draft is never opened on a timer. It cannot overlap with what this tick just
        // closed: closing requires `active` and stranded requires `draft`.
        var stranded = await FindStrandedAsync(db, nowUtc, batchSize, cancellationToken);

        if (closed > 0)
        {
            await db.SaveChangesAsync(cancellationToken);

            logger.LogInformation(
                "Microclimate lifecycle sweep at {NowUtc:O} closed {Closed} session(s) whose window had ended.",
                nowUtc,
                closed);
        }

        if (stranded.Count > 0)
        {
            // A warning, not information: each of these is a session with a scheduled window that
            // came and went while it was never activated -- and because activation is manual and
            // this job will not do it, nothing else anywhere reports that. It will name abandoned
            // authoring drafts as well, which the vocabulary cannot tell apart from scheduled
            // ones; the line says so rather than implying every id needs action.
            logger.LogWarning(
                "{Stranded} microclimate(s) are still 'draft' with an end time already in the past as of " +
                "{NowUtc:O}; their window elapsed without anyone activating them, and this job will not open a " +
                "draft, because publishing runs a translation gate no background job can report on. Some of these " +
                "are simply abandoned drafts. First ids: {MicroclimateIds}.",
                stranded.Count,
                nowUtc,
                string.Join(", ", stranded.Take(MaxStrandedIdsLogged)));
        }

        return new MicroclimateLifecycleSweepResult(closed, stranded.Count, more);
    }

    /// <summary>
    /// Takes one page and answers "is there more behind this?" exactly, by asking for one row
    /// more than the cap and throwing it away -- the idiom <see cref="SurveyDraftRetentionJob"/>
    /// uses, and for its reason: <c>count == cap</c> would claim a backlog on the one occasion
    /// there is none.
    /// </summary>
    private static async Task<(List<Microclimate> Page, bool More)> TakeAsync(
        IOrderedQueryable<Microclimate> query,
        int batchSize,
        CancellationToken cancellationToken)
    {
        var page = await query.Take(batchSize + 1).ToListAsync(cancellationToken);

        if (page.Count <= batchSize)
        {
            return (page, false);
        }

        page.RemoveAt(page.Count - 1);
        return (page, true);
    }

    /// <summary>
    /// Applies the schedule to each candidate and returns how many actually moved.
    ///
    /// <para><b>Every write is a compare-and-swap.</b> The <c>UPDATE</c> carries
    /// <c>AND status = @from AND scheduling_end_time = @deadline</c> -- both facts this sweep
    /// actually read and made its decision on -- so a row somebody changed in the meantime
    /// updates zero rows and is skipped instead of being overwritten. This is not theoretical. The job lease serialises this job against
    /// itself, but nothing serialises it against a person: four routes change a microclimate's
    /// status (<c>POST /activate</c>, <c>PUT /status</c>, <c>PUT /{id}</c> and
    /// <c>POST /bulk</c>), they run on the API at any moment, and the gap between this sweep's
    /// SELECT and its UPDATE is the whole of the sweep. Without the condition the last writer
    /// would win and it would always be the scheduler, because the scheduler holds the
    /// transaction open longest.</para>
    ///
    /// <para>The deadline half of the condition is this surface's own rather than a port of
    /// #371's. <c>PUT /microclimates/{id}</c> accepts an <c>EndTime</c> change on a live session,
    /// and the moment an admin uses it is the moment the deadline is about to lapse -- so the
    /// stale-read window and the edit window are the same window. Without the clause the sweep
    /// would close the session on a deadline that no longer existed, terminally.</para>
    ///
    /// <para>What that loses is exactly what makes the bug bad. <c>closed</c> is terminal in
    /// <see cref="MicroclimateStatuses"/> -- no outgoing edges at all -- so a session closed out
    /// from under an administrator who was mid-edit cannot be reopened, re-dated or returned to
    /// draft by anyone. Losing an update here is not a lost write; it is a microclimate nobody
    /// can ever run.</para>
    ///
    /// <para>No status is assigned to a tracked entity and nothing is saved here. The audit rows
    /// are staged and the caller saves once; the lease's transaction is what makes a sweep
    /// atomic, which is what keeps a status change and its audit row from ever existing without
    /// the other. A caller that runs this outside a transaction gets each conditional UPDATE
    /// committed on its own -- fine for a test, and the reason the worker never does it.</para>
    /// </summary>
    private static async Task<int> AdvanceAsync(
        ClimateProjectDbContext db,
        List<Microclimate> candidates,
        DateTimeOffset nowUtc,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var moved = 0;

        foreach (var microclimate in candidates)
        {
            var target = MicroclimateLifecycleSchedule.NextStatusFor(
                microclimate.Status,
                microclimate.Scheduling.StartTime,
                microclimate.Scheduling.EndTime,
                nowUtc);

            if (target is null)
            {
                // The query said this row needed a move and the rule says it does not. Reachable
                // only if the two disagree, which is a bug in one of them and never a reason to
                // guess: the row is left exactly as it is.
                logger.LogError(
                    "Microclimate {MicroclimateId} matched the lifecycle sweep in status '{Status}' (start " +
                    "{StartTime:O}, end {EndTime:O}) but the schedule names no transition for it. Left unchanged; " +
                    "the query predicate and MicroclimateLifecycleSchedule have come apart.",
                    microclimate.Id,
                    microclimate.Status,
                    microclimate.Scheduling.StartTime,
                    microclimate.Scheduling.EndTime);
                continue;
            }

            if (!MicroclimateStatuses.CanTransition(microclimate.Status, target))
            {
                // The domain's map has the last word, even over this job's own rule. An edge
                // removed from MicroclimateStatuses stops being taken here on the same deploy,
                // without anybody having to remember that this file exists.
                logger.LogError(
                    "Microclimate {MicroclimateId} would move '{From}' -> '{To}' on its dates, but that is not a " +
                    "legal transition. Left unchanged. Allowed from '{From}': {Allowed}.",
                    microclimate.Id,
                    microclimate.Status,
                    target,
                    microclimate.Status,
                    string.Join(", ", MicroclimateStatuses.AllowedTransitionsFrom(microclimate.Status)));
                continue;
            }

            var from = microclimate.Status;
            var deadline = microclimate.Scheduling.EndTime;

            // The compare-and-swap, on BOTH facts this decision was made from: the row moves only
            // if it is still in the status this sweep read and still carries the deadline that
            // sweep judged to have passed.
            //
            // The status half is the one #371 argued for. The deadline half is this surface's
            // own, and it is not decoration: `PUT /microclimates/{id}` accepts an EndTime change
            // while a session is active, and extending a deadline that is about to lapse is
            // exactly when an admin does it -- seconds before it lapses. Without this clause the
            // sweep would close the session anyway, on a deadline that no longer exists, and
            // `closed` is terminal here: no edge back to `active`, no edge back to `draft`,
            // nothing to duplicate. The extension would be lost and the session unrunnable.
            //
            // updated_at is set in the same statement for the same reason the endpoint sets it --
            // a status change is a change, and leaving it alone would hide an automatic close
            // from every "recently changed" listing in the product, which is where an admin
            // would look for it.
            var written = await db.Microclimates
                .Where(m => m.Id == microclimate.Id
                            && m.Status == from
                            && m.Scheduling.EndTime == deadline)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(m => m.Status, target)
                        .SetProperty(m => m.UpdatedAt, nowUtc),
                    cancellationToken);

            if (written == 0)
            {
                // Somebody changed this row between the SELECT and here -- its status, its
                // deadline, or both. Their edit wins: it was made by a person, on a microclimate
                // they administer, with the whole product in front of them. Information rather
                // than a warning -- an admin racing the scheduler to the minute is unusual but
                // entirely correct behaviour, and the row is now in whatever state they chose.
                logger.LogInformation(
                    "Microclimate {MicroclimateId} was '{From}' with end time {EndTime:O} when the lifecycle sweep " +
                    "read it and is not any more, so the move to '{To}' was not applied. A concurrent change wins " +
                    "over this job by design.",
                    microclimate.Id,
                    from,
                    deadline,
                    target);
                continue;
            }

            db.AuditLogs.Add(new AuditLog
            {
                Id = Guid.NewGuid(),
                // Null: the platform did this, not a person.
                UserId = null,
                CompanyId = microclimate.CompanyId,
                Action = ClosedAction,
                Resource = AuditResource,
                ResourceId = microclimate.Id.ToString(),
                Details = Describe(from, target, deadline),
                Success = true,
                Timestamp = nowUtc,
            });

            // Per row, at information. A microclimate closes once in its life, so there is no
            // volume argument against naming each one, and "why did my microclimate close" is a
            // question somebody will ask about a specific id.
            logger.LogInformation(
                "Microclimate {MicroclimateId} moved '{From}' -> '{To}' on its own end time (start {StartTime:O}, " +
                "end {EndTime:O}) at {NowUtc:O}.",
                microclimate.Id,
                from,
                target,
                microclimate.Scheduling.StartTime,
                microclimate.Scheduling.EndTime,
                nowUtc);

            moved++;
        }

        return moved;
    }

    /// <summary>
    /// Microclimates still <c>draft</c> whose window has entirely elapsed. Capped: the number is
    /// a signal to alarm on, not an accounting figure, and a first sweep over a long-neglected
    /// database should not pull every one of them into memory to count them.
    /// </summary>
    private static async Task<List<Guid>> FindStrandedAsync(
        ClimateProjectDbContext db,
        DateTimeOffset nowUtc,
        int batchSize,
        CancellationToken cancellationToken)
    {
        var candidates = await db.Microclimates
            .AsNoTracking()
            .Where(m => m.Status == MicroclimateStatuses.Draft && m.Scheduling.EndTime <= nowUtc)
            .OrderBy(m => m.Scheduling.EndTime)
            .ThenBy(m => m.Id)
            .Select(m => new { m.Id, m.Status, EndTime = m.Scheduling.EndTime })
            .Take(batchSize)
            .ToListAsync(cancellationToken);

        // Through the pure predicate rather than trusting the WHERE, for the same reason the
        // transition goes through its own: the definition of "stranded" lives in Application, and
        // this query is only how the rows get here.
        return
        [
            .. candidates
                .Where(c => MicroclimateLifecycleSchedule.WindowElapsedWhileDraft(c.Status, c.EndTime, nowUtc))
                .Select(c => c.Id),
        ];
    }

    /// <summary>
    /// <c>audit_logs.details</c> for one transition.
    ///
    /// <para>Serialized with the default naming policy, not the web one, to match
    /// <c>AuditWritingMiddleware.Describe</c> and <see cref="SurveyLifecycleJob"/> -- the other
    /// writers of this column. Two casing conventions in one jsonb column would make it
    /// unqueryable without knowing which writer produced the row.</para>
    /// </summary>
    private static string Describe(string from, string to, DateTimeOffset trigger)
        => JsonSerializer.Serialize(new MicroclimateLifecycleAuditDetails(from, to, trigger));

    /// <param name="Trigger">
    /// The date that came due -- the <c>EndTime</c> this close fired on. Recorded because it is
    /// the one fact a reader cannot recover later: <c>PUT /microclimates/{id}</c> still accepts a
    /// schedule edit, so the end time on the row a month from now need not be the one this
    /// transition fired on.
    /// </param>
    private sealed record MicroclimateLifecycleAuditDetails(string From, string To, DateTimeOffset Trigger);
}

/// <summary>What one microclimate lifecycle sweep did.</summary>
/// <param name="Closed">
/// Microclimates moved <c>active -&gt; closed</c> because their end time had passed.
/// </param>
/// <param name="Stranded">
/// Microclimates left alone in <c>draft</c> with their whole window behind them. Never a count
/// of work done -- it is a count of sessions that never ran, capped at the batch size.
/// </param>
/// <param name="MoreRemaining">
/// True when the close batch filled, so more transitions are waiting for the next tick. Expected
/// on the first sweep after this job is deployed and on no sweep thereafter.
/// </param>
public sealed record MicroclimateLifecycleSweepResult(int Closed, int Stranded, bool MoreRemaining);
