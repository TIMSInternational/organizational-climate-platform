using System.Net;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Auth;

[Collection("Postgres")]
public class GoogleLoginEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;

    public GoogleLoginEndpointTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public Task InitializeAsync() => _factory.ApplyMigrationsAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Google_login_with_valid_token_and_new_domain_creates_company_and_user()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest("valid:first@newdomain.test:First Person"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<TokenResponse>();
        Assert.False(string.IsNullOrEmpty(body!.Token));

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = await db.Companies.SingleAsync(c => c.EmailDomain == "newdomain.test");
        var user = await db.Users.SingleAsync(u => u.Email == "first@newdomain.test");
        Assert.Equal("employee", user.Role);
        Assert.Equal(company.Id, user.CompanyId);
        Assert.Null(user.PasswordHash);
    }

    [Fact]
    public async Task Google_login_with_existing_domain_reuses_the_company()
    {
        var client = _factory.CreateClient();
        var first = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest("valid:one@shared.test:One"));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var second = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest("valid:two@shared.test:Two"));
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyCount = await db.Companies.CountAsync(c => c.EmailDomain == "shared.test");
        Assert.Equal(1, companyCount);
    }

    [Fact]
    public async Task Google_login_for_existing_user_reuses_the_user_and_updates_last_login()
    {
        var client = _factory.CreateClient();
        var first = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest("valid:repeat@shared2.test:Repeat"));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var second = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest("valid:repeat@shared2.test:Repeat"));
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var userCount = await db.Users.CountAsync(u => u.Email == "repeat@shared2.test");
        Assert.Equal(1, userCount);
    }

    [Fact]
    public async Task Google_login_with_invalid_token_returns_401()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/google", new GoogleLoginRequest("not-a-valid-token"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
