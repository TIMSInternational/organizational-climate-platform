using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Auth.TwoFactor;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Auth;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.Tokens;

namespace ClimateProject.IntegrationTests.Auth;

/// <summary>Real time plus an offset the tests move forward: TOTP steps without sleeping.</summary>
public sealed class MovableClock : TimeProvider
{
    private long _offsetTicks;

    public override DateTimeOffset GetUtcNow() => base.GetUtcNow().AddTicks(Interlocked.Read(ref _offsetTicks));

    public void Advance(TimeSpan by) => Interlocked.Add(ref _offsetTicks, by.Ticks);
}

/// <summary>
/// ONE host for the run with <c>Auth:TotpEncryptionKey</c> set (feature ON) and a movable clock.
/// Static and lazy for the reason <c>RotatingHostFixture</c> is: the configuration is the
/// experiment, and every host is billed against <see cref="AuthWebApplicationFactory.HostBudget"/>.
/// </summary>
public sealed class TwoFactorHostFixture : IDisposable
{
    public static readonly string Key = Convert.ToBase64String(Enumerable.Range(40, 32).Select(i => (byte)i).ToArray());
    public static readonly MovableClock Clock = new();

    private static readonly Lock Gate = new();
    private static WebApplicationFactory<Program>? _host;

    public WebApplicationFactory<Program> HostFor(AuthWebApplicationFactory shared)
    {
        lock (Gate)
        {
            return _host ??= shared.WithWebHostBuilder(builder =>
            {
                builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
                    new Dictionary<string, string?> { [TwoFactorSettings.ConfigurationKey] = Key }));
                builder.ConfigureTestServices(services =>
                {
                    services.RemoveAll<TimeProvider>();
                    services.AddSingleton<TimeProvider>(Clock);
                });
            });
        }
    }

    public void Dispose() => GC.SuppressFinalize(this);
}

/// <summary>
/// Two-factor sign-in end to end with the feature ON (ruled 2026-11-15): required for super_admin,
/// optional for everyone else, never a session until the second step is passed.
/// </summary>
[Collection("Postgres")]
public class TwoFactorSignInTests : IAsyncLifetime, IClassFixture<TwoFactorHostFixture>
{
    private const string Password = "A-good-passw0rd";
    private readonly AuthWebApplicationFactory _shared;
    private readonly WebApplicationFactory<Program> _host;
    private readonly string _domain = $"twofactor-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public TwoFactorSignInTests(PostgresContainerFixture postgres, TwoFactorHostFixture fixture)
    {
        _shared = postgres.App;
        _host = fixture.HostFor(_shared);
    }

    public async Task InitializeAsync()
    {
        using var scope = _host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "2FA Co", EmailDomain = _domain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();
        _companyId = company.Id;
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ---- helpers ------------------------------------------------------------------------

    private sealed record Person(string Email, Guid Id, string FirstToken);

    private async Task<Person> NewPersonAsync(string role)
    {
        var client = _host.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_domain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Two Factor", email, Password));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        await db.SaveChangesAsync();
        return new Person(email, user.Id, token);
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
        => JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private static Task<HttpResponseMessage> LoginAsync(HttpClient client, string email)
        => client.PostAsJsonAsync("/auth/login", new LoginRequest(email, Password));

    private static HttpClient Bearer(HttpClient client, string token)
    {
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    /// <summary>A code for a step no earlier code in this run used: the clock moves one step first.</summary>
    private static string NextCode(byte[] secret)
    {
        TwoFactorHostFixture.Clock.Advance(TimeSpan.FromSeconds(Totp.StepSeconds + 1));
        return Totp.Compute(secret, Totp.StepAt(TwoFactorHostFixture.Clock.GetUtcNow()));
    }

    private static byte[] FromBase32(string text)
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        var bytes = new List<byte>();
        int buffer = 0, bits = 0;
        foreach (var c in text)
        {
            buffer = (buffer << 5) | alphabet.IndexOf(c, StringComparison.Ordinal);
            bits += 5;
            if (bits >= 8)
            {
                bytes.Add((byte)(buffer >> (bits - 8)));
                bits -= 8;
            }
        }

        return [.. bytes];
    }

    private sealed record Enrolled(string Token, byte[] Secret, string[] RecoveryCodes);

    /// <summary>Login → enroll challenge → start → confirm, as a super admin's first sign-in does.</summary>
    private async Task<Enrolled> EnrollAtSignInAsync(HttpClient client, string email)
    {
        var login = await JsonAsync(await LoginAsync(client, email));
        Assert.Equal("enroll", login.GetProperty("twoFactor").GetString());
        var challenge = login.GetProperty("challengeToken").GetString();

        var start = await client.PostAsJsonAsync("/auth/two-factor/enrollment/start", new { challengeToken = challenge });
        Assert.Equal(HttpStatusCode.OK, start.StatusCode);
        var secret = FromBase32((await JsonAsync(start)).GetProperty("secret").GetString()!);

        var confirm = await client.PostAsJsonAsync("/auth/two-factor/enrollment/confirm", new { challengeToken = challenge, code = NextCode(secret) });
        Assert.Equal(HttpStatusCode.OK, confirm.StatusCode);
        var body = await JsonAsync(confirm);
        return new Enrolled(
            body.GetProperty("token").GetString()!,
            secret,
            [.. body.GetProperty("recoveryCodes").EnumerateArray().Select(c => c.GetString()!)]);
    }

    /// <summary>Profile start → confirm, for a person signed in with <paramref name="token"/>.</summary>
    private static async Task<Enrolled> EnrollFromProfileAsync(HttpClient client, string token)
    {
        Bearer(client, token);
        var start = await client.PostAsJsonAsync("/profile/two-factor/start", new { currentCode = (string?)null });
        Assert.Equal(HttpStatusCode.OK, start.StatusCode);
        var secret = FromBase32((await JsonAsync(start)).GetProperty("secret").GetString()!);

        var confirm = await client.PostAsJsonAsync("/profile/two-factor/confirm", new { code = NextCode(secret) });
        Assert.Equal(HttpStatusCode.OK, confirm.StatusCode);
        var body = await JsonAsync(confirm);
        return new Enrolled(body.GetProperty("token").GetString()!, secret,
            [.. body.GetProperty("recoveryCodes").EnumerateArray().Select(c => c.GetString()!)]);
    }

    private async Task<string> VerifyChallengeAsync(HttpClient client, string email)
    {
        var login = await JsonAsync(await LoginAsync(client, email));
        Assert.Equal("verify", login.GetProperty("twoFactor").GetString());
        Assert.False(login.TryGetProperty("token", out _));
        return login.GetProperty("challengeToken").GetString()!;
    }

    private async Task<HttpStatusCode> StatusWithAsync(string token, HttpMethod method, string path)
    {
        var client = Bearer(_host.CreateClient(), token);
        return (await client.SendAsync(new HttpRequestMessage(method, path))).StatusCode;
    }

    // ---- facts --------------------------------------------------------------------------

    [Fact]
    public async Task A_super_admin_must_enroll_and_the_enrolled_session_works()
    {
        var admin = await NewPersonAsync(Roles.SuperAdmin);
        var client = _host.CreateClient();

        var login = await JsonAsync(await LoginAsync(client, admin.Email));
        Assert.Equal("enroll", login.GetProperty("twoFactor").GetString());
        Assert.Equal(300, login.GetProperty("expiresInSeconds").GetInt32());
        Assert.False(login.TryGetProperty("token", out _));

        var enrolled = await EnrollAtSignInAsync(_host.CreateClient(), admin.Email);
        Assert.Equal(10, enrolled.RecoveryCodes.Distinct().Count());
        Assert.All(enrolled.RecoveryCodes, c => Assert.Matches("^[A-Z2-9]{5}-[A-Z2-9]{5}$", c));

        var status = await JsonAsync(await Bearer(_host.CreateClient(), enrolled.Token).GetAsync("/profile/two-factor"));
        Assert.True(status.GetProperty("available").GetBoolean());
        Assert.True(status.GetProperty("enabled").GetBoolean());
        Assert.True(status.GetProperty("required").GetBoolean());
        Assert.Equal(10, status.GetProperty("recoveryCodesRemaining").GetInt32());

        // Enrollment rotated the stamp: the session minted before it (at signup) is over.
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusWithAsync(admin.FirstToken, HttpMethod.Get, "/profile"));
        Assert.Equal(HttpStatusCode.OK, await StatusWithAsync(enrolled.Token, HttpMethod.Get, "/profile"));
    }

    [Fact]
    public async Task An_enrolled_super_admin_signs_in_with_a_code_that_cannot_be_replayed()
    {
        var admin = await NewPersonAsync(Roles.SuperAdmin);
        var enrolled = await EnrollAtSignInAsync(_host.CreateClient(), admin.Email);
        var client = _host.CreateClient();

        var code = NextCode(enrolled.Secret);
        var verify = await client.PostAsJsonAsync("/auth/two-factor/verify", new { challengeToken = await VerifyChallengeAsync(client, admin.Email), code });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        var body = await JsonAsync(verify);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("recoveryCodesRemaining").ValueKind);
        Assert.Equal(HttpStatusCode.OK, await StatusWithAsync(body.GetProperty("token").GetString()!, HttpMethod.Get, "/profile"));

        // The same code, on a fresh challenge, inside its own window: refused.
        var replay = await client.PostAsJsonAsync("/auth/two-factor/verify", new { challengeToken = await VerifyChallengeAsync(client, admin.Email), code });
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
    }

    [Fact]
    public async Task A_challenge_token_is_never_a_session()
    {
        var admin = await NewPersonAsync(Roles.SuperAdmin);
        var login = await JsonAsync(await LoginAsync(_host.CreateClient(), admin.Email));
        var challenge = login.GetProperty("challengeToken").GetString()!;

        Assert.Equal(HttpStatusCode.Unauthorized, await StatusWithAsync(challenge, HttpMethod.Post, "/auth/refresh"));
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusWithAsync(challenge, HttpMethod.Get, "/admin/exports/responses"));
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusWithAsync(challenge, HttpMethod.Get, "/profile"));
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusWithAsync(challenge, HttpMethod.Get, "/profile/two-factor"));
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusWithAsync(challenge, HttpMethod.Get, "/admin/companies"));

        // The second guard: even a token signed with the SESSION secret is refused when it carries
        // a challenge purpose -- for the day the two keys are ever made the same.
        string stamp;
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            stamp = (await db.Users.FirstAsync(u => u.Id == admin.Id)).SecurityStamp.ToString();
        }

        var forged = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            claims:
            [
                new Claim("sub", admin.Id.ToString()), new Claim("role", Roles.SuperAdmin),
                new Claim("companyId", _companyId.ToString()), new Claim("isActive", "true"),
                new Claim(TokenClaimNames.SecurityStamp, stamp),
                new Claim(TwoFactorChallengeTokens.PurposeClaim, TwoFactorChallengeTokens.Verify),
            ],
            expires: DateTime.UtcNow.AddMinutes(5),
            signingCredentials: new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(AuthWebApplicationFactory.TestJwtSecret)),
                SecurityAlgorithms.HmacSha256)));
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusWithAsync(forged, HttpMethod.Get, "/profile"));
    }

    [Fact]
    public async Task An_enroll_challenge_does_not_verify_and_a_verify_challenge_does_not_enroll()
    {
        var newcomer = await NewPersonAsync(Roles.SuperAdmin);
        var enrollChallenge = (await JsonAsync(await LoginAsync(_host.CreateClient(), newcomer.Email))).GetProperty("challengeToken").GetString();
        var asVerify = await _host.CreateClient().PostAsJsonAsync("/auth/two-factor/verify", new { challengeToken = enrollChallenge, code = "123456" });
        Assert.Equal(HttpStatusCode.Unauthorized, asVerify.StatusCode);

        var enrolledAdmin = await NewPersonAsync(Roles.SuperAdmin);
        await EnrollAtSignInAsync(_host.CreateClient(), enrolledAdmin.Email);
        var client = _host.CreateClient();
        var verifyChallenge = await VerifyChallengeAsync(client, enrolledAdmin.Email);
        var asEnroll = await client.PostAsJsonAsync("/auth/two-factor/enrollment/start", new { challengeToken = verifyChallenge });
        Assert.Equal(HttpStatusCode.Unauthorized, asEnroll.StatusCode);
    }

    [Fact]
    public async Task Google_sign_in_is_gated_for_a_super_admin()
    {
        var admin = await NewPersonAsync(Roles.SuperAdmin);

        var google = await _host.CreateClient().PostAsJsonAsync("/auth/google", new GoogleLoginRequest($"valid:{admin.Email}:Two Factor"));

        Assert.Equal(HttpStatusCode.OK, google.StatusCode);
        var body = await JsonAsync(google);
        Assert.Equal("enroll", body.GetProperty("twoFactor").GetString());
        Assert.False(body.TryGetProperty("token", out _));
    }

    [Fact]
    public async Task A_company_admin_turns_it_on_and_off_from_the_profile_and_each_change_ends_old_sessions()
    {
        var person = await NewPersonAsync(Roles.CompanyAdmin);
        var client = _host.CreateClient();

        // Optional: a company admin with no factor signs in with the password alone.
        var plain = await JsonAsync(await LoginAsync(client, person.Email));
        var sessionBefore = plain.GetProperty("token").GetString()!;
        var status = await JsonAsync(await Bearer(_host.CreateClient(), sessionBefore).GetAsync("/profile/two-factor"));
        Assert.True(status.GetProperty("available").GetBoolean());
        Assert.False(status.GetProperty("required").GetBoolean());
        Assert.False(status.GetProperty("enabled").GetBoolean());

        var enrolled = await EnrollFromProfileAsync(_host.CreateClient(), sessionBefore);
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusWithAsync(sessionBefore, HttpMethod.Get, "/profile"));
        Assert.Equal(HttpStatusCode.OK, await StatusWithAsync(enrolled.Token, HttpMethod.Get, "/profile"));

        // Now the sign-in asks for a code.
        await VerifyChallengeAsync(_host.CreateClient(), person.Email);

        var disable = await Bearer(_host.CreateClient(), enrolled.Token)
            .PostAsJsonAsync("/profile/two-factor/disable", new { code = NextCode(enrolled.Secret) });
        Assert.Equal(HttpStatusCode.OK, disable.StatusCode);
        var afterDisable = (await JsonAsync(disable)).GetProperty("token").GetString()!;
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusWithAsync(enrolled.Token, HttpMethod.Get, "/profile"));
        Assert.Equal(HttpStatusCode.OK, await StatusWithAsync(afterDisable, HttpMethod.Get, "/profile"));

        Assert.True((await JsonAsync(await LoginAsync(_host.CreateClient(), person.Email))).TryGetProperty("token", out _));
    }

    [Fact]
    public async Task A_super_admin_cannot_turn_their_own_off()
    {
        var admin = await NewPersonAsync(Roles.SuperAdmin);
        var enrolled = await EnrollAtSignInAsync(_host.CreateClient(), admin.Email);

        var disable = await Bearer(_host.CreateClient(), enrolled.Token)
            .PostAsJsonAsync("/profile/two-factor/disable", new { code = NextCode(enrolled.Secret) });

        Assert.Equal(HttpStatusCode.Forbidden, disable.StatusCode);
    }

    [Fact]
    public async Task Re_enrolling_takes_the_current_code()
    {
        var admin = await NewPersonAsync(Roles.SuperAdmin);
        var enrolled = await EnrollAtSignInAsync(_host.CreateClient(), admin.Email);
        var client = Bearer(_host.CreateClient(), enrolled.Token);

        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/profile/two-factor/start", new { currentCode = (string?)null })).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await client.PostAsJsonAsync("/profile/two-factor/start", new { currentCode = NextCode(enrolled.Secret) })).StatusCode);
    }

    [Fact]
    public async Task A_super_admin_reset_is_audited_and_ends_the_targets_sessions()
    {
        var operatorAdmin = await NewPersonAsync(Roles.SuperAdmin);
        var operatorSession = (await EnrollAtSignInAsync(_host.CreateClient(), operatorAdmin.Email)).Token;

        var target = await NewPersonAsync(Roles.CompanyAdmin);
        var targetLogin = (await JsonAsync(await LoginAsync(_host.CreateClient(), target.Email))).GetProperty("token").GetString()!;
        var targetEnrolled = await EnrollFromProfileAsync(_host.CreateClient(), targetLogin);

        var admin = Bearer(_host.CreateClient(), operatorSession);
        Assert.True((await JsonAsync(await admin.GetAsync($"/admin/users/{target.Id}/two-factor"))).GetProperty("enabled").GetBoolean());

        var reset = await admin.PostAsync($"/admin/users/{target.Id}/two-factor/reset", null);
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, await StatusWithAsync(targetEnrolled.Token, HttpMethod.Get, "/profile"));
        Assert.True((await JsonAsync(await LoginAsync(_host.CreateClient(), target.Email))).TryGetProperty("token", out _));
        Assert.False((await JsonAsync(await admin.GetAsync($"/admin/users/{target.Id}/two-factor"))).GetProperty("enabled").GetBoolean());

        var row = await AuditRowAsync("admin.users.two-factor.reset.create", target.Id.ToString());
        Assert.Equal(operatorAdmin.Id, row.UserId);
        Assert.Equal(_companyId, row.CompanyId);
        Assert.True(row.Success);
    }

    [Fact]
    public async Task Only_a_super_admin_may_reset_or_read_another_persons_factor()
    {
        var companyAdmin = await NewPersonAsync(Roles.CompanyAdmin);
        var session = (await JsonAsync(await LoginAsync(_host.CreateClient(), companyAdmin.Email))).GetProperty("token").GetString()!;
        var target = await NewPersonAsync(Roles.Employee);
        var client = Bearer(_host.CreateClient(), session);

        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync($"/admin/users/{target.Id}/two-factor/reset", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync($"/admin/users/{target.Id}/two-factor")).StatusCode);
    }

    [Fact]
    public async Task A_recovery_code_opens_once_and_is_audited()
    {
        var admin = await NewPersonAsync(Roles.SuperAdmin);
        var enrolled = await EnrollAtSignInAsync(_host.CreateClient(), admin.Email);
        var client = _host.CreateClient();
        var typed = enrolled.RecoveryCodes[4].ToLowerInvariant().Replace("-", " ", StringComparison.Ordinal);

        var first = await client.PostAsJsonAsync("/auth/two-factor/verify", new { challengeToken = await VerifyChallengeAsync(client, admin.Email), code = typed });
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(9, (await JsonAsync(first)).GetProperty("recoveryCodesRemaining").GetInt32());

        var second = await client.PostAsJsonAsync("/auth/two-factor/verify", new { challengeToken = await VerifyChallengeAsync(client, admin.Email), code = typed });
        Assert.Equal(HttpStatusCode.Unauthorized, second.StatusCode);

        var row = await AuditRowAsync(TwoFactorEndpoints.RecoveryCodeUsedAction, admin.Id.ToString());
        Assert.Equal(admin.Id, row.UserId);
        Assert.Equal(_companyId, row.CompanyId);
    }

    [Fact]
    public async Task Five_wrong_codes_lock_the_second_step()
    {
        var admin = await NewPersonAsync(Roles.SuperAdmin);
        var enrolled = await EnrollAtSignInAsync(_host.CreateClient(), admin.Email);
        var client = _host.CreateClient();
        var challenge = await VerifyChallengeAsync(client, admin.Email);
        var right = NextCode(enrolled.Secret);
        var wrong = right == "000000" ? "111111" : "000000";

        for (var i = 0; i < TwoFactorEndpoints.MaxFailedAttempts; i++)
        {
            Assert.Equal(HttpStatusCode.Unauthorized,
                (await client.PostAsJsonAsync("/auth/two-factor/verify", new { challengeToken = challenge, code = wrong })).StatusCode);
        }

        var locked = await client.PostAsJsonAsync("/auth/two-factor/verify", new { challengeToken = challenge, code = right });
        Assert.Equal(HttpStatusCode.Unauthorized, locked.StatusCode);
    }

    [Fact]
    public async Task The_second_step_is_rate_limited_like_sign_in()
    {
        var client = _host.CreateClient();
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i <= AuthWebApplicationFactory.AuthenticationPermitsPerMinuteForTests; i++)
        {
            statuses.Add((await client.PostAsJsonAsync("/auth/two-factor/verify", new { challengeToken = "x", code = "123456" })).StatusCode);
        }

        Assert.Equal(HttpStatusCode.Unauthorized, statuses[0]);
        Assert.Equal(HttpStatusCode.TooManyRequests, statuses[^1]);
    }

    [Fact]
    public async Task A_session_from_before_the_factor_was_required_does_not_refresh_into_a_super_admin()
    {
        // A company admin with no factor signs in with the password alone, then is promoted. A
        // role change rotates no stamp, and /auth/refresh re-mints the role off the row.
        var person = await NewPersonAsync(Roles.CompanyAdmin);
        var session = (await JsonAsync(await LoginAsync(_host.CreateClient(), person.Email))).GetProperty("token").GetString()!;
        Assert.Equal(HttpStatusCode.OK, await StatusWithAsync(session, HttpMethod.Post, "/auth/refresh"));

        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            (await db.Users.FirstAsync(u => u.Id == person.Id)).Role = Roles.SuperAdmin;
            await db.SaveChangesAsync();
        }

        var refresh = await Bearer(_host.CreateClient(), session).PostAsync("/auth/refresh", null);
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
        Assert.False((await JsonAsync(refresh)).TryGetProperty("token", out _));

        // Once enrolled, the session the enrollment hands back refreshes normally.
        var enrolled = await EnrollAtSignInAsync(_host.CreateClient(), person.Email);
        Assert.Equal(HttpStatusCode.OK, await StatusWithAsync(enrolled.Token, HttpMethod.Post, "/auth/refresh"));
    }

    [Fact]
    public async Task Two_requests_spending_the_same_code_cannot_both_save()
    {
        var admin = await NewPersonAsync(Roles.SuperAdmin);
        await EnrollAtSignInAsync(_host.CreateClient(), admin.Email);

        // Two contexts read the same rows, as two parallel verifies would, and both spend.
        using var scopeA = _host.Services.CreateScope();
        using var scopeB = _host.Services.CreateScope();
        using var scopeC = _host.Services.CreateScope();
        var dbC = scopeC.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var dbA = scopeA.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var dbB = scopeB.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        var factorA = await dbA.UserTwoFactors.FirstAsync(t => t.UserId == admin.Id);
        var factorB = await dbB.UserTwoFactors.FirstAsync(t => t.UserId == admin.Id);
        var codeA = await dbA.UserRecoveryCodes.OrderBy(c => c.Id).FirstAsync(c => c.UserId == admin.Id);
        var codeB = await dbC.UserRecoveryCodes.OrderBy(c => c.Id).FirstAsync(c => c.UserId == admin.Id);

        factorA.LastUsedStep = (factorA.LastUsedStep ?? 0) + 1;
        factorB.LastUsedStep = (factorB.LastUsedStep ?? 0) + 1;
        await dbA.SaveChangesAsync();
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => dbB.SaveChangesAsync());

        codeA.UsedAt = DateTimeOffset.UtcNow;
        codeB.UsedAt = DateTimeOffset.UtcNow;
        await dbA.SaveChangesAsync();
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => dbC.SaveChangesAsync());
    }

    private async Task<AuditLog> AuditRowAsync(string action, string resourceId)
    {
        for (var attempt = 0; attempt < 50; attempt++)
        {
            using var scope = _host.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var row = await db.AuditLogs.AsNoTracking()
                .Where(a => a.Action == action && a.ResourceId == resourceId)
                .OrderByDescending(a => a.Timestamp)
                .FirstOrDefaultAsync();
            if (row is not null)
            {
                return row;
            }

            await Task.Delay(100);
        }

        throw new Xunit.Sdk.XunitException($"No audit row {action} for {resourceId}.");
    }
}

/// <summary>The shared host has no <c>Auth:TotpEncryptionKey</c>: the feature is OFF and sign-in is unchanged.</summary>
[Collection("Postgres")]
public class TwoFactorFeatureOffTests(PostgresContainerFixture postgres) : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory = postgres.App;
    private readonly string _domain = $"twofactor-off-{Guid.NewGuid():N}.test";

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Companies.Add(new Company { Id = Guid.NewGuid(), Name = "2FA Off Co", EmailDomain = _domain, CreatedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task With_no_key_a_super_admin_signs_in_with_the_password_alone()
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_domain}";
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Off", email, "A-good-passw0rd"))).StatusCode);
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            (await db.Users.FirstAsync(u => u.Email == email)).Role = Roles.SuperAdmin;
            await db.SaveChangesAsync();
        }

        var login = JsonDocument.Parse(await (await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"))).Content.ReadAsStringAsync()).RootElement;
        Assert.False(login.TryGetProperty("twoFactor", out _));
        var token = login.GetProperty("token").GetString();

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var status = JsonDocument.Parse(await client.GetStringAsync("/profile/two-factor")).RootElement;
        Assert.False(status.GetProperty("available").GetBoolean());
        Assert.False(status.GetProperty("required").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/profile/two-factor/start", new { currentCode = (string?)null })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/auth/two-factor/verify", new { challengeToken = "x", code = "123456" })).StatusCode);
    }
}
