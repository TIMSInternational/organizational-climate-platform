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
public class GoogleLoginEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;

    // EmailDomain must be unique per test-class instance: xUnit constructs a new
    // GoogleLoginEndpointTests (and re-runs InitializeAsync) for every [Fact], and the
    // "Postgres" collection fixture shares one live database across all of them, so a fixed
    // value here would collide with the companies.email_domain unique index. These tests used
    // to get away with fixed domains because /auth/google created the company itself, once,
    // for whichever [Fact] ran first -- the very behaviour #280 removed.
    private readonly Company _company = new()
    {
        Id = Guid.NewGuid(),
        Name = "Acme",
        EmailDomain = $"acme-{Guid.NewGuid():N}.test",
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private string Domain => _company.EmailDomain!;

    public GoogleLoginEndpointTests(PostgresContainerFixture postgres)
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

    [Fact]
    public async Task Google_login_with_valid_token_and_known_domain_creates_the_user_in_that_company()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest($"valid:first@{Domain}:First Person"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<TokenResponse>();
        Assert.False(string.IsNullOrEmpty(body!.Token));

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.SingleAsync(u => u.Email == $"first@{Domain}");
        Assert.Equal("employee", user.Role);
        Assert.Equal(_company.Id, user.CompanyId);
        Assert.Null(user.PasswordHash);
    }

    /// The behaviour this replaces (#280): an unseen domain used to get a Company minted for
    /// it and the caller became its first employee, which made /auth/google a self-service
    /// tenant factory for gmail.com. /auth/signup refuses exactly that, and the two paths
    /// now give the same refusal.
    [Fact]
    public async Task Google_login_with_an_unknown_domain_is_refused_exactly_as_signup_refuses_it()
    {
        var unknownDomain = $"nobody-{Guid.NewGuid():N}.test";
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest($"valid:someone@{unknownDomain}:Some One"));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.Equal(
            "No company found for this email domain. Please contact your administrator for an invitation.",
            body!.Message);

        // Nothing was provisioned on the way to the refusal.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.Companies.AnyAsync(c => c.EmailDomain == unknownDomain));
        Assert.False(await db.Users.AnyAsync(u => u.Email == $"someone@{unknownDomain}"));
    }

    [Fact]
    public async Task Google_login_with_an_unknown_domain_is_refused_with_the_same_status_and_message_as_signup()
    {
        var unknownDomain = $"nobody-{Guid.NewGuid():N}.test";
        var client = _factory.CreateClient();

        var google = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest($"valid:someone@{unknownDomain}:Some One"));
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Some One", $"someone@{unknownDomain}", "A-good-passw0rd"));

        Assert.Equal(signup.StatusCode, google.StatusCode);
        var googleBody = await google.Content.ReadFromJsonAsync<ErrorResponse>();
        var signupBody = await signup.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.Equal(signupBody!.Message, googleBody!.Message);
    }

    /// This used to assert `Companies.Count(c => c.EmailDomain == Domain) == 1`, which after
    /// #280 is unfalsifiable: /auth/google can no longer create a Company at all, so the count
    /// is 1 whatever the endpoint does -- it passed against the reverted code too. What is
    /// still gettable wrong is *which* company each caller is placed in, so assert that: two
    /// callers on the same domain both land in that domain's company, and not in some other
    /// tenant that happens to exist in the same database.
    [Fact]
    public async Task Google_login_places_every_caller_on_a_domain_in_that_domains_company()
    {
        var otherCompany = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Not Acme",
            EmailDomain = $"not-acme-{Guid.NewGuid():N}.test",
            CreatedAt = DateTimeOffset.UtcNow,
        };

        using (var seed = _factory.Services.CreateScope())
        {
            var seedDb = seed.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            seedDb.Companies.Add(otherCompany);
            await seedDb.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        var first = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest($"valid:one@{Domain}:One"));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var second = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest($"valid:two@{Domain}:Two"));
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var one = await db.Users.SingleAsync(u => u.Email == $"one@{Domain}");
        var two = await db.Users.SingleAsync(u => u.Email == $"two@{Domain}");

        Assert.Equal(_company.Id, one.CompanyId);
        Assert.Equal(_company.Id, two.CompanyId);
        Assert.NotEqual(otherCompany.Id, one.CompanyId);
    }

    [Fact]
    public async Task Google_login_for_existing_user_reuses_the_user_and_updates_last_login()
    {
        var client = _factory.CreateClient();
        var first = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest($"valid:repeat@{Domain}:Repeat"));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var second = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest($"valid:repeat@{Domain}:Repeat"));
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.SingleAsync(u => u.Email == $"repeat@{Domain}");
        Assert.NotNull(user.LastLoginAt);
    }

    /// #280: a deactivated employee holding a valid Google ID token for their work address
    /// was issued a fully working API JWT. Deactivation is how this product removes access,
    /// and the check has to be on the server -- the only thing that used to notice was a
    /// redirect in the SPA, which is no obstacle to calling the API directly.
    [Fact]
    public async Task Google_login_for_a_deactivated_user_issues_no_token()
    {
        var email = $"deactivated@{Domain}";
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.Users.Add(new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _company.Id,
                Email = email,
                Name = "Deactivated Person",
                Role = "employee",
                IsActive = false,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest($"valid:{email}:Deactivated Person"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<TokenResponse>();
        Assert.True(string.IsNullOrEmpty(body?.Token));

        // The sign-in left no trace: LastLoginAt is not stamped for an account that was
        // refused, which is also how you can tell the guard runs before the write.
        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await verifyDb.Users.SingleAsync(u => u.Email == email);
        Assert.Null(user.LastLoginAt);
        Assert.False(user.IsActive);
    }

    /// The refusal must not tell an unauthenticated caller that the address exists but is
    /// switched off -- same reason LoginAsync answers a deactivated account with the same
    /// "Invalid email or password" a wrong password gets.
    [Fact]
    public async Task Google_login_for_a_deactivated_user_is_indistinguishable_from_an_unverifiable_token()
    {
        var email = $"quiet@{Domain}";
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.Users.Add(new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _company.Id,
                Email = email,
                Name = "Quiet Person",
                Role = "employee",
                IsActive = false,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        var deactivated = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest($"valid:{email}:Quiet Person"));
        var unverifiable = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest("not-a-valid-token"));

        Assert.Equal(unverifiable.StatusCode, deactivated.StatusCode);
        var deactivatedBody = await deactivated.Content.ReadFromJsonAsync<ErrorResponse>();
        var unverifiableBody = await unverifiable.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.Equal(unverifiableBody!.Message, deactivatedBody!.Message);
    }

    [Fact]
    public async Task Google_login_with_invalid_token_returns_401()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest("not-a-valid-token"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Google_login_with_missing_id_token_returns_400_not_500()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/google", new { });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.Equal("Google ID token is required", body!.Message);
    }
}
