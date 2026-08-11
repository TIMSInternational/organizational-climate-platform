using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Profile;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

namespace ClimateProject.IntegrationTests.Auth;

/// <summary>
/// #284: changing a password ends every other session, and so does an administrator's
/// credential reset.
/// </summary>
/// <remarks>
/// Every token here is obtained the way a real client obtains one — from
/// <c>POST /auth/login</c> or from the response of the change itself — and every assertion is
/// a request to a real authenticated endpoint. Nothing here calls
/// <c>SecurityStampValidation</c>, <c>ActingUserResolver</c> or <c>IJwtTokenService</c>
/// directly, with one deliberate exception (<see cref="A_token_with_no_security_stamp_claim_is_still_accepted"/>),
/// which has to hand-build a token precisely because no code path in this API can produce
/// one any more.
///
/// <c>AuthWebApplicationFactory</c> replaces exactly one collaborator on this path,
/// <c>IGoogleTokenVerifier</c>, which none of these tests goes near: the password paths, the
/// JWT bearer handler, <c>ClimateProjectDbContext</c> and the real
/// <c>JwtTokenService</c> are all the production types.
/// </remarks>
[Collection("Postgres")]
public class SecurityStampRevocationTests : IAsyncLifetime
{
    private const string EmployeePassword = "Or1ginalPassword";
    private const string AdminPassword = "Adm1nPassword";
    private const string NewPassword = "Rep1acementPass";

    private readonly AuthWebApplicationFactory _factory;

    // Unique per test-class instance: xUnit builds a new instance per [Fact] and the
    // "Postgres" fixture shares one database, where companies.email_domain is unique.
    private readonly Company _company = new()
    {
        Id = Guid.NewGuid(),
        Name = "Acme",
        EmailDomain = $"acme-{Guid.NewGuid():N}.test",
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private User _employee = null!;
    private User _admin = null!;

    public SecurityStampRevocationTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        var hasher = new ClimateProject.Infrastructure.Auth.BcryptPasswordHasher();

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Companies.Add(_company);

        _employee = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = _company.Id,
            Email = $"employee@{_company.EmailDomain}",
            Name = "Employee",
            PasswordHash = hasher.Hash(EmployeePassword),
            Role = Roles.Employee,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        _admin = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = _company.Id,
            Email = $"admin@{_company.EmailDomain}",
            Name = "Admin",
            PasswordHash = hasher.Hash(AdminPassword),
            Role = Roles.CompanyAdmin,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.AddRange(_employee, _admin);
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------ self-service

    /// <summary>
    /// The property the issue was filed for. The "other device" is a second token, minted
    /// from a second login before the change — exactly what a session open on another
    /// machine is — and it stops working the moment the password changes.
    /// </summary>
    [Fact]
    public async Task A_token_minted_before_a_password_change_is_refused_after_it()
    {
        var otherDevice = await LoginAsync(_employee.Email, EmployeePassword);
        var thisDevice = await LoginAsync(_employee.Email, EmployeePassword);

        // Live before the change, so the 401 below cannot be a token that never worked.
        Assert.Equal(HttpStatusCode.OK, (await ClientWith(otherDevice).GetAsync("/profile")).StatusCode);

        var change = await ClientWith(thisDevice).PutAsJsonAsync(
            "/profile/password",
            new ChangePasswordRequest(EmployeePassword, NewPassword));
        Assert.Equal(HttpStatusCode.OK, change.StatusCode);

        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await ClientWith(otherDevice).GetAsync("/profile")).StatusCode);
    }

    /// <summary>
    /// The other half of the acceptance criteria: the user who made the change is not bounced
    /// to the login page by their own successful save. The token that does that is the one in
    /// the response body — the session they sent the request on is revoked with all the rest.
    /// </summary>
    [Fact]
    public async Task The_session_that_changed_the_password_is_handed_a_working_replacement()
    {
        var before = await LoginAsync(_employee.Email, EmployeePassword);

        var change = await ClientWith(before).PutAsJsonAsync(
            "/profile/password",
            new ChangePasswordRequest(EmployeePassword, NewPassword));
        Assert.Equal(HttpStatusCode.OK, change.StatusCode);

        var replacement = (await change.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        Assert.False(string.IsNullOrWhiteSpace(replacement));
        Assert.NotEqual(before, replacement);

        Assert.Equal(HttpStatusCode.OK, (await ClientWith(replacement).GetAsync("/profile")).StatusCode);

        // And the token it replaced is dead, so the new one is not simply the old one again.
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await ClientWith(before).GetAsync("/profile")).StatusCode);
    }

    /// <summary>
    /// <c>POST /auth/refresh</c> mints a new token from a presented one. If revocation were
    /// enforced in the authorization policy instead of during authentication, or if refresh
    /// were exempt, a stolen token could be laundered into a fresh 24-hour one and the whole
    /// mechanism would be decorative.
    /// </summary>
    [Fact]
    public async Task A_revoked_token_cannot_be_refreshed_into_a_live_one()
    {
        var stolen = await LoginAsync(_employee.Email, EmployeePassword);
        var owner = await LoginAsync(_employee.Email, EmployeePassword);

        Assert.Equal(
            HttpStatusCode.OK,
            (await ClientWith(stolen).PostAsync("/auth/refresh", content: null)).StatusCode);

        Assert.Equal(
            HttpStatusCode.OK,
            (await ClientWith(owner).PutAsJsonAsync(
                "/profile/password",
                new ChangePasswordRequest(EmployeePassword, NewPassword))).StatusCode);

        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await ClientWith(stolen).PostAsync("/auth/refresh", content: null)).StatusCode);
    }

    // ------------------------------------------------------------- admin reset

    [Fact]
    public async Task A_token_minted_before_an_admin_credential_reset_is_refused_after_it()
    {
        var employeeSession = await LoginAsync(_employee.Email, EmployeePassword);
        var adminSession = await LoginAsync(_admin.Email, AdminPassword);

        Assert.Equal(HttpStatusCode.OK, (await ClientWith(employeeSession).GetAsync("/profile")).StatusCode);

        var reset = await ClientWith(adminSession).PostAsJsonAsync(
            "/auth/admin/reset-credentials",
            new ResetCredentialsRequest(_employee.Id));
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);

        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await ClientWith(employeeSession).GetAsync("/profile")).StatusCode);
    }

    /// <summary>
    /// Rotation is per user, not per company and not global: resetting somebody else's
    /// credentials must not sign the administrator out of their own console mid-task.
    /// </summary>
    [Fact]
    public async Task An_admin_reset_leaves_the_administrators_own_session_alone()
    {
        var employeeSession = await LoginAsync(_employee.Email, EmployeePassword);
        var adminSession = await LoginAsync(_admin.Email, AdminPassword);

        Assert.Equal(
            HttpStatusCode.OK,
            (await ClientWith(adminSession).PostAsJsonAsync(
                "/auth/admin/reset-credentials",
                new ResetCredentialsRequest(_employee.Id))).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await ClientWith(adminSession).GetAsync("/profile")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await ClientWith(employeeSession).GetAsync("/profile")).StatusCode);
    }

    // ------------------------------------------------------- what is NOT closed

    /// <summary>
    /// A token carrying no <c>securityStamp</c> claim is let through, and that is a
    /// documented limit rather than an oversight: <c>TrackingJwtSecret</c> is shared with the
    /// legacy climate-tracking application, whose tokens know nothing about this column, and
    /// tokens this API issued before #284 shipped have no claim either.
    /// </summary>
    /// <remarks>
    /// This is the one test that hand-builds a token, because nothing in this API can produce
    /// a claim-less one any more — <c>TokenClaims</c> requires the stamp and
    /// <c>SingleTokenMintSiteTests</c> keeps that the only shape. It signs with
    /// <see cref="AuthWebApplicationFactory.TestJwtSecret"/> and otherwise mirrors
    /// <c>JwtTokenService</c>'s claim set.
    ///
    /// The exemption does not weaken the revocation property. A holder of a token this API
    /// minted cannot reach this state: removing the claim means re-signing, which needs the
    /// signing secret — see <c>A_token_carrying_someone_elses_stamp_is_refused</c> for what
    /// happens to a token that carries a stamp that is merely wrong.
    /// </remarks>
    [Fact]
    public async Task A_token_with_no_security_stamp_claim_is_still_accepted()
    {
        var legacyToken = SignWithoutSecurityStamp(_employee);

        Assert.Equal(HttpStatusCode.OK, (await ClientWith(legacyToken).GetAsync("/profile")).StatusCode);
    }

    /// <summary>
    /// The comparison is against the acting user's own row, not "any stamp this database
    /// knows". A token minted for the employee but carrying the administrator's stamp is
    /// refused, which is what stops the check degenerating into a presence test.
    /// </summary>
    [Fact]
    public async Task A_token_carrying_someone_elses_stamp_is_refused()
    {
        using var scope = _factory.Services.CreateScope();
        var jwtTokenService = scope.ServiceProvider.GetRequiredService<IJwtTokenService>();
        var mismatched = jwtTokenService.IssueToken(new TokenClaims(
            Sub: _employee.Id.ToString(),
            Role: _employee.Role,
            NodoId: null,
            Email: _employee.Email,
            Name: _employee.Name,
            CompanyId: _employee.CompanyId?.ToString() ?? string.Empty,
            IsActive: true,
            SecurityStamp: _admin.SecurityStamp));

        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await ClientWith(mismatched).GetAsync("/profile")).StatusCode);
    }

    // ------------------------------------------------------------------ helpers

    private async Task<string> LoginAsync(string email, string password)
    {
        var response = await _factory.CreateClient().PostAsJsonAsync(
            "/auth/login",
            new LoginRequest(email, password));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    private HttpClient ClientWith(string token)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    /// <summary>
    /// <c>JwtTokenService.IssueToken</c>'s claim set minus the <c>securityStamp</c> claim —
    /// i.e. what an issuer that predates the column, or the legacy tracking application,
    /// produces against the same shared secret.
    /// </summary>
    private static string SignWithoutSecurityStamp(User user)
    {
        var now = DateTimeOffset.UtcNow;
        var key = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(AuthWebApplicationFactory.TestJwtSecret));

        var token = new JwtSecurityToken(
            claims:
            [
                new Claim("sub", user.Id.ToString()),
                new Claim("role", user.Role),
                new Claim("nodoId", string.Empty),
                new Claim("email", user.Email),
                new Claim("name", user.Name),
                new Claim("companyId", user.CompanyId?.ToString() ?? string.Empty),
                new Claim("isActive", "true"),
                new Claim(
                    JwtRegisteredClaimNames.Iat,
                    now.ToUnixTimeSeconds().ToString(),
                    ClaimValueTypes.Integer64),
            ],
            expires: now.UtcDateTime.AddHours(1),
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
