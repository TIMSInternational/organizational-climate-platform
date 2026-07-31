using System.Net;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Auth;

[Collection("Postgres")]
public class SignupEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    // EmailDomain must be unique per test-class instance: xUnit constructs a new
    // SignupEndpointTests (and re-runs InitializeAsync) for every [Fact], and the
    // "Postgres" collection fixture shares one live database across all of them,
    // so a fixed value here would collide with the companies.email_domain unique index.
    private readonly string _domain = $"acme-{Guid.NewGuid():N}.test";
    private Company _company = null!;

    public SignupEndpointTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        _company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Acme",
            EmailDomain = _domain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Companies.Add(_company);
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Signup_with_matching_company_domain_creates_employee_and_returns_201()
    {
        var client = _factory.CreateClient();
        var email = $"new-person@{_domain}";
        var response = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("New Person", email, "a-good-password"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<TokenResponse>();
        Assert.False(string.IsNullOrEmpty(body!.Token));

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.SingleAsync(u => u.Email == email);
        Assert.Equal("employee", user.Role);
        Assert.Equal(_company.Id, user.CompanyId);
    }

    [Fact]
    public async Task Signup_with_no_matching_company_domain_returns_404()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Nobody", "person@unknown-domain.test", "a-good-password"));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Signup_with_existing_email_returns_409()
    {
        var client = _factory.CreateClient();
        var email = $"dupe@{_domain}";
        var first = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("First", email, "a-good-password"));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var second = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Second", email, "another-password"));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Signup_with_short_password_returns_400()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Short Pw", $"short-pw@{_domain}", "short"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
