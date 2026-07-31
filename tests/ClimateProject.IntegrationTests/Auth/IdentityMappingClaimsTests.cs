using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.IdentityModel.Tokens.Jwt;
using ClimateProject.Api.Endpoints;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Auth;

[Collection("Postgres")]
public class IdentityMappingClaimsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _emailDomain = $"idmap-{Guid.NewGuid():N}.test";

    public IdentityMappingClaimsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Companies.Add(new Company { Id = Guid.NewGuid(), Name = "IdMap Co", EmailDomain = _emailDomain, CreatedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static string DecodeSubClaim(string token)
        => new JwtSecurityTokenHandler().ReadJwtToken(token).Claims.First(c => c.Type == "sub").Value;

    [Fact]
    public async Task Login_uses_fresh_guid_as_sub_when_PersonaExternalId_is_not_set()
    {
        var client = _factory.CreateClient();
        var email = $"noexternal@{_emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("No External", email, "a-good-password"));
        var signupToken = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        Guid userId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = db.Users.First(u => u.Email == email);
            userId = user.Id;
            Assert.Null(user.PersonaExternalId);
        }

        Assert.Equal(userId.ToString(), DecodeSubClaim(signupToken));
    }

    [Fact]
    public async Task Login_uses_PersonaExternalId_as_sub_when_it_is_set()
    {
        var client = _factory.CreateClient();
        var email = $"hasexternal@{_emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Has External", email, "a-good-password"));
        await signup.Content.ReadFromJsonAsync<TokenResponse>();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = db.Users.First(u => u.Email == email);
            user.PersonaExternalId = "legacy-mongo-id-abc123";
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        var loginToken = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        Assert.Equal("legacy-mongo-id-abc123", DecodeSubClaim(loginToken));
    }
}
