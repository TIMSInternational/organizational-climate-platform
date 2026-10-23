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
    private readonly Company _otherCompany = new()
    {
        Id = Guid.NewGuid(),
        Name = "Globex",
        EmailDomain = $"globex-{Guid.NewGuid():N}.test",
        CreatedAt = DateTimeOffset.UtcNow,
    };
    private User _admin = null!;
    private User _employee = null!;
    private User _otherCompanyEmployee = null!;
    private User _superAdmin = null!;
    private string _adminToken = null!;
    private string _employeeToken = null!;
    private string _superAdminToken = null!;

    public ResetCredentialsEndpointTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        var hasher = new ClimateProject.Infrastructure.Auth.BcryptPasswordHasher();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.Companies.AddRange(_company, _otherCompany);

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
            _otherCompanyEmployee = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _otherCompany.Id,
                Email = $"employee@{_otherCompany.EmailDomain}",
                Name = "Other Company Employee",
                PasswordHash = hasher.Hash("other-employee-password"),
                Role = "employee",
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            _superAdmin = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _company.Id,
                Email = $"super-admin@{_company.EmailDomain}",
                Name = "Super Admin",
                PasswordHash = hasher.Hash("super-admin-password"),
                Role = "super_admin",
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Users.AddRange(_admin, _employee, _otherCompanyEmployee, _superAdmin);
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        var adminLogin = await client.PostAsJsonAsync("/auth/login", new LoginRequest(_admin.Email, "admin-password"));
        _adminToken = (await adminLogin.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        var employeeLogin = await client.PostAsJsonAsync("/auth/login", new LoginRequest(_employee.Email, "employee-password"));
        _employeeToken = (await employeeLogin.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        var superAdminLogin = await client.PostAsJsonAsync("/auth/login", new LoginRequest(_superAdmin.Email, "super-admin-password"));
        _superAdminToken = (await superAdminLogin.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>
    /// The temporary password must be one the product would accept on the next change.
    /// The old Guid-derived twelve hex characters failed the default policy (no uppercase);
    /// this asserts the minted value passes the same validator every password-setting
    /// route now runs, and is comfortably longer than the minimum.
    /// </summary>
    [Fact]
    public async Task Reset_mints_a_temporary_password_that_satisfies_the_password_policy()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _adminToken);

        var response = await client.PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(_employee.Id));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ResetCredentialsResponse>();
        Assert.Null(ClimateProject.Application.Auth.PasswordPolicyValidation.Validate(body!.TemporaryPassword, new PasswordPolicy()));
        Assert.True(body.TemporaryPassword.Length >= 16, body.TemporaryPassword);
    }

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

    [Fact]
    public async Task Company_admin_cannot_reset_a_user_in_a_different_company()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _adminToken);

        var response = await client.PostAsJsonAsync(
            "/auth/admin/reset-credentials",
            new ResetCredentialsRequest(_otherCompanyEmployee.Id));

        // 404, not 403 -- same response as "user not found" so this endpoint
        // doesn't leak the existence of users in other companies.
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Super_admin_can_reset_a_user_in_any_company()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _superAdminToken);

        var response = await client.PostAsJsonAsync(
            "/auth/admin/reset-credentials",
            new ResetCredentialsRequest(_otherCompanyEmployee.Id));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ResetCredentialsResponse>();
        Assert.Equal(_otherCompanyEmployee.Email, body!.Email);
        Assert.False(string.IsNullOrEmpty(body.TemporaryPassword));

        var loginClient = _factory.CreateClient();
        var loginResponse = await loginClient.PostAsJsonAsync(
            "/auth/login",
            new LoginRequest(_otherCompanyEmployee.Email, body.TemporaryPassword));
        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);
    }

    // ------------------------------------------------- admin-role targets (audit G29)
    //
    // The response hands the caller a working password, so the endpoint is only as safe as who
    // it lets reset whom. A company_admin's CompanyId can match a super_admin's (signup assigns
    // it from the email domain): the tenant filter alone let them take over that account.

    private async Task<User> SeedPeerAdminAsync(string password)
    {
        var hasher = new ClimateProject.Infrastructure.Auth.BcryptPasswordHasher();
        var peer = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = _company.Id,
            Email = $"peer-admin-{Guid.NewGuid():N}@{_company.EmailDomain}",
            Name = "Peer Admin",
            PasswordHash = hasher.Hash(password),
            Role = "company_admin",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Users.Add(peer);
        await db.SaveChangesAsync();
        return peer;
    }

    [Fact]
    public async Task Company_admin_cannot_reset_a_super_admin_who_shares_their_company()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _adminToken);

        var response = await client.PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(_superAdmin.Id));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        // Nothing was replaced: the super admin's own password still opens their account.
        var login = await _factory.CreateClient().PostAsJsonAsync("/auth/login", new LoginRequest(_superAdmin.Email, "super-admin-password"));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
    }

    [Fact]
    public async Task Company_admin_cannot_reset_a_peer_company_admin()
    {
        var peer = await SeedPeerAdminAsync("peer-admin-password");
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _adminToken);

        var response = await client.PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(peer.Id));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var login = await _factory.CreateClient().PostAsJsonAsync("/auth/login", new LoginRequest(peer.Email, "peer-admin-password"));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
    }

    [Fact]
    public async Task Company_admin_may_still_reset_their_own_credentials()
    {
        var peer = await SeedPeerAdminAsync("peer-admin-password");
        var login = await _factory.CreateClient().PostAsJsonAsync("/auth/login", new LoginRequest(peer.Email, "peer-admin-password"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(peer.Id));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Super_admin_can_reset_a_company_admin()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _superAdminToken);

        var response = await client.PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(_admin.Id));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ------------------------------------------- one code, one survey (per_survey mode)
    //
    // A per_survey person has no account password; each of their keys opens one survey. A reset
    // would mint an account password and with it an email sign-in scoped to no survey at all.

    private async Task<(Company Company, User Person)> SeedCompanyWithPersonAsync(string mode, string? passwordHash)
    {
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Modo " + mode,
            EmailDomain = $"mode-{Guid.NewGuid():N}.test",
            CreatedAt = DateTimeOffset.UtcNow,
            Settings = new CompanySettings { CredentialMode = mode },
        };
        var person = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Email = $"person@{company.EmailDomain}",
            Name = "Person",
            // Null hash and null username: the exact shape a per_survey import mints.
            PasswordHash = passwordHash,
            Role = "employee",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Companies.Add(company);
        db.Users.Add(person);
        await db.SaveChangesAsync();
        return (company, person);
    }

    private async Task<User> ReadUserAsync(Guid id)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        return await db.Users.AsNoTracking().FirstAsync(u => u.Id == id);
    }

    private HttpClient SuperAdminClient()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _superAdminToken);
        return client;
    }

    [Fact]
    public async Task A_per_survey_person_with_no_password_cannot_be_reset_and_keeps_no_account_password()
    {
        var (_, person) = await SeedCompanyWithPersonAsync("per_survey", passwordHash: null);
        var before = await ReadUserAsync(person.Id);

        var response = await SuperAdminClient().PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(person.Id));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<Dictionary<string, string>>();
        Assert.Equal("per_survey_person", body!["code"]);
        var after = await ReadUserAsync(person.Id);
        Assert.Null(after.PasswordHash);
        // Nothing else was touched either: their sessions were not ended for a refused request.
        Assert.Equal(before.SecurityStamp, after.SecurityStamp);
        // And the email sign-in the reset would have opened does not exist.
        var login = await _factory.CreateClient().PostAsJsonAsync("/auth/login", new LoginRequest(person.Email, "anything"));
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
    }

    [Fact]
    public async Task A_shared_mode_person_with_no_password_still_resets()
    {
        // The other half of the rule: the same row shape in a SHARED company (an account that
        // used Google sign-in, say) is not a per-survey person, and resets as before.
        var (_, person) = await SeedCompanyWithPersonAsync("shared", passwordHash: null);

        var response = await SuperAdminClient().PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(person.Id));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotNull((await ReadUserAsync(person.Id)).PasswordHash);
    }

    [Fact]
    public async Task A_person_with_their_own_password_in_a_per_survey_company_still_resets()
    {
        // An administrator (or anyone) who already signs in with a password of their own: the
        // reset replaces a key they have, it does not create a wider one.
        var hasher = new ClimateProject.Infrastructure.Auth.BcryptPasswordHasher();
        var (_, person) = await SeedCompanyWithPersonAsync("per_survey", hasher.Hash("own-password"));

        var response = await SuperAdminClient().PostAsJsonAsync("/auth/admin/reset-credentials", new ResetCredentialsRequest(person.Id));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task The_user_detail_says_who_signs_in_only_with_survey_codes()
    {
        var (_, codesOnly) = await SeedCompanyWithPersonAsync("per_survey", passwordHash: null);
        var (_, shared) = await SeedCompanyWithPersonAsync("shared", passwordHash: null);
        var client = SuperAdminClient();

        var codesOnlyDetail = await client.GetFromJsonAsync<ClimateProject.Application.OrgStructure.UserDetail>($"/admin/users/{codesOnly.Id}");
        var sharedDetail = await client.GetFromJsonAsync<ClimateProject.Application.OrgStructure.UserDetail>($"/admin/users/{shared.Id}");

        Assert.True(codesOnlyDetail!.SurveyCodesOnly);
        Assert.False(sharedDetail!.SurveyCodesOnly);
    }
}
