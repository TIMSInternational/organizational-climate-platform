namespace ClimateProject.Application.Microclimates;

/// <summary>
/// The microclimate-invitation state ladder, and -- more importantly -- the point on that
/// ladder past which an anonymous microclimate may record nothing.
///
/// <para>
/// Deliberately the same shape as <c>SurveyInvitationStatuses</c>, member for member and
/// method for method, because #130 is explicitly the reference shape for #116's survey
/// invitation states and the two surfaces are read by the same web client. What it is NOT is
/// the same class: <c>microclimate_invitations</c> is a different table with a different
/// foreign key, and a shared vocabulary object would be the first step towards a shared
/// notification payload -- which is exactly the mistake that would put a
/// <c>microclimate_invitations</c> id into a column pointing at <c>survey_invitations</c>.
/// Two files that look alike and cannot be confused beats one file that serves both.
/// </para>
///
/// <para>
/// A validated string set rather than a C# enum, matching <c>MicroclimateStatuses</c>,
/// <c>SurveyInvitationStatuses</c>, <c>Roles</c> and <c>NotificationStatuses</c>. The column
/// is <c>character varying(20)</c> with a <c>pending</c> default and no CHECK constraint
/// (see <c>20260731125410_AddMicroclimateInvitations</c>), so this class is the only thing
/// standing between the product and an invitation in a state nothing understands.
/// </para>
///
/// <para>
/// Kept in Application rather than Api so the anonymity rule is unit-testable without
/// Docker. It is the rule in this file most expensive to get wrong, and the one whose
/// failure is invisible in a passing end-to-end test.
/// </para>
/// </summary>
public static class MicroclimateInvitationStatuses
{
    /// <summary>Minted. No notification has been queued for it yet.</summary>
    public const string Pending = "pending";

    /// <summary>A <c>microclimate_invitation</c> notification has been queued for this invitee.</summary>
    public const string Sent = "sent";

    /// <summary>The invitee opened the invitation link.</summary>
    public const string Opened = "opened";

    /// <summary>The invitee began answering.</summary>
    public const string Started = "started";

    /// <summary>
    /// The invitee finished.
    ///
    /// <para>
    /// The legacy route for this rung is <c>invitations/[id]/participated</c> and the stored
    /// name here is <c>completed</c>. The column decides it: the entity has
    /// <c>MicroclimateInvitation.CompletedAt</c> and no <c>ParticipatedAt</c>, and a status
    /// string that disagrees with the timestamp column beside it is a trap for whoever reads
    /// the table next. The legacy verb survives as a route alias -- see
    /// <c>MicroclimateInvitationEndpoints</c> -- so a legacy link still lands somewhere,
    /// while only one word is ever written to a row.
    /// </para>
    /// </summary>
    public const string Completed = "completed";

    /// <summary>
    /// Terminal, and off the ladder: revocation is a decision, not progress. A revoked
    /// invitation never advances again, and its token is refused before its expiry is even
    /// consulted so that "revoked" and "expired" stay distinguishable to the holder.
    /// </summary>
    public const string Revoked = "revoked";

    /// <summary>
    /// The ladder, in order. <see cref="Revoked"/> is deliberately absent -- see its own
    /// remarks. Expiry is likewise absent because it is <b>derived</b> from
    /// <c>expires_at</c> rather than stored: a stored "expired" status would need a sweep to
    /// become true, and an invitation whose expiry depends on a cron job having run is an
    /// invitation that is still live when the cron job is down.
    /// </summary>
    public static readonly string[] Progression = [Pending, Sent, Opened, Started, Completed];

    public static readonly string[] All = [.. Progression, Revoked];

    // ------------------------------------------------------------------
    // What the legacy vocabulary had and this one does not, and why
    //
    // The archived legacy model lists the lifecycle as
    // "pending -> sent -> opened -> started -> participated, plus expired/bounced"
    // (docs/legacy-issues/climate-project-issues.md). Three differences, all deliberate,
    // all matching the choices SurveyInvitationStatuses already made -- which is what
    // "shape reusable by #116" requires.
    //
    // * `participated` is spelled `completed` here. The column decides it: the table has
    //   `completed_at` and no `participated_at`. The legacy word survives as a route alias
    //   onto the same handler, so a legacy link still lands somewhere, and exactly one word
    //   is ever written to a row. See Completed.
    //
    // * `expired` is DERIVED from `expires_at`, never stored. A stored "expired" needs a
    //   sweep to become true, and an invitation whose expiry depends on a cron job having
    //   run is an invitation that is still live when the cron job is down. Every read path
    //   compares the column against the clock instead -- LoadByTokenAsync, ToDetail's
    //   IsExpired, and SummariseAsync's Expired count.
    //
    // * `bounced` is not an invitation state in this architecture, because the invitation
    //   is not what bounces. A `notifications` row is, and one invitation can have several
    //   of them -- the invite plus every reminder -- each of which can be delivered or
    //   permanently fail independently. So a bounce is recorded where it happens:
    //   NotificationStatuses.Failed with the provider's reason in `failure_reason`, set by
    //   EmailNotificationSender (and refused before the provider entirely for RFC-reserved
    //   domains, see UndeliverableAddresses). Copying it onto the invitation would give one
    //   row a single flag standing for several independent outcomes, and would have to be
    //   kept in sync by something.
    // ------------------------------------------------------------------

    /// <summary>
    /// The last state an invitation to an anonymous microclimate may record.
    ///
    /// <para>
    /// This is the whole anonymity boundary, in one constant, and it is the acceptance
    /// criterion this file exists to satisfy. The long form lives in
    /// <c>docs/decisions/microclimate-invitation-anonymity.md</c>; the argument in short:
    /// </para>
    /// <para>
    /// <see cref="Sent"/> and <see cref="Opened"/> record that a person was invited and was
    /// shown the invitation. Both are true of invitees who never answer, so neither asserts
    /// that a response exists, and neither can be correlated with anything a respondent
    /// submitted.
    /// </para>
    /// <para>
    /// <see cref="Started"/> and <see cref="Completed"/> are categorically different: each is
    /// a per-person timestamp whose existence asserts that this named invitee submitted, at
    /// almost exactly the moment the microclimate's own aggregate moved.
    /// </para>
    /// <para>
    /// <b>And a microclimate makes that correlation easier than a survey does, not harder.</b>
    /// A survey's re-identification needs an admin to join two tables offline. A microclimate
    /// broadcasts the join: <c>GET /microclimates/{id}/live-results</c> serves
    /// <c>ResponseCount</c> and the word cloud on demand while the session is running, the
    /// product draws it on a live page, and <c>Microclimate.UpdatedAt</c> is stamped by every
    /// submission. An admin watching that page sees the count tick from 4 to 5 and the cloud
    /// gain a word; a <c>completed_at</c> written in the same second names who did it. There
    /// is no per-response row to hide in, because a microclimate persists none -- the whole
    /// pulse is one aggregate, so one attributable timestamp is enough to attribute one
    /// answer.
    /// </para>
    /// <para>
    /// So for an anonymous microclimate the ladder stops here. The two later states are
    /// accepted by the API (the respondent's client should not have to branch on anonymity)
    /// and deliberately not persisted, and the response says so rather than pretending the
    /// write happened. Participation rates for anonymous microclimates come from
    /// <c>microclimates.response_count</c> against <c>target_participant_count</c> -- an
    /// aggregate, which is the only shape of that number that does not name anybody.
    /// </para>
    /// <para>
    /// What this does NOT defend against, stated plainly rather than left implied: an
    /// anonymous microclimate with a single invitee is de-anonymised by its own response
    /// count, and no per-invitation rule can fix that. The minimum-audience floor is a
    /// separate guard and it already exists -- <c>MicroclimateExportProjection</c> withholds
    /// the whole export below <c>SurveyResultsPrivacy.MinimumRespondents</c> (5) and
    /// individual words below <c>MinimumWordRespondents</c> (2).
    /// <para>
    /// Note it is NOT <c>MicroclimateRealtimeSettings.ParticipationThreshold</c>, which is a
    /// stored column defaulting to 3 that no code path in this repository reads. Naming that
    /// one here would send the next reader to a setting that enforces nothing.
    /// </para>
    /// </para>
    /// </summary>
    public const string AnonymityCeiling = Opened;

    /// <summary>
    /// The states an anonymous microclimate suppresses, derived from
    /// <see cref="AnonymityCeiling"/> rather than re-listed -- so moving the ceiling moves
    /// this too, instead of leaving a second list that quietly disagrees with the first.
    /// </summary>
    public static readonly string[] SuppressedWhenAnonymous =
        [.. Progression.Where(state => RankOf(state) > RankOf(AnonymityCeiling))];

    public static bool IsValid(string? status)
        => status is not null && Array.IndexOf(All, status) >= 0;

    /// <summary>
    /// Position on <see cref="Progression"/>, or -1 for <see cref="Revoked"/> and for
    /// anything unrecognised. Callers must treat -1 as "not on the ladder", never as
    /// "earliest".
    /// </summary>
    public static int RankOf(string? status)
        => status is null ? -1 : Array.IndexOf(Progression, status);

    /// <summary>
    /// The last state this microclimate may record for one invitee.
    /// </summary>
    public static string HighestRecordableState(bool anonymous)
        => anonymous ? AnonymityCeiling : Completed;

    /// <summary>
    /// True when <paramref name="target"/> is a state this microclimate is permitted to
    /// record at all. False for the two states an anonymous microclimate suppresses, and for
    /// anything off the ladder.
    /// </summary>
    public static bool IsRecordable(string? target, bool anonymous)
    {
        var rank = RankOf(target);
        return rank >= 0 && rank <= RankOf(HighestRecordableState(anonymous));
    }

    /// <summary>
    /// True when moving to <paramref name="target"/> is real forward progress.
    ///
    /// Strictly monotonic, so a duplicate "opened" ping from a mail client's link prefetcher
    /// cannot move the recorded timestamp, and an out-of-order "opened" arriving after
    /// "started" cannot walk the invitation backwards. Anything off the ladder -- including
    /// <see cref="Revoked"/> as either side -- advances nothing.
    /// </summary>
    public static bool Advances(string? current, string? target)
    {
        var targetRank = RankOf(target);
        if (targetRank < 0 || string.Equals(current, Revoked, StringComparison.Ordinal))
        {
            return false;
        }

        return targetRank > RankOf(current);
    }
}
