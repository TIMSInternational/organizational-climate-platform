using System.Security.Claims;
using ClimateProject.Application.Auth;

namespace ClimateProject.UnitTests.Auth;

/// <summary>
/// The arithmetic that decides when an idle session dies, and the ceiling it slides under.
/// </summary>
public class SessionWindowsTests
{
    private static readonly DateTimeOffset SignIn = new(2026, 10, 13, 8, 0, 0, TimeSpan.Zero);

    private static ClaimsPrincipal PrincipalWith(params (string Type, string Value)[] claims)
        => new(new ClaimsIdentity(claims.Select(c => new Claim(c.Type, c.Value))));

    [Fact]
    public void A_token_minted_now_expires_after_the_configured_timeout()
    {
        var window = SessionWindows.Next(SignIn, SignIn, sessionTimeoutMinutes: 60);

        Assert.NotNull(window);
        Assert.Equal(SignIn.AddMinutes(60), window.ExpiresAt);
        Assert.Equal(SignIn, window.StartedAt);
    }

    [Fact]
    public void The_configured_timeout_is_what_moves_the_expiry()
    {
        // The whole feature in one assertion: the number a super admin edits decides when the
        // session dies. Before this, both of these produced 24 hours.
        var fifteen = SessionWindows.Next(SignIn, SignIn, sessionTimeoutMinutes: 15);
        var ninety = SessionWindows.Next(SignIn, SignIn, sessionTimeoutMinutes: 90);

        Assert.Equal(SignIn.AddMinutes(15), fifteen!.ExpiresAt);
        Assert.Equal(SignIn.AddMinutes(90), ninety!.ExpiresAt);
    }

    [Fact]
    public void A_refresh_slides_the_expiry_forward_without_moving_the_session_start()
    {
        var now = SignIn.AddMinutes(50);

        var window = SessionWindows.Next(SignIn, now, sessionTimeoutMinutes: 60);

        Assert.Equal(now.AddMinutes(60), window!.ExpiresAt);

        // The point of carrying the start rather than re-basing it: this is what stops the
        // sliding window extending a session forever.
        Assert.Equal(SignIn, window.StartedAt);
    }

    [Fact]
    public void The_idle_window_is_truncated_by_the_absolute_ceiling()
    {
        // Twenty-three and a half hours in, a sixty-minute idle window would reach past the
        // 24-hour ceiling. The token must die at the ceiling, not an hour after it.
        var now = SignIn.AddHours(23).AddMinutes(30);

        var window = SessionWindows.Next(SignIn, now, sessionTimeoutMinutes: 60);

        Assert.Equal(SignIn + SessionWindows.AbsoluteCeiling, window!.ExpiresAt);
        Assert.Equal(SignIn.AddHours(24), window.ExpiresAt);
    }

    [Fact]
    public void A_session_at_its_ceiling_cannot_be_re_minted_at_all()
    {
        Assert.Null(SessionWindows.Next(SignIn, SignIn.AddHours(24), sessionTimeoutMinutes: 60));
        Assert.Null(SessionWindows.Next(SignIn, SignIn.AddHours(30), sessionTimeoutMinutes: 60));
    }

    [Fact]
    public void The_ceiling_is_still_twenty_four_hours()
    {
        // Stated as its own assertion because adding the idle window was explicitly not a
        // mandate to shorten the absolute cap: 24 hours is what JwtTokenService hardcoded as
        // a LIFETIME before this, and it survives as the ceiling.
        Assert.Equal(TimeSpan.FromHours(24), SessionWindows.AbsoluteCeiling);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(int.MinValue)]
    public void A_non_positive_timeout_reads_as_the_shipped_default_rather_than_locking_everyone_out(int minutes)
    {
        // SystemSettingsEndpoints.UpdateAsync writes this field straight through and nothing
        // in the database constrains it. Honouring a 0 literally would mint already-expired
        // tokens for every account including the super admin's, with no way back in through
        // the UI to undo it.
        Assert.Equal(TimeSpan.FromMinutes(60), SessionWindows.IdleWindow(minutes));
        Assert.Equal(SignIn.AddMinutes(60), SessionWindows.Next(SignIn, SignIn, minutes)!.ExpiresAt);
    }

    [Fact]
    public void A_timeout_longer_than_the_ceiling_is_clamped_to_it()
    {
        Assert.Equal(SessionWindows.AbsoluteCeiling, SessionWindows.IdleWindow(60 * 24 * 7));
        Assert.Equal(SessionWindows.AbsoluteCeiling, SessionWindows.IdleWindow(int.MaxValue));
    }

    [Fact]
    public void StartedAt_prefers_the_session_start_claim_over_iat()
    {
        // A refreshed token carries both, and they differ: sessionStart is first sign-in and
        // iat is this mint. Reading iat is the bug -- the ceiling would move forward every
        // time the window slid, and never arrive.
        var principal = PrincipalWith(
            (TokenClaimNames.SessionStart, SignIn.ToUnixTimeSeconds().ToString()),
            ("iat", SignIn.AddHours(20).ToUnixTimeSeconds().ToString()));

        Assert.Equal(SignIn, SessionWindows.StartedAt(principal, DateTimeOffset.UtcNow));
    }

    [Fact]
    public void StartedAt_falls_back_to_iat_for_a_token_minted_before_the_claim_existed()
    {
        // Every session open at deploy time, plus any token the legacy climate-tracking
        // application minted against the shared TrackingJwtSecret. Refusing these would sign
        // everyone out on deploy; giving them a fresh ceiling would be a free extension, so
        // the oldest instant the token can prove is used.
        var principal = PrincipalWith(("iat", SignIn.ToUnixTimeSeconds().ToString()));

        Assert.Equal(SignIn, SessionWindows.StartedAt(principal, DateTimeOffset.UtcNow));
    }

    [Fact]
    public void StartedAt_falls_back_to_now_when_the_token_proves_no_instant_at_all()
    {
        var now = SignIn.AddDays(3);

        Assert.Equal(now, SessionWindows.StartedAt(PrincipalWith(), now));
        Assert.Equal(now, SessionWindows.StartedAt(PrincipalWith(("iat", "not-a-number")), now));
        Assert.Equal(
            now,
            SessionWindows.StartedAt(PrincipalWith((TokenClaimNames.SessionStart, "")), now));
    }

    [Fact]
    public void StartedAt_does_not_throw_on_an_absurd_epoch_value()
    {
        // long.MaxValue seconds is outside DateTimeOffset's range. The only caller is a mint,
        // so throwing here would 500 a refresh rather than refuse it.
        var now = SignIn;
        var principal = PrincipalWith(
            (TokenClaimNames.SessionStart, long.MaxValue.ToString()),
            ("iat", long.MinValue.ToString()));

        Assert.Equal(now, SessionWindows.StartedAt(principal, now));
    }
}
