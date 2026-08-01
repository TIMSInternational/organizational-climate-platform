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

    private static string CreateToken(
        string secret,
        string companyId = ProcomerCompanyId,
        DateTime? expires = null)
    {
        var handler = new Jwt.JwtSecurityTokenHandler();
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim("sub", "PER-0231"),
            new Claim("role", "leader"),
            new Claim("nodoId", "ND-014"),
            new Claim("email", "mrodriguez@procomer.com"),
            new Claim("name", "Maria Rodriguez"),
            new Claim("companyId", companyId),
            new Claim("isActive", "true"),
        };

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

    private sealed record WhoAmIResponse(
        string PersonaExternalId,
        string Role,
        string NodoExternalId,
        string Email,
        string Name,
        string CompanyId,
        bool IsActive);
}
