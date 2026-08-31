using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Diagnostics;

/// <summary>
/// A request the caller got wrong must not be reported as the server falling over.
///
/// Minimal-API parameter binding throws <see cref="BadHttpRequestException"/> when a required
/// parameter is missing or unparseable, and that type carries its own status code. The global
/// handler in <c>Program.cs</c> knew only about <c>DbUpdateConcurrencyException</c> and
/// unique violations, so every binding failure fell through to
/// <c>500 "An unexpected error occurred."</c>
///
/// Found by calling <c>GET /admin/users</c> without <c>?companyId=</c> against a running API
/// while checking whether the frontend's screens were wired — the 500 read as a broken
/// endpoint and cost real time before the log showed a binding failure underneath.
///
/// The reason this is worth an integration test rather than a unit one: the behaviour is a
/// property of the assembled pipeline. Binding runs inside <c>EndpointMiddleware</c>, AFTER
/// authorization, so the exception can only be produced by a caller who is authenticated and
/// authorized and still got the query string wrong. Nothing below the pipeline can stage that.
///
/// It also matters operationally. #158's alarm pages on 5xx rate, so before this fix a stale
/// client or a hand-typed URL was indistinguishable from the service crashing.
/// </summary>
[Collection("Postgres")]
public class RequestBindingFailureTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _postgres;

    // Its own email domain and company row: the suite shares one Postgres and
    // `companies.email_domain` carries a filtered unique index.
    private readonly string _companyDomain = $"binding-{Guid.NewGuid():N}.test";

    private const string SignupPassword = "Sign4upPassword";

    public RequestBindingFailureTests(PostgresContainerFixture postgres) => _postgres = postgres;

    private AuthWebApplicationFactory Factory => _postgres.App;

    private ClimateProjectDbContext CreateContext() => new(
        new DbContextOptionsBuilder<ClimateProjectDbContext>().UseNpgsql(_postgres.ConnectionString).Options);

    public async Task InitializeAsync()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        db.Companies.Add(new Company
        {
            Id = Guid.NewGuid(),
            Name = "Binding Co",
            EmailDomain = _companyDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        });

        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>
    /// The status code. 400 is the whole point: 500 tells the caller the server broke, and
    /// tells the on-call alarm the same thing.
    /// </summary>
    [Fact]
    public async Task Missing_required_query_parameter_answers_400_not_500()
    {
        var client = await SignUpAsync(Roles.CompanyAdmin);

        // `/admin/users` declares `Guid companyId` from the query string, and the caller is
        // authenticated and authorized — binding is the only thing left to fail.
        var response = await client.GetAsync("/admin/users");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>
    /// The body. A separate guarantee from the status code, and separately losable: an arm
    /// that answered 400 with the handler's generic "An unexpected error occurred." would pass
    /// the test above and still leave the caller with no idea which parameter was missing.
    ///
    /// Asserts the parameter's NAME rather than the framework's exact sentence, which is not
    /// this repo's string to depend on.
    /// </summary>
    [Fact]
    public async Task Missing_required_query_parameter_names_the_parameter()
    {
        var client = await SignUpAsync(Roles.CompanyAdmin);

        var response = await client.GetAsync("/admin/users");
        var body = await response.Content.ReadAsStringAsync();

        Assert.Contains("companyId", body, StringComparison.Ordinal);
        Assert.DoesNotContain("An unexpected error occurred", body, StringComparison.Ordinal);
    }

    private async Task<HttpClient> SignUpAsync(string role)
    {
        var client = Factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";

        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Binding Person", email, SignupPassword));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        await using (var db = CreateContext())
        {
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            await db.SaveChangesAsync();
        }

        // Logged in after the role change so the token carries the new role.
        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, SignupPassword));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        return client;
    }
}
