namespace ClimateProject.Application.Surveys;

/// <summary>
/// Which status a survey's own <c>start_date</c> and <c>end_date</c> say it should be in --
/// and, which is most of this file, which ones they must never be allowed to say.
///
/// <para>Nothing advanced a survey by its dates until this landed. A survey scheduled to open
/// never opened, and one past its end date accepted responses forever, because
/// <see cref="SurveyStatuses.AcceptsResponses"/> is <c>status == active</c> and no process
/// moved <c>status</c>. <c>SurveyResponseEndpoints.SubmitAsync</c> is the other half of that
/// story and says so in a comment: the response window is deliberately status-only, because
/// re-deriving it from the dates there "would let this endpoint refuse a survey that
/// <c>SurveyQueries.AssignedTo</c> still lists in <c>/surveys/my</c>". That reasoning is only
/// sound if something keeps the status honest about the dates. This is that something.</para>
///
/// <para>Kept in Application rather than in the job so the rule is unit-testable without
/// Docker -- the same reason <see cref="SurveyStatuses"/> itself lives here -- and so the
/// scheduler's SQL is a pre-filter for performance rather than the definition of the rule.
/// The job loads candidates with a tight <c>WHERE</c>, then asks this function what to do with
/// each row and refuses anything it does not name.</para>
///
/// ## The two transitions it may make
/// <list type="bullet">
/// <item><b><c>scheduled -&gt; active</c></b>, once <c>start_date</c> has passed and while
/// <c>end_date</c> is still ahead. Safe because everything that makes publishing dangerous
/// already happened on the way into <c>scheduled</c>: the #195 translation gate, the
/// "at least one question" check and the <c>survey_versions</c> snapshot all run in
/// <c>SurveyEndpoints.ApplyStatusAsync</c> under <see cref="SurveyStatuses.IsPublish"/>, which
/// is <c>draft -&gt; scheduled|active</c>. <c>scheduled -&gt; active</c> is excluded from that
/// gate on purpose and for a stated reason -- the content has been frozen since it entered
/// <c>scheduled</c> -- so this transition adds nothing a human's own
/// <c>PUT /surveys/{id}/status</c> would have added.</item>
/// <item><b><c>active -&gt; closed</c></b>, once <c>end_date</c> has passed. By
/// <c>end_date</c> alone: see below.</item>
/// </list>
///
/// ## The transitions it must never make
/// <list type="bullet">
/// <item><b>Anything out of <c>draft</c>.</b> <c>draft -&gt; active</c> is a legal edge in
/// <see cref="SurveyStatuses"/>, but that map describes what a <i>human</i> may do through an
/// endpoint that runs the publish gate. A draft is unfinished authoring, and its
/// <c>start_date</c> is whatever the wizard defaulted on step one, so "opening a draft whose
/// start date has passed" would mean every abandoned draft in the database going live at once,
/// untranslated, possibly with no questions, and with no version snapshot -- which is the row
/// that makes a stored answer resolvable to the wording it was given. And it is
/// unrecoverable: there is no <c>active -&gt; draft</c> edge, by design, so a draft opened by
/// mistake can never be returned to authoring. Leaving it in draft costs a survey that did
/// not open; opening it costs a survey that can never be finished. Refused.</item>
/// <item><b><c>scheduled -&gt; closed</c>.</b> This one <i>is</i> in the transition map, and it
/// is still refused. A survey whose whole window elapsed while it sat in <c>scheduled</c> is
/// a mistake someone has to fix, and <c>scheduled</c> is the only status from which they can:
/// <see cref="SurveyStatuses.AllowsScheduleEdit"/> stops at <c>closed</c>, <c>closed</c>'s only
/// outgoing edge is <c>archived</c>, and <c>scheduled -&gt; draft</c> is described in
/// <see cref="SurveyStatuses"/> as "the only way back". Closing it would tidy the row and
/// destroy the remedy. So it stays scheduled and the job logs it -- see
/// <see cref="WindowElapsedWhileScheduled"/>, which exists only so that "nothing happened
/// here" is a visible fact rather than silence.</item>
/// <item><b>Anything to <c>archived</c>.</b> Terminal, and editorial: no date on a survey
/// carries the meaning "file this away". A scheduler that archived on a timer would be
/// deleting a company admin's working set with no undo.</item>
/// <item><b>Anything at all to a <c>closed</c> or <c>archived</c> row.</b> Reopening is not in
/// the map (the supported way to run a survey again is
/// <c>POST /surveys/{id}/duplicate</c>), and extending <c>end_date</c> on a closed survey is
/// already refused by <see cref="SurveyStatuses.AllowsScheduleEdit"/>, so no date change can
/// resurrect one.</item>
/// </list>
///
/// ## Closing by <c>end_date</c> alone
/// <para>Yes, alone. The alternatives were considered and rejected:</para>
/// <list type="bullet">
/// <item><b>Not on <c>settings_response_limit</c>.</b> A response cap is a different trigger
/// with a different meaning -- "we have enough answers" rather than "the window is over" --
/// and it fires on a response being written, not on a clock. Closing on it belongs where
/// responses are counted, not in a sweep that runs every few minutes.</item>
/// <item><b>Not on "every invitee has answered".</b> Response counts against an anonymous
/// survey cannot be attributed to invitees at all, so the condition is unknowable for exactly
/// the surveys where it would matter most.</item>
/// <item><b>No timezone resolution.</b> Both columns are <c>timestamptz</c> surfaced as
/// <see cref="DateTimeOffset"/> -- absolute instants chosen by an admin -- so unlike
/// <c>ScheduledReportJob</c>, which resolves the company's zone to decide what "the monthly
/// report" means, there is no local calendar here to get wrong.</item>
/// </list>
///
/// <para>The boundary convention is the one the rest of the survey domain already uses:
/// <c>start_date &lt;= now &lt; end_date</c>, copied from
/// <c>SurveyDistributionEndpoints</c>'s <c>withinWindow</c> and its
/// <c>survey.EndDate &lt;= now</c> refusal ("this survey's response window has already
/// closed"). A survey is open at the instant its window starts and shut at the instant it
/// ends.</para>
/// </summary>
public static class SurveyLifecycleSchedule
{
    /// <summary>
    /// The status this survey's dates require, or <c>null</c> to leave it exactly as it is.
    ///
    /// <para><c>null</c> is the answer for every status except <c>scheduled</c> and
    /// <c>active</c>, and for those two whenever the dates do not yet demand a move. Callers
    /// must treat <c>null</c> as "do nothing", never as "fall back to something sensible".</para>
    ///
    /// <para>Every non-null result is checked against
    /// <see cref="SurveyStatuses.CanTransition"/> by the caller before it is written. That is
    /// not redundancy for its own sake: it means a future edit to this function cannot invent
    /// a transition the domain's own map forbids, on live customer data, from a background
    /// thread.</para>
    /// </summary>
    public static string? NextStatusFor(
        string? status,
        DateTimeOffset startDate,
        DateTimeOffset endDate,
        DateTimeOffset nowUtc)
    {
        if (string.Equals(status, SurveyStatuses.Scheduled, StringComparison.Ordinal))
        {
            // Both halves are required. `endDate > nowUtc` is what stops a survey whose entire
            // window elapsed in `scheduled` from being opened for the sole purpose of being
            // closed on the next tick -- a round trip that would strip the admin's only route
            // back to draft and, for the few minutes in between, accept responses to a survey
            // whose deadline had already passed.
            return startDate <= nowUtc && nowUtc < endDate ? SurveyStatuses.Active : null;
        }

        if (string.Equals(status, SurveyStatuses.Active, StringComparison.Ordinal))
        {
            // Deliberately not `startDate <= nowUtc &&`: an active survey is open whatever its
            // start date says, because a human put it there. SurveyEndpoints already refuses to
            // move StartDate once a survey is active ("moving the moment it opened is a rewrite
            // of history"), so re-litigating the start here could only ever act on a row that
            // predates that guard, and closing it would be the wrong correction anyway.
            return endDate <= nowUtc ? SurveyStatuses.Closed : null;
        }

        return null;
    }

    /// <summary>
    /// A survey that never opened and now never will: still <c>scheduled</c>, with its
    /// <c>end_date</c> already behind it.
    ///
    /// <para>Not a transition -- <see cref="NextStatusFor"/> returns <c>null</c> for these, and
    /// the reasoning for refusing <c>scheduled -&gt; closed</c> is in this class's remarks. This
    /// predicate exists so the job can count and log them, because the failure it describes
    /// (a survey that was published, invited against, and never opened) is invisible from every
    /// other surface: the row looks perfectly healthy, and only the dates say otherwise. Fixing
    /// it is a human's job -- return it to <c>draft</c>, re-date it, publish again.</para>
    /// </summary>
    public static bool WindowElapsedWhileScheduled(string? status, DateTimeOffset endDate, DateTimeOffset nowUtc)
        => string.Equals(status, SurveyStatuses.Scheduled, StringComparison.Ordinal) && endDate <= nowUtc;
}
