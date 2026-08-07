namespace ClimateProject.Application.Surveys;

/// <summary>
/// The survey-invitation state ladder, and -- more importantly -- the point on that ladder
/// past which an anonymous survey may record nothing.
///
/// A validated string set rather than a C# enum, matching <c>SurveyStatuses</c>,
/// <c>Roles</c>, <c>ContentLanguages</c> and <c>NotificationStatuses</c>. The column is
/// <c>character varying(20)</c> with a <c>pending</c> default and no CHECK constraint (see
/// <c>20260731111446_AddSurveyDistributionAndInvitations</c>), so this class is the only
/// thing standing between the product and an invitation in a state nothing understands.
///
/// Kept in Application rather than Api so the anonymity rule is unit-testable without
/// Docker. It is the rule in this file most expensive to get wrong, and the one whose
/// failure is invisible in a passing end-to-end test.
/// </summary>
public static class SurveyInvitationStatuses
{
    /// <summary>Minted. No notification has been queued for it yet.</summary>
    public const string Pending = "pending";

    /// <summary>A <c>survey_invitation</c> notification has been queued for this invitee.</summary>
    public const string Sent = "sent";

    /// <summary>The invitee opened the invitation link.</summary>
    public const string Opened = "opened";

    /// <summary>The invitee began answering.</summary>
    public const string Started = "started";

    /// <summary>The invitee finished.</summary>
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

    /// <summary>
    /// The last state an invitation to an anonymous survey may record.
    ///
    /// This is the whole anonymity boundary, in one constant. The reasoning, at length,
    /// because it is the acceptance criterion this file exists to satisfy:
    ///
    /// <para>
    /// <see cref="Sent"/> and <see cref="Opened"/> record that a person was invited and was
    /// shown the invitation. Both are true of invitees who never answer, so neither asserts
    /// that a response exists, and neither can be correlated with anything in
    /// <c>responses</c>.
    /// </para>
    /// <para>
    /// <see cref="Started"/> and <see cref="Completed"/> are categorically different: each is
    /// a per-person timestamp whose existence asserts that a response row exists, taken at
    /// almost exactly the moment <c>responses.start_time</c> / <c>responses.completion_time</c>
    /// is written. An admin holding both tables joins them on time and re-identifies the
    /// respondent -- and with a small audience, or a quiet hour, the join is exact rather
    /// than probabilistic. Storing <c>started_at</c> on an anonymous survey and calling the
    /// survey anonymous is a promise the schema itself disproves.
    /// </para>
    /// <para>
    /// So for an anonymous survey the ladder stops here. The two later states are accepted by
    /// the API (the respondent's client should not have to branch on anonymity) and
    /// deliberately not persisted, and the response says so rather than pretending the write
    /// happened. Response rates for anonymous surveys come from <c>surveys.response_count</c>
    /// against <c>target_audience_count</c> -- an aggregate, which is the only shape of that
    /// number that does not name anybody.
    /// </para>
    /// <para>
    /// What this does NOT defend against, stated plainly rather than left implied: an
    /// anonymous survey with a single invitee is de-anonymised by its own response count, and
    /// no per-invitation rule can fix that. A minimum-audience floor belongs to whatever
    /// reports the aggregate, not here.
    /// </para>
    /// </summary>
    public const string AnonymityCeiling = Opened;

    /// <summary>
    /// The states an anonymous survey suppresses, derived from <see cref="AnonymityCeiling"/>
    /// rather than re-listed -- so moving the ceiling moves this too, instead of leaving a
    /// second list that quietly disagrees with the first.
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
    /// The last state this survey may record for one invitee.
    /// </summary>
    public static string HighestRecordableState(bool anonymous)
        => anonymous ? AnonymityCeiling : Completed;

    /// <summary>
    /// True when <paramref name="target"/> is a state this survey is permitted to record at
    /// all. False for the two states an anonymous survey suppresses, and for anything off
    /// the ladder.
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
