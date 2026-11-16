using System.Security.Claims;
using ClimateProject.Application.Auth.TwoFactor;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace ClimateProject.Infrastructure.Auth;

/// <summary>What a valid challenge token says.</summary>
public sealed record TwoFactorChallenge(Guid UserId, string Purpose, Guid SecurityStamp, Guid? SurveyScope);

/// <summary>
/// The short-lived token that carries a password-verified sign-in to its second step.
/// </summary>
/// <remarks>
/// It is NOT a session, and three things keep it from ever being used as one:
/// <list type="number">
/// <item><description>It is signed with <see cref="TwoFactorSettings.ChallengeSigningKey"/>, a key
/// derived from the TOTP encryption key, never with TrackingJwtSecret -- so the session bearer
/// scheme (here and in climate-tracking, which shares that secret) fails its signature.</description></item>
/// <item><description>It carries <see cref="PurposeClaim"/>, which the session scheme's
/// OnTokenValidated refuses outright (<see cref="CarriesChallengePurpose"/>) -- the guard for the
/// day the keys are ever made the same.</description></item>
/// <item><description>Its audience is <see cref="Audience"/>, and reading one requires that audience,
/// the expected purpose, and an unexpired <c>exp</c> on the injected clock.</description></item>
/// </list>
/// It is bound to the user's security stamp; the endpoint compares it with the row, so a stamp
/// rotation (password change, reset) voids every challenge in flight.
/// </remarks>
public static class TwoFactorChallengeTokens
{
    public const string PurposeClaim = "twoFactorPurpose";
    public const string StampClaim = "twoFactorStamp";
    public const string SurveyScopeClaim = "twoFactorSurveyScope";
    public const string Audience = "occ-two-factor";
    public const string Issuer = "occ-api";

    public const string Verify = "verify";
    public const string Enroll = "enroll";

    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(5);

    public static string Create(
        TwoFactorSettings settings, Guid userId, string purpose, Guid securityStamp, Guid? surveyScope, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var key = settings.ChallengeSigningKey
            ?? throw new InvalidOperationException("Two-factor sign-in is off; no challenge can be created.");

        var claims = new Dictionary<string, object>
        {
            ["sub"] = userId.ToString("D"),
            [PurposeClaim] = purpose,
            [StampClaim] = securityStamp.ToString("D"),
        };
        if (surveyScope is { } scope)
        {
            claims[SurveyScopeClaim] = scope.ToString("D");
        }

        return new JsonWebTokenHandler { SetDefaultTimesOnTokenCreation = false }.CreateToken(new SecurityTokenDescriptor
        {
            Claims = claims,
            Audience = Audience,
            Issuer = Issuer,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = now.Add(Lifetime).UtcDateTime,
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(key), SecurityAlgorithms.HmacSha256),
        });
    }

    /// <summary>The challenge, or null when the token is not one of ours, has expired, or is for another purpose.</summary>
    public static async Task<TwoFactorChallenge?> ReadAsync(
        TwoFactorSettings settings, string? token, string expectedPurpose, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(settings);
        if (string.IsNullOrWhiteSpace(token) || settings.ChallengeSigningKey is not { } key)
        {
            return null;
        }

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(key),
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
            ValidateIssuer = true,
            ValidIssuer = Issuer,
            ValidateAudience = true,
            ValidAudience = Audience,
            // Lifetime is checked below against the injected clock, so tests can move time.
            ValidateLifetime = false,
        });

        if (!result.IsValid || result.SecurityToken is not JsonWebToken jwt)
        {
            return null;
        }

        if (new DateTimeOffset(jwt.ValidTo, TimeSpan.Zero) <= now)
        {
            return null;
        }

        string? Claim(string name) => jwt.TryGetPayloadValue<string>(name, out var value) ? value : null;

        if (!string.Equals(Claim(PurposeClaim), expectedPurpose, StringComparison.Ordinal)
            || !Guid.TryParse(Claim("sub"), out var userId)
            || !Guid.TryParse(Claim(StampClaim), out var stamp))
        {
            return null;
        }

        Guid? surveyScope = Guid.TryParse(Claim(SurveyScopeClaim), out var parsed) ? parsed : null;
        return new TwoFactorChallenge(userId, expectedPurpose, stamp, surveyScope);
    }

    /// <summary>True for any principal carrying a challenge purpose -- never a session.</summary>
    public static bool CarriesChallengePurpose(ClaimsPrincipal? principal)
        => principal?.FindFirst(PurposeClaim) is not null;
}
