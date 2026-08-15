using System.Net;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Auth;

[Collection("Postgres")]
public class LoginEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    // EmailDomain must be unique per test-class instance: xUnit constructs a new
    // LoginEndpointTests (and re-runs InitializeAsync) for every [Fact], and the
    // "Postgres" collection fixture shares one live database across all of them,
    // so a fixed value here would collide with the companies.email_domain unique index.
    private readonly Company _company = new()
    {
        Id = Guid.NewGuid(),
        Name = "Acme",
        EmailDomain = $"acme-{Guid.NewGuid():N}.test",
        CreatedAt = DateTimeOffset.UtcNow,
    };

    public LoginEndpointTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Companies.Add(_company);
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<User> SeedUserAsync(string email, string? passwordHash, bool isActive = true)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = _company.Id,
            Email = email,
            Name = "Test User",
            PasswordHash = passwordHash,
            Role = "employee",
            IsActive = isActive,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    [Fact]
    public async Task Login_with_correct_credentials_returns_200_and_a_token()
    {
        var hasher = new ClimateProject.Infrastructure.Auth.BcryptPasswordHasher();
        await SeedUserAsync("valid-login@acme.test", hasher.Hash("correct-password"));

        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/login", new LoginRequest("valid-login@acme.test", "correct-password"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<TokenResponse>();
        Assert.False(string.IsNullOrEmpty(body!.Token));
    }

    [Fact]
    public async Task Login_with_wrong_password_returns_401()
    {
        var hasher = new ClimateProject.Infrastructure.Auth.BcryptPasswordHasher();
        await SeedUserAsync("wrong-pw@acme.test", hasher.Hash("correct-password"));

        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/login", new LoginRequest("wrong-pw@acme.test", "not-the-password"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Login_with_unknown_email_returns_401()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/login", new LoginRequest("nobody@acme.test", "whatever"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Login_for_inactive_user_returns_401()
    {
        var hasher = new ClimateProject.Infrastructure.Auth.BcryptPasswordHasher();
        await SeedUserAsync("inactive@acme.test", hasher.Hash("correct-password"), isActive: false);

        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/login", new LoginRequest("inactive@acme.test", "correct-password"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Login_for_oauth_only_user_returns_401_with_specific_message()
    {
        await SeedUserAsync("oauth-only@acme.test", passwordHash: null);

        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/login", new LoginRequest("oauth-only@acme.test", "anything"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.Equal("This account uses Google sign-in", body!.Message);
    }

    [Fact]
    public async Task Login_with_missing_email_and_password_returns_400_not_500()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/login", new { });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.Equal("Email and password are required", body!.Message);
    }
}
