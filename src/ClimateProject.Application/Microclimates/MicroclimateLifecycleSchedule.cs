namespace ClimateProject.Application.Microclimates;

/// <summary>
/// Which status a microclimate's own <c>StartTime</c> and <c>EndTime</c> say it should be in --
/// and, which is most of this file, the one they must never be allowed to say.
///
/// <para>Nothing advanced a microclimate by its dates until this landed.
/// <see cref="MicroclimateStatuses.AcceptsResponses"/> is <c>status == active</c>, full stop,
/// and <c>MicroclimateEndpoints.SubmitResponseAsync</c> checks that and nothing else, so an
/// activated session kept taking answers indefinitely past its <c>EndTime</c>. The only thing
/// that ever moved one to <c>closed</c> was a human remembering to send
/// <c>PUT /microclimates/{id}/status</c>. The window was decoration; this is what makes the
/// status honest about it.</para>
///
/// <para>The counterpart of <see cref="Surveys.SurveyLifecycleSchedule"/>, deliberately the same
/// shape and kept in Application for the same reason: the rule is unit-testable without Docker,
/// and the scheduler's SQL is a pre-filter for performance rather than the definition of the
/// rule. The job loads candidates with a tight <c>WHERE</c>, then asks this function what to do
/// with each row and refuses anything it does not name.</para>
///
/// ## The one transition it may make
/// <list type="bullet">
/// <item><b><c>active -&gt; closed</c></b>, once <c>EndTime</c> has passed. By <c>EndTime</c>
/// alone, and only from <c>active</c>: a human put the session in front of respondents, and the
/// deadline they set is now behind it.</item>
/// </list>
///
/// ## The transition it must never make, and why this is not a straight port of the survey rule
/// <para><b><c>draft -&gt; active</c> on <c>StartTime</c> is refused.</b> It is a legal edge in
/// <see cref="MicroclimateStatuses"/>, and the survey job makes the equivalent move -- but the
/// survey job moves out of <c>scheduled</c>, a status whose whole meaning is "an admin has
/// already said publish". The microclimate vocabulary has no such status. Its <c>draft</c>
/// means "still being authored", and publishing runs the #195 translation gate
/// (<see cref="MicroclimateStatuses.IsPublish"/> -&gt; <c>ContentPublishValidation.FindMissing</c>)
/// inside <c>MicroclimateEndpoints.ApplyStatusAsync</c>, which a background sweep can neither
/// run usefully nor report the result of to anybody. Auto-activating a draft would put
/// half-translated content in front of respondents -- the one thing that gate exists to stop --
/// and it is unrecoverable, because <c>active -&gt; draft</c> is deliberately absent from the
/// map: a microclimate's answers are folded straight into <c>ResponseCount</c> and
/// <c>LiveResults</c> with no per-response row, so content that became editable again could
/// never be reconciled with the aggregate it had already contributed to.</para>
///
/// <para>Opening a microclimate on its start date needs a <c>scheduled</c> status added to the
/// vocabulary, gated at the moment the admin schedules it -- a vocabulary change, a
/// transition-map change and a client change, and a product decision rather than a defect fix.
/// Until that exists, activation stays manual and this rule closes only. What it can do about
/// the other half is refuse to be quiet: see <see cref="WindowElapsedWhileDraft"/>.</para>
///
/// ## Closing by <c>EndTime</c> alone
/// <list type="bullet">
/// <item><b>Not on <c>Targeting.MaxParticipants</c>.</b> A participant cap is a different
/// trigger with a different meaning -- "we have enough answers" rather than "the window is
/// over" -- and it fires on a response being written, not on a clock.</item>
/// <item><b>Not on "every invitee has answered".</b> A microclimate defaults to anonymous
/// responses (<c>RealtimeSettings.AnonymousResponses</c> is true), so submitted answers cannot
/// be attributed to invitations at all for exactly the sessions where it would matter.</item>
/// <item><b>No timezone resolution.</b> <c>MicroclimateScheduling</c> carries a
/// <c>Timezone</c> string, but <c>StartTime</c> and <c>EndTime</c> are <c>timestamptz</c>
/// surfaced as <see cref="DateTimeOffset"/> -- absolute instants an admin picked -- so the zone
/// is display metadata and there is no local calendar here to get wrong. Resolving it would
/// mean re-interpreting an instant that is already unambiguous.</item>
/// </list>
///
/// <para>The boundary convention matches the rest of the domain: a session is open at the
/// instant its window starts and shut at the instant it ends, so the test is
/// <c>EndTime &lt;= now</c>. That is the same comparison <c>InvitationReminderJob</c> already
/// makes in the opposite direction when it stops nagging respondents
/// (<c>Scheduling.EndTime &gt; nowUtc</c>) -- which is the inconsistency this closes: the
/// product stopped inviting people to a session it was still collecting into.</para>
/// </summary>
public static class MicroclimateLifecycleSchedule
{
    /// <summary>
    /// The status this microclimate's dates require, or <c>null</c> to leave it exactly as it
    /// is.
    ///
    /// <para><c>null</c> is the answer for every status except <c>active</c>, and for
    /// <c>active</c> whenever the deadline has not arrived. Callers must treat <c>null</c> as
    /// "do nothing", never as "fall back to something sensible".</para>
    ///
    /// <para>Every non-null result is checked against
    /// <see cref="MicroclimateStatuses.CanTransition"/> by the caller before it is written. Not
    /// redundancy for its own sake: it means a future edit to this function cannot invent a
    /// transition the domain's own map forbids, on live customer data, from a background
    /// thread.</para>
    ///
    /// <para><paramref name="startTime"/> is accepted and deliberately unused. It is here so the
    /// signature does not have to change on the day a <c>scheduled</c> status arrives and the
    /// opening half becomes buildable, and so that a reader who expects the start date to matter
    /// finds the reason it does not written down next to it rather than concluding it was
    /// forgotten.</para>
    /// </summary>
    public static string? NextStatusFor(
        string? status,
        DateTimeOffset startTime,
        DateTimeOffset endTime,
        DateTimeOffset nowUtc)
    {
        _ = startTime;

        if (string.Equals(status, MicroclimateStatuses.Active, StringComparison.Ordinal))
        {
            // Deliberately not `startTime <= nowUtc &&`: an active microclimate is open whatever
            // its start time says, because a human activated it. Re-litigating the start here
            // could only close a session that is collecting answers right now.
            return endTime <= nowUtc ? MicroclimateStatuses.Closed : null;
        }

        return null;
    }

    /// <summary>
    /// A microclimate that never opened and now never will: still <c>draft</c>, with its
    /// <c>EndTime</c> already behind it.
    ///
    /// <para>Not a transition -- <see cref="NextStatusFor"/> returns <c>null</c> for these, and
    /// the reasoning for refusing <c>draft -&gt; active</c> is in this class's remarks. This
    /// predicate exists so the job can count and log them, because it is the only thing this
    /// slice can do about the half of the defect it cannot fix: a microclimate created with a
    /// start date next Tuesday is not open on Tuesday, it is open the moment somebody
    /// activates it, and nothing anywhere says so.</para>
    ///
    /// <para><b>It will name abandoned drafts too, and that is accepted rather than
    /// overlooked.</b> The microclimate vocabulary cannot distinguish "scheduled and forgotten"
    /// from "started and never finished" -- both are <c>draft</c> -- so the two cannot be told
    /// apart here without inventing the status this rule is waiting for. The alternative was
    /// silence about a session somebody scheduled, invited a company to, and never ran. The
    /// count is capped by the caller so the log line stays one line however many there are.</para>
    /// </summary>
    public static bool WindowElapsedWhileDraft(string? status, DateTimeOffset endTime, DateTimeOffset nowUtc)
        => string.Equals(status, MicroclimateStatuses.Draft, StringComparison.Ordinal) && endTime <= nowUtc;
}
