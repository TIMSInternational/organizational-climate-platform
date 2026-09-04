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
public class AuthFlowEndToEndTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _emailDomain = $"flowco-{Guid.NewGuid():N}.test";

    public AuthFlowEndToEndTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Companies.Add(new Company
        {
            Id = Guid.NewGuid(),
            Name = "Flow Co",
            EmailDomain = _emailDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Signup_then_login_then_refresh_then_role_protected_call_all_work_together()
    {
        var client = _factory.CreateClient();
        var email = $"flow-user@{_emailDomain}";

        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Flow User", email, "A-good-passw0rd"));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);
        var signupToken = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var loginToken = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", loginToken);
        var refresh = await client.PostAsync("/auth/refresh", content: null);
        Assert.Equal(HttpStatusCode.OK, refresh.StatusCode);
        var refreshedToken = (await refresh.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        // The signed-up user is role "employee" (not admin), so a role-protected
        // admin-only endpoint must reject it even with a valid, freshly-refreshed token.
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", refreshedToken);
        var forbidden = await client.PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        Assert.False(string.IsNullOrEmpty(signupToken));
    }
}
