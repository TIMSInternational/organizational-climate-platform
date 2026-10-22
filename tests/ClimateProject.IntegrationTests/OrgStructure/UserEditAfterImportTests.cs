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

/// <summary>
/// Editing a person after an import (audit G6): the two links a null cannot unset -- a
/// department and a manager -- now have an explicit clear, and a demographics edit made from a
/// screen that offers only the ACTIVE fields no longer erases answers to retired ones.
/// </summary>
[Collection("Postgres")]
public class UserEditAfterImportTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _domain = $"useredit-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public UserEditAfterImportTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "User Edit Co", EmailDomain = _domain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(string Token, Guid UserId)> SignUpAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_domain}";
        await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "A-good-passw0rd"));

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.CompanyId = _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        using var readScope = _factory.Services.CreateScope();
        var readDb = readScope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        return (token, (await readDb.Users.FirstAsync(u => u.Email == email)).Id);
    }

    private async Task<HttpClient> AdminAsync()
    {
        var client = _factory.CreateClient();
        var (token, _) = await SignUpAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<Guid> EmployeeAsync() => (await SignUpAsync(_factory.CreateClient(), Roles.Employee)).UserId;

    private async Task<Guid> SeedDepartmentAsync(string name)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var department = new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            Name = name,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Departments.Add(department);
        await db.SaveChangesAsync();
        return department.Id;
    }

    private async Task<User> ReadUserAsync(Guid id)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        return await db.Users.AsNoTracking().FirstAsync(u => u.Id == id);
    }

    // ----------------------------------------------------------------- department

    [Fact]
    public async Task ClearDepartment_removes_a_persons_department()
    {
        var admin = await AdminAsync();
        var employeeId = await EmployeeAsync();
        var department = await SeedDepartmentAsync("Ventas");
        (await admin.PutAsJsonAsync($"/admin/users/{employeeId}", new UpdateUserRequest(null, department, null, null))).EnsureSuccessStatusCode();
        Assert.Equal(department, (await ReadUserAsync(employeeId)).DepartmentId);

        var response = await admin.PutAsJsonAsync($"/admin/users/{employeeId}", new UpdateUserRequest(null, null, null, null, ClearDepartment: true));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Null((await response.Content.ReadFromJsonAsync<UserDetail>())!.DepartmentId);
        Assert.Null((await ReadUserAsync(employeeId)).DepartmentId);
    }

    [Fact]
    public async Task An_omitted_department_still_leaves_it_alone()
    {
        // The contract every existing caller relies on: a save that says nothing about the
        // department (the edit panel's name-only save) must not unset it.
        var admin = await AdminAsync();
        var employeeId = await EmployeeAsync();
        var department = await SeedDepartmentAsync("Finanzas");
        (await admin.PutAsJsonAsync($"/admin/users/{employeeId}", new UpdateUserRequest(null, department, null, null))).EnsureSuccessStatusCode();

        (await admin.PutAsJsonAsync($"/admin/users/{employeeId}", new UpdateUserRequest("Renamed", null, null, true))).EnsureSuccessStatusCode();

        Assert.Equal(department, (await ReadUserAsync(employeeId)).DepartmentId);
    }

    [Fact]
    public async Task ClearDepartment_together_with_a_department_is_refused_and_changes_nothing()
    {
        var admin = await AdminAsync();
        var employeeId = await EmployeeAsync();
        var first = await SeedDepartmentAsync("Uno");
        var second = await SeedDepartmentAsync("Dos");
        (await admin.PutAsJsonAsync($"/admin/users/{employeeId}", new UpdateUserRequest(null, first, null, null))).EnsureSuccessStatusCode();

        var response = await admin.PutAsJsonAsync(
            $"/admin/users/{employeeId}",
            new UpdateUserRequest("Should not apply", second, null, null, ClearDepartment: true));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var user = await ReadUserAsync(employeeId);
        Assert.Equal(first, user.DepartmentId);
        Assert.NotEqual("Should not apply", user.Name);
    }

    // -------------------------------------------------------------------- manager

    [Fact]
    public async Task A_manager_can_be_set_and_then_cleared()
    {
        var admin = await AdminAsync();
        var employeeId = await EmployeeAsync();
        var managerId = await EmployeeAsync();

        var set = await admin.PutAsJsonAsync($"/admin/users/{employeeId}", new UpdateUserRequest(null, null, managerId, null));
        Assert.Equal(HttpStatusCode.OK, set.StatusCode);
        Assert.Equal(managerId, (await set.Content.ReadFromJsonAsync<UserDetail>())!.ManagerId);

        var cleared = await admin.PutAsJsonAsync($"/admin/users/{employeeId}", new UpdateUserRequest(null, null, null, null, ClearManager: true));
        Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);
        Assert.Null((await cleared.Content.ReadFromJsonAsync<UserDetail>())!.ManagerId);
        Assert.Null((await ReadUserAsync(employeeId)).ManagerId);
    }

    [Fact]
    public async Task ClearManager_together_with_a_manager_is_refused()
    {
        var admin = await AdminAsync();
        var employeeId = await EmployeeAsync();
        var managerId = await EmployeeAsync();

        var response = await admin.PutAsJsonAsync(
            $"/admin/users/{employeeId}",
            new UpdateUserRequest(null, null, managerId, null, ClearManager: true));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Null((await ReadUserAsync(employeeId)).ManagerId);
    }

    [Fact]
    public async Task A_person_cannot_be_their_own_manager()
    {
        var admin = await AdminAsync();
        var employeeId = await EmployeeAsync();

        var response = await admin.PutAsJsonAsync($"/admin/users/{employeeId}", new UpdateUserRequest(null, null, employeeId, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Null((await ReadUserAsync(employeeId)).ManagerId);
    }

    // ---------------------------------------------------------------- demographics

    [Fact]
    public async Task A_demographics_edit_keeps_the_answer_to_a_retired_field()
    {
        var admin = await AdminAsync();
        var employeeId = await EmployeeAsync();
        Guid retiredFieldId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var now = DateTimeOffset.UtcNow;
            var active = new DemographicField
            {
                Id = Guid.NewGuid(), CompanyId = _companyId, Field = "sede", LabelEn = "sede", Type = "text",
                Order = 0, IsActive = true, CreatedAt = now, UpdatedAt = now,
            };
            var retired = new DemographicField
            {
                Id = Guid.NewGuid(), CompanyId = _companyId, Field = "turno", LabelEn = "turno", Type = "text",
                Order = 1, IsActive = true, CreatedAt = now, UpdatedAt = now,
            };
            db.DemographicFields.AddRange(active, retired);
            await db.SaveChangesAsync();
            retiredFieldId = retired.Id;
        }

        (await admin.PutAsJsonAsync(
            $"/admin/users/{employeeId}",
            new UpdateUserRequest(null, null, null, null, new Dictionary<string, string?> { ["sede"] = "Heredia", ["turno"] = "noche" })))
            .EnsureSuccessStatusCode();

        // The company retires "turno" after the person answered it.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var field = await db.DemographicFields.FirstAsync(f => f.Id == retiredFieldId);
            field.IsActive = false;
            await db.SaveChangesAsync();
        }

        // The edit screen offers only active fields, so this is everything it can send.
        var response = await admin.PutAsJsonAsync(
            $"/admin/users/{employeeId}",
            new UpdateUserRequest(null, null, null, null, new Dictionary<string, string?> { ["sede"] = "Cartago" }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = (await response.Content.ReadFromJsonAsync<UserDetail>())!;
        Assert.Equal("Cartago", detail.Demographics["sede"]);
        Assert.Equal("noche", detail.Demographics["turno"]);

        using var readScope = _factory.Services.CreateScope();
        var readDb = readScope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var stored = await readDb.UserDemographics.SingleAsync(d => d.UserId == employeeId && d.DemographicFieldId == retiredFieldId);
        Assert.Equal("noche", stored.Value);
    }
}
