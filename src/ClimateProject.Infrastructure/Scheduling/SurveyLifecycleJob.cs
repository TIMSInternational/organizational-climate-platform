using System.Text.Json;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Scheduling;

/// <summary>
/// Opens a survey when its <c>start_date</c> arrives and closes it when its <c>end_date</c>
/// passes. The scheduled half of the survey lifecycle, which until now did not exist.
///
/// <para><b>What was broken.</b> <c>WorkerJobs</c> declared six jobs and not one of them
/// advanced a survey's status. <see cref="SurveyStatuses.AcceptsResponses"/> is
/// <c>status == active</c>, full stop, and <c>SurveyResponseEndpoints</c> checks nothing else
/// -- on purpose, with the reasoning written down. So a survey published as <c>scheduled</c>
/// stayed shut forever no matter what its start date said, and an <c>active</c> one kept
/// taking answers years past its deadline. Both halves of the response window were
/// decoration.</para>
///
/// <para><b>Which transitions, and which never.</b> The whole rule is
/// <see cref="SurveyLifecycleSchedule"/>, in Application, where it is unit-testable without
/// Docker and where the defence of each refusal is written out: <c>scheduled -&gt; active</c>
/// and <c>active -&gt; closed</c> only; never out of <c>draft</c>, never
/// <c>scheduled -&gt; closed</c> even though the transition map permits it, never to
/// <c>archived</c>, never anything to a row that is already <c>closed</c> or
/// <c>archived</c>. This class is the plumbing; that class is the decision.</para>
///
/// <para><b>The SQL is a pre-filter, not the rule.</b> Each query below selects only rows that
/// could possibly need a move, and then every candidate is put back through
/// <see cref="SurveyLifecycleSchedule.NextStatusFor"/> and through
/// <see cref="SurveyStatuses.CanTransition"/> before anything is written. Two checks on a
/// decision the query already made looks redundant and is not: this job writes status
/// transitions to live customer data from a background thread, where a wrong one is discovered
/// by a customer rather than by a build. The predicate can be optimised freely -- indexes, a
/// different ordering, a rewritten <c>WHERE</c> -- without any of that being able to change
/// what the job does, and a transition the domain's own map forbids becomes an error log and a
/// skipped row rather than an UPDATE.</para>
///
/// <para><b>A human always wins.</b> Every write is conditional on the status this sweep read
/// (<c>UPDATE ... WHERE id = ? AND status = ?</c>). The job lease serialises this job against
/// itself; nothing serialises it against a person, and <c>PUT /surveys/{id}/status</c> can land
/// at any moment in the seconds between this sweep's SELECT and its UPDATE. Unconditionally,
/// the scheduler would win that race every time -- and the transitions it would overwrite are
/// the ones it is most careful never to make itself: from <c>scheduled</c> a human may go to
/// <c>draft</c> or <c>archived</c>, and a survey dragged back to <c>draft</c> to fix its dates
/// and then re-opened by this job is stuck in <c>active</c>, which has no edge back to
/// <c>draft</c>, with its content frozen for good. So a row that moved underneath the sweep is
/// left alone and logged, and the next tick re-reads it.</para>
///
/// <para><b>Cadence: five minutes</b> (<c>Scheduling:SurveyLifecycleInterval</c>), matching
/// <c>ScheduledReportJob</c>'s reasoning -- this is about promptness, not correctness. It does
/// mean the window is a scheduler tick rather than a hard cutoff: a response submitted three
/// minutes after the deadline is still accepted. That is a deliberate, bounded regression from
/// perfect and an enormous improvement on unbounded, and the alternative -- having the submit
/// endpoint re-derive the window from the dates -- is refused there for a reason that has not
/// changed (it would refuse a survey that <c>/surveys/my</c> still lists). Faster ticks buy
/// less than they look like they would: the start and end times an admin picks are hours, not
/// seconds.</para>
///
/// <para><b>No index, deliberately no migration.</b> Both predicates are
/// <c>status = ? AND date &lt;=|&gt; ?</c> against <c>surveys</c>, which carries no index on
/// any of the three columns, so each tick is a sequential scan. That is the right trade today:
/// <c>surveys</c> holds tens of rows per tenant rather than the unbounded growth that earned
/// <c>survey_drafts</c> its index in #278, and a status transition is not worth a schema change
/// on a contended migration chain. If it ever becomes one, the shape to add is a partial index
/// on <c>(status, start_date)</c> and <c>(status, end_date)</c> restricted to the two live
/// statuses -- and keep the predicates bare comparisons on the columns so it can be used.</para>
///
/// <para><b>The anonymity floor is untouched.</b> This job writes <c>surveys.status</c>,
/// <c>surveys.updated_at</c> and an <c>audit_logs</c> row. It reads no response, no respondent
/// and no count, and <c>SurveyResultsPrivacy</c> takes no status input at all -- the floor is a
/// respondent-count rule and nothing here can change a respondent count. Closing a survey can
/// only ever reduce the number of answers it will ever have, so it cannot lift a suppressed
/// group above the threshold.</para>
///
/// <para><b>Attribution.</b> Every transition writes one <c>audit_logs</c> row with a null
/// <c>user_id</c> -- the "system entry" the column is nullable for, and which
/// <c>AuditLogTests</c> already pins as round-trippable. It deliberately does <b>not</b> write
/// the per-survey <c>survey_audit_logs</c> row that <c>PUT /surveys/{id}/status</c> writes,
/// because that table's <c>user_id</c> is NOT NULL behind a RESTRICT foreign key: the only way
/// to record a scheduler action there is to attribute it to a human who did not perform it,
/// and a false name in an audit trail is worse than a gap. The consequence, stated plainly so
/// nobody has to discover it: <c>GET /surveys/{id}/history</c> shows manual transitions and not
/// automatic ones, while <c>GET /audit</c> shows both. Closing that needs
/// <c>survey_audit_logs.user_id</c> to become nullable, which is a migration this slice does
/// not take.</para>
/// </summary>
public static class SurveyLifecycleJob
{
    /// <summary>
    /// Transitions applied per category per tick. Bounded so one sweep is one bounded
    /// transaction under the job lease -- the same reason the retention sweeps are capped.
    ///
    /// <para>A hundred is generous against the steady state by orders of magnitude: a survey
    /// opens and closes once in its life, so reaching this cap in five minutes would take a
    /// hundred surveys scheduled to the same minute. It is sized for the first tick after
    /// deploy, which has to work through every survey that has been sitting past its end date
    /// since the product launched, and which drains over consecutive ticks rather than taking
    /// one enormous transaction.</para>
    /// </summary>
    public const int DefaultBatchSize = 100;

    /// <summary>
    /// <c>audit_logs.resource</c> for a lifecycle transition.
    ///
    /// <para>Deliberately the same value <c>AuditPolicy</c> derives for
    /// <c>PUT /surveys/{id}/status</c>, so that one filter -- <c>?resource=surveys.status</c>
    /// -- returns every status change a survey ever had, whoever made it, and the null
    /// <c>user_id</c> is what distinguishes the scheduler from a person. Hard-coded here
    /// because this writer has no route to derive it from; a test pins it against the live
    /// derivation so the two cannot drift.</para>
    /// </summary>
    public const string AuditResource = "surveys.status";

    /// <summary>
    /// <c>audit_logs.action</c> for an automatic open. Distinct from the endpoint's derived
    /// <c>surveys.status.update</c> on purpose: an operator reading the trail should be able to
    /// tell "the scheduler opened this on its start date" from "somebody sent a PUT", and a row
    /// that merely says <c>update</c> with no actor invites the conclusion that a token was
    /// misconfigured.
    /// </summary>
    public const string OpenedAction = "surveys.status.opened";

    /// <summary><c>audit_logs.action</c> for an automatic close. See <see cref="OpenedAction"/>.</summary>
    public const string ClosedAction = "surveys.status.closed";

    private const string LogCategory = "ClimateProject.Workers.SurveyLifecycle";

    /// <summary>The most stranded ids one warning will name. The count is what alarms; the ids are a starting point.</summary>
    private const int MaxStrandedIdsLogged = 10;

    /// <summary>
    /// One sweep. Writes through the caller's <see cref="ClimateProjectDbContext"/> -- one
    /// conditional UPDATE per transition, then a single save for the audit rows; the lease's
    /// transaction is what commits the lot, so a throw anywhere leaves every status exactly
    /// where it was.
    /// </summary>
    public static async Task<SurveyLifecycleSweepResult> RunAsync(
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

        // Two queries rather than one disjunction. `status = 'active' AND start_date <= now` is
        // true of every running survey in the database, so a single query broad enough to cover
        // both cases would ship every active row across the wire every five minutes and then
        // discard almost all of them. Each of these returns only rows that need a write.
        //
        // Oldest first, in both, and that is not cosmetic: with a cap in play, ordering is what
        // makes progress monotone. Unordered pages could hand a later tick the same rows it just
        // skipped while a survey that has been waiting since Tuesday is starved -- and unlike
        // the draft sweep, whose rows are invisible either way, every row here is a survey a
        // company is waiting on.
        var (toOpen, moreToOpen) = await TakeAsync(
            db.Surveys
                // Read-only on purpose. Nothing below assigns to a tracked entity: the write is
                // the conditional UPDATE in AdvanceAsync, and a tracked copy would only offer a
                // second, unconditional way to write the same column.
                .AsNoTracking()
                .Where(s => s.Status == SurveyStatuses.Scheduled
                            && s.StartDate <= nowUtc
                            && s.EndDate > nowUtc)
                .OrderBy(s => s.StartDate)
                .ThenBy(s => s.Id),
            batchSize,
            cancellationToken);

        var (toClose, moreToClose) = await TakeAsync(
            db.Surveys
                .AsNoTracking()
                .Where(s => s.Status == SurveyStatuses.Active && s.EndDate <= nowUtc)
                .OrderBy(s => s.EndDate)
                .ThenBy(s => s.Id),
            batchSize,
            cancellationToken);

        var opened = await AdvanceAsync(db, toOpen, nowUtc, logger, cancellationToken);
        var closed = await AdvanceAsync(db, toClose, nowUtc, logger, cancellationToken);

        // Nothing here is written -- see SurveyLifecycleSchedule.WindowElapsedWhileScheduled for
        // why closing these would destroy the only remedy for them. It cannot overlap with what
        // this tick just opened, and not by luck of ordering: opening requires
        // `end_date > now` and stranded requires `end_date <= now`, so the two sets are disjoint
        // whether this runs before the save or after it.
        var stranded = await FindStrandedAsync(db, nowUtc, batchSize, cancellationToken);

        if (opened > 0 || closed > 0)
        {
            await db.SaveChangesAsync(cancellationToken);

            logger.LogInformation(
                "Survey lifecycle sweep at {NowUtc:O} opened {Opened} scheduled surveys and closed {Closed} whose " +
                "window had ended.",
                nowUtc,
                opened,
                closed);
        }

        if (stranded.Count > 0)
        {
            // A warning, not information: each of these is a survey somebody published, possibly
            // invited an entire company to, which never opened and now never will. The job
            // cannot fix it without taking away the fix -- returning it to draft and re-dating it
            // is a human's call -- so the least it can do is refuse to be quiet.
            logger.LogWarning(
                "{Stranded} survey(s) are still 'scheduled' with an end_date already in the past as of {NowUtc:O}; " +
                "they never opened and this job will not close them, because 'scheduled' is the only status they can " +
                "be returned to draft and re-dated from. First ids: {SurveyIds}.",
                stranded.Count,
                nowUtc,
                string.Join(", ", stranded.Take(MaxStrandedIdsLogged)));
        }

        return new SurveyLifecycleSweepResult(opened, closed, stranded.Count, moreToOpen || moreToClose);
    }

    /// <summary>
    /// Takes one page and answers "is there more behind this?" exactly, by asking for one row
    /// more than the cap and throwing it away -- the idiom <see cref="SurveyDraftRetentionJob"/>
    /// uses, and for its reason: <c>count == cap</c> would claim a backlog on the one occasion
    /// there is none.
    /// </summary>
    private static async Task<(List<Survey> Page, bool More)> TakeAsync(
        IOrderedQueryable<Survey> query,
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
    /// <c>AND status = @from</c> -- the status this sweep actually read and made its decision
    /// on -- so a row somebody moved in the meantime updates zero rows and is skipped instead of
    /// being overwritten. This is not a theoretical race. The job lease serialises this job
    /// against itself, but nothing serialises it against a person: <c>PUT /surveys/{id}/status</c>
    /// runs on the API at any moment, and the gap between this sweep's SELECT and its UPDATE is
    /// the whole of the sweep. Without the condition the last writer would win and it would
    /// always be the scheduler, because the scheduler holds the transaction open longest.</para>
    ///
    /// <para>What that loses is exactly what makes the bug bad. From <c>scheduled</c> a human may
    /// legally go to <c>draft</c> or to <c>archived</c> -- and this job refuses both directions,
    /// so an admin who catches a mis-dated survey seconds before its start date and pulls it back
    /// to <c>draft</c> would find it <c>active</c>, in a status with no edge back to <c>draft</c>
    /// at all, its content frozen forever. Losing an update is not a lost write here; it is a
    /// survey nobody can ever fix.</para>
    ///
    /// <para>No status is assigned to a tracked entity and nothing is saved here. The audit rows
    /// are staged and the caller saves once; the lease's transaction is what makes a sweep atomic,
    /// which is what keeps a status change and its audit row from ever existing without the
    /// other. A caller that runs this outside a transaction gets each conditional UPDATE
    /// committed on its own -- fine for a test, and the reason the worker never does it.</para>
    /// </summary>
    private static async Task<int> AdvanceAsync(
        ClimateProjectDbContext db,
        List<Survey> candidates,
        DateTimeOffset nowUtc,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var moved = 0;

        foreach (var survey in candidates)
        {
            var target = SurveyLifecycleSchedule.NextStatusFor(
                survey.Status, survey.StartDate, survey.EndDate, nowUtc);

            if (target is null)
            {
                // The query said this row needed a move and the rule says it does not. Reachable
                // only if the two disagree, which is a bug in one of them and never a reason to
                // guess: the row is left exactly as it is.
                logger.LogError(
                    "Survey {SurveyId} matched the lifecycle sweep in status '{Status}' (start {StartDate:O}, end " +
                    "{EndDate:O}) but the schedule names no transition for it. Left unchanged; the query predicate " +
                    "and SurveyLifecycleSchedule have come apart.",
                    survey.Id,
                    survey.Status,
                    survey.StartDate,
                    survey.EndDate);
                continue;
            }

            if (!SurveyStatuses.CanTransition(survey.Status, target))
            {
                // The domain's map has the last word, even over this job's own rule. An edge
                // removed from SurveyStatuses stops being taken here on the same deploy, without
                // anybody having to remember that this file exists.
                logger.LogError(
                    "Survey {SurveyId} would move '{From}' -> '{To}' on its dates, but that is not a legal " +
                    "transition. Left unchanged. Allowed from '{From}': {Allowed}.",
                    survey.Id,
                    survey.Status,
                    target,
                    survey.Status,
                    string.Join(", ", SurveyStatuses.AllowedTransitionsFrom(survey.Status)));
                continue;
            }

            var from = survey.Status;
            var opening = string.Equals(target, SurveyStatuses.Active, StringComparison.Ordinal);

            // The compare-and-swap. `s.Status == from` is the whole of it: the row moves only if
            // it is still in the status this sweep read. updated_at is set in the same statement
            // for the same reason the endpoint sets it -- a status change is a change, and
            // leaving it alone would hide an automatic close from every "recently changed"
            // listing in the product, which is where an admin would look for it.
            var written = await db.Surveys
                .Where(s => s.Id == survey.Id && s.Status == from)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(s => s.Status, target)
                        .SetProperty(s => s.UpdatedAt, nowUtc),
                    cancellationToken);

            if (written == 0)
            {
                // Somebody moved this row between the SELECT and here. Their transition wins:
                // it was made by a person, on a survey they administer, with the whole product
                // in front of them. Information rather than a warning -- an admin racing the
                // scheduler to the minute is unusual but entirely correct behaviour, and the
                // row is now in whatever status they chose.
                logger.LogInformation(
                    "Survey {SurveyId} was '{From}' when the lifecycle sweep read it and is not any more, so the " +
                    "move to '{To}' was not applied. A concurrent change wins over this job by design.",
                    survey.Id,
                    from,
                    target);
                continue;
            }

            db.AuditLogs.Add(new AuditLog
            {
                Id = Guid.NewGuid(),
                // Null: the platform did this, not a person. See the class remarks on why the
                // per-survey trail gets no row at all rather than a borrowed name.
                UserId = null,
                CompanyId = survey.CompanyId,
                Action = opening ? OpenedAction : ClosedAction,
                Resource = AuditResource,
                ResourceId = survey.Id.ToString(),
                Details = Describe(from, target, opening ? survey.StartDate : survey.EndDate),
                Success = true,
                Timestamp = nowUtc,
            });

            // Per row, at information. Transitions are rare -- twice in a survey's life -- so
            // there is no volume argument against naming each one, and "why did my survey
            // close" is a question somebody will ask about a specific id.
            logger.LogInformation(
                "Survey {SurveyId} moved '{From}' -> '{To}' on its own dates (start {StartDate:O}, end " +
                "{EndDate:O}) at {NowUtc:O}.",
                survey.Id,
                from,
                target,
                survey.StartDate,
                survey.EndDate,
                nowUtc);

            moved++;
        }

        return moved;
    }

    /// <summary>
    /// Surveys still <c>scheduled</c> whose window has entirely elapsed. Capped: the number is a
    /// signal to alarm on, not an accounting figure, and a first sweep over a long-neglected
    /// database should not pull every one of them into memory to count them.
    /// </summary>
    private static async Task<List<Guid>> FindStrandedAsync(
        ClimateProjectDbContext db,
        DateTimeOffset nowUtc,
        int batchSize,
        CancellationToken cancellationToken)
    {
        var candidates = await db.Surveys
            .AsNoTracking()
            .Where(s => s.Status == SurveyStatuses.Scheduled && s.EndDate <= nowUtc)
            .OrderBy(s => s.EndDate)
            .ThenBy(s => s.Id)
            .Select(s => new { s.Id, s.Status, s.EndDate })
            .Take(batchSize)
            .ToListAsync(cancellationToken);

        // Through the pure predicate rather than trusting the WHERE, for the same reason the
        // transitions go through theirs: the definition of "stranded" lives in Application, and
        // this query is only how the rows get here.
        return
        [
            .. candidates
                .Where(c => SurveyLifecycleSchedule.WindowElapsedWhileScheduled(c.Status, c.EndDate, nowUtc))
                .Select(c => c.Id),
        ];
    }

    /// <summary>
    /// <c>audit_logs.details</c> for one transition.
    ///
    /// <para>Serialized with the default naming policy, not the web one, to match
    /// <c>AuditWritingMiddleware.Describe</c> -- the only other writer of this column. Two
    /// casing conventions in one jsonb column would make it unqueryable without knowing which
    /// writer produced the row.</para>
    /// </summary>
    private static string Describe(string from, string to, DateTimeOffset trigger)
        => JsonSerializer.Serialize(new SurveyLifecycleAuditDetails(from, to, trigger));

    /// <param name="Trigger">
    /// The date that came due -- <c>start_date</c> for an open, <c>end_date</c> for a close.
    /// Recorded because it is the one fact a reader cannot recover later: the schedule stays
    /// editable while a survey is live, so the dates on the row a month from now need not be the
    /// ones this transition fired on.
    /// </param>
    private sealed record SurveyLifecycleAuditDetails(string From, string To, DateTimeOffset Trigger);
}

/// <summary>What one lifecycle sweep did.</summary>
/// <param name="Opened">Surveys moved <c>scheduled -&gt; active</c> because their start date had arrived.</param>
/// <param name="Closed">Surveys moved <c>active -&gt; closed</c> because their end date had passed.</param>
/// <param name="Stranded">
/// Surveys left alone in <c>scheduled</c> with their whole window behind them. Never a count of
/// work done -- it is a count of work that needs a human, capped at the batch size.
/// </param>
/// <param name="MoreRemaining">
/// True when either category filled its batch, so more transitions are waiting for the next
/// tick. Expected on the first sweep after this job is deployed and on no sweep thereafter.
/// </param>
public sealed record SurveyLifecycleSweepResult(int Opened, int Closed, int Stranded, bool MoreRemaining);
