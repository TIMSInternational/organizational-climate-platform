using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Auth;

/// <summary>
/// The idle session timeout, end to end: <c>SystemSettings.SessionTimeoutMinutes</c> is the
/// lifetime of every token this API mints, and the 24-hour absolute ceiling survives
/// underneath it as a ceiling.
/// </summary>
/// <remarks>
/// <para>
/// Why this is an integration test and not only a unit test: <see cref="SessionWindows"/>
/// unit tests prove the arithmetic, and proved nothing about whether the number a super admin
/// edits ever reaches the mint. That was the whole defect — the setting existed, defaulted to
/// 60, was editable, and was enforced nowhere.
/// </para>
/// <para>
/// The settings row is written through <c>PUT /admin/system-settings</c>, the endpoint the
/// super admin screen calls, and restored to 60 in a <c>finally</c>: every class in the
/// "Postgres" collection shares one database and runs sequentially against it, so a timeout
/// left at a few minutes would shorten tokens for whatever class ran next.
/// </para>
/// </remarks>
[Collection("Postgres")]
public class IdleSessionTimeoutTests : IAsyncLifetime
{
    private const string Password = "A-good-passw0rd";

    private readonly AuthWebApplicationFactory _factory;
    private readonly string _emailDomain = $"idle-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public IdleSessionTimeoutTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Idle Co",
            EmailDomain = _emailDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(string Token, string Email)> SignUpAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_emailDomain}";
        await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, Password));

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = _companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, Password));
        return ((await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token, email);
    }

    private async Task SetSessionTimeoutAsync(int minutes)
    {
        var client = _factory.CreateClient();
        var (token, _) = await SignUpAsync(client, Roles.SuperAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PutAsJsonAsync("/admin/system-settings", new UpdateSystemSettingsRequest(
            LoginEnabled: null,
            MaintenanceMode: null,
            MaintenanceMessage: null,
            MaxLoginAttempts: null,
            SessionTimeoutMinutes: minutes,
            PasswordPolicy: null,
            EmailSettings: null));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static JwtSecurityToken Read(string token) => new JwtSecurityTokenHandler().ReadJwtToken(token);

    private static TimeSpan Lifetime(string token)
    {
        var jwt = Read(token);
        var iat = DateTimeOffset.FromUnixTimeSeconds(long.Parse(jwt.Claims.Single(c => c.Type == "iat").Value));
        return new DateTimeOffset(jwt.ValidTo, TimeSpan.Zero) - iat;
    }

    private static DateTimeOffset SessionStart(string token) => DateTimeOffset.FromUnixTimeSeconds(
        long.Parse(Read(token).Claims.Single(c => c.Type == TokenClaimNames.SessionStart).Value));

    [Fact]
    public async Task A_login_token_lives_exactly_as_long_as_the_configured_timeout()
    {
        await SetSessionTimeoutAsync(7);
        try
        {
            var client = _factory.CreateClient();
            var (token, _) = await SignUpAsync(client, Roles.Employee);

            // Within a second, because iat and exp are both whole epoch seconds and the mint
            // reads the clock twice.
            var lifetime = Lifetime(token);
            Assert.True(
                lifetime >= TimeSpan.FromMinutes(7) - TimeSpan.FromSeconds(2)
                    && lifetime <= TimeSpan.FromMinutes(7) + TimeSpan.FromSeconds(2),
                $"a 7-minute timeout minted a token that lives {lifetime}");
        }
        finally
        {
            await SetSessionTimeoutAsync(SessionWindows.DefaultIdleMinutes);
        }
    }

    [Fact]
    public async Task The_timeout_applies_to_an_employee_with_no_role_carve_out()
    {
        // Stated as its own test because the alternative design — a timeout for staff only —
        // was considered and rejected: a shared or kiosk terminal is exactly the respondent
        // case, and one mechanism with no role carve-outs is harder to get wrong.
        await SetSessionTimeoutAsync(5);
        try
        {
            var client = _factory.CreateClient();
            var (employee, _) = await SignUpAsync(client, Roles.Employee);
            var (superAdmin, _) = await SignUpAsync(client, Roles.SuperAdmin);

            Assert.True(Lifetime(employee) < TimeSpan.FromMinutes(6), $"employee token lived {Lifetime(employee)}");
            Assert.True(Lifetime(superAdmin) < TimeSpan.FromMinutes(6), $"super admin token lived {Lifetime(superAdmin)}");
        }
        finally
        {
            await SetSessionTimeoutAsync(SessionWindows.DefaultIdleMinutes);
        }
    }

    [Fact]
    public async Task A_refresh_slides_the_expiry_and_carries_the_session_start_forward()
    {
        var client = _factory.CreateClient();
        var (token, _) = await SignUpAsync(client, Roles.Employee);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await client.PostAsync("/auth/refresh", content: null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var refreshed = (await response.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        // The ceiling's anchor is unchanged — this is what stops a refreshed session living
        // forever — while the expiry has moved to now + the idle window.
        Assert.Equal(SessionStart(token).ToUnixTimeSeconds(), SessionStart(refreshed).ToUnixTimeSeconds());
        Assert.True(
            Read(refreshed).ValidTo >= Read(token).ValidTo,
            "a refresh did not move the expiry forward");
    }

    [Fact]
    public async Task A_refresh_is_refused_once_the_session_reaches_its_absolute_ceiling()
    {
        var client = _factory.CreateClient();
        var (_, email) = await SignUpAsync(client, Roles.Employee);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        var jwtTokenService = scope.ServiceProvider.GetRequiredService<IJwtTokenService>();

        // Signed by the production service, carrying the real security stamp, and NOT expired
        // — the only thing wrong with it is that its session began more than 24 hours ago.
        // That combination is unreachable through the endpoints (a sliding window never mints
        // past the ceiling), which is exactly why the token is built here: the test has to
        // present the state the ceiling exists to refuse.
        var now = DateTimeOffset.UtcNow;
        var pastCeiling = jwtTokenService.IssueToken(
            new TokenClaims(
                Sub: user.Id.ToString(),
                Role: user.Role,
                NodoId: null,
                Email: user.Email,
                Name: user.Name,
                CompanyId: user.CompanyId?.ToString() ?? string.Empty,
                IsActive: true,
                SecurityStamp: user.SecurityStamp),
            new SessionWindow(now - SessionWindows.AbsoluteCeiling - TimeSpan.FromMinutes(1), now.AddHours(1), now));

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", pastCeiling);
        var response = await client.PostAsync("/auth/refresh", content: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_token_still_in_its_ceiling_refreshes_normally()
    {
        // The control for the test above: same hand-built shape, same endpoint, a session
        // start 23 hours old instead of 24. Without it, a 401 from any cause at all would
        // read as the ceiling being enforced.
        var client = _factory.CreateClient();
        var (_, email) = await SignUpAsync(client, Roles.Employee);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        var jwtTokenService = scope.ServiceProvider.GetRequiredService<IJwtTokenService>();

        var now = DateTimeOffset.UtcNow;
        var insideCeiling = jwtTokenService.IssueToken(
            new TokenClaims(
                Sub: user.Id.ToString(),
                Role: user.Role,
                NodoId: null,
                Email: user.Email,
                Name: user.Name,
                CompanyId: user.CompanyId?.ToString() ?? string.Empty,
                IsActive: true,
                SecurityStamp: user.SecurityStamp),
            new SessionWindow(now.AddHours(-23), now.AddHours(1), now));

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", insideCeiling);
        var response = await client.PostAsync("/auth/refresh", content: null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        // And the token it hands back dies at the ceiling rather than a full idle window
        // later: 23 hours in, an hour is all that is left.
        var refreshed = (await response.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        Assert.True(
            Read(refreshed).ValidTo <= now.AddHours(1).UtcDateTime.AddSeconds(2),
            "the idle window was not truncated by the ceiling");
    }
}
