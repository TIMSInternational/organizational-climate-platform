using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using ClimateProject.Application.Auth;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace ClimateProject.Infrastructure.Auth;

public class JwtTokenService : IJwtTokenService
{
    private static readonly TimeSpan TokenLifetime = TimeSpan.FromHours(24);
    private readonly SymmetricSecurityKey _signingKey;

    public JwtTokenService(IConfiguration configuration)
    {
        var secret = configuration["TrackingJwtSecret"]
            ?? throw new InvalidOperationException("Missing TrackingJwtSecret configuration.");
        _signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
    }

    public string IssueToken(TokenClaims claims)
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
            new(JwtRegisteredClaimNames.Iat, now.ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64),
        };

        var token = new JwtSecurityToken(
            claims: jwtClaims,
            expires: now.UtcDateTime.Add(TokenLifetime),
            signingCredentials: new SigningCredentials(_signingKey, SecurityAlgorithms.HmacSha256));

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
