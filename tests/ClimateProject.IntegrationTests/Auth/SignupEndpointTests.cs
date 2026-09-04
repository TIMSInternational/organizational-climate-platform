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
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
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
        var response = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("New Person", email, "A-good-passw0rd"));

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
        var response = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Nobody", "person@unknown-domain.test", "A-good-passw0rd"));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Signup_with_existing_email_returns_409()
    {
        var client = _factory.CreateClient();
        var email = $"dupe@{_domain}";
        var first = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("First", email, "A-good-passw0rd"));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var second = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Second", email, "An0ther-password"));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Signup_with_short_password_returns_400()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Short Pw", $"short-pw@{_domain}", "short"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>
    /// The whole configured policy, not MinLength alone. With no settings row the entity
    /// defaults apply (min 8, uppercase, lowercase, number), so a password that is long
    /// enough but has neither an uppercase letter nor a digit is refused, and the message
    /// names BOTH unmet rules -- the validator's every-rule-at-once contract, which proves
    /// this is the validator and not the old length check.
    /// </summary>
    [Fact]
    public async Task Signup_enforces_the_full_password_policy_not_only_the_minimum_length()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Weak Pw", $"weak-pw@{_domain}", "a-good-password"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.Contains("uppercase", body!.Message);
        Assert.Contains("number", body.Message);
        Assert.DoesNotContain("at least", body.Message); // length was fine; the length rule must not be named

        var accepted = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Strong Pw", $"strong-pw@{_domain}", "A-good-passw0rd"));
        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
    }

    [Fact]
    public async Task Signup_with_email_missing_at_sign_returns_400_not_500()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("No At Sign", "noatsign", "A-good-passw0rd"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.Equal("Invalid email format", body!.Message);
    }
}
