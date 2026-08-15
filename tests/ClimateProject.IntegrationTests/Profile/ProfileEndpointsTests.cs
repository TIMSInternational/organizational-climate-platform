using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Profile;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Profile;

/// <summary>
/// <c>/profile</c> (#136): the caller's own account, and nobody else's.
///
/// The authorization rule under test here is **self-service**, not the company scoping used
/// almost everywhere else in this codebase. The tests that matter most are therefore the
/// negative ones: a second user -- including a CompanyAdmin and a SuperAdmin in the same
/// tenant -- must not be able to read or write the first user's profile, password,
/// preferences or activity through this group.
/// </summary>
[Collection("Postgres")]
public class ProfileEndpointsTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _postgres;

    // Its own email domain and its own company rows: the suite shares one Postgres and
    // `companies.email_domain` carries a filtered unique index.
    private readonly string _companyDomain = $"profile-{Guid.NewGuid():N}.test";

    private Guid _companyId;
    private Guid _departmentId;

    public ProfileEndpointsTests(PostgresContainerFixture postgres) => _postgres = postgres;

    /// <summary>The collection's one application host -- see PostgresContainerFixture and #279.</summary>
    private AuthWebApplicationFactory Factory => _postgres.App;

    private ClimateProjectDbContext CreateContext() => new(
        new DbContextOptionsBuilder<ClimateProjectDbContext>().UseNpgsql(_postgres.ConnectionString).Options);

    public async Task InitializeAsync()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Profile Co",
            EmailDomain = _companyDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);

        var department = new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Name = "Engineering",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Departments.Add(department);

        _companyId = company.Id;
        _departmentId = department.Id;
        await db.SaveChangesAsync();
    }

    // Nothing to dispose: the host belongs to the collection fixture (#279).
    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>
    /// Satisfies the shipped <c>PasswordPolicy</c> defaults (min 8, upper, lower, digit), so
    /// every account here can actually change its password.
    /// </summary>
    private const string SignupPassword = "Sign4upPassword";

    private async Task<(HttpClient Client, Guid UserId, string Email)> SignUpAsync(
        string role = Roles.Employee,
        string password = SignupPassword)
    {
        var client = Factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";

        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test Person", email, password));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        Guid userId;
        await using (var db = CreateContext())
        {
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.DepartmentId = _departmentId;
            await db.SaveChangesAsync();
            userId = user.Id;
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, password));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        return (client, userId, email);
    }

    private async Task WithDbAsync(Func<ClimateProjectDbContext, Task> action)
    {
        await using var db = CreateContext();
        await action(db);
    }

    // ---------------------------------------------------------------- read / update

    [Fact]
    public async Task An_employee_can_read_their_own_profile()
    {
        var (client, userId, email) = await SignUpAsync();

        var response = await client.GetAsync("/profile");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var profile = (await response.Content.ReadFromJsonAsync<ProfileResponse>())!;
        Assert.Equal(userId, profile.Id);
        Assert.Equal(email, profile.Email);
        Assert.Equal(Roles.Employee, profile.Role);
        Assert.Equal(_companyId, profile.CompanyId);
        Assert.Equal("Profile Co", profile.CompanyName);
        Assert.Equal("Engineering", profile.DepartmentName);
        Assert.True(profile.HasPassword);
    }

    /// <summary>
    /// "Page reachable by every role, including plain employees" -- asserted for all five,
    /// because the failure mode this guards against is somebody later "tidying" the group
    /// behind an admin check like almost every other group in this codebase has.
    /// </summary>
    [Theory]
    [InlineData(Roles.Employee)]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Leader)]
    [InlineData(Roles.CompanyAdmin)]
    [InlineData(Roles.SuperAdmin)]
    public async Task Every_role_can_reach_every_route(string role)
    {
        var (client, _, _) = await SignUpAsync(role);

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/profile")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/profile/activity")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/profile/preferences")).StatusCode);

        var update = await client.PutAsJsonAsync("/profile", new UpdateProfileRequest($"Renamed {role}"));
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);

        var preferences = await client.PutAsJsonAsync(
            "/profile/preferences",
            new UpdateProfilePreferencesRequest(Language: "es"));
        Assert.Equal(HttpStatusCode.OK, preferences.StatusCode);
    }

    [Fact]
    public async Task Anonymous_callers_are_rejected()
    {
        var client = Factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/profile")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/profile/activity")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/profile/preferences")).StatusCode);
    }

    [Fact]
    public async Task Updating_the_name_persists_and_is_echoed_back()
    {
        var (client, userId, _) = await SignUpAsync();

        var response = await client.PutAsJsonAsync("/profile", new UpdateProfileRequest("  Renamed Person  "));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Renamed Person", (await response.Content.ReadFromJsonAsync<ProfileResponse>())!.Name);

        await WithDbAsync(async db =>
            Assert.Equal("Renamed Person", (await db.Users.FirstAsync(u => u.Id == userId)).Name));
    }

    [Fact]
    public async Task A_blank_name_is_rejected_rather_than_silently_ignored()
    {
        var (client, userId, _) = await SignUpAsync();

        var response = await client.PutAsJsonAsync("/profile", new UpdateProfileRequest("   "));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await WithDbAsync(async db =>
            Assert.Equal("Test Person", (await db.Users.FirstAsync(u => u.Id == userId)).Name));
    }

    /// <summary>
    /// Role, email and activation are administrator-owned facts. The request record has no
    /// field for any of them, so there is nothing to bind even if a client sends them --
    /// asserted by posting them anyway.
    /// </summary>
    [Fact]
    public async Task A_user_cannot_promote_themselves_through_their_own_profile()
    {
        var (client, userId, email) = await SignUpAsync();

        var response = await client.PutAsJsonAsync("/profile", new
        {
            name = "Still An Employee",
            role = Roles.SuperAdmin,
            email = $"hijack-{Guid.NewGuid():N}@{_companyDomain}",
            isActive = false,
            companyId = Guid.NewGuid(),
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Id == userId);
            Assert.Equal(Roles.Employee, user.Role);
            Assert.Equal(email, user.Email);
            Assert.True(user.IsActive);
            Assert.Equal(_companyId, user.CompanyId);
            Assert.Equal("Still An Employee", user.Name);
        });

        Assert.DoesNotContain(
            typeof(UpdateProfileRequest).GetProperties(),
            p => p.Name is "Role" or "Email" or "IsActive" or "CompanyId");
    }

    // ---------------------------------------------------------------- isolation

    /// <summary>
    /// **The criterion this issue calls easy to get wrong.**
    ///
    /// There is no user id anywhere in this route group, so the only way to "reach another
    /// user's profile" is to be handed one -- and that is exactly what is checked here, from
    /// both ends: two accounts in one company, each seeing only itself, with the second one a
    /// CompanyAdmin and then a SuperAdmin, the two roles that CAN read the other's row
    /// through <c>/admin/users/{id}</c>. Elevated privilege buys nothing here.
    /// </summary>
    [Theory]
    [InlineData(Roles.CompanyAdmin)]
    [InlineData(Roles.SuperAdmin)]
    public async Task No_other_user_can_be_reached_from_this_group(string otherRole)
    {
        var (victimClient, victimId, victimEmail) = await SignUpAsync();
        await victimClient.PutAsJsonAsync("/profile", new UpdateProfileRequest("Victim Name"));

        var (attackerClient, attackerId, attackerEmail) = await SignUpAsync(otherRole);

        // Every id-shaped smuggling route a client has: path, query, and body.
        foreach (var url in new[]
                 {
                     $"/profile?userId={victimId}",
                     $"/profile?id={victimId}",
                     $"/profile/{victimId}",
                 })
        {
            var probe = await attackerClient.GetAsync(url);
            if (probe.StatusCode == HttpStatusCode.OK)
            {
                // A 200 is only acceptable if the route ignored the id and answered with the
                // caller's own row. A 404 (no such route) is the other acceptable answer.
                var leaked = (await probe.Content.ReadFromJsonAsync<ProfileResponse>())!;
                Assert.Equal(attackerId, leaked.Id);
                Assert.Equal(attackerEmail, leaked.Email);
            }
            else
            {
                Assert.Equal(HttpStatusCode.NotFound, probe.StatusCode);
            }
        }

        var write = await attackerClient.PutAsJsonAsync("/profile", new
        {
            userId = victimId,
            id = victimId,
            name = "Renamed By Someone Else",
        });
        Assert.Equal(HttpStatusCode.OK, write.StatusCode);

        var preferences = await attackerClient.PutAsJsonAsync("/profile/preferences", new
        {
            userId = victimId,
            language = "es",
        });
        Assert.Equal(HttpStatusCode.OK, preferences.StatusCode);

        // Nothing the attacker did touched the victim.
        await WithDbAsync(async db =>
        {
            var victim = await db.Users.FirstAsync(u => u.Id == victimId);
            Assert.Equal("Victim Name", victim.Name);
            Assert.Equal(victimEmail, victim.Email);
            Assert.Equal("en", victim.Preferences.Language);

            var attacker = await db.Users.FirstAsync(u => u.Id == attackerId);
            Assert.Equal("Renamed By Someone Else", attacker.Name);
            Assert.Equal("es", attacker.Preferences.Language);
        });

        // And the victim still sees only themselves.
        var victimProfile = (await (await victimClient.GetAsync("/profile")).Content
            .ReadFromJsonAsync<ProfileResponse>())!;
        Assert.Equal(victimId, victimProfile.Id);
    }

    [Fact]
    public async Task One_users_activity_is_never_visible_to_another()
    {
        var (victimClient, victimId, _) = await SignUpAsync();
        await victimClient.PutAsJsonAsync("/profile", new UpdateProfileRequest("Victim Name"));

        var (adminClient, _, _) = await SignUpAsync(Roles.CompanyAdmin);
        await adminClient.PutAsJsonAsync("/profile", new UpdateProfileRequest("Admin Name"));

        var victimEntries = (await (await victimClient.GetAsync("/profile/activity")).Content
            .ReadFromJsonAsync<ProfileActivityResponse>())!.Activity;
        var adminEntries = (await (await adminClient.GetAsync("/profile/activity")).Content
            .ReadFromJsonAsync<ProfileActivityResponse>())!.Activity;

        Assert.NotEmpty(victimEntries);
        Assert.NotEmpty(adminEntries);

        // Same company, same action, disjoint histories.
        Assert.All(victimEntries, entry => Assert.Equal(victimId.ToString(), entry.ResourceId));
        Assert.DoesNotContain(adminEntries, entry => entry.ResourceId == victimId.ToString());
    }

    /// <summary>
    /// **The collision the whole authorization argument turns on.**
    ///
    /// <c>persona_external_id</c> is a free-form 64-character string, so nothing stops one
    /// from being a Guid in canonical form -- and #154's ETL is the feature that will start
    /// filling the column from legacy ids. Here the attacker's <c>PersonaExternalId</c> is
    /// set to the victim's <c>Id</c>, which is exactly what the attacker's <c>sub</c> is then
    /// minted from (<c>PersonaExternalId ?? Id</c>, AuthEndpoints).
    ///
    /// A resolver that tries <c>Id</c> first hands the attacker's token the victim's row and
    /// every route in the group follows: read, rename, preferences, password change. Trying
    /// <c>PersonaExternalId</c> first is unambiguous, because that is the order the claim was
    /// minted in.
    ///
    /// Note this is a *self-inflicted* misresolution as much as an attack -- the victim here
    /// need not be complicit and the attacker need not be malicious; the ETL alone can create
    /// the collision. Either way the wrong row is written.
    /// </summary>
    [Fact]
    public async Task A_guid_shaped_external_id_never_resolves_to_the_user_whose_id_it_matches()
    {
        var (victimClient, victimId, victimEmail) = await SignUpAsync();
        await victimClient.PutAsJsonAsync("/profile", new UpdateProfileRequest("Victim Name"));

        // A second account whose legacy external id happens to be the victim's row id.
        var attackerClient = Factory.CreateClient();
        var attackerEmail = $"{Guid.NewGuid():N}@{_companyDomain}";
        Assert.Equal(
            HttpStatusCode.Created,
            (await attackerClient.PostAsJsonAsync(
                "/auth/signup",
                new SignupRequest("Collider", attackerEmail, SignupPassword))).StatusCode);

        Guid attackerId;
        await using (var db = CreateContext())
        {
            var attacker = await db.Users.FirstAsync(u => u.Email == attackerEmail);
            attacker.PersonaExternalId = victimId.ToString();
            await db.SaveChangesAsync();
            attackerId = attacker.Id;
        }

        Assert.NotEqual(attackerId, victimId);

        var login = await attackerClient.PostAsJsonAsync(
            "/auth/login",
            new LoginRequest(attackerEmail, SignupPassword));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        attackerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // Read resolves to the collider, not to the row whose id their sub happens to spell.
        var read = (await (await attackerClient.GetAsync("/profile")).Content
            .ReadFromJsonAsync<ProfileResponse>())!;
        Assert.Equal(attackerId, read.Id);
        Assert.Equal(attackerEmail, read.Email);

        // ...and so does every write.
        Assert.Equal(
            HttpStatusCode.OK,
            (await attackerClient.PutAsJsonAsync("/profile", new UpdateProfileRequest("Collider Renamed"))).StatusCode);
        Assert.Equal(
            HttpStatusCode.OK,
            (await attackerClient.PutAsJsonAsync(
                "/profile/preferences",
                new UpdateProfilePreferencesRequest(Language: "es"))).StatusCode);
        var passwordChange = await attackerClient.PutAsJsonAsync(
            "/profile/password",
            new ChangePasswordRequest(SignupPassword, "Rep1acementPass"));
        Assert.Equal(HttpStatusCode.OK, passwordChange.StatusCode);

        // The change revoked the token this client is holding (#284). The replacement it
        // handed back is minted from the same resolved row, so carrying on with it keeps the
        // rest of this test asking the question it was written to ask -- which row the
        // collider's sub lands on -- rather than a 401.
        attackerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            (await passwordChange.Content.ReadFromJsonAsync<TokenResponse>())!.Token);

        await WithDbAsync(async db =>
        {
            var victim = await db.Users.FirstAsync(u => u.Id == victimId);
            Assert.Equal("Victim Name", victim.Name);
            Assert.Equal(victimEmail, victim.Email);
            Assert.Equal("en", victim.Preferences.Language);

            var attacker = await db.Users.FirstAsync(u => u.Id == attackerId);
            Assert.Equal("Collider Renamed", attacker.Name);
            Assert.Equal("es", attacker.Preferences.Language);
        });

        // The victim's password is the one that still works; the collider's is the one that
        // changed. A misresolved password change would invert both of these.
        var anonymous = Factory.CreateClient();
        Assert.Equal(
            HttpStatusCode.OK,
            (await anonymous.PostAsJsonAsync("/auth/login", new LoginRequest(victimEmail, SignupPassword))).StatusCode);
        Assert.Equal(
            HttpStatusCode.OK,
            (await anonymous.PostAsJsonAsync("/auth/login", new LoginRequest(attackerEmail, "Rep1acementPass"))).StatusCode);

        // And the activity the collider generated is filed against the collider.
        var entries = (await (await attackerClient.GetAsync("/profile/activity")).Content
            .ReadFromJsonAsync<ProfileActivityResponse>())!.Activity;
        Assert.NotEmpty(entries);
        Assert.All(entries, entry => Assert.Equal(attackerId.ToString(), entry.ResourceId));
    }

    /// <summary>
    /// A global super_admin (#191) has no company row, and <c>audit_logs.company_id</c> is
    /// NOT NULL with a restricting FK to <c>companies</c> -- so <c>AddActivity</c> skips them
    /// rather than inventing an attribution or widening the column (which would collide with
    /// another branch's outstanding migration).
    ///
    /// The consequence is deliberate but invisible, so it is pinned here: their edits must
    /// still succeed, and their activity list is empty rather than 500. Without this test the
    /// decision could be reversed -- in either direction -- without anything noticing.
    /// </summary>
    [Fact]
    public async Task A_company_less_user_can_still_edit_but_has_no_activity()
    {
        var (client, userId, _) = await SignUpAsync(Roles.SuperAdmin);

        await WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Id == userId);
            user.CompanyId = null;
            user.DepartmentId = null;
            await db.SaveChangesAsync();
        });

        var renamed = await client.PutAsJsonAsync("/profile", new UpdateProfileRequest("Global Admin"));
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        var profile = (await renamed.Content.ReadFromJsonAsync<ProfileResponse>())!;
        Assert.Null(profile.CompanyId);
        Assert.Null(profile.CompanyName);
        Assert.Equal("Global Admin", profile.Name);

        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PutAsJsonAsync(
                "/profile/preferences",
                new UpdateProfilePreferencesRequest(Theme: "dark"))).StatusCode);

        // The rename and the preferences save both landed...
        await WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Id == userId);
            Assert.Equal("Global Admin", user.Name);
            Assert.Equal("dark", user.Preferences.Theme);
            Assert.Empty(await db.AuditLogs.Where(a => a.UserId == userId).ToListAsync());
        });

        // ...and the activity endpoint answers, empty, rather than failing.
        var activity = await client.GetAsync("/profile/activity");
        Assert.Equal(HttpStatusCode.OK, activity.StatusCode);
        Assert.Empty((await activity.Content.ReadFromJsonAsync<ProfileActivityResponse>())!.Activity);
    }

    // ---------------------------------------------------------------- password

    [Fact]
    public async Task Changing_the_password_requires_the_current_one()
    {
        var (client, userId, email) = await SignUpAsync();

        var wrong = await client.PutAsJsonAsync(
            "/profile/password",
            new ChangePasswordRequest("not-the-current-password", "Rep1acement!"));

        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);

        // The stored hash is untouched: the old password still logs in, the new one does not.
        var anonymous = Factory.CreateClient();
        Assert.Equal(
            HttpStatusCode.OK,
            (await anonymous.PostAsJsonAsync("/auth/login", new LoginRequest(email, SignupPassword))).StatusCode);
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await anonymous.PostAsJsonAsync("/auth/login", new LoginRequest(email, "Rep1acement!"))).StatusCode);

        await WithDbAsync(async db =>
        {
            // ...and the failed attempt is on the record.
            var failures = await db.AuditLogs
                .Where(a => a.UserId == userId && a.Action == ProfileAuditActions.PasswordChange && !a.Success)
                .CountAsync();
            Assert.Equal(1, failures);
        });
    }

    [Fact]
    public async Task Changing_the_password_with_the_current_one_succeeds_and_the_new_password_logs_in()
    {
        var (client, _, email) = await SignUpAsync();
        const string NewPassword = "Rep1acementPass";

        var response = await client.PutAsJsonAsync(
            "/profile/password",
            new ChangePasswordRequest(SignupPassword, NewPassword));

        // 200 with a replacement token since #284: the change rotates the caller's security
        // stamp, which ends the session they sent this request on, so the route hands back a
        // session minted after the rotation. SecurityStampRevocationTests covers what that
        // token is worth; here it is only the status that moved.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var anonymous = Factory.CreateClient();
        Assert.Equal(
            HttpStatusCode.OK,
            (await anonymous.PostAsJsonAsync("/auth/login", new LoginRequest(email, NewPassword))).StatusCode);
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await anonymous.PostAsJsonAsync("/auth/login", new LoginRequest(email, SignupPassword))).StatusCode);
    }

    /// <summary>
    /// A password change is not an admin reset. It never returns a password -- unlike
    /// <c>POST /auth/admin/reset-credentials</c>, which returns the temporary password it
    /// generated.
    /// </summary>
    /// <remarks>
    /// The body stopped being empty in #284: it carries the replacement token, because the
    /// change revokes the caller's own session along with every other. So "empty body" is no
    /// longer the assertion. What is asserted instead is the property that mattered -- the
    /// only field present is the token, and neither password appears anywhere in the
    /// response text.
    /// </remarks>
    [Fact]
    public async Task The_response_never_carries_a_password()
    {
        var (client, _, _) = await SignUpAsync();

        var response = await client.PutAsJsonAsync(
            "/profile/password",
            new ChangePasswordRequest(SignupPassword, "Rep1acementPass"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var text = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain(SignupPassword, text, StringComparison.Ordinal);
        Assert.DoesNotContain("Rep1acementPass", text, StringComparison.Ordinal);

        using var body = JsonDocument.Parse(text);
        Assert.Equal(
            ["token"],
            body.RootElement.EnumerateObject().Select(p => p.Name).ToArray());
    }

    /// <summary>
    /// A CompanyAdmin can reset another user's credentials through the admin route -- that is
    /// the intended administrative path and stays open. What must not exist is a second door
    /// on <c>/profile/password</c> that skips the current-password proof.
    /// </summary>
    [Fact]
    public async Task An_admin_cannot_change_someone_elses_password_through_this_route()
    {
        var (_, victimId, victimEmail) = await SignUpAsync();
        var (adminClient, _, _) = await SignUpAsync(Roles.CompanyAdmin);

        var attempt = await adminClient.PutAsJsonAsync("/profile/password", new
        {
            userId = victimId,
            currentPassword = SignupPassword,
            newPassword = "Adm1nChosenPass",
        });

        // 200 -- the admin changed their OWN password, because that is the only row this
        // route can address. The victim's is untouched. (204 until #284 gave the route a
        // replacement token to hand back.)
        Assert.Equal(HttpStatusCode.OK, attempt.StatusCode);

        var anonymous = Factory.CreateClient();
        Assert.Equal(
            HttpStatusCode.OK,
            (await anonymous.PostAsJsonAsync("/auth/login", new LoginRequest(victimEmail, SignupPassword))).StatusCode);
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await anonymous.PostAsJsonAsync("/auth/login", new LoginRequest(victimEmail, "Adm1nChosenPass"))).StatusCode);
    }

    [Fact]
    public async Task A_new_password_that_fails_the_configured_policy_is_rejected()
    {
        var (client, _, email) = await SignUpAsync();

        var response = await client.PutAsJsonAsync(
            "/profile/password",
            new ChangePasswordRequest(SignupPassword, "short"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var anonymous = Factory.CreateClient();
        Assert.Equal(
            HttpStatusCode.OK,
            (await anonymous.PostAsJsonAsync("/auth/login", new LoginRequest(email, SignupPassword))).StatusCode);
    }

    [Fact]
    public async Task Reusing_the_current_password_is_rejected()
    {
        var (client, _, _) = await SignUpAsync();

        var response = await client.PutAsJsonAsync(
            "/profile/password",
            new ChangePasswordRequest(SignupPassword, SignupPassword));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_account_with_no_password_is_told_so_rather_than_having_one_set()
    {
        var (client, userId, _) = await SignUpAsync();
        await WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Id == userId);
            user.PasswordHash = null;
            await db.SaveChangesAsync();
        });

        var response = await client.PutAsJsonAsync(
            "/profile/password",
            new ChangePasswordRequest(SignupPassword, "Rep1acementPass"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await WithDbAsync(async db =>
            Assert.Null((await db.Users.FirstAsync(u => u.Id == userId)).PasswordHash));

        var profile = (await (await client.GetAsync("/profile")).Content.ReadFromJsonAsync<ProfileResponse>())!;
        Assert.False(profile.HasPassword);
    }

    // ---------------------------------------------------------------- activity

    [Fact]
    public async Task Activity_records_the_caller_own_events_most_recent_first()
    {
        var (client, userId, _) = await SignUpAsync();

        await client.PutAsJsonAsync("/profile", new UpdateProfileRequest("First Rename"));
        await client.PutAsJsonAsync("/profile/preferences", new UpdateProfilePreferencesRequest(Theme: "dark"));

        var passwordChange = await client.PutAsJsonAsync(
            "/profile/password",
            new ChangePasswordRequest(SignupPassword, "Rep1acementPass"));

        // The change ended the session this client was holding (#284), so the rest of the
        // test carries on with the replacement token the route handed back. Without this the
        // GET below is a 401 -- which is the mechanism working, not a flake.
        Assert.Equal(HttpStatusCode.OK, passwordChange.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            (await passwordChange.Content.ReadFromJsonAsync<TokenResponse>())!.Token);

        var response = await client.GetAsync("/profile/activity");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var activity = (await response.Content.ReadFromJsonAsync<ProfileActivityResponse>())!.Activity;

        Assert.Contains(activity, e => e.Action == ProfileAuditActions.Update);
        Assert.Contains(activity, e => e.Action == ProfileAuditActions.PreferencesUpdate);
        Assert.Contains(activity, e => e.Action == ProfileAuditActions.PasswordChange && e.Success);
        Assert.All(activity, e => Assert.Equal(ProfileAuditActions.Resource, e.Resource));
        Assert.All(activity, e => Assert.Equal(userId.ToString(), e.ResourceId));

        var timestamps = activity.Select(e => e.Timestamp).ToList();
        Assert.Equal(timestamps.OrderByDescending(t => t).ToList(), timestamps);
    }

    [Fact]
    public async Task Activity_honours_a_limit_and_caps_it()
    {
        var (client, _, _) = await SignUpAsync();

        for (var i = 0; i < 5; i++)
        {
            await client.PutAsJsonAsync("/profile", new UpdateProfileRequest($"Rename {i}"));
        }

        var limited = (await (await client.GetAsync("/profile/activity?limit=2")).Content
            .ReadFromJsonAsync<ProfileActivityResponse>())!.Activity;
        Assert.Equal(2, limited.Count);

        // Out-of-range values are clamped, not rejected, and never unbounded.
        var absurd = (await (await client.GetAsync("/profile/activity?limit=100000")).Content
            .ReadFromJsonAsync<ProfileActivityResponse>())!.Activity;
        Assert.Equal(5, absurd.Count);

        var zero = (await (await client.GetAsync("/profile/activity?limit=0")).Content
            .ReadFromJsonAsync<ProfileActivityResponse>())!.Activity;
        Assert.Single(zero);
    }

    // ---------------------------------------------------------------- preferences

    [Fact]
    public async Task Preferences_read_back_both_halves_of_the_one_store()
    {
        var (client, _, _) = await SignUpAsync();

        var preferences = (await (await client.GetAsync("/profile/preferences")).Content
            .ReadFromJsonAsync<ProfilePreferencesResponse>())!;

        Assert.Equal("en", preferences.Display.Language);
        Assert.Equal("UTC", preferences.Display.Timezone);
        Assert.Equal("light", preferences.Display.Theme);
        Assert.Equal("default", preferences.Display.DashboardLayout);
        Assert.True(preferences.Notifications.EmailSurveys);
        Assert.Equal("weekly", preferences.Notifications.DigestFrequency);
    }

    [Fact]
    public async Task Display_preferences_persist()
    {
        var (client, userId, _) = await SignUpAsync();

        var response = await client.PutAsJsonAsync(
            "/profile/preferences",
            new UpdateProfilePreferencesRequest(Language: "es", Timezone: "America/Bogota", Theme: "dark"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<ProfilePreferencesResponse>())!;
        Assert.Equal("es", body.Display.Language);
        Assert.Equal("America/Bogota", body.Display.Timezone);
        Assert.Equal("dark", body.Display.Theme);

        await WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Id == userId);
            Assert.Equal("es", user.Preferences.Language);
            Assert.Equal("America/Bogota", user.Preferences.Timezone);
            Assert.Equal("dark", user.Preferences.Theme);
        });
    }

    /// <summary>
    /// **The single-store criterion, end to end.** A notification preference written through
    /// <c>/profile/preferences</c> is read back by <c>/notifications/preferences</c>, and vice
    /// versa. Two stores would pass every other test in this file and fail this one.
    /// </summary>
    [Fact]
    public async Task Notification_preferences_written_here_are_the_ones_the_notifications_route_reads()
    {
        var (client, _, _) = await SignUpAsync();

        var viaProfile = await client.PutAsJsonAsync(
            "/profile/preferences",
            new UpdateProfilePreferencesRequest(
                Notifications: new UpdateNotificationPreferencesRequest(EmailSurveys: false, DigestFrequency: "never")));
        Assert.Equal(HttpStatusCode.OK, viaProfile.StatusCode);

        var viaNotifications = (await (await client.GetAsync("/notifications/preferences")).Content
            .ReadFromJsonAsync<NotificationPreferencesResponse>())!;
        Assert.False(viaNotifications.EmailSurveys);
        Assert.Equal("never", viaNotifications.DigestFrequency);

        // ...and back the other way.
        await client.PutAsJsonAsync(
            "/notifications/preferences",
            new UpdateNotificationPreferencesRequest(EmailSurveys: true, DigestFrequency: "daily"));

        var backViaProfile = (await (await client.GetAsync("/profile/preferences")).Content
            .ReadFromJsonAsync<ProfilePreferencesResponse>())!;
        Assert.True(backViaProfile.Notifications.EmailSurveys);
        Assert.Equal("daily", backViaProfile.Notifications.DigestFrequency);
    }

    /// <summary>
    /// A display-only save must not disturb consent state. The four email flags are opt-outs
    /// real users exercise; a page that saves its theme and silently re-subscribes them would
    /// be the worst kind of regression, because nothing would report it.
    /// </summary>
    [Fact]
    public async Task Saving_the_display_half_leaves_the_notification_half_exactly_as_stored()
    {
        var (client, userId, _) = await SignUpAsync();

        await client.PutAsJsonAsync(
            "/notifications/preferences",
            new UpdateNotificationPreferencesRequest(
                EmailSurveys: false,
                EmailMicroclimates: false,
                EmailActionPlans: false,
                EmailReminders: false,
                DigestFrequency: "never"));

        DateTimeOffset? consentStampedAt = null;
        await WithDbAsync(async db =>
            consentStampedAt = (await db.Users.FirstAsync(u => u.Id == userId)).ConsentUpdatedAt);
        Assert.NotNull(consentStampedAt);

        var response = await client.PutAsJsonAsync(
            "/profile/preferences",
            new UpdateProfilePreferencesRequest(Theme: "dark"));

        var body = (await response.Content.ReadFromJsonAsync<ProfilePreferencesResponse>())!;
        Assert.False(body.Notifications.EmailSurveys);
        Assert.False(body.Notifications.EmailReminders);
        Assert.Equal("never", body.Notifications.DigestFrequency);

        await WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Id == userId);
            Assert.False(user.Notifications.EmailSurveys);
            // A display-only save is not a consent event, so the stamp does not move.
            Assert.Equal(consentStampedAt, user.ConsentUpdatedAt);
        });
    }

    [Fact]
    public async Task A_rejected_preferences_request_writes_neither_half()
    {
        var (client, userId, _) = await SignUpAsync();

        var response = await client.PutAsJsonAsync(
            "/profile/preferences",
            new UpdateProfilePreferencesRequest(
                Language: "es",
                Notifications: new UpdateNotificationPreferencesRequest(EmailSurveys: false, DigestFrequency: "hourly")));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        await WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Id == userId);
            Assert.Equal("en", user.Preferences.Language);
            Assert.True(user.Notifications.EmailSurveys);
            Assert.Equal("weekly", user.Notifications.DigestFrequency);
        });
    }

    [Theory]
    [InlineData("language", "de")]
    [InlineData("language", "both")]
    [InlineData("theme", "solarized")]
    [InlineData("timezone", "Mars/Olympus_Mons")]
    public async Task An_invalid_display_preference_is_rejected(string field, string value)
    {
        var (client, _, _) = await SignUpAsync();

        var response = await client.PutAsJsonAsync(
            "/profile/preferences",
            new Dictionary<string, string> { [field] = value });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>
    /// Push is stored (consent fidelity) and exposed by neither route. Asserted on the wire,
    /// not just on the record shape, because a serializer setting could reintroduce it.
    /// </summary>
    [Fact]
    public async Task The_preferences_payload_never_mentions_push()
    {
        var (client, _, _) = await SignUpAsync();

        var body = await (await client.GetAsync("/profile/preferences")).Content.ReadAsStringAsync();

        Assert.DoesNotContain("push", body, StringComparison.OrdinalIgnoreCase);
    }
}
