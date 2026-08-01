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

namespace ClimateProject.IntegrationTests.OrgStructure;

[Collection("Postgres")]
public class SystemSettingsEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _emailDomain = $"sysset-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public SystemSettingsEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        // Clean up any existing SystemSettings to ensure tests start fresh
        var existingSettings = await db.SystemSettings.ToListAsync();
        foreach (var setting in existingSettings)
        {
            db.SystemSettings.Remove(setting);
        }
        await db.SaveChangesAsync();

        var company = new Company { Id = Guid.NewGuid(), Name = "SysSet Co", EmailDomain = _emailDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = _companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    [Fact]
    public async Task Get_creates_a_default_row_the_first_time_its_called()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/admin/system-settings");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var settings = await response.Content.ReadFromJsonAsync<SystemSettingsDetail>();
        Assert.True(settings!.LoginEnabled);
        Assert.Equal(5, settings.MaxLoginAttempts);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Equal(1, await db.SystemSettings.CountAsync());
    }

    [Fact]
    public async Task NonSuperAdmin_cannot_read_or_update_system_settings()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var getResponse = await client.GetAsync("/admin/system-settings");
        Assert.Equal(HttpStatusCode.Forbidden, getResponse.StatusCode);

        var putResponse = await client.PutAsJsonAsync("/admin/system-settings", new UpdateSystemSettingsRequest(false, null, null, null, null, null, null));
        Assert.Equal(HttpStatusCode.Forbidden, putResponse.StatusCode);
    }

    [Fact]
    public async Task SuperAdmin_can_update_settings_and_the_change_persists()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        await client.GetAsync("/admin/system-settings");

        var updateResponse = await client.PutAsJsonAsync("/admin/system-settings", new UpdateSystemSettingsRequest(
            LoginEnabled: false,
            MaintenanceMode: true,
            MaintenanceMessage: "Down for maintenance",
            MaxLoginAttempts: 3,
            SessionTimeoutMinutes: 30,
            PasswordPolicy: null,
            EmailSettings: null));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<SystemSettingsDetail>();
        Assert.False(updated!.LoginEnabled);
        Assert.True(updated.MaintenanceMode);
        Assert.Equal("Down for maintenance", updated.MaintenanceMessage);
        Assert.Equal(3, updated.MaxLoginAttempts);

        var getAgain = await client.GetAsync("/admin/system-settings");
        var reread = await getAgain.Content.ReadFromJsonAsync<SystemSettingsDetail>();
        Assert.False(reread!.LoginEnabled);
    }
}
