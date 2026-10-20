using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using ClimateProject.Application.Auth;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace ClimateProject.Infrastructure.Auth;

public class JwtTokenService : IJwtTokenService
{
    private readonly SymmetricSecurityKey _signingKey;

    public JwtTokenService(IConfiguration configuration)
    {
        var secret = configuration["TrackingJwtSecret"];
        if (string.IsNullOrWhiteSpace(secret))
        {
            throw new InvalidOperationException("Missing TrackingJwtSecret configuration.");
        }

        _signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
    }

    public string IssueToken(TokenClaims claims, SessionWindow window)
    {
        var now = DateTimeOffset.UtcNow;

        var jwtClaims = new List<Claim>
        {
            new("sub", claims.Sub),
            new("role", claims.Role),
            new("nodoId", claims.NodoId ?? string.Empty),
            new("email", claims.Email),
            new("name", claims.Name),
            new("companyId", claims.CompanyId),
            new("isActive", claims.IsActive ? "true" : "false"),

            // #284. "D" (the Guid default, 8-4-4-4-12 with hyphens) rather than "N", because
            // the reader parses with Guid.TryParse, which accepts both, and "D" is the form
            // Postgres prints a uuid in — so a stamp copied out of a decoded token can be
            // pasted straight into a query against users.security_stamp.
            new(TokenClaimNames.SecurityStamp, claims.SecurityStamp.ToString()),

            new(JwtRegisteredClaimNames.Iat, now.ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64),

            // The absolute ceiling, carried in the token rather than recomputed (#idle).
            // `iat` cannot stand in for it: iat is when THIS token was minted, and a sliding
            // window re-mints on activity, so a ceiling measured from iat would move forward
            // with every refresh and never arrive.
            new(
                TokenClaimNames.SessionStart,
                window.StartedAt.ToUnixTimeSeconds().ToString(),
                ClaimValueTypes.Integer64),
        };

        // Added only when there is one, so a shared session's token is byte-identical to
        // what it was before this existed -- an absent claim is the "every survey" answer,
        // and writing an empty one would make the reader parse a sentinel instead.
        if (claims.SurveyScope is { } surveyScope)
        {
            jwtClaims.Add(new Claim(TokenClaimNames.SurveyScope, surveyScope.ToString()));
        }

        var token = new JwtSecurityToken(
            claims: jwtClaims,
            // SessionWindows.Next decided this: the idle window from SystemSettings, or the
            // ceiling, whichever lands first. The lifetime used to be a constant here, which
            // is precisely why the setting a super admin edits enforced nothing.
            expires: window.ExpiresAt.UtcDateTime,
            signingCredentials: new SigningCredentials(_signingKey, SecurityAlgorithms.HmacSha256));

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
