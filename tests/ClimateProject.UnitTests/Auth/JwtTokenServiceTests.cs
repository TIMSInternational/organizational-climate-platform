using System.IdentityModel.Tokens.Jwt;
using System.Text;
using ClimateProject.Application.Auth;
using ClimateProject.Infrastructure.Auth;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace ClimateProject.UnitTests.Auth;

public class JwtTokenServiceTests
{
    private const string TestSecret = "unit-test-tracking-jwt-secret-must-be-at-least-32-bytes";

    private static JwtTokenService CreateService()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["TrackingJwtSecret"] = TestSecret })
            .Build();
        return new JwtTokenService(configuration);
    }

    private static readonly TokenClaims SampleClaims = new(
        Sub: Guid.NewGuid().ToString(),
        Role: Roles.Employee,
        NodoId: "nodo-123",
        Email: "person@acme.test",
        Name: "Person One",
        CompanyId: Guid.NewGuid().ToString(),
        IsActive: true,
        SecurityStamp: Guid.NewGuid());

    /// <summary>
    /// A window around the present, truncated to whole seconds.
    /// </summary>
    /// <remarks>
    /// Truncated because `exp` is an epoch-second claim, so `jwt.ValidTo` read back from a
    /// `DateTimeOffset.UtcNow` carrying milliseconds would never compare equal to it.
    /// Around the PRESENT because two tests here validate the token under
    /// `ValidateLifetime = true`, which a fixed calendar date would fail the moment it went
    /// past — a test that passes because of the calendar is worse than no test. The two
    /// offsets are unequal and not round, so a test asserting on one instant cannot pass by
    /// accidentally reading the other, `iat`, or `now`.
    /// </remarks>
    private static readonly DateTimeOffset WholeSecond =
        DateTimeOffset.FromUnixTimeSeconds(DateTimeOffset.UtcNow.ToUnixTimeSeconds());

    private static readonly SessionWindow SampleWindow = new(
        StartedAt: WholeSecond.AddMinutes(-37),
        ExpiresAt: WholeSecond.AddMinutes(43),
        IssuedAt: WholeSecond);

    [Fact]
    public void IssueToken_produces_exact_claim_shape_with_no_iss_or_aud()
    {
        var service = CreateService();
        var token = service.IssueToken(SampleClaims, SampleWindow);

        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        Assert.Equal(SampleClaims.Sub, jwt.Claims.Single(c => c.Type == "sub").Value);
        Assert.Equal(Roles.Employee, jwt.Claims.Single(c => c.Type == "role").Value);
        Assert.Equal("nodo-123", jwt.Claims.Single(c => c.Type == "nodoId").Value);
        Assert.Equal("person@acme.test", jwt.Claims.Single(c => c.Type == "email").Value);
        Assert.Equal("Person One", jwt.Claims.Single(c => c.Type == "name").Value);
        Assert.Equal(SampleClaims.CompanyId, jwt.Claims.Single(c => c.Type == "companyId").Value);
        Assert.Equal("true", jwt.Claims.Single(c => c.Type == "isActive").Value);

        // #284. Asserted as the exact "D" text a Guid renders by default, not just as
        // "present": the reader parses this value and compares it for equality against
        // users.security_stamp, so a token carrying a truncated or reformatted stamp would
        // be refused by its own next request.
        Assert.Equal(
            SampleClaims.SecurityStamp.ToString(),
            jwt.Claims.Single(c => c.Type == "securityStamp").Value);

        Assert.Contains(jwt.Claims, c => c.Type == "iat");

        // The absolute ceiling's anchor. Asserted as the exact epoch seconds of the window's
        // StartedAt rather than "present", because SessionWindows.StartedAt parses this value
        // back on the next refresh: a token carrying `iat` here instead would re-base the
        // ceiling on every refresh and the ceiling would never arrive.
        Assert.Equal(
            SampleWindow.StartedAt.ToUnixTimeSeconds().ToString(),
            jwt.Claims.Single(c => c.Type == TokenClaimNames.SessionStart).Value);

        Assert.DoesNotContain(jwt.Claims, c => c.Type == "iss");
        Assert.DoesNotContain(jwt.Claims, c => c.Type == "aud");
        Assert.DoesNotContain(jwt.Claims, c => c.Type == "nbf");
    }

    [Fact]
    public void IssueToken_expires_exactly_when_the_window_says()
    {
        // NOTE: `exp` is read off jwt.ValidTo rather than measured as exp - iat, which is how
        // the superseded `IssueToken_sets_24_hour_expiry` had to do it: that test asserted a
        // DURATION (24 hours, then hardcoded in this service), and a duration can only be
        // measured against iat because the token omits `nbf` and ValidFrom therefore reads
        // back as DateTime.MinValue. This asserts an INSTANT instead -- the one
        // SessionWindows computed from SystemSettings.SessionTimeoutMinutes -- so iat is not
        // involved and the assertion is immune to second-truncation flakiness either way.
        //
        // The duration is deliberately no longer asserted here. It is not this service's to
        // decide any more: it belongs to SessionWindows, where SessionWindowsTests measures
        // it against the configured timeout and the 24-hour ceiling.
        var service = CreateService();
        var token = service.IssueToken(SampleClaims, SampleWindow);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        var exp = new DateTimeOffset(jwt.ValidTo, TimeSpan.Zero);

        Assert.Equal(SampleWindow.ExpiresAt, exp);
    }

    [Fact]
    public void IssueToken_no_longer_mints_a_24_hour_lifetime_of_its_own()
    {
        // The regression this feature exists to prevent coming back, stated as its own test:
        // the lifetime used to be `TimeSpan.FromHours(24)` inside this class, so
        // SessionTimeoutMinutes -- editable by a super admin, shipped at 60 -- enforced
        // nothing at all. A sixty-minute window must produce a sixty-minute token.
        //
        // Exact rather than "under an hour and two seconds": iat and exp now come from the same
        // instant, so truncating both to whole seconds cannot open a gap between them.
        var service = CreateService();
        var startedAt = DateTimeOffset.UtcNow;
        var window = new SessionWindow(startedAt, startedAt.AddMinutes(60), startedAt);

        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(service.IssueToken(SampleClaims, window));
        var iat = DateTimeOffset.FromUnixTimeSeconds(long.Parse(jwt.Claims.Single(c => c.Type == "iat").Value));
        var exp = new DateTimeOffset(jwt.ValidTo, TimeSpan.Zero);

        Assert.Equal(TimeSpan.FromHours(1), exp - iat);
    }

    [Fact]
    public void IssueToken_stamps_iat_from_the_window_not_from_a_second_clock_reading()
    {
        // The mint used to read the clock again for iat, after the endpoint had already read it
        // for the expiry and then queried the database. A second boundary between the two
        // readings minted a 60-minute window as 59:59, which is how CrossServiceTokenTests went
        // red on main on 2026-10-21. An IssuedAt seven minutes in the past cannot be confused
        // with the present, so this fails every time a second reading comes back.
        var service = CreateService();
        var issuedAt = WholeSecond.AddMinutes(-7);
        var window = new SessionWindow(issuedAt.AddMinutes(-3), issuedAt.AddMinutes(60), issuedAt);

        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(service.IssueToken(SampleClaims, window));
        var iat = DateTimeOffset.FromUnixTimeSeconds(long.Parse(jwt.Claims.Single(c => c.Type == "iat").Value));

        Assert.Equal(issuedAt, iat);
    }

    [Fact]
    public void IssueToken_empty_nodoId_when_null()
    {
        var service = CreateService();
        var claimsWithoutNodo = SampleClaims with { NodoId = null };
        var token = service.IssueToken(claimsWithoutNodo, SampleWindow);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        Assert.Equal(string.Empty, jwt.Claims.Single(c => c.Type == "nodoId").Value);
    }

    [Fact]
    public void Issued_token_validates_under_climate_tracking_exact_TokenValidationParameters()
    {
        var service = CreateService();
        var token = service.IssueToken(SampleClaims, SampleWindow);

        // These TokenValidationParameters are copied verbatim from
        // climate-tracking/services/api/src/ClimateTracking.Api/Program.cs
        // (lines 40-49) — this test is the byte-for-byte compatibility proof.
        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
        var validationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TestSecret)),
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateLifetime = true,
            NameClaimType = "sub",
        };

        var principal = handler.ValidateToken(token, validationParameters, out _);

        // Mirrors ClimateTracking.Application.Auth.CurrentUser's exact claim reads.
        Assert.Equal(SampleClaims.Sub, principal.FindFirst("sub")?.Value);
        Assert.Equal(SampleClaims.Role, principal.FindFirst("role")?.Value);
        Assert.Equal(SampleClaims.NodoId, principal.FindFirst("nodoId")?.Value);
        Assert.Equal(SampleClaims.Email, principal.FindFirst("email")?.Value);
        Assert.Equal(SampleClaims.Name, principal.FindFirst("name")?.Value);
        Assert.Equal(SampleClaims.CompanyId, principal.FindFirst("companyId")?.Value);
        Assert.Equal("true", principal.FindFirst("isActive")?.Value);
    }

    [Fact]
    public void Company_less_super_admin_round_trips_as_an_empty_companyId_claim()
    {
        // #191 made User.CompanyId nullable, and AuthEndpoints emits
        // `user.CompanyId?.ToString() ?? string.Empty` for it. This proves the resulting
        // token still carries a companyId claim -- omitting it entirely would be the
        // tempting alternative -- and that reading it back yields exactly the
        // string.Empty that GetCurrentUser already defaults a missing claim to. That
        // equivalence is what lets every existing guard keep working untouched.
        var service = CreateService();
        var token = service.IssueToken(SampleClaims with { Role = Roles.SuperAdmin, CompanyId = string.Empty }, SampleWindow);

        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
        var principal = handler.ValidateToken(
            token,
            new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TestSecret)),
                ValidateIssuer = false,
                ValidateAudience = false,
                ValidateLifetime = true,
                NameClaimType = "sub",
            },
            out _);

        Assert.Contains(principal.Claims, c => c.Type == "companyId");

        var currentUser = principal.GetCurrentUser();
        Assert.Equal(string.Empty, currentUser.CompanyId);
        Assert.Equal(Roles.SuperAdmin, currentUser.Role);
        Assert.True(CompanyScope.CanAccess(currentUser, Guid.NewGuid()));
        Assert.True(CompanyScope.CanAccess(currentUser, null));
    }

    [Fact]
    public void Constructor_throws_when_TrackingJwtSecret_is_empty_string()
    {
        // appsettings.json ships "TrackingJwtSecret": "" as a placeholder. An
        // empty string is not null, so a naive "?? throw" null-coalescing guard
        // silently lets it through, producing a zero-length signing key. This
        // proves the constructor rejects that case explicitly.
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["TrackingJwtSecret"] = "" })
            .Build();

        var exception = Assert.Throws<InvalidOperationException>(() => new JwtTokenService(configuration));
        Assert.Equal("Missing TrackingJwtSecret configuration.", exception.Message);
    }

    [Fact]
    public void Constructor_throws_when_TrackingJwtSecret_is_missing()
    {
        var configuration = new ConfigurationBuilder().Build();

        var exception = Assert.Throws<InvalidOperationException>(() => new JwtTokenService(configuration));
        Assert.Equal("Missing TrackingJwtSecret configuration.", exception.Message);
    }
}
