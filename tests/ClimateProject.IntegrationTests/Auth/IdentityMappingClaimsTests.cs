using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.IdentityModel.Tokens.Jwt;
using ClimateProject.Api.Endpoints;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
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
        // Unique per test run: PersonaExternalId now has a DB-level unique constraint
        // (see PersonaExternalId_must_be_unique_at_the_database_level below), and this
        // suite runs against a Postgres instance shared across the whole collection, so a
        // hardcoded literal here would collide with the same literal in a sibling test.
        var externalId = $"legacy-mongo-id-{Guid.NewGuid():N}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Has External", email, "a-good-password"));
        await signup.Content.ReadFromJsonAsync<TokenResponse>();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = db.Users.First(u => u.Email == email);
            user.PersonaExternalId = externalId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        var loginToken = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        Assert.Equal(externalId, DecodeSubClaim(loginToken));
    }

    [Fact]
    public async Task Refresh_succeeds_when_PersonaExternalId_is_a_non_guid_string()
    {
        var client = _factory.CreateClient();
        var email = $"refresh-external@{_emailDomain}";
        // See the uniqueness note in Login_uses_PersonaExternalId_as_sub_when_it_is_set.
        var externalId = $"legacy-mongo-id-{Guid.NewGuid():N}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Refresh External", email, "a-good-password"));
        await signup.Content.ReadFromJsonAsync<TokenResponse>();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = db.Users.First(u => u.Email == email);
            user.PersonaExternalId = externalId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        var loginToken = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        Assert.Equal(externalId, DecodeSubClaim(loginToken));

        using var refreshRequest = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        refreshRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", loginToken);
        var refresh = await client.SendAsync(refreshRequest);

        Assert.True(refresh.IsSuccessStatusCode, $"Expected success, got {(int)refresh.StatusCode}: {await refresh.Content.ReadAsStringAsync()}");
        var refreshToken = (await refresh.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        Assert.Equal(externalId, DecodeSubClaim(refreshToken));
    }

    [Fact]
    public async Task PersonaExternalId_must_be_unique_at_the_database_level()
    {
        // /auth/refresh resolves the acting user by PersonaExternalId and trusts it as a
        // unique identity key (see Refresh_succeeds_when_PersonaExternalId_is_a_non_guid_string
        // above). This proves that invariant is enforced by the schema, not just "relied
        // on" -- a duplicate value must fail to save rather than silently succeed and let
        // refresh return whichever row Postgres happens to pick.
        var client = _factory.CreateClient();
        var emailOne = $"dup-one@{_emailDomain}";
        var emailTwo = $"dup-two@{_emailDomain}";
        await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Dup One", emailOne, "a-good-password"));
        await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Dup Two", emailTwo, "a-good-password"));

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var userOne = await db.Users.FirstAsync(u => u.Email == emailOne);
        userOne.PersonaExternalId = "duplicate-legacy-id";
        await db.SaveChangesAsync();

        var userTwo = await db.Users.FirstAsync(u => u.Email == emailTwo);
        userTwo.PersonaExternalId = "duplicate-legacy-id";

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Multiple_users_may_share_a_null_PersonaExternalId()
    {
        // The unique index is filtered (persona_external_id IS NOT NULL) so it must not
        // block ordinary signups, which all leave PersonaExternalId unset.
        var client = _factory.CreateClient();
        var signupOne = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Null One", $"null-one@{_emailDomain}", "a-good-password"));
        var signupTwo = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Null Two", $"null-two@{_emailDomain}", "a-good-password"));

        Assert.True(signupOne.IsSuccessStatusCode);
        Assert.True(signupTwo.IsSuccessStatusCode);
    }
}
