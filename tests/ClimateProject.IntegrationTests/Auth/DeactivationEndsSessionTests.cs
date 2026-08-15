using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Auth;

/// <summary>
/// #286: deactivating a user ends the sessions they already hold.
/// </summary>
/// <remarks>
/// #280 stopped a deactivated account being issued a NEW token and #284 built the mechanism
/// that can kill an old one, but the two met nowhere: <c>PUT /admin/users/{id}</c> flipped
/// <c>is_active</c> and left <c>security_stamp</c> alone, so the offboarded employee's browser
/// kept working for up to the token's 24 hours. Every fact here is about that seam.
///
/// Tokens are obtained from <c>POST /auth/login</c> the way a real client obtains them, and
/// every assertion is a request to a real authenticated endpoint (<c>GET /profile</c>, which
/// any role may reach, so a 401 here can only be the revocation and never an authorisation
/// rule). Nothing on the path is a double: the endpoint, the JWT bearer handler with its
/// <c>OnTokenValidated</c> hook, <c>ClimateProjectDbContext</c>, <c>BcryptPasswordHasher</c>
/// and <c>JwtTokenService</c> are the production types against a real Postgres.
/// </remarks>
[Collection("Postgres")]
public class DeactivationEndsSessionTests : IAsyncLifetime
{
    private const string Password = "0ffboardingPass";

    private readonly AuthWebApplicationFactory _factory;

    // Unique per test-class instance: xUnit builds a new instance per [Fact] and the
    // "Postgres" fixture shares one database, where companies.email_domain is unique.
    private readonly Company _company = new()
    {
        Id = Guid.NewGuid(),
        Name = "Acme",
        EmailDomain = $"acme-{Guid.NewGuid():N}.test",
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private User _admin = null!;
    private User _employee = null!;
    private User _coworker = null!;

    public DeactivationEndsSessionTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        var hasher = new ClimateProject.Infrastructure.Auth.BcryptPasswordHasher();

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Companies.Add(_company);

        _admin = SeedUser(hasher, "admin", Roles.CompanyAdmin);
        _employee = SeedUser(hasher, "employee", Roles.Employee);
        _coworker = SeedUser(hasher, "coworker", Roles.Employee);
        db.Users.AddRange(_admin, _employee, _coworker);
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>
    /// The property the issue was filed for: the token the offboarded employee is holding
    /// right now stops working, rather than outliving their access by up to 24 hours.
    /// </summary>
    [Fact]
    public async Task A_token_minted_before_a_deactivation_is_refused_after_it()
    {
        var session = await LoginAsync(_employee.Email);

        // Live before the change, so the 401 below cannot be a token that never worked.
        Assert.Equal(HttpStatusCode.OK, (await ClientWith(session).GetAsync("/profile")).StatusCode);

        var adminSession = await LoginAsync(_admin.Email);
        Assert.Equal(HttpStatusCode.OK, (await SetActiveAsync(adminSession, _employee.Id, false)).StatusCode);

        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await ClientWith(session).GetAsync("/profile")).StatusCode);
    }

    /// <summary>
    /// <c>POST /auth/refresh</c> mints a fresh 24-hour token from a presented one, so a
    /// revocation that did not reach it would be undone by the client's next refresh.
    /// </summary>
    /// <remarks>
    /// The account is reactivated first, and that is the whole point of the fact rather than
    /// an odd detail. While the row is still inactive, refresh is refused by
    /// <c>IssueTokenForAsync</c>'s mint-time deactivation check (#280) whether the stamp
    /// rotated or not — a fact worded against THAT state passes with this change reverted and
    /// proves nothing. Reactivating removes the #280 guard, leaving the rotated stamp as the
    /// only thing between the pre-deactivation token and a fresh one. It is also a real
    /// sequence: an account disabled during an investigation and re-enabled afterwards is
    /// exactly where a token that was supposed to be dead would come back to life.
    /// </remarks>
    [Fact]
    public async Task A_revoked_token_cannot_be_refreshed_into_a_live_one_after_the_account_returns()
    {
        var session = await LoginAsync(_employee.Email);

        Assert.Equal(
            HttpStatusCode.OK,
            (await ClientWith(session).PostAsync("/auth/refresh", content: null)).StatusCode);

        var adminSession = await LoginAsync(_admin.Email);
        Assert.Equal(HttpStatusCode.OK, (await SetActiveAsync(adminSession, _employee.Id, false)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SetActiveAsync(adminSession, _employee.Id, true)).StatusCode);

        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await ClientWith(session).PostAsync("/auth/refresh", content: null)).StatusCode);
    }

    /// <summary>
    /// The rotation is per user, not per company and not global: deactivating one employee
    /// must not sign their colleagues -- or the administrator doing the deactivating -- out
    /// of the console mid-task.
    /// </summary>
    [Fact]
    public async Task Deactivating_one_user_leaves_every_other_session_alone()
    {
        var employeeSession = await LoginAsync(_employee.Email);
        var coworkerSession = await LoginAsync(_coworker.Email);
        var adminSession = await LoginAsync(_admin.Email);

        Assert.Equal(HttpStatusCode.OK, (await SetActiveAsync(adminSession, _employee.Id, false)).StatusCode);

        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await ClientWith(employeeSession).GetAsync("/profile")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ClientWith(coworkerSession).GetAsync("/profile")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ClientWith(adminSession).GetAsync("/profile")).StatusCode);
    }

    /// <summary>
    /// An edit that does not touch <c>isActive</c> is not a revocation. Renaming somebody, or
    /// moving them between departments, must not sign them out -- and this is the fact that
    /// stops the rotation being written unconditionally inside <c>UpdateAsync</c>.
    /// </summary>
    [Fact]
    public async Task An_update_that_does_not_touch_is_active_leaves_the_session_alive()
    {
        var session = await LoginAsync(_employee.Email);

        var rename = await ClientWith(await LoginAsync(_admin.Email)).PutAsJsonAsync(
            $"/admin/users/{_employee.Id}",
            new UpdateUserRequest("Renamed", null, null, null));
        Assert.Equal(HttpStatusCode.OK, rename.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await ClientWith(session).GetAsync("/profile")).StatusCode);
    }

    /// <summary>
    /// Saving an active user as active is not a deactivation, and this is the fact that makes
    /// the rotation conditional rather than "rotate whenever isActive is present".
    /// </summary>
    /// <remarks>
    /// The SPA's edit dialog sends <c>{ name, isActive }</c> on every save
    /// (<c>web/src/features/org-structure/pages/UsersListPage.tsx</c>), so <c>isActive: true</c>
    /// arrives on a user who is already active every time an administrator fixes a typo in
    /// somebody's name. Rotating there would sign that person out of their own session as a
    /// side effect of an edit they never saw -- a revocation with no deactivation behind it.
    /// </remarks>
    [Fact]
    public async Task Re_saving_an_active_user_as_active_does_not_sign_them_out()
    {
        var session = await LoginAsync(_employee.Email);

        var save = await ClientWith(await LoginAsync(_admin.Email)).PutAsJsonAsync(
            $"/admin/users/{_employee.Id}",
            new UpdateUserRequest("Renamed", null, null, true));
        Assert.Equal(HttpStatusCode.OK, save.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await ClientWith(session).GetAsync("/profile")).StatusCode);
    }

    /// <summary>
    /// Reactivating does not hand the old session back. The stamp the revoked token carries is
    /// gone for good, so an administrator who deactivates somebody by mistake and undoes it has
    /// still ended that account's open sessions -- the user signs in again, which is the
    /// correct and the safe outcome.
    /// </summary>
    /// <remarks>
    /// This is also what makes the true -> false condition safe to write as a condition rather
    /// than an unconditional rotate: reactivation needs no rotation of its own, because there
    /// is no live token left for it to revoke.
    /// </remarks>
    [Fact]
    public async Task Reactivating_does_not_revive_the_token_the_deactivation_killed()
    {
        var session = await LoginAsync(_employee.Email);
        Assert.Equal(HttpStatusCode.OK, (await ClientWith(session).GetAsync("/profile")).StatusCode);

        var adminSession = await LoginAsync(_admin.Email);
        Assert.Equal(HttpStatusCode.OK, (await SetActiveAsync(adminSession, _employee.Id, false)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SetActiveAsync(adminSession, _employee.Id, true)).StatusCode);

        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await ClientWith(session).GetAsync("/profile")).StatusCode);

        // And the account itself is genuinely usable again, so the assertion above is about the
        // dead token and not about an account that stayed locked out.
        var fresh = await LoginAsync(_employee.Email);
        Assert.Equal(HttpStatusCode.OK, (await ClientWith(fresh).GetAsync("/profile")).StatusCode);
    }

    /// <summary>
    /// Deactivating somebody who already reads as inactive still ends their sessions. The
    /// remediation an administrator reaches for on noticing that an offboarded person still
    /// has access is to deactivate them again, and it has to work.
    /// </summary>
    /// <remarks>
    /// The setup writes <c>is_active</c> straight to the row, which is the state this change
    /// deploys into rather than a contrivance: every account deactivated by the code before
    /// this fix had its column flipped and its stamp left alone, so on the day this ships
    /// those users' tokens are live and their rows already read inactive. A rotation keyed on
    /// the <c>true -&gt; false</c> transition sees no transition there, answers 200 and leaves
    /// the token working — which is why the endpoint keys on what the save ASKS FOR instead.
    ///
    /// The 200 in the middle is load-bearing: it establishes that the row being inactive is
    /// not by itself what refuses the token (nothing reads <c>is_active</c> per request), so
    /// the 401 at the end can only be the rotation this save performed.
    /// </remarks>
    [Fact]
    public async Task Deactivating_a_user_who_is_already_inactive_still_ends_their_session()
    {
        var session = await LoginAsync(_employee.Email);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            await db.Users
                .Where(u => u.Id == _employee.Id)
                .ExecuteUpdateAsync(set => set.SetProperty(u => u.IsActive, false));
        }

        Assert.Equal(HttpStatusCode.OK, (await ClientWith(session).GetAsync("/profile")).StatusCode);

        var adminSession = await LoginAsync(_admin.Email);
        Assert.Equal(HttpStatusCode.OK, (await SetActiveAsync(adminSession, _employee.Id, false)).StatusCode);

        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await ClientWith(session).GetAsync("/profile")).StatusCode);
    }

    // ------------------------------------------------------------------ helpers

    private User SeedUser(IPasswordHasher hasher, string localPart, string role) => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = _company.Id,
        Email = $"{localPart}@{_company.EmailDomain}",
        Name = localPart,
        PasswordHash = hasher.Hash(Password),
        Role = role,
        IsActive = true,
        CreatedAt = DateTimeOffset.UtcNow,
        UpdatedAt = DateTimeOffset.UtcNow,
    };

    private async Task<string> LoginAsync(string email)
    {
        var response = await _factory.CreateClient().PostAsJsonAsync(
            "/auth/login",
            new LoginRequest(email, Password));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    private Task<HttpResponseMessage> SetActiveAsync(string adminToken, Guid userId, bool isActive)
        => ClientWith(adminToken).PutAsJsonAsync(
            $"/admin/users/{userId}",
            new UpdateUserRequest(null, null, null, isActive));

    private HttpClient ClientWith(string token)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }
}
