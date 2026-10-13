using System.Security.Claims;

namespace ClimateProject.Application.Auth;

/// <summary>
/// The two instants a minted token carries: when the session began, and when this
/// particular token stops working.
/// </summary>
/// <param name="StartedAt">
/// First sign-in, carried forward unchanged through every re-mint. It is what makes the
/// absolute ceiling absolute: a sliding window that re-based this on each refresh would
/// extend a session for as long as somebody kept clicking.
/// </param>
/// <param name="ExpiresAt">
/// The idle deadline, or the ceiling, whichever comes first.
/// </param>
public sealed record SessionWindow(DateTimeOffset StartedAt, DateTimeOffset ExpiresAt);

/// <summary>
/// The idle window, and the ceiling underneath which it slides.
/// </summary>
/// <remarks>
/// <para>
/// Before this, <c>JwtTokenService</c> hardcoded a 24-hour lifetime and
/// <c>SystemSettings.SessionTimeoutMinutes</c> — a field a super admin can edit, shipped
/// at 60 — was enforced nowhere. It is now the token's lifetime, which is why the
/// timeout is server-enforced rather than a client-side screen lock: an unattended
/// browser holds a bearer token, and the only way an idle session genuinely dies is for
/// that token to stop validating.
/// </para>
/// <para>
/// The 24-hour value survives as the ceiling rather than the lifetime. Those are
/// different guarantees and the product wanted both: the idle window ends a session
/// nobody is using, and the ceiling ends one somebody is, so a session cannot be slid
/// forward forever.
/// </para>
/// <para>
/// Pure and in Application rather than beside the DbContext read, so the arithmetic that
/// decides when a session dies is unit-testable without a database.
/// </para>
/// </remarks>
public static class SessionWindows
{
    /// <summary>
    /// The longest a session may live from first sign-in, however much it is used.
    /// </summary>
    /// <remarks>
    /// Unchanged from the lifetime <c>JwtTokenService</c> hardcoded before the idle window
    /// existed, deliberately: adding the idle window was not a mandate to shorten the
    /// absolute cap, and a shorter ceiling would sign out an actively working user.
    /// </remarks>
    public static readonly TimeSpan AbsoluteCeiling = TimeSpan.FromHours(24);

    /// <summary>The shipped default, and the fallback for a value that is not a policy.</summary>
    public const int DefaultIdleMinutes = 60;

    /// <summary>
    /// How long a token minted now may sit unused.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>SystemSettingsEndpoints.UpdateAsync</c> writes <c>SessionTimeoutMinutes</c>
    /// straight through, and nothing in the database constrains it, so this has to cope
    /// with a row that holds 0, a negative number or a year. A non-positive timeout is not
    /// a short policy — it is an absent one, and honouring it literally would mint tokens
    /// that are already expired and lock every account out of the product including the
    /// super admin's, with no way back in through the UI. It therefore reads as the
    /// shipped default. Anything past the ceiling is clamped to it, because a window
    /// longer than the ceiling cannot be reached anyway.
    /// </para>
    /// </remarks>
    public static TimeSpan IdleWindow(int sessionTimeoutMinutes)
    {
        if (sessionTimeoutMinutes <= 0)
        {
            return TimeSpan.FromMinutes(DefaultIdleMinutes);
        }

        var requested = TimeSpan.FromMinutes(sessionTimeoutMinutes);
        return requested > AbsoluteCeiling ? AbsoluteCeiling : requested;
    }

    /// <summary>
    /// The window a token minted at <paramref name="now"/> gets, or <c>null</c> when the
    /// session has reached its ceiling and must not be re-minted at all.
    /// </summary>
    public static SessionWindow? Next(DateTimeOffset startedAt, DateTimeOffset now, int sessionTimeoutMinutes)
    {
        var ceiling = startedAt + AbsoluteCeiling;
        if (now >= ceiling)
        {
            return null;
        }

        var idleDeadline = now + IdleWindow(sessionTimeoutMinutes);
        return new SessionWindow(startedAt, idleDeadline < ceiling ? idleDeadline : ceiling);
    }

    /// <summary>
    /// When the presented token says its session began, for a re-mint that must carry that
    /// instant forward rather than restart it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Falls back to <c>iat</c>, then to <paramref name="now"/>. Both fallbacks exist
    /// because <c>TrackingJwtSecret</c> is shared with the legacy climate-tracking
    /// application, so a validly signed token this API never minted can arrive here, as can
    /// one minted before this claim existed. Neither can be refused — that would sign out
    /// every open session on deploy — and neither can be given a ceiling it has no data
    /// for, so the oldest instant the token can prove is used.
    /// </para>
    /// <para>
    /// The value is not trusted beyond being signed: a caller cannot choose it, because
    /// forging a claim means forging the signature.
    /// </para>
    /// </remarks>
    public static DateTimeOffset StartedAt(ClaimsPrincipal principal, DateTimeOffset now)
    {
        return ReadUnixSeconds(principal, TokenClaimNames.SessionStart)
            ?? ReadUnixSeconds(principal, "iat")
            ?? now;
    }

    private static DateTimeOffset? ReadUnixSeconds(ClaimsPrincipal principal, string claimType)
    {
        var raw = principal.FindFirst(claimType)?.Value;
        if (!long.TryParse(raw, out var seconds))
        {
            return null;
        }

        try
        {
            return DateTimeOffset.FromUnixTimeSeconds(seconds);
        }
        catch (ArgumentOutOfRangeException)
        {
            // A signed token with an absurd epoch value. Treated as absent rather than
            // thrown, because the only caller is a mint and throwing would 500 a refresh.
            return null;
        }
    }
}
