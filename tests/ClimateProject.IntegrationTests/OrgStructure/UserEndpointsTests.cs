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
    public async Task NonAdmin_cannot_list_get_or_update_users_in_their_own_company()
    {
        var client = _factory.CreateClient();
        var (employeeToken, _) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        var (_, coworkerId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", employeeToken);

        var listResponse = await client.GetAsync($"/admin/users?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.Forbidden, listResponse.StatusCode);

        var getResponse = await client.GetAsync($"/admin/users/{coworkerId}");
        Assert.Equal(HttpStatusCode.Forbidden, getResponse.StatusCode);

        var updateResponse = await client.PutAsJsonAsync($"/admin/users/{coworkerId}", new UpdateUserRequest("Renamed", null, null, false));
        Assert.Equal(HttpStatusCode.Forbidden, updateResponse.StatusCode);
    }

    [Fact]
    public async Task Supervisor_and_Leader_cannot_list_users_in_their_own_company()
    {
        var client = _factory.CreateClient();
        var (supervisorToken, _) = await SignUpAndGetTokenAsync(client, Roles.Supervisor, _companyADomain, _companyAId);
        var (leaderToken, _) = await SignUpAndGetTokenAsync(client, Roles.Leader, _companyADomain, _companyAId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", supervisorToken);
        var supervisorListResponse = await client.GetAsync($"/admin/users?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.Forbidden, supervisorListResponse.StatusCode);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", leaderToken);
        var leaderListResponse = await client.GetAsync($"/admin/users?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.Forbidden, leaderListResponse.StatusCode);
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
    public async Task CompanyAdmin_cannot_deactivate_a_super_admin_sharing_their_company_id()
    {
        // Regression test: signup assigns CompanyId from the email domain, so a
        // super_admin can end up sharing a CompanyId with a company_admin who has no
        // authority over them. A CompanyAdmin flipping that super_admin's IsActive would
        // be a lower-privileged role locking out a higher-privileged one.
        var client = _factory.CreateClient();
        var (adminToken, _) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var (_, superAdminId) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, _companyAId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var deactivateResponse = await client.PutAsJsonAsync($"/admin/users/{superAdminId}", new UpdateUserRequest(null, null, null, false));
        Assert.Equal(HttpStatusCode.Forbidden, deactivateResponse.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var superAdmin = await db.Users.FirstAsync(u => u.Id == superAdminId);
        Assert.True(superAdmin.IsActive);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_deactivate_themselves_or_a_peer_company_admin()
    {
        var client = _factory.CreateClient();
        var (adminToken, adminId) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var (_, peerAdminId) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var selfDeactivate = await client.PutAsJsonAsync($"/admin/users/{adminId}", new UpdateUserRequest(null, null, null, false));
        Assert.Equal(HttpStatusCode.Forbidden, selfDeactivate.StatusCode);

        var peerDeactivate = await client.PutAsJsonAsync($"/admin/users/{peerAdminId}", new UpdateUserRequest(null, null, null, false));
        Assert.Equal(HttpStatusCode.Forbidden, peerDeactivate.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_can_still_deactivate_a_regular_employee()
    {
        var client = _factory.CreateClient();
        var (adminToken, _) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var (_, employeeId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var deactivateResponse = await client.PutAsJsonAsync($"/admin/users/{employeeId}", new UpdateUserRequest(null, null, null, false));
        Assert.Equal(HttpStatusCode.OK, deactivateResponse.StatusCode);
        var updated = await deactivateResponse.Content.ReadFromJsonAsync<UserDetail>();
        Assert.False(updated!.IsActive);
    }

    [Fact]
    public async Task SuperAdmin_can_deactivate_a_company_admin()
    {
        var client = _factory.CreateClient();
        var (superAdminToken, _) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, _companyAId);
        var (_, companyAdminId) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyBDomain, _companyBId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        var deactivateResponse = await client.PutAsJsonAsync($"/admin/users/{companyAdminId}", new UpdateUserRequest(null, null, null, false));
        Assert.Equal(HttpStatusCode.OK, deactivateResponse.StatusCode);
        var updated = await deactivateResponse.Content.ReadFromJsonAsync<UserDetail>();
        Assert.False(updated!.IsActive);
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

    private async Task<Guid> SeedDemographicFieldAsync(Guid companyId, string field, string type, List<string>? options, bool required = false)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;
        var definition = new DemographicField
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Field = field,
            LabelEn = field,
            Type = type,
            Required = required,
            Order = 0,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.DemographicFields.Add(definition);
        DemographicOptionSeed.Add(db, definition.Id, options);
        await db.SaveChangesAsync();
        return definition.Id;
    }

    [Fact]
    public async Task CompanyAdmin_can_set_a_users_demographics_and_read_them_back()
    {
        var client = _factory.CreateClient();
        var (adminToken, _) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var (_, employeeId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        var fieldId = await SeedDemographicFieldAsync(_companyAId, "work_mode", "select", ["remote", "onsite"]);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var updateResponse = await client.PutAsJsonAsync(
            $"/admin/users/{employeeId}",
            new UpdateUserRequest(null, null, null, null, new Dictionary<string, string?> { ["work_mode"] = "remote" }));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<UserDetail>();
        Assert.Equal("remote", updated!.Demographics["work_mode"]);

        var getResponse = await client.GetAsync($"/admin/users/{employeeId}");
        var fetched = await getResponse.Content.ReadFromJsonAsync<UserDetail>();
        Assert.Equal("remote", fetched!.Demographics["work_mode"]);

        // Stored as a row keyed by the field definition, not as a blob.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var row = await db.UserDemographics.SingleAsync(d => d.UserId == employeeId);
        Assert.Equal(fieldId, row.DemographicFieldId);
        Assert.Equal("remote", row.Value);
    }

    [Fact]
    public async Task Update_rejects_a_demographic_value_outside_the_fields_configured_options()
    {
        var client = _factory.CreateClient();
        var (adminToken, _) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var (_, employeeId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        await SeedDemographicFieldAsync(_companyAId, "work_mode", "select", ["remote", "onsite"]);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var response = await client.PutAsJsonAsync(
            $"/admin/users/{employeeId}",
            new UpdateUserRequest(null, null, null, null, new Dictionary<string, string?> { ["work_mode"] = "hybrid" }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Empty(await db.UserDemographics.Where(d => d.UserId == employeeId).ToListAsync());
    }

    [Fact]
    public async Task Update_rejects_a_demographic_key_the_company_has_not_defined()
    {
        var client = _factory.CreateClient();
        var (adminToken, _) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var (_, employeeId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var response = await client.PutAsJsonAsync(
            $"/admin/users/{employeeId}",
            new UpdateUserRequest(null, null, null, null, new Dictionary<string, string?> { ["not_a_field"] = "x" }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Users_can_be_filtered_by_a_demographic_field_value()
    {
        // The capability the jsonb blob could not provide at all, and the reason
        // #193 exists: req.md 2.2 requires every custom demographic to be filterable.
        var client = _factory.CreateClient();
        var (adminToken, _) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var (_, remoteId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        var (_, onsiteId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        await SeedDemographicFieldAsync(_companyAId, "work_mode", "select", ["remote", "onsite"]);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        await client.PutAsJsonAsync($"/admin/users/{remoteId}", new UpdateUserRequest(null, null, null, null, new Dictionary<string, string?> { ["work_mode"] = "remote" }));
        await client.PutAsJsonAsync($"/admin/users/{onsiteId}", new UpdateUserRequest(null, null, null, null, new Dictionary<string, string?> { ["work_mode"] = "onsite" }));

        var filtered = await client.GetAsync($"/admin/users?companyId={_companyAId}&demographicField=work_mode&demographicValue=remote");
        Assert.Equal(HttpStatusCode.OK, filtered.StatusCode);
        var list = await filtered.Content.ReadFromJsonAsync<UserListResponse>();
        Assert.Contains(list!.Users, u => u.Id == remoteId);
        Assert.DoesNotContain(list.Users, u => u.Id == onsiteId);

        // Field with no value constraint returns everyone who answered it at all.
        var anyValue = await client.GetAsync($"/admin/users?companyId={_companyAId}&demographicField=work_mode");
        var anyList = await anyValue.Content.ReadFromJsonAsync<UserListResponse>();
        Assert.Contains(anyList!.Users, u => u.Id == remoteId);
        Assert.Contains(anyList.Users, u => u.Id == onsiteId);

        var valueWithoutField = await client.GetAsync($"/admin/users?companyId={_companyAId}&demographicValue=remote");
        Assert.Equal(HttpStatusCode.BadRequest, valueWithoutField.StatusCode);
    }

    [Fact]
    public async Task A_later_update_replaces_the_full_demographic_set_but_omitting_the_property_leaves_it_alone()
    {
        var client = _factory.CreateClient();
        var (adminToken, _) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var (_, employeeId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        await SeedDemographicFieldAsync(_companyAId, "work_mode", "select", ["remote", "onsite"]);
        await SeedDemographicFieldAsync(_companyAId, "tenure", "text", null);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        await client.PutAsJsonAsync(
            $"/admin/users/{employeeId}",
            new UpdateUserRequest(null, null, null, null, new Dictionary<string, string?> { ["work_mode"] = "remote", ["tenure"] = "2 years" }));

        // A non-null map is the complete set: dropping "tenure" clears that answer.
        var replaced = await client.PutAsJsonAsync(
            $"/admin/users/{employeeId}",
            new UpdateUserRequest(null, null, null, null, new Dictionary<string, string?> { ["work_mode"] = "onsite" }));
        var afterReplace = await replaced.Content.ReadFromJsonAsync<UserDetail>();
        Assert.Equal("onsite", afterReplace!.Demographics["work_mode"]);
        Assert.False(afterReplace.Demographics.ContainsKey("tenure"));

        // Companion: a null map means "not part of this request" and must not wipe anything.
        var renamed = await client.PutAsJsonAsync($"/admin/users/{employeeId}", new UpdateUserRequest("Renamed", null, null, null));
        var afterRename = await renamed.Content.ReadFromJsonAsync<UserDetail>();
        Assert.Equal("Renamed", afterRename!.Name);
        Assert.Equal("onsite", afterRename.Demographics["work_mode"]);
    }

    [Fact]
    public async Task A_full_profile_update_must_supply_every_required_demographic()
    {
        var client = _factory.CreateClient();
        var (adminToken, _) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var (_, employeeId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        await SeedDemographicFieldAsync(_companyAId, "work_mode", "select", ["remote", "onsite"], required: true);
        await SeedDemographicFieldAsync(_companyAId, "tenure", "text", null);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var missingRequired = await client.PutAsJsonAsync(
            $"/admin/users/{employeeId}",
            new UpdateUserRequest(null, null, null, null, new Dictionary<string, string?> { ["tenure"] = "2 years" }));
        Assert.Equal(HttpStatusCode.BadRequest, missingRequired.StatusCode);

        var withRequired = await client.PutAsJsonAsync(
            $"/admin/users/{employeeId}",
            new UpdateUserRequest(null, null, null, null, new Dictionary<string, string?> { ["tenure"] = "2 years", ["work_mode"] = "remote" }));
        Assert.Equal(HttpStatusCode.OK, withRequired.StatusCode);
    }
}
