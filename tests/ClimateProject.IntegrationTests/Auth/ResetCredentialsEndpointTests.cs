using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Auth;

[Collection("Postgres")]
public class ResetCredentialsEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly Company _company = new()
    {
        Id = Guid.NewGuid(),
        Name = "Acme",
        EmailDomain = $"acme-{Guid.NewGuid():N}.test",
        CreatedAt = DateTimeOffset.UtcNow,
    };
    private User _admin = null!;
    private User _employee = null!;
    private string _adminToken = null!;
    private string _employeeToken = null!;

    public ResetCredentialsEndpointTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        var hasher = new ClimateProject.Infrastructure.Auth.BcryptPasswordHasher();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.Companies.Add(_company);

            _admin = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _company.Id,
                Email = $"admin@{_company.EmailDomain}",
                Name = "Admin",
                PasswordHash = hasher.Hash("admin-password"),
                Role = "company_admin",
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            _employee = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _company.Id,
                Email = $"employee@{_company.EmailDomain}",
                Name = "Employee",
                PasswordHash = hasher.Hash("employee-password"),
                Role = "employee",
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Users.AddRange(_admin, _employee);
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        var adminLogin = await client.PostAsJsonAsync("/auth/login", new LoginRequest(_admin.Email, "admin-password"));
        _adminToken = (await adminLogin.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        var employeeLogin = await client.PostAsJsonAsync("/auth/login", new LoginRequest(_employee.Email, "employee-password"));
        _employeeToken = (await employeeLogin.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Admin_can_reset_another_users_credentials()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _adminToken);

        var response = await client.PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(_employee.Id));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ResetCredentialsResponse>();
        Assert.Equal(_employee.Email, body!.Email);
        Assert.False(string.IsNullOrEmpty(body.TemporaryPassword));

        var loginClient = _factory.CreateClient();
        var loginResponse = await loginClient.PostAsJsonAsync("/auth/login", new LoginRequest(_employee.Email, body.TemporaryPassword));
        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);
    }

    [Fact]
    public async Task Non_admin_cannot_reset_credentials()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _employeeToken);

        var response = await client.PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(_admin.Id));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Unauthenticated_request_returns_401()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(_employee.Id));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Reset_for_unknown_user_returns_404()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _adminToken);

        var response = await client.PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
