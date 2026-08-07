using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.ActionPlans;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Tracking;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.OrgStructure;

/// <summary>
/// End-to-end coverage for #191: User.CompanyId is nullable, and NULL means the user
/// belongs to no tenant. In practice that user is a super_admin operating across every
/// company, whose companyId JWT claim is therefore <see cref="string.Empty"/>.
/// </summary>
[Collection("Postgres")]
public class CompanyLessSuperAdminTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly JsonSerializerOptions _snakeCaseOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    private readonly string _companyADomain = $"globala-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"globalb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public CompanyLessSuperAdminTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "Global Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Global Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>
    /// Signs a user up (which always assigns a company from the email domain), then
    /// rewrites their role and company directly and logs in again so the returned token
    /// carries the rewritten claims. Passing <c>companyId: null</c> produces the
    /// company-less user this whole file is about -- there is deliberately no endpoint
    /// that mints one, since a global super_admin is provisioned, not self-registered.
    /// </summary>
    private async Task<(string Token, Guid UserId)> SignUpAndGetTokenAsync(
        HttpClient client, string role, string emailDomain, Guid? companyId)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        Guid userId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            userId = user.Id;
            user.Role = role;
            user.CompanyId = companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        return (token, userId);
    }

    [Fact]
    public async Task A_user_can_be_persisted_with_no_company_at_all()
    {
        // The schema half of #191: without the migration dropping NOT NULL from
        // users.company_id this SaveChanges throws.
        var client = _factory.CreateClient();
        var (_, superAdminId) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, companyId: null);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var reloaded = await db.Users.AsNoTracking().FirstAsync(u => u.Id == superAdminId);
        Assert.Null(reloaded.CompanyId);
    }

    [Fact]
    public async Task Company_less_super_admin_can_list_and_read_users_in_any_company()
    {
        // THE headline test: a super_admin with no tenant, driven through an authorized
        // endpoint end to end -- login, JWT with a blank companyId claim, bearer auth,
        // CanAccessCompany, query. Every one of those layers previously assumed the acting
        // user had a company.
        var client = _factory.CreateClient();
        var (superAdminToken, _) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, companyId: null);
        var (_, employeeAId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        var (_, employeeBId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyBDomain, _companyBId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        var listA = await client.GetAsync($"/admin/users?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.OK, listA.StatusCode);
        Assert.Contains((await listA.Content.ReadFromJsonAsync<UserListResponse>())!.Users, u => u.Id == employeeAId);

        var listB = await client.GetAsync($"/admin/users?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.OK, listB.StatusCode);
        Assert.Contains((await listB.Content.ReadFromJsonAsync<UserListResponse>())!.Users, u => u.Id == employeeBId);

        var getB = await client.GetAsync($"/admin/users/{employeeBId}");
        Assert.Equal(HttpStatusCode.OK, getB.StatusCode);
        Assert.Equal(_companyBId, (await getB.Content.ReadFromJsonAsync<UserDetail>())!.CompanyId);
    }

    [Fact]
    public async Task Company_less_super_admin_does_not_appear_in_any_companys_user_list()
    {
        // `u.CompanyId == companyId` against a nullable column excludes NULL rows, which is
        // the intended outcome: a user who belongs to no tenant must not be listed as a
        // member of one. This asserts it rather than trusting EF's null semantics.
        var client = _factory.CreateClient();
        var (superAdminToken, superAdminId) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, companyId: null);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        foreach (var companyId in new[] { _companyAId, _companyBId })
        {
            var list = await client.GetAsync($"/admin/users?companyId={companyId}");
            Assert.Equal(HttpStatusCode.OK, list.StatusCode);
            var users = (await list.Content.ReadFromJsonAsync<UserListResponse>())!.Users;
            Assert.DoesNotContain(users, u => u.Id == superAdminId);
        }
    }

    [Fact]
    public async Task Company_less_super_admin_reads_back_with_a_null_companyId()
    {
        var client = _factory.CreateClient();
        var (superAdminToken, superAdminId) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, companyId: null);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        var response = await client.GetAsync($"/admin/users/{superAdminId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = await response.Content.ReadFromJsonAsync<UserDetail>();
        Assert.Null(detail!.CompanyId);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_read_or_update_a_company_less_super_admin()
    {
        // The Guid? overload's rule under test: a NULL target is global scope, reachable by
        // SuperAdmins only. The companion is
        // Company_less_super_admin_can_list_and_read_users_in_any_company above, which
        // proves the guard still lets the right caller through.
        var client = _factory.CreateClient();
        var (companyAdminToken, _) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var (_, superAdminId) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, companyId: null);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", companyAdminToken);

        var get = await client.GetAsync($"/admin/users/{superAdminId}");
        Assert.Equal(HttpStatusCode.Forbidden, get.StatusCode);

        var update = await client.PutAsJsonAsync($"/admin/users/{superAdminId}", new UpdateUserRequest("Renamed", null, null, null));
        Assert.Equal(HttpStatusCode.Forbidden, update.StatusCode);
    }

    [Fact]
    public async Task Company_less_super_admin_cannot_be_given_a_department_manager_or_demographics()
    {
        // All three are company-scoped concepts; a user with no company has no org chart to
        // sit in and no demographic field set to answer.
        var client = _factory.CreateClient();
        var (superAdminToken, superAdminId) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, companyId: null);
        var (_, employeeAId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);

        Guid departmentId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var department = new Department
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyAId,
                Name = "Engineering",
                EmployeeCount = 0,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Departments.Add(department);
            departmentId = department.Id;
            await db.SaveChangesAsync();
        }

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        var withDepartment = await client.PutAsJsonAsync(
            $"/admin/users/{superAdminId}", new UpdateUserRequest(null, departmentId, null, null));
        Assert.Equal(HttpStatusCode.BadRequest, withDepartment.StatusCode);

        var withManager = await client.PutAsJsonAsync(
            $"/admin/users/{superAdminId}", new UpdateUserRequest(null, null, employeeAId, null));
        Assert.Equal(HttpStatusCode.BadRequest, withManager.StatusCode);

        var withDemographics = await client.PutAsJsonAsync(
            $"/admin/users/{superAdminId}",
            new UpdateUserRequest(null, null, null, null, new Dictionary<string, string?> { ["gender"] = "female" }));
        Assert.Equal(HttpStatusCode.BadRequest, withDemographics.StatusCode);

        // Nothing was persisted by any of the three rejected calls.
        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var reloaded = await verifyDb.Users.AsNoTracking().FirstAsync(u => u.Id == superAdminId);
        Assert.Null(reloaded.DepartmentId);
        Assert.Null(reloaded.ManagerId);
    }

    [Fact]
    public async Task A_plain_rename_of_a_company_less_super_admin_still_succeeds()
    {
        // Companion to the test above: the company-less guard must reject only the
        // company-scoped fields, not block the endpoint outright.
        var client = _factory.CreateClient();
        var (superAdminToken, superAdminId) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, companyId: null);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        var response = await client.PutAsJsonAsync($"/admin/users/{superAdminId}", new UpdateUserRequest("Platform Operator", null, null, null));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = await response.Content.ReadFromJsonAsync<UserDetail>();
        Assert.Equal("Platform Operator", detail!.Name);
        Assert.Null(detail.CompanyId);
    }

    [Fact]
    public async Task A_company_less_user_cannot_be_demoted_out_of_super_admin()
    {
        // Every role except super_admin is tenant-scoped. Demoting in place would mint a
        // company_admin with a blank companyId claim -- the one combination the codebase is
        // not written for. BenchmarkEndpoints.ListAsync would then reach
        // Guid.Parse(currentUser.CompanyId) and 500.
        var client = _factory.CreateClient();
        var (superAdminToken, superAdminId) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, companyId: null);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        var demote = await client.PutAsJsonAsync($"/admin/users/{superAdminId}/role", new UpdateUserRoleRequest(Roles.CompanyAdmin));
        Assert.Equal(HttpStatusCode.BadRequest, demote.StatusCode);

        // Companion: the same endpoint still performs a legitimate role change, so the new
        // guard is not simply blocking everything.
        var (_, employeeId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        var promote = await client.PutAsJsonAsync($"/admin/users/{employeeId}/role", new UpdateUserRoleRequest(Roles.Supervisor));
        Assert.Equal(HttpStatusCode.OK, promote.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var reloaded = await db.Users.AsNoTracking().FirstAsync(u => u.Id == superAdminId);
        Assert.Equal(Roles.SuperAdmin, reloaded.Role);
        Assert.Null(reloaded.CompanyId);
    }

    [Fact]
    public async Task Company_less_super_admin_can_list_benchmarks_without_hitting_Guid_Parse()
    {
        // BenchmarkEndpoints.ListAsync does Guid.Parse(currentUser.CompanyId), guarded only
        // by `if (currentUser.Role != Roles.SuperAdmin)`. That short-circuit is the entire
        // reason a blank claim is safe there -- this pins it, because losing it turns a
        // super_admin's benchmark list into a 500 rather than a 403.
        var client = _factory.CreateClient();
        var (superAdminToken, superAdminId) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, companyId: null);

        Guid globalBenchmarkId;
        Guid companyBenchmarkId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

            // CreatedBy FKs to users with OnDelete(Restrict), so it needs a real row. Using
            // the company-less super_admin also proves that a user with a NULL company_id is
            // a perfectly valid FK target for the rest of the schema.
            var globalBenchmark = new Benchmark
            {
                Id = Guid.NewGuid(), Name = "Industry Average", Description = "Cross-industry baseline",
                Type = "industry", Category = "engagement", Source = "test", CreatedBy = superAdminId,
                CompanyId = null, IsActive = true, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            };
            var companyBenchmark = new Benchmark
            {
                Id = Guid.NewGuid(), Name = "Co A Internal", Description = "Company A baseline",
                Type = "internal", Category = "engagement", Source = "test", CreatedBy = superAdminId,
                CompanyId = _companyAId, IsActive = true, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Benchmarks.AddRange(globalBenchmark, companyBenchmark);
            globalBenchmarkId = globalBenchmark.Id;
            companyBenchmarkId = companyBenchmark.Id;
            await db.SaveChangesAsync();
        }

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        var response = await client.GetAsync("/admin/benchmarks");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var benchmarks = await response.Content.ReadFromJsonAsync<List<BenchmarkListItem>>();

        // A super_admin sees every tenant's benchmarks plus the global ones.
        Assert.Contains(benchmarks!, b => b.Id == globalBenchmarkId);
        Assert.Contains(benchmarks!, b => b.Id == companyBenchmarkId);
    }

    [Fact]
    public async Task Company_less_super_admin_is_excluded_from_the_tracking_persona_sync()
    {
        // The cross-service contract. climate-tracking's MatchingTenantHandler compares the
        // companyId claim verbatim against a configured ExpectedCompanyId, so an empty
        // company_id on a persona would be a broken tenant key rather than a harmless one.
        // Company-less super_admins are platform operators, not survey participants of any
        // tenant, so they are simply absent -- and every persona that IS emitted carries a
        // non-empty company_id.
        var client = _factory.CreateClient();
        var (_, superAdminId) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, companyId: null);
        var (_, employeeAId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);

        string superAdminPersonaId;
        string employeePersonaId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            superAdminPersonaId = TrackingIdentifiers.ExternalPersonaId(await db.Users.AsNoTracking().FirstAsync(u => u.Id == superAdminId));
            employeePersonaId = TrackingIdentifiers.ExternalPersonaId(await db.Users.AsNoTracking().FirstAsync(u => u.Id == employeeAId));
        }

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.GetAsync($"/api/internal/personas?company_id={_companyAId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var personas = (await response.Content.ReadFromJsonAsync<Envelope<PersonasData>>(_snakeCaseOptions))!.Data.Personas;

        Assert.Contains(personas, p => p.PersonaId == employeePersonaId);
        Assert.DoesNotContain(personas, p => p.PersonaId == superAdminPersonaId);
        Assert.All(personas, p => Assert.Equal(_companyAId.ToString(), p.CompanyId));
    }

    [Fact]
    public async Task Company_less_super_admin_is_not_counted_in_any_companys_user_count()
    {
        var client = _factory.CreateClient();
        var (superAdminToken, _) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, companyId: null);
        await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        var response = await client.GetAsync($"/admin/companies/{_companyAId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = await response.Content.ReadFromJsonAsync<CompanyDetail>();

        // Exactly the one active employee seeded above for company A -- the company-less
        // super_admin, whose signup email domain was company A's, is not among them.
        Assert.Equal(1, detail!.UserCount);
    }

    [Fact]
    public async Task ResetCredentials_by_a_company_less_super_admin_still_resolves_the_target()
    {
        // AuthEndpoints.ResetCredentialsAsync used to embed `u.CompanyId.ToString()` in the
        // EF query. With a nullable CompanyId that receiver is Nullable<Guid>, whose
        // ToString() EF cannot translate -- it would have thrown at runtime, not compile
        // time. This drives the rewritten query for both the SuperAdmin branch (here) and
        // the tenant branch (the companion test below).
        var client = _factory.CreateClient();
        var (superAdminToken, _) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, companyId: null);
        var (_, employeeBId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyBDomain, _companyBId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        var response = await client.PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(employeeBId));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var reset = await response.Content.ReadFromJsonAsync<ResetCredentialsResponse>();
        Assert.False(string.IsNullOrWhiteSpace(reset!.TemporaryPassword));
    }

    [Fact]
    public async Task ResetCredentials_by_a_CompanyAdmin_still_stops_at_their_own_tenant()
    {
        // Companion guard test: the rewritten query must not have widened access. A
        // CompanyAdmin reaches their own company's user and nobody else's -- including a
        // company-less super_admin, whose NULL company_id must not be treated as a match
        // for a blank or absent claim.
        var client = _factory.CreateClient();
        var (companyAdminToken, _) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var (_, employeeAId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        var (_, employeeBId) = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyBDomain, _companyBId);
        var (_, superAdminId) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, companyId: null);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", companyAdminToken);

        var ownTenant = await client.PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(employeeAId));
        Assert.Equal(HttpStatusCode.OK, ownTenant.StatusCode);

        var otherTenant = await client.PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(employeeBId));
        Assert.Equal(HttpStatusCode.NotFound, otherTenant.StatusCode);

        var globalScope = await client.PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(superAdminId));
        Assert.Equal(HttpStatusCode.NotFound, globalScope.StatusCode);
    }

    /// <summary>
    /// The server half of #124: a company-less super_admin can drive a company-scoped
    /// endpoint by naming the company explicitly, for any company they choose.
    /// </summary>
    /// <remarks>
    /// This is what the web app's new company-context selector relies on. The selector
    /// does not invent an override parameter -- it fills in the <c>companyId</c> these
    /// endpoints already required, which the caller's own claim can no longer supply now
    /// that it is <see cref="string.Empty"/>. The companion guard lives beside the
    /// endpoint it protects, as
    /// <c>ActionPlanEndpointsTests.CompanyAdmin_cannot_list_another_companys_plans_via_the_companyId_parameter</c>:
    /// the same parameter refuses a CompanyAdmin who names someone else's company.
    /// </remarks>
    [Fact]
    public async Task Company_less_super_admin_can_list_action_plans_for_any_company_they_name()
    {
        var client = _factory.CreateClient();
        var (superAdminToken, _) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, companyId: null);
        var (companyAdminBToken, _) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyBDomain, _companyBId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", companyAdminBToken);
        var created = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "B's plan", "desc", _companyBId, null, DateTimeOffset.UtcNow.AddDays(10), "low", null, null, null, null, null, null));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        var listB = await client.GetAsync($"/action-plans?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.OK, listB.StatusCode);
        var plansB = (await listB.Content.ReadFromJsonAsync<ActionPlanListResponse>())!.ActionPlans;
        Assert.Contains(plansB, p => p.CompanyId == _companyBId);

        // And the *other* company, from the same session: the selector switches context
        // without re-authenticating, so both must work for one token.
        var listA = await client.GetAsync($"/action-plans?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.OK, listA.StatusCode);
        Assert.DoesNotContain(
            (await listA.Content.ReadFromJsonAsync<ActionPlanListResponse>())!.ActionPlans,
            p => p.CompanyId == _companyBId);
    }
}
