using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Notifications;

/// <summary>
/// The HTTP surface of the self-service preferences endpoint (#103).
///
/// The per-user authorization rule is proved structurally here: the route takes no user id,
/// so the only thing a caller can address is their own row. The tests below check the
/// consequence -- two users sharing a company see and write different preferences, and
/// neither can name the other.
/// </summary>
[Collection("Postgres")]
public class NotificationPreferenceEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _emailDomain = $"prefs-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public NotificationPreferenceEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Prefs Co",
            EmailDomain = _emailDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(string Token, Guid UserId)> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        _ = await signup.Content.ReadFromJsonAsync<TokenResponse>();

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        var userId = user.Id;
        user.Role = role;
        user.CompanyId = _companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        return (token, userId);
    }

    private static HttpClient Authenticated(HttpClient client, string token)
    {
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static StringContent Json(string body)
        => new(body, Encoding.UTF8, "application/json");

    [Fact]
    public async Task Requires_authentication()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/me/notification-preferences");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Returns_the_legacy_default_state_for_a_user_who_has_never_touched_them()
    {
        var client = _factory.CreateClient();
        var (token, _) = await SignUpAndGetTokenAsync(client, Roles.Employee);
        Authenticated(client, token);

        var response = await client.GetAsync("/me/notification-preferences");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var prefs = await response.Content.ReadFromJsonAsync<NotificationPreferencesResponse>();
        Assert.True(prefs!.EmailSurveys);
        Assert.True(prefs.EmailMicroclimates);
        Assert.True(prefs.EmailActionPlans);
        Assert.True(prefs.EmailReminders);
        Assert.Equal("weekly", prefs.DigestFrequency);
    }

    [Fact]
    public async Task Never_exposes_the_stored_push_preference()
    {
        var client = _factory.CreateClient();
        var (token, userId) = await SignUpAndGetTokenAsync(client, Roles.Employee);
        Authenticated(client, token);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Id == userId);
            user.Notifications.PushNotifications = true;
            await db.SaveChangesAsync();
        }

        var body = await (await client.GetAsync("/me/notification-preferences")).Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(body);
        var names = document.RootElement.EnumerateObject().Select(p => p.Name).ToArray();

        Assert.Equal(5, names.Length);
        Assert.DoesNotContain(names, n => n.Contains("push", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Persists_exactly_what_was_set_and_reads_it_back()
    {
        var client = _factory.CreateClient();
        var (token, _) = await SignUpAndGetTokenAsync(client, Roles.Employee);
        Authenticated(client, token);

        var update = await client.PutAsJsonAsync(
            "/me/notification-preferences",
            new UpdateNotificationPreferencesRequest(false, true, false, false, "never"));
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);

        var updated = await update.Content.ReadFromJsonAsync<NotificationPreferencesResponse>();
        Assert.False(updated!.EmailSurveys);
        Assert.True(updated.EmailMicroclimates);
        Assert.False(updated.EmailActionPlans);
        Assert.False(updated.EmailReminders);
        Assert.Equal("never", updated.DigestFrequency);

        var reread = await (await client.GetAsync("/me/notification-preferences"))
            .Content.ReadFromJsonAsync<NotificationPreferencesResponse>();
        Assert.Equal(updated, reread);
    }

    [Fact]
    public async Task Saving_does_not_disturb_the_stored_push_preference()
    {
        var client = _factory.CreateClient();
        var (token, userId) = await SignUpAndGetTokenAsync(client, Roles.Employee);
        Authenticated(client, token);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Id == userId);
            user.Notifications.PushNotifications = true;
            await db.SaveChangesAsync();
        }

        var update = await client.PutAsJsonAsync(
            "/me/notification-preferences",
            new UpdateNotificationPreferencesRequest(false, false, false, false, "daily"));
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.AsNoTracking().FirstAsync(u => u.Id == userId);
            Assert.True(user.Notifications.PushNotifications);
            Assert.False(user.Notifications.EmailSurveys);
            Assert.Equal("daily", user.Notifications.DigestFrequency);
        }
    }

    [Fact]
    public async Task An_omitted_flag_is_rejected_rather_than_read_as_an_opt_out()
    {
        var client = _factory.CreateClient();
        var (token, userId) = await SignUpAndGetTokenAsync(client, Roles.Employee);
        Authenticated(client, token);

        // emailSurveys is missing. With a non-nullable bool this would deserialize to false
        // and silently unsubscribe the user from survey mail.
        var response = await client.PutAsync(
            "/me/notification-preferences",
            Json("""
            {"emailMicroclimates":true,"emailActionPlans":true,"emailReminders":true,"digestFrequency":"weekly"}
            """));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.AsNoTracking().FirstAsync(u => u.Id == userId);
        Assert.True(user.Notifications.EmailSurveys);
    }

    [Fact]
    public async Task An_unknown_digest_frequency_is_rejected()
    {
        var client = _factory.CreateClient();
        var (token, _) = await SignUpAndGetTokenAsync(client, Roles.Employee);
        Authenticated(client, token);

        var response = await client.PutAsJsonAsync(
            "/me/notification-preferences",
            new UpdateNotificationPreferencesRequest(true, true, true, true, "yearly"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_company_admin_reads_and_writes_only_their_own_preferences()
    {
        // The per-user rule, not the per-company one the rest of the codebase uses: a
        // CompanyAdmin sharing a company with an employee still has no way to name that
        // employee's preferences, because the route carries no user id at all.
        var adminClient = _factory.CreateClient();
        var (adminToken, _) = await SignUpAndGetTokenAsync(adminClient, Roles.CompanyAdmin);
        Authenticated(adminClient, adminToken);

        var employeeClient = _factory.CreateClient();
        var (employeeToken, employeeId) = await SignUpAndGetTokenAsync(employeeClient, Roles.Employee);
        Authenticated(employeeClient, employeeToken);

        var employeeUpdate = await employeeClient.PutAsJsonAsync(
            "/me/notification-preferences",
            new UpdateNotificationPreferencesRequest(false, false, false, false, "never"));
        Assert.Equal(HttpStatusCode.OK, employeeUpdate.StatusCode);

        var adminPrefs = await (await adminClient.GetAsync("/me/notification-preferences"))
            .Content.ReadFromJsonAsync<NotificationPreferencesResponse>();
        Assert.True(adminPrefs!.EmailSurveys);
        Assert.Equal("weekly", adminPrefs.DigestFrequency);

        var adminUpdate = await adminClient.PutAsJsonAsync(
            "/me/notification-preferences",
            new UpdateNotificationPreferencesRequest(true, true, true, true, "daily"));
        Assert.Equal(HttpStatusCode.OK, adminUpdate.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var employee = await db.Users.AsNoTracking().FirstAsync(u => u.Id == employeeId);
        Assert.False(employee.Notifications.EmailSurveys);
        Assert.Equal("never", employee.Notifications.DigestFrequency);
    }

    [Fact]
    public async Task A_super_admin_with_no_company_still_has_preferences()
    {
        // User.CompanyId is Guid? since #191; NULL means global scope. Preferences are
        // per-person, so nothing here may depend on a tenant.
        var client = _factory.CreateClient();
        var (token, userId) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        Authenticated(client, token);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Id == userId);
            user.CompanyId = null;
            await db.SaveChangesAsync();
        }

        var update = await client.PutAsJsonAsync(
            "/me/notification-preferences",
            new UpdateNotificationPreferencesRequest(true, false, true, false, "monthly"));
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);

        var prefs = await (await client.GetAsync("/me/notification-preferences"))
            .Content.ReadFromJsonAsync<NotificationPreferencesResponse>();
        Assert.False(prefs!.EmailMicroclimates);
        Assert.Equal("monthly", prefs.DigestFrequency);
    }
}
