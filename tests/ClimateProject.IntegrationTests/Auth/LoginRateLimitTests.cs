using System.Net;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Auth;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Auth;

/// <summary>
/// Brute force against <c>POST /auth/login</c> (#146).
///
/// <para>
/// Run at the shipped limit rather than a lowered one, against the real endpoint and the
/// real database, precisely because the failure mode worth catching is a limit set so tight
/// that it also refuses legitimate traffic. Both halves are asserted: every one of the
/// permitted attempts is answered normally, and only the one past the limit is refused.
/// </para>
/// <para>
/// What this does NOT do is lock the account out. Per-account lockout across attempts from
/// many addresses needs state that survives a restart and is shared between instances, which
/// this service has nowhere to put -- see the note on
/// <see cref="RateLimitPolicies.Authentication"/>.
/// </para>
/// </summary>
[Collection("Postgres")]
public class LoginRateLimitTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;

    private readonly Company _company = new()
    {
        Id = Guid.NewGuid(),
        Name = "Acme",
        EmailDomain = $"acme-{Guid.NewGuid():N}.test",
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private readonly string _email = $"brute-{Guid.NewGuid():N}@acme.test";

    public LoginRateLimitTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Companies.Add(_company);
        db.Users.Add(new User
        {
            Id = Guid.NewGuid(),
            CompanyId = _company.Id,
            Email = _email,
            Name = "Brute Target",
            PasswordHash = new BcryptPasswordHasher().Hash("the-real-password"),
            Role = "employee",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Password_guessing_is_refused_once_it_passes_the_authentication_limit()
    {
        var client = _factory.CreateClient();

        for (var attempt = 0; attempt < RateLimitPolicies.AuthenticationPermitsPerWindow; attempt++)
        {
            var permitted = await client.PostAsJsonAsync(
                "/auth/login",
                new LoginRequest(_email, $"guess-{attempt}"));

            Assert.Equal(HttpStatusCode.Unauthorized, permitted.StatusCode);
        }

        var refused = await client.PostAsJsonAsync("/auth/login", new LoginRequest(_email, "guess-again"));

        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
        Assert.NotNull(refused.Headers.RetryAfter);
    }

    [Fact]
    public async Task A_correct_password_still_succeeds_after_a_run_of_ordinary_typos()
    {
        // The product half. A person who mistypes their password several times must not be
        // locked out, and neither must their colleagues behind the same office address --
        // which under TestServer is exactly what this is, since every request here shares one
        // partition key.
        var client = _factory.CreateClient();

        for (var attempt = 0; attempt < 5; attempt++)
        {
            await client.PostAsJsonAsync("/auth/login", new LoginRequest(_email, $"typo-{attempt}"));
        }

        var response = await client.PostAsJsonAsync("/auth/login", new LoginRequest(_email, "the-real-password"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
