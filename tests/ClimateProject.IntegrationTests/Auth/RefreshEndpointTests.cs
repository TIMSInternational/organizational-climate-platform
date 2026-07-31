using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Auth;

[Collection("Postgres")]
public class RefreshEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    // EmailDomain must be unique per test-class instance: xUnit constructs a new
    // RefreshEndpointTests (and re-runs InitializeAsync) for every [Fact], and the
    // "Postgres" collection fixture shares one live database across all of them,
    // so a fixed value here would collide with the companies.email_domain unique index.
    private readonly Company _company = new()
    {
        Id = Guid.NewGuid(),
        Name = "Acme",
        EmailDomain = $"acme-{Guid.NewGuid():N}.test",
        CreatedAt = DateTimeOffset.UtcNow,
    };
    private User _user = null!;
    private string _token = null!;

    public RefreshEndpointTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Companies.Add(_company);
        _user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = _company.Id,
            Email = $"refresh-user@{_company.EmailDomain}",
            Name = "Refresh User",
            PasswordHash = new ClimateProject.Infrastructure.Auth.BcryptPasswordHasher().Hash("password123"),
            Role = "employee",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(_user);
        await db.SaveChangesAsync();

        var client = _factory.CreateClient();
        var loginResponse = await client.PostAsJsonAsync("/auth/login", new LoginRequest(_user.Email, "password123"));
        var body = await loginResponse.Content.ReadFromJsonAsync<TokenResponse>();
        _token = body!.Token;
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Refresh_with_valid_token_returns_a_new_token()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _token);

        var response = await client.PostAsync("/auth/refresh", content: null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<TokenResponse>();
        Assert.False(string.IsNullOrEmpty(body!.Token));
    }

    [Fact]
    public async Task Refresh_without_a_token_returns_401()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsync("/auth/refresh", content: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Refresh_for_deactivated_user_returns_401_even_with_a_still_valid_old_token()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FindAsync(_user.Id);
            user!.IsActive = false;
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _token);

        var response = await client.PostAsync("/auth/refresh", content: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
