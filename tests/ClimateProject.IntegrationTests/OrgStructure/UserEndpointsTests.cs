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
public class UserEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"usera-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"userb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public UserEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "User Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "User Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(string Token, Guid UserId)> SignUpAndGetTokenAsync(HttpClient client, string role, string emailDomain, Guid companyId)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        var userId = user.Id;
        user.Role = role;
        user.CompanyId = companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        return (token, userId);
    }

    [Fact]
    public async Task CompanyAdmin_can_list_and_get_users_in_their_own_company()
    {
        var client = _factory.CreateClient();
        var (adminToken, _) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var (_, employeeId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var listResponse = await client.GetAsync($"/admin/users?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        var list = await listResponse.Content.ReadFromJsonAsync<UserListResponse>();
        Assert.Contains(list!.Users, u => u.Id == employeeId);

        var getResponse = await client.GetAsync($"/admin/users/{employeeId}");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_list_or_get_users_in_another_company()
    {
        var client = _factory.CreateClient();
        var (adminToken, _) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var (_, otherCompanyUserId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyBDomain, _companyBId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var listResponse = await client.GetAsync($"/admin/users?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.Forbidden, listResponse.StatusCode);

        var getResponse = await client.GetAsync($"/admin/users/{otherCompanyUserId}");
        Assert.Equal(HttpStatusCode.Forbidden, getResponse.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_can_update_a_user_but_cannot_change_role()
    {
        var client = _factory.CreateClient();
        var (adminToken, _) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var (_, employeeId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var updateResponse = await client.PutAsJsonAsync($"/admin/users/{employeeId}", new UpdateUserRequest("Renamed", null, null, false));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<UserDetail>();
        Assert.Equal("Renamed", updated!.Name);
        Assert.False(updated.IsActive);

        var roleResponse = await client.PutAsJsonAsync($"/admin/users/{employeeId}/role", new UpdateUserRoleRequest(Roles.CompanyAdmin));
        Assert.Equal(HttpStatusCode.Forbidden, roleResponse.StatusCode);
    }

    [Fact]
    public async Task SuperAdmin_can_change_a_users_role()
    {
        var client = _factory.CreateClient();
        var (superAdminToken, _) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, _companyAId);
        var (_, employeeId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyBDomain, _companyBId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        var roleResponse = await client.PutAsJsonAsync($"/admin/users/{employeeId}/role", new UpdateUserRoleRequest(Roles.Supervisor));
        Assert.Equal(HttpStatusCode.OK, roleResponse.StatusCode);
        var updated = await roleResponse.Content.ReadFromJsonAsync<UserDetail>();
        Assert.Equal(Roles.Supervisor, updated!.Role);
    }

    [Fact]
    public async Task Role_update_rejects_an_invalid_role_value()
    {
        var client = _factory.CreateClient();
        var (superAdminToken, _) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, _companyAId);
        var (_, employeeId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        var roleResponse = await client.PutAsJsonAsync($"/admin/users/{employeeId}/role", new UpdateUserRoleRequest("not_a_real_role"));
        Assert.Equal(HttpStatusCode.BadRequest, roleResponse.StatusCode);
    }
}
