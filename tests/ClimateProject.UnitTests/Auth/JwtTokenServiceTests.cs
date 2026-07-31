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
        IsActive: true);

    [Fact]
    public void IssueToken_produces_exact_claim_shape_with_no_iss_or_aud()
    {
        var service = CreateService();
        var token = service.IssueToken(SampleClaims);

        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        Assert.Equal(SampleClaims.Sub, jwt.Claims.Single(c => c.Type == "sub").Value);
        Assert.Equal(Roles.Employee, jwt.Claims.Single(c => c.Type == "role").Value);
        Assert.Equal("nodo-123", jwt.Claims.Single(c => c.Type == "nodoId").Value);
        Assert.Equal("person@acme.test", jwt.Claims.Single(c => c.Type == "email").Value);
        Assert.Equal("Person One", jwt.Claims.Single(c => c.Type == "name").Value);
        Assert.Equal(SampleClaims.CompanyId, jwt.Claims.Single(c => c.Type == "companyId").Value);
        Assert.Equal("true", jwt.Claims.Single(c => c.Type == "isActive").Value);
        Assert.Contains(jwt.Claims, c => c.Type == "iat");

        Assert.DoesNotContain(jwt.Claims, c => c.Type == "iss");
        Assert.DoesNotContain(jwt.Claims, c => c.Type == "aud");
        Assert.DoesNotContain(jwt.Claims, c => c.Type == "nbf");
    }

    [Fact]
    public void IssueToken_sets_24_hour_expiry()
    {
        // NOTE: measured via exp - iat (both are epoch-second claims embedded
        // in the token) rather than jwt.ValidTo - jwt.ValidFrom.
        // JwtSecurityToken.ValidFrom is derived solely from an "nbf" claim in
        // the payload; since this token intentionally omits nbf (see
        // IssueToken_produces_exact_claim_shape_with_no_iss_or_aud), ValidFrom
        // always reads back as DateTime.MinValue and can't be used to measure
        // lifetime. Adding notBefore to populate it would add an "nbf" claim,
        // which the claim-shape test explicitly forbids. Comparing exp - iat
        // is also immune to wall-clock/second-truncation flakiness.
        var service = CreateService();
        var token = service.IssueToken(SampleClaims);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        var iat = long.Parse(jwt.Claims.Single(c => c.Type == "iat").Value);
        var exp = new DateTimeOffset(jwt.ValidTo, TimeSpan.Zero).ToUnixTimeSeconds();

        Assert.Equal(TimeSpan.FromHours(24).TotalSeconds, exp - iat);
    }

    [Fact]
    public void IssueToken_empty_nodoId_when_null()
    {
        var service = CreateService();
        var claimsWithoutNodo = SampleClaims with { NodoId = null };
        var token = service.IssueToken(claimsWithoutNodo);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        Assert.Equal(string.Empty, jwt.Claims.Single(c => c.Type == "nodoId").Value);
    }

    [Fact]
    public void Issued_token_validates_under_climate_tracking_exact_TokenValidationParameters()
    {
        var service = CreateService();
        var token = service.IssueToken(SampleClaims);

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
}
