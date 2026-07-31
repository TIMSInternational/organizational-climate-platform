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
public class DepartmentEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"depta-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"deptb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public DepartmentEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "Dept Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Dept Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, string emailDomain, Guid? companyId = null)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        if (role != Roles.Employee)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            if (companyId.HasValue)
            {
                user.CompanyId = companyId.Value;
            }
            await db.SaveChangesAsync();

            var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
            token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        }

        return token;
    }

    [Fact]
    public async Task CompanyAdmin_can_create_and_list_departments_in_their_own_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyAId, Name: "Engineering", Description: null, ParentDepartmentId: null, IsActive: true));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<DepartmentDetail>();
        Assert.Equal("Engineering", created!.Name);

        var listResponse = await client.GetAsync($"/admin/departments?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        var list = await listResponse.Content.ReadFromJsonAsync<DepartmentListResponse>();
        Assert.Contains(list!.Departments, d => d.Id == created.Id);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_list_or_create_departments_in_another_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var listResponse = await client.GetAsync($"/admin/departments?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.Forbidden, listResponse.StatusCode);

        var createResponse = await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyBId, Name: "Sales", Description: null, ParentDepartmentId: null, IsActive: true));
        Assert.Equal(HttpStatusCode.Forbidden, createResponse.StatusCode);
    }

    [Fact]
    public async Task SuperAdmin_can_manage_departments_in_any_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyBId, Name: "Marketing", Description: null, ParentDepartmentId: null, IsActive: true));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);

        var listResponse = await client.GetAsync($"/admin/departments?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_duplicate_name_at_the_same_level()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyAId, Name: "HR", Description: null, ParentDepartmentId: null, IsActive: true));

        var duplicate = await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyAId, Name: "HR", Description: null, ParentDepartmentId: null, IsActive: true));

        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_duplicate_name_that_only_differs_by_whitespace()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var created = await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyAId, Name: "HR", Description: null, ParentDepartmentId: null, IsActive: true));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        var duplicate = await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyAId, Name: " HR", Description: null, ParentDepartmentId: null, IsActive: true));

        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);
    }

    [Fact]
    public async Task Update_persists_name_description_and_isActive_changes()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyAId, Name: "Finance", Description: "Original description", ParentDepartmentId: null, IsActive: true));
        var created = await createResponse.Content.ReadFromJsonAsync<DepartmentDetail>();

        var updateResponse = await client.PutAsJsonAsync($"/admin/departments/{created!.Id}", new UpdateDepartmentRequest(
            Name: "Finance & Accounting", Description: "Updated description", IsActive: false));

        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<DepartmentDetail>();
        Assert.Equal("Finance & Accounting", updated!.Name);
        Assert.Equal("Updated description", updated.Description);
        Assert.False(updated.IsActive);

        var getResponse = await client.GetAsync($"/admin/departments/{created.Id}");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var persisted = await getResponse.Content.ReadFromJsonAsync<DepartmentDetail>();
        Assert.Equal("Finance & Accounting", persisted!.Name);
        Assert.Equal("Updated description", persisted.Description);
        Assert.False(persisted.IsActive);
    }

    [Fact]
    public async Task Create_rejects_a_parent_department_from_a_different_company()
    {
        var client = _factory.CreateClient();
        var superAdminToken = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        var parentInB = await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyBId, Name: "Parent In B", Description: null, ParentDepartmentId: null, IsActive: true));
        var parent = await parentInB.Content.ReadFromJsonAsync<DepartmentDetail>();

        var response = await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyAId, Name: "Child In A", Description: null, ParentDepartmentId: parent!.Id, IsActive: true));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
