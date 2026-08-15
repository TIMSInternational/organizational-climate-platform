using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using ClimateTracking.Infrastructure.Persistence;
using Jwt = System.IdentityModel.Tokens.Jwt;
using Microsoft.IdentityModel.Tokens;
using System.Security.Claims;
using System.Text;

namespace ClimateTracking.IntegrationTests.Auth;

public class JwtAuthenticationTests : IClassFixture<PostgresFixture>, IAsyncLifetime
{
    private const string TrackingJwtSecret = "test-tracking-secret-at-least-32-bytes-long";
    private const string ProcomerCompanyId = "CO-014";

    private readonly PostgresFixture _postgres;
    private WebApplicationFactory<Program> _factory = null!;

    public JwtAuthenticationTests(PostgresFixture postgres)
    {
        _postgres = postgres;
    }

    public async Task InitializeAsync()
    {
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("ConnectionStrings:ClimateTracking", _postgres.ConnectionString);
            builder.UseSetting("TrackingJwtSecret", TrackingJwtSecret);
            builder.UseSetting("ProcomerCompanyId", ProcomerCompanyId);
            builder.UseSetting("ClimateProjectBaseUrl", "http://climate-project.test");
            builder.UseSetting("ClimateProjectInternalApiKey", "test-internal-key");
        });

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        await db.Database.EnsureCreatedAsync();
    }

    public async Task DisposeAsync()
    {
        await _factory.DisposeAsync();
    }

    /// <param name="isActive">
    /// The claim's value, or null to mint no <c>isActive</c> claim at all — which is what an
    /// issuer that predates the claim produces, and what must not be locked out.
    /// </param>
    /// <param name="securityStamp">
    /// climate-project-api mints this on every token (#284) and compares it against the user
    /// row on every request; this service has no such row. Null mints no claim.
    /// </param>
    private static string CreateToken(
        string secret,
        string companyId = ProcomerCompanyId,
        DateTime? expires = null,
        string? isActive = "true",
        string? securityStamp = null)
    {
        var handler = new Jwt.JwtSecurityTokenHandler();
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new("sub", "PER-0231"),
            new("role", "leader"),
            new("nodoId", "ND-014"),
            new("email", "mrodriguez@procomer.com"),
            new("name", "Maria Rodriguez"),
            new("companyId", companyId),
        };

        if (isActive is not null)
        {
            claims.Add(new Claim("isActive", isActive));
        }

        if (securityStamp is not null)
        {
            claims.Add(new Claim("securityStamp", securityStamp));
        }

        var token = new Jwt.JwtSecurityToken(
            claims: claims,
            expires: expires ?? DateTime.UtcNow.AddHours(1),
            signingCredentials: creds);

        return handler.WriteToken(token);
    }

    [Fact]
    public async Task Returns_401_without_a_token()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/whoami");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Returns_401_for_a_token_signed_with_the_wrong_secret()
    {
        var client = _factory.CreateClient();
        var token = CreateToken("a-completely-different-secret-value-1234567890");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/api/whoami");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Returns_401_for_an_expired_token()
    {
        var client = _factory.CreateClient();
        var token = CreateToken(TrackingJwtSecret, expires: DateTime.UtcNow.AddMinutes(-5));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/api/whoami");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Returns_403_when_companyId_claim_does_not_match_this_deployment()
    {
        var client = _factory.CreateClient();
        var token = CreateToken(TrackingJwtSecret, companyId: "SOME-OTHER-COMPANY");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/api/whoami");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Returns_200_with_claims_correctly_exposed_for_a_valid_token()
    {
        var client = _factory.CreateClient();
        var token = CreateToken(TrackingJwtSecret);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/api/whoami");
        var body = await response.Content.ReadFromJsonAsync<WhoAmIResponse>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("PER-0231", body!.PersonaExternalId);
        Assert.Equal("leader", body.Role);
        Assert.Equal("ND-014", body.NodoExternalId);
        Assert.Equal("mrodriguez@procomer.com", body.Email);
        Assert.Equal("Maria Rodriguez", body.Name);
        Assert.Equal(ProcomerCompanyId, body.CompanyId);
        Assert.True(body.IsActive);
    }

    // ------------------------------------------------ what a token's own claims can say

    [Fact]
    public async Task Returns_403_for_a_token_whose_own_isActive_claim_says_false()
    {
        // Parity with climate-project-api's #280 policy, which has refused this token shape
        // since it shipped while this service accepted it. Nothing upstream can be what
        // refuses it here: the token below is signed with this deployment's secret and
        // carries this deployment's tenant, so it clears the bearer handler and the tenant
        // requirement, and the only thing left to say no is the isActive assertion in
        // Program.cs's default policy. Delete that line and this test returns 200.
        var client = _factory.CreateClient();
        var token = CreateToken(TrackingJwtSecret, isActive: "false");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/api/whoami");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_token_with_no_isActive_claim_is_still_accepted()
    {
        // The limit on the check above, and the reason it is HasDeactivatedAccountClaim
        // rather than !IsActive: an absent claim means "unknown", not "deactivated". An
        // issuer that never wrote the claim keeps working. Without this, the check would be a
        // silent lockout of every such token rather than a refusal of the one shape it means
        // to refuse.
        var client = _factory.CreateClient();
        var token = CreateToken(TrackingJwtSecret, isActive: null);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/api/whoami");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>
    /// A KNOWN GAP, asserted so that it is a decision rather than a surprise. Read
    /// <c>docs/decisions/cross-service-session-revocation.md</c> before changing this test.
    /// </summary>
    [Fact]
    public async Task A_token_whose_session_climate_project_has_already_ended_is_still_accepted_here()
    {
        // The token below is exactly what a user's browser holds after they change their
        // password on climate-project-api: same signature, same tenant, same isActive: true,
        // and a securityStamp claim that no longer matches their row over there. That service
        // 401s it on its next request (#284). This service has no users table to compare the
        // claim against, so it authenticates it and serves the request -- for the rest of the
        // token's lifetime, up to 24 hours.
        //
        // This is NOT the behaviour we want; it is the behaviour we have, bounded and
        // written down. If you close the gap, this test must fail -- change it to assert the
        // refusal and update the decision record, do not delete it quietly.
        var client = _factory.CreateClient();
        var token = CreateToken(TrackingJwtSecret, securityStamp: Guid.NewGuid().ToString());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/api/whoami");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private sealed record WhoAmIResponse(
        string PersonaExternalId,
        string Role,
        string NodoExternalId,
        string Email,
        string Name,
        string CompanyId,
        bool IsActive);
}
