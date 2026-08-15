using System.Net;
using System.Net.Http.Headers;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Auth;

/// <summary>
/// The server-side half of #280: the API refuses a token that says the account is
/// deactivated, on every endpoint behind <c>RequireAuthorization()</c>.
/// </summary>
/// <remarks>
/// The user rows here are <c>IsActive = true</c> on purpose. Only the claim in the token
/// says otherwise, so the refusal can only come from the authorization policy reading it --
/// with that policy removed, <c>/auth/refresh</c> looks the account up, finds it active and
/// hands back a fresh token. Before this, the sole reader of that claim anywhere in the
/// product was <c>web/src/app/RequireAuth.tsx</c>, a client-side redirect.
/// </remarks>
[Collection("Postgres")]
public class DeactivatedTokenAuthorizationTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    // Unique per test-class instance -- xUnit builds a new instance per [Fact] and the
    // "Postgres" fixture shares one database, where companies.email_domain is unique.
    private readonly Company _company = new()
    {
        Id = Guid.NewGuid(),
        Name = "Acme",
        EmailDomain = $"acme-{Guid.NewGuid():N}.test",
        CreatedAt = DateTimeOffset.UtcNow,
    };
    private User _user = null!;

    public DeactivatedTokenAuthorizationTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Companies.Add(_company);
        _user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = _company.Id,
            Email = $"claims-user@{_company.EmailDomain}",
            Name = "Claims User",
            Role = "employee",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(_user);
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private string IssueToken(bool isActive)
    {
        using var scope = _factory.Services.CreateScope();
        var jwtTokenService = scope.ServiceProvider.GetRequiredService<IJwtTokenService>();
        return jwtTokenService.IssueToken(new TokenClaims(
            Sub: _user.Id.ToString(),
            Role: _user.Role,
            NodoId: null,
            Email: _user.Email,
            Name: _user.Name,
            CompanyId: _user.CompanyId?.ToString() ?? string.Empty,
            IsActive: isActive,
            // The seeded row's real stamp, so #284's revocation check passes and the only
            // thing that can refuse these tokens is the isActive claim this class is about.
            SecurityStamp: _user.SecurityStamp));
    }

    private HttpClient ClientWith(string token)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [Fact]
    public async Task A_token_claiming_the_account_is_deactivated_is_refused_by_the_api()
    {
        var client = ClientWith(IssueToken(isActive: false));

        var response = await client.PostAsync("/auth/refresh", content: null);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task The_same_request_with_an_active_token_is_allowed_through()
    {
        var client = ClientWith(IssueToken(isActive: true));

        var response = await client.PostAsync("/auth/refresh", content: null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
