using System.Net;
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

    private static string DecodeSubClaim(string token) => DecodeClaim(token, "sub");

    private static string DecodeClaim(string token, string type)
        => new JwtSecurityTokenHandler().ReadJwtToken(token).Claims.First(c => c.Type == type).Value;

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

    /// <summary>
    /// #285: /auth/refresh must re-mint a token for the caller's own row, even when their
    /// <c>sub</c> spells another user's <c>Id</c>.
    ///
    /// The filtered unique index proved above stops two users *sharing* a
    /// <c>persona_external_id</c>. It does nothing about user A's <c>persona_external_id</c>
    /// equalling user B's <c>id</c> — different columns, and the column is a free-form
    /// 64-character string, so a canonical Guid is a legal value. #154's ETL is the feature
    /// that will start filling it from legacy ids.
    ///
    /// Until #285 this endpoint resolved with a single unordered
    /// <c>Id == userId || PersonaExternalId == sub</c> predicate, so under this collision it
    /// returned whichever row Postgres reached first and could mint a token carrying the
    /// victim's identity. The <c>sub</c> claim cannot detect that — a token minted for the
    /// victim carries the victim's own Id as <c>sub</c>, which is the same string — so this
    /// asserts on <c>email</c>, the claim that says who the new token is for.
    /// </summary>
    [Fact]
    public async Task Refresh_never_re_mints_for_the_user_whose_id_a_guid_shaped_external_id_matches()
    {
        var client = _factory.CreateClient();
        var victimEmail = $"collision-victim-{Guid.NewGuid():N}@{_emailDomain}";
        var colliderEmail = $"collision-collider-{Guid.NewGuid():N}@{_emailDomain}";
        (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Victim", victimEmail, "a-good-password")))
            .EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Collider", colliderEmail, "a-good-password")))
            .EnsureSuccessStatusCode();

        Guid victimId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var victim = await db.Users.FirstAsync(u => u.Email == victimEmail);
            var collider = await db.Users.FirstAsync(u => u.Email == colliderEmail);
            victimId = victim.Id;
            Assert.NotEqual(victim.Id, collider.Id);

            collider.PersonaExternalId = victim.Id.ToString();
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(colliderEmail, "a-good-password"));
        var loginToken = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        // The collider's own sub is now the victim's Id, spelled exactly.
        Assert.Equal(victimId.ToString(), DecodeSubClaim(loginToken));
        Assert.Equal(colliderEmail, DecodeClaim(loginToken, "email"));

        using var refreshRequest = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        refreshRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", loginToken);
        var refresh = await client.SendAsync(refreshRequest);

        Assert.True(refresh.IsSuccessStatusCode, $"Expected success, got {(int)refresh.StatusCode}: {await refresh.Content.ReadAsStringAsync()}");
        var refreshToken = (await refresh.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        Assert.Equal(colliderEmail, DecodeClaim(refreshToken, "email"));
        Assert.Equal("Collider", DecodeClaim(refreshToken, "name"));
    }

    /// <summary>
    /// #285: the branch that decides between "refuse" and "act as somebody".
    ///
    /// <c>ActingUserResolver</c> ends in <c>return null</c> — reached by a <c>sub</c> that
    /// matches no <c>persona_external_id</c> and does not parse as a Guid, so neither of its
    /// two steps can answer. Every collision test in this suite seeds a Guid-shaped
    /// <c>sub</c>, so none of them reaches that tail; this one does.
    ///
    /// The tail is load-bearing. Its callers turn null into a refusal — 401 here, 403 on the
    /// notification routes, a 400 or a null attribution elsewhere — so a tail that answered
    /// with a row instead (the first user, or the all-zeroes id) would hand an unresolvable
    /// bearer somebody else's session. A non-Guid <c>sub</c> whose row is gone is exactly the
    /// state #154's ETL can produce: it mints <c>sub</c> from a legacy id, and the mapping
    /// can be corrected or withdrawn while a token is still in flight.
    /// </summary>
    [Fact]
    public async Task Refresh_is_refused_when_a_non_guid_sub_matches_no_row()
    {
        var client = _factory.CreateClient();
        var email = $"orphaned-sub-{Guid.NewGuid():N}@{_emailDomain}";
        // See the uniqueness note in Login_uses_PersonaExternalId_as_sub_when_it_is_set.
        var externalId = $"legacy-mongo-id-{Guid.NewGuid():N}";
        Assert.False(Guid.TryParse(externalId, out _));
        (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Orphaned Sub", email, "a-good-password")))
            .EnsureSuccessStatusCode();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.PersonaExternalId = externalId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        var loginToken = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        Assert.Equal(externalId, DecodeSubClaim(loginToken));

        // The mapping is withdrawn while the token is still valid. The token still carries a
        // signature this API accepts and a sub that now belongs to nobody: no row has that
        // persona_external_id any more, and it is not a Guid, so the Id step cannot run
        // either. The account itself is untouched -- only the identity the sub named is gone.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.PersonaExternalId = null;
            await db.SaveChangesAsync();
            Assert.True(user.IsActive);
        }

        using var refreshRequest = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        refreshRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", loginToken);
        var refresh = await client.SendAsync(refreshRequest);

        // Refused, and with no re-minted token in the body -- not a token for whichever row
        // a defaulting resolver happened to reach.
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
        Assert.DoesNotContain("token", await refresh.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
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
