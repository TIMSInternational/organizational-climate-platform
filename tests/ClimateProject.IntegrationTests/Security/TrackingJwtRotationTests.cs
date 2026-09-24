using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using ClimateProject.Api.Endpoints;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace ClimateProject.IntegrationTests.Security;

/// <summary>
/// One application host, configured the way a deployment mid-rotation is: the NEW
/// <c>TrackingJwtSecret</c> as current, the old one as <c>TrackingJwtSecretPrevious</c> (#70).
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a host of its own, and exactly one.</b> The configuration IS the experiment — the same
/// reason as the capturing-mail host — and it cannot be varied per request, because
/// <c>JwtBearerOptions</c> resolves this configuration once. It is static and lazy so that the
/// class costs the run a single host no matter how many <c>[Fact]</c>s it grows: xUnit constructs
/// the test class once per test case, and each host is billed against
/// <see cref="AuthWebApplicationFactory.HostBudget"/>.
/// </para>
/// </remarks>
public sealed class RotatingHostFixture : IDisposable
{
    /// <summary>The value this host validates with as CURRENT — nothing in the suite mints with it.</summary>
    public const string RotatedToSecret = "rotated-to-a-brand-new-tracking-jwt-secret-value-0123456789";

    private static readonly Lock Gate = new();
    private static WebApplicationFactory<Program>? _rotated;

    /// <summary>
    /// A client against the mid-rotation host: current = <see cref="RotatedToSecret"/>,
    /// previous = the secret the rest of the suite mints with.
    /// </summary>
    public HttpClient CreateClient(AuthWebApplicationFactory shared)
    {
        lock (Gate)
        {
            if (_rotated is null)
            {
                _rotated = shared.WithWebHostBuilder(builder =>
                    builder.ConfigureAppConfiguration((_, config) =>
                        config.AddInMemoryCollection(new Dictionary<string, string?>
                        {
                            ["TrackingJwtSecret"] = RotatedToSecret,
                            ["TrackingJwtSecretPrevious"] = AuthWebApplicationFactory.TestJwtSecret,
                        })));
            }
        }

        return _rotated.CreateClient();
    }

    public void Dispose()
    {
        // Deliberately does not dispose the host: it is static and shared for the assembly, and
        // xUnit disposes a class fixture per class. Same shape as CapturingMailHostFixture.
        GC.SuppressFinalize(this);
    }
}

/// <summary>
/// The rotation window for <c>TrackingJwtSecret</c>, end to end through this API's own bearer
/// handler (#70).
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this exists alongside <c>CrossServiceTokenTests</c> and <c>JwtSigningKeysTests</c>.</b>
/// Those prove the key SET is built correctly and that climate-tracking's parameters accept a
/// retired key. Neither says whether <i>this</i> service's <c>Program.cs</c> actually reads
/// <c>TrackingJwtSecretPrevious</c> and hands it to the handler. A misspelt configuration key
/// there would leave the window silently absent in production while every one of those tests
/// stayed green — the shape of a resolver that is written and never called.
/// </para>
/// <para>
/// That is measured, not assumed: mutating the key to <c>TrackingJwtSecretPrevius</c> keeps all
/// 10 unit tests and 21 of 22 cross-service tests passing, and is caught here alone.
/// </para>
/// <para>
/// <b>Scope, deliberately narrow.</b> Only the two properties that need a real host live here —
/// the window works, and it admits nothing else. "The window closes when the previous key is
/// removed" is a property of the key set, proven by <c>JwtSigningKeysTests</c> and by
/// <c>CrossServiceTokenTests</c> against a real minted token; asserting it here would cost the
/// run a second host to re-prove what those already show.
/// </para>
/// </remarks>
[Collection("Postgres")]
public class TrackingJwtRotationTests : IAsyncLifetime, IClassFixture<RotatingHostFixture>
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly RotatingHostFixture _rotating;
    private readonly string _emailDomain = $"jwtrotation-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public TrackingJwtRotationTests(PostgresContainerFixture postgres, RotatingHostFixture rotating)
    {
        _factory = postgres.App;
        _rotating = rotating;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Rotation Co",
            EmailDomain = _emailDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>A real token, minted over HTTP by the shared host — signed with the OLD secret.</summary>
    private async Task<string> TokenSignedWithTheOldSecretAsync()
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_emailDomain}";

        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Rotation User", email, "A-good-passw0rd"));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.CompanyId = _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    /// <summary>
    /// A well-formed token signed with a key that was never in service — a forger's token, not a
    /// retired one. Hand-built on purpose: the claims are irrelevant, the SIGNATURE is the test.
    /// </summary>
    private static string TokenSignedWithAnUnrelatedSecret()
    {
        const string neverOurs = "an-attackers-own-signing-key-that-was-never-ours-0123456789";
        var handler = new JsonWebTokenHandler();

        return handler.CreateToken(new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity([new Claim("sub", Guid.NewGuid().ToString())]),
            Expires = DateTime.UtcNow.AddHours(1),
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(neverOurs)),
                SecurityAlgorithms.HmacSha256),
        });
    }

    private async Task<HttpStatusCode> ProfileStatusOnRotatedHostAsync(string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/profile");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await _rotating.CreateClient(_factory).SendAsync(request);
        return response.StatusCode;
    }

    /// <summary>
    /// <b>The window, proven through this API's own handler.</b> A user signed in before the
    /// rotation is still signed in after it — which is the whole reason the rotation is now
    /// something anybody would be willing to perform.
    /// </summary>
    [Fact]
    public async Task A_session_from_before_the_rotation_survives_it()
    {
        var token = await TokenSignedWithTheOldSecretAsync();

        Assert.Equal(HttpStatusCode.OK, await ProfileStatusOnRotatedHostAsync(token));
    }

    /// <summary>
    /// And the widening is bounded: the window admits exactly the one retired key, not any key.
    /// Without this, "accepts the previous secret" and "accepts anything" would pass identically.
    /// </summary>
    [Fact]
    public async Task A_token_signed_with_a_secret_that_was_never_ours_is_still_refused()
    {
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            await ProfileStatusOnRotatedHostAsync(TokenSignedWithAnUnrelatedSecret()));
    }
}
