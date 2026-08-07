namespace ClimateProject.Application.Surveys;

/// <summary>
/// The retention policy for survey drafts, in one place because the issue asks for it to
/// be decided rather than left to accrete.
///
/// **30 days, sliding.** Every save, autosave and recovery pushes <c>expires_at</c> out
/// again, so a draft you are actively working on never expires and one you abandoned in
/// October is gone in November. 30 rather than 7 because a survey is drafted around other
/// people's calendars -- a fortnight of leave must not eat your work -- and rather than
/// "never" because a draft is one jsonb blob per wizard session per user and unbounded
/// accumulation is a slow leak with no upper bound and no owner.
///
/// The policy is enforced at READ time, not by the sweep: every draft query filters on
/// <c>expires_at &gt; now</c>, so an expired draft is invisible whether or not anything
/// ever ran <c>DELETE /surveys/drafts/expired</c>. The sweep only reclaims the rows. That
/// ordering matters -- a retention rule that depends on a scheduler existing is a
/// retention rule that quietly stops applying the first time the scheduler is down.
/// </summary>
public static class SurveyDraftRetention
{
    public static readonly TimeSpan Ttl = TimeSpan.FromDays(30);

    /// <summary>The new <c>expires_at</c> after a save at <paramref name="now"/>.</summary>
    public static DateTimeOffset ExpiresAt(DateTimeOffset now) => now + Ttl;

    /// <summary>
    /// Expiry is exclusive of the boundary: a draft whose <c>expires_at</c> is exactly now
    /// is expired, matching the <c>expires_at &gt; now</c> filter the queries use, so the
    /// helper and the SQL cannot disagree about the boundary instant.
    /// </summary>
    public static bool IsExpired(DateTimeOffset expiresAt, DateTimeOffset now) => expiresAt <= now;
}
