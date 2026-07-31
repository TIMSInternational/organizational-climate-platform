# Org structure Slice 2: Users + Invitations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship User admin management (list/detail/update/role-change) and the full invitation flow (create, shareable-link, resend, accept) on top of the existing `#49` schema, plus the identity-mapping columns `#56` needs later.

**Architecture:** Same as Slice 1 — minimal-API endpoints with manual role checks (no `[Authorize(Roles=)]`), `Application/OrgStructure/` services, typed frontend API clients, focused React components (not a port of the 1861-line legacy monolith).

**Tech Stack:** .NET 10 minimal APIs, EF Core/Postgres, xUnit + Testcontainers, React 19 + Vite + react-router-dom, Vitest.

## Global Constraints

- Schema changes in this slice are limited to exactly three additive/nullability changes,
  all in Task 1: `User.PersonaExternalId` (new, nullable), `Department.LegacyExternalId`
  (new, nullable), `UserInvitation.Email` (existing `required string` → nullable `string?`,
  needed because shareable-link invitations don't have a known email until someone uses
  the link). No other schema changes.
- Authorization pattern: `.RequireAuthorization()` on the route + manual role check in the
  handler body, `Results.Forbid()` on failure — copy `DepartmentEndpoints.cs`'s
  `CanAccessCompany` pattern (duplicated per-endpoint-file, matching this codebase's
  established precedent — no shared abstraction). Never `[Authorize(Roles=)]`.
- User management: `Roles.SuperAdmin` can see/manage any company; `Roles.CompanyAdmin` is
  scoped to their own `CompanyId` only. Role changes (`PUT /admin/users/{id}/role`) are
  `Roles.SuperAdmin`-only — a `CompanyAdmin` changing roles (including their own) is a
  privilege-escalation surface, keep it stricter than general user updates.
- No hard delete for `User` — deactivate via `IsActive` on the general update endpoint,
  matching the Company/Department precedent from Slice 1.
- `POST /invitations/{token}/accept` is **unauthenticated by design** — the token itself is
  the credential. Do not add `.RequireAuthorization()` to it.
- Email is stubbed this slice: `IInvitationEmailSender` logs the invitation via `ILogger`,
  no real Brevo call. The invitation response includes the raw `Token` so the frontend can
  build `${window.location.origin}/accept-invitation/${token}` itself — the API does not
  need to know the frontend's base URL for this.
- Shareable links are **accept-once** in this slice (the schema has no uses-counter column)
  — not true multi-use. A `UserInvitation` row of type `employee_self_signup` generates one
  token; using it transitions that same row to `accepted`, same as the other two types.
- Do not build: system settings, demographics, bulk import (Slice 3); `#56`'s `/internal/*`
  endpoints (separate issue); real Brevo email sending; i18n/PWA/design tokens (`#57`).
- `.NET`: don't touch pinned package versions in any `.csproj`.
- Frontend: Node 20 LTS+.

---

## Task 1: Identity-mapping columns + JWT wiring

**Files:**
- Modify: `src/ClimateProject.Domain/Entities/User.cs`
- Modify: `src/ClimateProject.Domain/Entities/Department.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/Configurations/UserConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/Configurations/DepartmentConfiguration.cs`
- Modify: `src/ClimateProject.Domain/Entities/UserInvitation.cs` (`Email` → nullable)
- Modify: `src/ClimateProject.Infrastructure/Persistence/Configurations/UserInvitationConfiguration.cs`
- Modify: `src/ClimateProject.Api/Endpoints/AuthEndpoints.cs` (5 `TokenClaims` call sites)
- Create: EF Core migration (via `dotnet ef migrations add`)
- Test: `tests/ClimateProject.IntegrationTests/Auth/IdentityMappingClaimsTests.cs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `User.PersonaExternalId` (`string?`), `Department.LegacyExternalId` (`string?`)
  — Task 2's list/detail DTOs intentionally do NOT expose these (internal migration
  fields, not user-facing). JWT `sub` claim now prefers `PersonaExternalId` when set.

- [ ] **Step 1: Add the two new columns to the entities**

In `src/ClimateProject.Domain/Entities/User.cs`, add one property (near `NodoId`):

```csharp
    public string? NodoId { get; set; }
    public string? PersonaExternalId { get; set; }
```

In `src/ClimateProject.Domain/Entities/Department.cs`, add one property (near `Id`):

```csharp
    public Guid Id { get; set; }
    public string? LegacyExternalId { get; set; }
    public Guid CompanyId { get; set; }
```

In `src/ClimateProject.Domain/Entities/UserInvitation.cs`, change:

```csharp
    public required string Email { get; set; }
```

to:

```csharp
    public string? Email { get; set; }
```

- [ ] **Step 2: Wire the new columns into EF Core configuration**

In `UserConfiguration.cs`, add after the `NodoId` line:

```csharp
        builder.Property(u => u.NodoId).HasColumnName("nodo_id").HasMaxLength(64);
        builder.Property(u => u.PersonaExternalId).HasColumnName("persona_external_id").HasMaxLength(64);
```

In `DepartmentConfiguration.cs`, add after `builder.HasKey(d => d.Id);`:

```csharp
        builder.HasKey(d => d.Id);
        builder.Property(d => d.LegacyExternalId).HasColumnName("legacy_external_id").HasMaxLength(64);
```

In `UserInvitationConfiguration.cs`, change:

```csharp
        builder.Property(i => i.Email).HasColumnName("email").HasMaxLength(255).IsRequired();
```

to:

```csharp
        builder.Property(i => i.Email).HasColumnName("email").HasMaxLength(255);
```

- [ ] **Step 3: Generate and inspect the migration**

Run from the repo root:

```bash
dotnet ef migrations add AddIdentityMappingColumns \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api
```

Open the generated migration file and confirm it contains exactly three changes: add
column `persona_external_id` to `users`, add column `legacy_external_id` to
`departments`, alter column `email` on `user_invitations` to be nullable. If it contains
anything else, EF Core detected an unrelated pending model change — stop and investigate
before proceeding (do not silently accept an unexpected migration).

- [ ] **Step 4: Update the JWT claim minting in AuthEndpoints.cs**

There are 5 call sites constructing `new TokenClaims(...)` in this file (`LoginAsync`,
`SignupAsync`, `GoogleLoginAsync`, `RefreshAsync`, and one more — search for
`new TokenClaims(` to find all 5). In every one, change:

```csharp
            Sub: user.Id.ToString(),
```

to:

```csharp
            Sub: user.PersonaExternalId ?? user.Id.ToString(),
```

Leave every other line of each `TokenClaims` construction unchanged.

- [ ] **Step 5: Write the failing test**

Create `tests/ClimateProject.IntegrationTests/Auth/IdentityMappingClaimsTests.cs`:

```csharp
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.IdentityModel.Tokens.Jwt;
using ClimateProject.Api.Endpoints;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Auth;

[Collection("Postgres")]
public class IdentityMappingClaimsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _emailDomain = $"idmap-{Guid.NewGuid():N}.test";

    public IdentityMappingClaimsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Companies.Add(new Company { Id = Guid.NewGuid(), Name = "IdMap Co", EmailDomain = _emailDomain, CreatedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static string DecodeSubClaim(string token)
        => new JwtSecurityTokenHandler().ReadJwtToken(token).Claims.First(c => c.Type == "sub").Value;

    [Fact]
    public async Task Login_uses_fresh_guid_as_sub_when_PersonaExternalId_is_not_set()
    {
        var client = _factory.CreateClient();
        var email = $"noexternal@{_emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("No External", email, "a-good-password"));
        var signupToken = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        Guid userId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = db.Users.First(u => u.Email == email);
            userId = user.Id;
            Assert.Null(user.PersonaExternalId);
        }

        Assert.Equal(userId.ToString(), DecodeSubClaim(signupToken));
    }

    [Fact]
    public async Task Login_uses_PersonaExternalId_as_sub_when_it_is_set()
    {
        var client = _factory.CreateClient();
        var email = $"hasexternal@{_emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Has External", email, "a-good-password"));
        await signup.Content.ReadFromJsonAsync<TokenResponse>();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = db.Users.First(u => u.Email == email);
            user.PersonaExternalId = "legacy-mongo-id-abc123";
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        var loginToken = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        Assert.Equal("legacy-mongo-id-abc123", DecodeSubClaim(loginToken));
    }
}
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~IdentityMappingClaimsTests"`
Expected: FAIL (compile error until Steps 1-4 are done, or assertion failure if done
out of order — run this step only after Steps 1-4 are complete, to confirm the test
itself is well-formed against the real schema/endpoint before trusting a later green run).

- [ ] **Step 7: Run the test to verify it passes**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~IdentityMappingClaimsTests"`
Expected: PASS, 2/2.

- [ ] **Step 8: Run the full backend suite to confirm no regressions**

Run: `dotnet test ClimateProject.slnx`
Expected: all tests pass (140 baseline + 2 new = 142; a pre-existing flaky test,
`StartupValidationTests.Missing_TrackingJwtSecret_fails_startup_instead_of_accepting_traffic`,
is known to occasionally fail under full-suite parallel execution and pass on retry — see
`[[project_org_structure_slice1_complete]]` memory; retry once before treating a failure
there as real).

- [ ] **Step 9: Commit**

```bash
git add src/ClimateProject.Domain/Entities/User.cs src/ClimateProject.Domain/Entities/Department.cs \
        src/ClimateProject.Domain/Entities/UserInvitation.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/UserConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/DepartmentConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/UserInvitationConfiguration.cs \
        src/ClimateProject.Infrastructure/Migrations/ \
        src/ClimateProject.Api/Endpoints/AuthEndpoints.cs \
        tests/ClimateProject.IntegrationTests/Auth/IdentityMappingClaimsTests.cs
git commit -m "feat: add identity-mapping columns and prefer PersonaExternalId in JWT sub claim"
```

---

## Task 2: User admin endpoints

**Files:**
- Create: `src/ClimateProject.Application/OrgStructure/UserDtos.cs`
- Create: `src/ClimateProject.Api/Endpoints/UserEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs` (register `app.MapUserEndpoints();`)
- Test: `tests/ClimateProject.IntegrationTests/OrgStructure/UserEndpointsTests.cs`

**Interfaces:**
- Consumes: `Roles`, `CurrentUser`/`GetCurrentUser()` (existing), `User` entity (Task 1's
  `PersonaExternalId` is NOT exposed here).
- Produces: `UserListItem`, `UserDetail`, `UpdateUserRequest`, `UpdateUserRoleRequest` DTOs
  and the 3 endpoints below — Task 3 does not consume these, but Task 6 (frontend) does.

- [ ] **Step 1: Write the DTOs**

Create `src/ClimateProject.Application/OrgStructure/UserDtos.cs`:

```csharp
namespace ClimateProject.Application.OrgStructure;

public sealed record UserListItem(
    Guid Id,
    string Email,
    string Name,
    string Role,
    Guid? DepartmentId,
    bool IsActive,
    DateTimeOffset? LastLoginAt,
    DateTimeOffset CreatedAt);

public sealed record UserListResponse(IReadOnlyList<UserListItem> Users);

public sealed record UserDetail(
    Guid Id,
    Guid CompanyId,
    string Email,
    string Name,
    string Role,
    Guid? DepartmentId,
    Guid? ManagerId,
    bool IsActive,
    DateTimeOffset? LastLoginAt,
    DateTimeOffset CreatedAt);

public sealed record UpdateUserRequest(
    string? Name,
    Guid? DepartmentId,
    Guid? ManagerId,
    bool? IsActive);

public sealed record UpdateUserRoleRequest(string Role);
```

- [ ] **Step 2: Write the failing tests**

Create `tests/ClimateProject.IntegrationTests/OrgStructure/UserEndpointsTests.cs`:

```csharp
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~UserEndpointsTests"`
Expected: FAIL (compile error — `UserEndpoints` doesn't exist yet).

- [ ] **Step 4: Implement the endpoints**

Create `src/ClimateProject.Api/Endpoints/UserEndpoints.cs`:

```csharp
using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class UserEndpoints
{
    public static void MapUserEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/users").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapPut("/{id:guid}/role", UpdateRoleAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || currentUser.CompanyId == companyId.ToString();

    private static UserListItem ToListItem(User u)
        => new(u.Id, u.Email, u.Name, u.Role, u.DepartmentId, u.IsActive, u.LastLoginAt, u.CreatedAt);

    private static UserDetail ToDetail(User u)
        => new(u.Id, u.CompanyId, u.Email, u.Name, u.Role, u.DepartmentId, u.ManagerId, u.IsActive, u.LastLoginAt, u.CreatedAt);

    private static async Task<IResult> ListAsync(
        Guid companyId,
        Guid? departmentId,
        string? role,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        var query = db.Users.Where(u => u.CompanyId == companyId);
        if (departmentId.HasValue)
        {
            query = query.Where(u => u.DepartmentId == departmentId.Value);
        }

        if (!string.IsNullOrWhiteSpace(role))
        {
            query = query.Where(u => u.Role == role);
        }

        var users = await query
            .OrderBy(u => u.Name)
            .Select(u => new UserListItem(u.Id, u.Email, u.Name, u.Role, u.DepartmentId, u.IsActive, u.LastLoginAt, u.CreatedAt))
            .ToListAsync(cancellationToken);

        return Results.Ok(new UserListResponse(users));
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, cancellationToken);
        if (user is null)
        {
            return Results.Json(new { message = "User not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, user.CompanyId))
        {
            return Results.Forbid();
        }

        return Results.Ok(ToDetail(user));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateUserRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, cancellationToken);
        if (user is null)
        {
            return Results.Json(new { message = "User not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, user.CompanyId))
        {
            return Results.Forbid();
        }

        if (!string.IsNullOrWhiteSpace(request.Name))
        {
            user.Name = request.Name.Trim();
        }

        if (request.DepartmentId.HasValue)
        {
            var department = await db.Departments.FirstOrDefaultAsync(d => d.Id == request.DepartmentId.Value, cancellationToken);
            if (department is null || department.CompanyId != user.CompanyId)
            {
                return Results.Json(new { message = "Department must exist in the same company" }, statusCode: 400);
            }

            user.DepartmentId = request.DepartmentId.Value;
        }

        if (request.ManagerId.HasValue)
        {
            var manager = await db.Users.FirstOrDefaultAsync(m => m.Id == request.ManagerId.Value, cancellationToken);
            if (manager is null || manager.CompanyId != user.CompanyId)
            {
                return Results.Json(new { message = "Manager must exist in the same company" }, statusCode: 400);
            }

            user.ManagerId = request.ManagerId.Value;
        }

        if (request.IsActive.HasValue)
        {
            user.IsActive = request.IsActive.Value;
        }

        user.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(user));
    }

    private static async Task<IResult> UpdateRoleAsync(
        Guid id,
        UpdateUserRoleRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        if (!Roles.All.Contains(request.Role))
        {
            return Results.Json(new { message = "Invalid role" }, statusCode: 400);
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, cancellationToken);
        if (user is null)
        {
            return Results.Json(new { message = "User not found" }, statusCode: 404);
        }

        user.Role = request.Role;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(user));
    }
}
```

- [ ] **Step 5: Register the endpoint group**

In `src/ClimateProject.Api/Program.cs`, add after `app.MapDepartmentEndpoints();`:

```csharp
app.MapDepartmentEndpoints();
app.MapUserEndpoints();
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~UserEndpointsTests"`
Expected: PASS, 5/5.

- [ ] **Step 7: Run the full backend suite**

Run: `dotnet test ClimateProject.slnx`
Expected: all pass (142 + 5 = 147; see Task 1 Step 8's note on the known flaky
`StartupValidationTests` test).

- [ ] **Step 8: Commit**

```bash
git add src/ClimateProject.Application/OrgStructure/UserDtos.cs \
        src/ClimateProject.Api/Endpoints/UserEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/OrgStructure/UserEndpointsTests.cs
git commit -m "feat: add User admin endpoints (list/get/update/role-change)"
```

---

## Task 3: Invitation creation, list, and resend endpoints

**Files:**
- Create: `src/ClimateProject.Application/OrgStructure/InvitationDtos.cs`
- Create: `src/ClimateProject.Application/OrgStructure/InvitationValidation.cs`
- Create: `src/ClimateProject.Application/OrgStructure/IInvitationEmailSender.cs`
- Create: `src/ClimateProject.Infrastructure/OrgStructure/LoggingInvitationEmailSender.cs`
- Create: `src/ClimateProject.Api/Endpoints/InvitationEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs` (register the sender + `app.MapInvitationEndpoints();`)
- Test: `tests/ClimateProject.IntegrationTests/OrgStructure/InvitationEndpointsTests.cs`

**Interfaces:**
- Consumes: `Roles`, `CanAccessCompany`-equivalent (own copy), `UserInvitation` entity
  (Task 1's nullable `Email`).
- Produces: `IInvitationEmailSender.SendAsync(UserInvitation, CancellationToken)` — Task 4
  does not consume this (accept doesn't send email), Task 3 registers the only
  implementation. `InvitationDetail` DTO (includes `Token`) — Task 7 (frontend) consumes
  its shape.

- [ ] **Step 1: Write the validation constants**

Create `src/ClimateProject.Application/OrgStructure/InvitationValidation.cs`:

```csharp
namespace ClimateProject.Application.OrgStructure;

public static class InvitationValidation
{
    public const string TypeCompanyAdminSetup = "company_admin_setup";
    public const string TypeEmployeeDirect = "employee_direct";
    public const string TypeEmployeeSelfSignup = "employee_self_signup";

    public const string StatusPending = "pending";
    public const string StatusSent = "sent";
    public const string StatusAccepted = "accepted";
}
```

- [ ] **Step 2: Write the DTOs and the email-sender interface**

Create `src/ClimateProject.Application/OrgStructure/InvitationDtos.cs`:

```csharp
namespace ClimateProject.Application.OrgStructure;

public sealed record InvitationDetail(
    Guid Id,
    string? Email,
    Guid CompanyId,
    Guid? DepartmentId,
    string InvitationType,
    string Role,
    string Status,
    string Token,
    DateTimeOffset ExpiresAt,
    DateTimeOffset? SentAt,
    DateTimeOffset? AcceptedAt,
    int ReminderCount);

public sealed record InvitationListResponse(IReadOnlyList<InvitationDetail> Invitations);

public sealed record CreateInvitationRequest(
    string InvitationType,
    string Email,
    Guid CompanyId,
    Guid? DepartmentId,
    string Role);

public sealed record CreateShareableLinkRequest(
    Guid CompanyId,
    Guid? DepartmentId,
    string Role);
```

Create `src/ClimateProject.Application/OrgStructure/IInvitationEmailSender.cs`:

```csharp
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.OrgStructure;

public interface IInvitationEmailSender
{
    Task SendAsync(UserInvitation invitation, CancellationToken cancellationToken);
}
```

- [ ] **Step 3: Write the stub email sender**

Create `src/ClimateProject.Infrastructure/OrgStructure/LoggingInvitationEmailSender.cs`:

```csharp
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.OrgStructure;

public class LoggingInvitationEmailSender(ILogger<LoggingInvitationEmailSender> logger) : IInvitationEmailSender
{
    public Task SendAsync(UserInvitation invitation, CancellationToken cancellationToken)
    {
        logger.LogInformation(
            "Invitation email stubbed -- would send to {Email} (type {InvitationType}), token {Token}, expires {ExpiresAt}",
            invitation.Email ?? "(no email -- shareable link)",
            invitation.InvitationType,
            invitation.InvitationToken,
            invitation.ExpiresAt);
        return Task.CompletedTask;
    }
}
```

- [ ] **Step 4: Write the failing tests**

Create `tests/ClimateProject.IntegrationTests/OrgStructure/InvitationEndpointsTests.cs`:

```csharp
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
public class InvitationEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"invitea-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"inviteb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public InvitationEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "Invite Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Invite Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, string emailDomain, Guid companyId)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    [Fact]
    public async Task SuperAdmin_can_create_a_company_admin_setup_invitation()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationType: InvitationValidation.TypeCompanyAdminSetup,
            Email: "new-admin@invitee.test",
            CompanyId: _companyBId,
            DepartmentId: null,
            Role: Roles.Employee)); // deliberately wrong role -- server must force company_admin

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<InvitationDetail>();
        Assert.Equal(Roles.CompanyAdmin, created!.Role);
        Assert.Equal(InvitationValidation.StatusSent, created.Status);
        Assert.False(string.IsNullOrEmpty(created.Token));
    }

    [Fact]
    public async Task CompanyAdmin_cannot_create_a_company_admin_setup_invitation()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationType: InvitationValidation.TypeCompanyAdminSetup,
            Email: "new-admin@invitee.test",
            CompanyId: _companyAId,
            DepartmentId: null,
            Role: Roles.CompanyAdmin));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_can_create_an_employee_direct_invitation_in_their_own_company_only()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var ownCompany = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationType: InvitationValidation.TypeEmployeeDirect,
            Email: "employee@invitee.test",
            CompanyId: _companyAId,
            DepartmentId: null,
            Role: Roles.Employee));
        Assert.Equal(HttpStatusCode.Created, ownCompany.StatusCode);

        var otherCompany = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationType: InvitationValidation.TypeEmployeeDirect,
            Email: "employee2@invitee.test",
            CompanyId: _companyBId,
            DepartmentId: null,
            Role: Roles.Employee));
        Assert.Equal(HttpStatusCode.Forbidden, otherCompany.StatusCode);
    }

    [Fact]
    public async Task Employee_direct_invitation_rejects_superadmin_role()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationType: InvitationValidation.TypeEmployeeDirect,
            Email: "wannabe@invitee.test",
            CompanyId: _companyAId,
            DepartmentId: null,
            Role: Roles.SuperAdmin));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Shareable_link_creates_an_invitation_with_no_email()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/invitations/shareable-link", new CreateShareableLinkRequest(
            CompanyId: _companyAId,
            DepartmentId: null,
            Role: Roles.Employee));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<InvitationDetail>();
        Assert.Null(created!.Email);
        Assert.Equal(InvitationValidation.TypeEmployeeSelfSignup, created.InvitationType);
    }

    [Fact]
    public async Task Resend_regenerates_the_token_and_extends_expiry()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationType: InvitationValidation.TypeEmployeeDirect,
            Email: "resend-me@invitee.test",
            CompanyId: _companyAId,
            DepartmentId: null,
            Role: Roles.Employee));
        var created = await createResponse.Content.ReadFromJsonAsync<InvitationDetail>();

        var resendResponse = await client.PostAsync($"/admin/invitations/{created!.Id}/resend", content: null);
        Assert.Equal(HttpStatusCode.OK, resendResponse.StatusCode);
        var resent = await resendResponse.Content.ReadFromJsonAsync<InvitationDetail>();
        Assert.NotEqual(created.Token, resent!.Token);
        Assert.Equal(1, resent.ReminderCount);
    }

    [Fact]
    public async Task List_returns_invitations_scoped_to_the_callers_company()
    {
        var client = _factory.CreateClient();
        var tokenA = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);
        await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationValidation.TypeEmployeeDirect, "listme@invitee.test", _companyAId, null, Roles.Employee));

        var listResponse = await client.GetAsync($"/admin/invitations?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        var list = await listResponse.Content.ReadFromJsonAsync<InvitationListResponse>();
        Assert.Contains(list!.Invitations, i => i.Email == "listme@invitee.test");

        var otherCompanyList = await client.GetAsync($"/admin/invitations?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.Forbidden, otherCompanyList.StatusCode);
    }
}
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~InvitationEndpointsTests"`
Expected: FAIL (compile error — `InvitationEndpoints` doesn't exist yet).

- [ ] **Step 6: Implement the endpoints**

Create `src/ClimateProject.Api/Endpoints/InvitationEndpoints.cs`:

```csharp
using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class InvitationEndpoints
{
    private static readonly TimeSpan InvitationLifetime = TimeSpan.FromDays(7);

    public static void MapInvitationEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/invitations").RequireAuthorization();

        group.MapPost("", CreateAsync);
        group.MapPost("/shareable-link", CreateShareableLinkAsync);
        group.MapPost("/{id:guid}/resend", ResendAsync);
        group.MapGet("", ListAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || currentUser.CompanyId == companyId.ToString();

    private static InvitationDetail ToDetail(UserInvitation i)
        => new(i.Id, i.Email, i.CompanyId, i.DepartmentId, i.InvitationType, i.Role, i.Status,
               i.InvitationToken, i.ExpiresAt, i.SentAt, i.AcceptedAt, i.ReminderCount);

    // UserInvitation.InvitedBy is a FK to Users.Id (a Guid) -- it is NOT the JWT's `sub`
    // claim. Task 1 changes `sub` to prefer PersonaExternalId (an arbitrary legacy string,
    // not necessarily a Guid) once that backfill runs, so parsing currentUser.Sub as a Guid
    // here would silently break for any user with a populated PersonaExternalId. Resolve
    // the acting user's real Id via their (unique, stable) email instead.
    private static async Task<Guid> ResolveActingUserIdAsync(CurrentUser currentUser, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var actingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == currentUser.Email, cancellationToken);
        return actingUser?.Id ?? Guid.Empty;
    }

    private static async Task<IResult> CreateAsync(
        CreateInvitationRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IInvitationEmailSender emailSender,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        string role;
        if (request.InvitationType == InvitationValidation.TypeCompanyAdminSetup)
        {
            if (currentUser.Role != Roles.SuperAdmin)
            {
                return Results.Forbid();
            }

            role = Roles.CompanyAdmin;
        }
        else if (request.InvitationType == InvitationValidation.TypeEmployeeDirect)
        {
            if (!Roles.Admin.Contains(currentUser.Role) || !CanAccessCompany(currentUser, request.CompanyId))
            {
                return Results.Forbid();
            }

            if (request.Role == Roles.SuperAdmin || !Roles.All.Contains(request.Role))
            {
                return Results.Json(new { message = "Invalid role for an employee invitation" }, statusCode: 400);
            }

            role = request.Role;
        }
        else
        {
            return Results.Json(new { message = "Invalid invitation type" }, statusCode: 400);
        }

        if (string.IsNullOrWhiteSpace(request.Email))
        {
            return Results.Json(new { message = "Email is required" }, statusCode: 400);
        }

        if (request.DepartmentId.HasValue)
        {
            var department = await db.Departments.FirstOrDefaultAsync(d => d.Id == request.DepartmentId.Value, cancellationToken);
            if (department is null || department.CompanyId != request.CompanyId)
            {
                return Results.Json(new { message = "Department must exist in the same company" }, statusCode: 400);
            }
        }

        var now = DateTimeOffset.UtcNow;
        var invitedBy = await ResolveActingUserIdAsync(currentUser, db, cancellationToken);
        var invitation = new UserInvitation
        {
            Id = Guid.NewGuid(),
            Email = request.Email.ToLowerInvariant(),
            CompanyId = request.CompanyId,
            DepartmentId = request.DepartmentId,
            InvitedBy = invitedBy,
            InvitationToken = Guid.NewGuid().ToString("N"),
            InvitationType = request.InvitationType,
            Role = role,
            Status = InvitationValidation.StatusPending,
            ExpiresAt = now.Add(InvitationLifetime),
            ReminderCount = 0,
        };

        db.UserInvitations.Add(invitation);
        await emailSender.SendAsync(invitation, cancellationToken);
        invitation.Status = InvitationValidation.StatusSent;
        invitation.SentAt = now;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(ToDetail(invitation), statusCode: 201);
    }

    private static async Task<IResult> CreateShareableLinkAsync(
        CreateShareableLinkRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IInvitationEmailSender emailSender,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role) || !CanAccessCompany(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        if (request.Role == Roles.SuperAdmin || !Roles.All.Contains(request.Role))
        {
            return Results.Json(new { message = "Invalid role for a shareable link" }, statusCode: 400);
        }

        if (request.DepartmentId.HasValue)
        {
            var department = await db.Departments.FirstOrDefaultAsync(d => d.Id == request.DepartmentId.Value, cancellationToken);
            if (department is null || department.CompanyId != request.CompanyId)
            {
                return Results.Json(new { message = "Department must exist in the same company" }, statusCode: 400);
            }
        }

        var now = DateTimeOffset.UtcNow;
        var invitedBy = await ResolveActingUserIdAsync(currentUser, db, cancellationToken);
        var invitation = new UserInvitation
        {
            Id = Guid.NewGuid(),
            Email = null,
            CompanyId = request.CompanyId,
            DepartmentId = request.DepartmentId,
            InvitedBy = invitedBy,
            InvitationToken = Guid.NewGuid().ToString("N"),
            InvitationType = InvitationValidation.TypeEmployeeSelfSignup,
            Role = request.Role,
            Status = InvitationValidation.StatusSent,
            ExpiresAt = now.Add(InvitationLifetime),
            SentAt = now,
            ReminderCount = 0,
        };

        db.UserInvitations.Add(invitation);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(ToDetail(invitation), statusCode: 201);
    }

    private static async Task<IResult> ResendAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IInvitationEmailSender emailSender,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var invitation = await db.UserInvitations.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (invitation is null)
        {
            return Results.Json(new { message = "Invitation not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, invitation.CompanyId))
        {
            return Results.Forbid();
        }

        if (invitation.Status == InvitationValidation.StatusAccepted)
        {
            return Results.Json(new { message = "Invitation has already been accepted" }, statusCode: 409);
        }

        var now = DateTimeOffset.UtcNow;
        invitation.InvitationToken = Guid.NewGuid().ToString("N");
        invitation.ExpiresAt = now.Add(InvitationLifetime);
        invitation.ReminderCount += 1;
        invitation.LastReminderSentAt = now;
        invitation.Status = InvitationValidation.StatusSent;
        invitation.SentAt = now;

        await emailSender.SendAsync(invitation, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(invitation));
    }

    private static async Task<IResult> ListAsync(
        Guid companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        var invitations = await db.UserInvitations
            .Where(i => i.CompanyId == companyId)
            .OrderByDescending(i => i.SentAt ?? DateTimeOffset.MinValue)
            .Select(i => new InvitationDetail(i.Id, i.Email, i.CompanyId, i.DepartmentId, i.InvitationType, i.Role, i.Status,
                i.InvitationToken, i.ExpiresAt, i.SentAt, i.AcceptedAt, i.ReminderCount))
            .ToListAsync(cancellationToken);

        return Results.Ok(new InvitationListResponse(invitations));
    }
}
```

- [ ] **Step 7: Register the DI service and endpoint group**

In `src/ClimateProject.Api/Program.cs`, add near the other `AddScoped` registrations:

```csharp
builder.Services.AddScoped<IPasswordHasher, BcryptPasswordHasher>();
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<IGoogleTokenVerifier, GoogleTokenVerifier>();
builder.Services.AddScoped<IInvitationEmailSender, LoggingInvitationEmailSender>();
```

Add `using ClimateProject.Infrastructure.OrgStructure;` to the top of `Program.cs`. And
after `app.MapUserEndpoints();`:

```csharp
app.MapUserEndpoints();
app.MapInvitationEndpoints();
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~InvitationEndpointsTests"`
Expected: PASS, 7/7.

- [ ] **Step 9: Run the full backend suite**

Run: `dotnet test ClimateProject.slnx`
Expected: all pass (147 + 7 = 154; see Task 1 Step 8's note on the known flaky test).

- [ ] **Step 10: Commit**

```bash
git add src/ClimateProject.Application/OrgStructure/InvitationDtos.cs \
        src/ClimateProject.Application/OrgStructure/InvitationValidation.cs \
        src/ClimateProject.Application/OrgStructure/IInvitationEmailSender.cs \
        src/ClimateProject.Infrastructure/OrgStructure/LoggingInvitationEmailSender.cs \
        src/ClimateProject.Api/Endpoints/InvitationEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/OrgStructure/InvitationEndpointsTests.cs
git commit -m "feat: add invitation create/shareable-link/resend/list endpoints with stubbed email"
```

---

## Task 4: Invitation-accept endpoint (unauthenticated)

**Files:**
- Modify: `src/ClimateProject.Application/OrgStructure/InvitationDtos.cs` (add
  `AcceptInvitationRequest`)
- Create: `src/ClimateProject.Api/Endpoints/InvitationAcceptEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs` (register `app.MapInvitationAcceptEndpoints();`)
- Test: `tests/ClimateProject.IntegrationTests/OrgStructure/InvitationAcceptEndpointTests.cs`

**Interfaces:**
- Consumes: `IPasswordHasher`, `IJwtTokenService`, `TokenClaims` (all existing, from
  `Application.Auth`), `TokenResponse` (existing, `ClimateProject.Api.Endpoints` namespace
  — this file is in the same namespace, no import needed), `Roles.All` (Task 2/3's
  pattern), `InvitationValidation` (Task 3).
- Produces: `POST /invitations/{token}/accept` — Task 8 (frontend `AcceptInvitationPage`)
  consumes this.

- [ ] **Step 1: Add the request DTO**

In `src/ClimateProject.Application/OrgStructure/InvitationDtos.cs`, add at the end:

```csharp
public sealed record AcceptInvitationRequest(string? Email, string Name, string Password);
```

- [ ] **Step 2: Write the failing tests**

Create `tests/ClimateProject.IntegrationTests/OrgStructure/InvitationAcceptEndpointTests.cs`:

```csharp
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
public class InvitationAcceptEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"accept-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public InvitationAcceptEndpointTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Accept Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<UserInvitation> CreateDirectInvitationAsync(string email, string? expiresOverride = null)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var invitation = new UserInvitation
        {
            Id = Guid.NewGuid(),
            Email = email,
            CompanyId = _companyId,
            InvitedBy = Guid.NewGuid(),
            InvitationToken = Guid.NewGuid().ToString("N"),
            InvitationType = InvitationValidation.TypeEmployeeDirect,
            Role = Roles.Employee,
            Status = InvitationValidation.StatusSent,
            ExpiresAt = expiresOverride is null ? DateTimeOffset.UtcNow.AddDays(7) : DateTimeOffset.UtcNow.AddDays(-1),
            SentAt = DateTimeOffset.UtcNow,
            ReminderCount = 0,
        };
        db.UserInvitations.Add(invitation);
        await db.SaveChangesAsync();
        return invitation;
    }

    [Fact]
    public async Task Accepting_a_direct_invitation_creates_an_active_user_and_returns_a_token()
    {
        var invitation = await CreateDirectInvitationAsync("directinvitee@example.test");
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            $"/invitations/{invitation.InvitationToken}/accept",
            new AcceptInvitationRequest(Email: null, Name: "Direct Invitee", Password: "a-good-password"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var token = (await response.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        Assert.False(string.IsNullOrEmpty(token));

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == "directinvitee@example.test");
        Assert.NotNull(user);
        Assert.Equal(_companyId, user!.CompanyId);
        Assert.True(user.IsActive);

        var reloaded = await db.UserInvitations.FirstAsync(i => i.Id == invitation.Id);
        Assert.Equal(InvitationValidation.StatusAccepted, reloaded.Status);
    }

    [Fact]
    public async Task Accepting_an_expired_invitation_fails()
    {
        var invitation = await CreateDirectInvitationAsync("expired@example.test", expiresOverride: "expired");
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            $"/invitations/{invitation.InvitationToken}/accept",
            new AcceptInvitationRequest(Email: null, Name: "Too Late", Password: "a-good-password"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Accepting_an_already_accepted_invitation_fails()
    {
        var invitation = await CreateDirectInvitationAsync("twice@example.test");
        var client = _factory.CreateClient();

        var first = await client.PostAsJsonAsync(
            $"/invitations/{invitation.InvitationToken}/accept",
            new AcceptInvitationRequest(Email: null, Name: "First Try", Password: "a-good-password"));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var second = await client.PostAsJsonAsync(
            $"/invitations/{invitation.InvitationToken}/accept",
            new AcceptInvitationRequest(Email: null, Name: "Second Try", Password: "another-password"));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Accepting_an_unknown_token_returns_404()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync(
            "/invitations/not-a-real-token/accept",
            new AcceptInvitationRequest(Email: null, Name: "Nobody", Password: "a-good-password"));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Accepting_a_shareable_link_requires_an_email_matching_the_companys_domain()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.UserInvitations.Add(new UserInvitation
            {
                Id = Guid.NewGuid(),
                Email = null,
                CompanyId = _companyId,
                InvitedBy = Guid.NewGuid(),
                InvitationToken = "shareable-token-1",
                InvitationType = InvitationValidation.TypeEmployeeSelfSignup,
                Role = Roles.Employee,
                Status = InvitationValidation.StatusSent,
                ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
                SentAt = DateTimeOffset.UtcNow,
                ReminderCount = 0,
            });
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();

        var wrongDomain = await client.PostAsJsonAsync(
            "/invitations/shareable-token-1/accept",
            new AcceptInvitationRequest(Email: $"someone@not-{_companyDomain}", Name: "Wrong Domain", Password: "a-good-password"));
        Assert.Equal(HttpStatusCode.BadRequest, wrongDomain.StatusCode);

        var rightDomain = await client.PostAsJsonAsync(
            "/invitations/shareable-token-1/accept",
            new AcceptInvitationRequest(Email: $"someone@{_companyDomain}", Name: "Right Domain", Password: "a-good-password"));
        Assert.Equal(HttpStatusCode.Created, rightDomain.StatusCode);
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~InvitationAcceptEndpointTests"`
Expected: FAIL (compile error — the endpoint doesn't exist yet).

- [ ] **Step 4: Implement the endpoint**

Create `src/ClimateProject.Api/Endpoints/InvitationAcceptEndpoints.cs`:

```csharp
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class InvitationAcceptEndpoints
{
    public static void MapInvitationAcceptEndpoints(this WebApplication app)
    {
        app.MapPost("/invitations/{token}/accept", AcceptAsync);
    }

    private static async Task<IResult> AcceptAsync(
        string token,
        AcceptInvitationRequest request,
        ClimateProjectDbContext db,
        IPasswordHasher passwordHasher,
        IJwtTokenService jwtTokenService,
        CancellationToken cancellationToken)
    {
        var invitation = await db.UserInvitations.FirstOrDefaultAsync(i => i.InvitationToken == token, cancellationToken);
        if (invitation is null)
        {
            return Results.Json(new { message = "Invitation not found" }, statusCode: 404);
        }

        if (invitation.Status == InvitationValidation.StatusAccepted)
        {
            return Results.Json(new { message = "Invitation has already been accepted" }, statusCode: 409);
        }

        if (invitation.ExpiresAt < DateTimeOffset.UtcNow)
        {
            return Results.Json(new { message = "Invitation has expired" }, statusCode: 400);
        }

        if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Password))
        {
            return Results.Json(new { message = "Name and password are required" }, statusCode: 400);
        }

        if (request.Password.Length < 8)
        {
            return Results.Json(new { message = "Password must be at least 8 characters long" }, statusCode: 400);
        }

        string email;
        if (invitation.Email is not null)
        {
            email = invitation.Email;
        }
        else
        {
            if (string.IsNullOrWhiteSpace(request.Email))
            {
                return Results.Json(new { message = "Email is required for a shareable-link invitation" }, statusCode: 400);
            }

            var company = await db.Companies.FirstOrDefaultAsync(c => c.Id == invitation.CompanyId, cancellationToken);
            var candidateEmail = request.Email.ToLowerInvariant();
            var domain = candidateEmail.Contains('@') ? candidateEmail.Split('@')[1] : string.Empty;
            if (company?.EmailDomain is not null && domain != company.EmailDomain)
            {
                return Results.Json(new { message = "Email domain does not match this company" }, statusCode: 400);
            }

            email = candidateEmail;
        }

        var existingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == email, cancellationToken);
        if (existingUser is not null)
        {
            return Results.Json(new { message = "A user with this email already exists" }, statusCode: 409);
        }

        var now = DateTimeOffset.UtcNow;
        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = invitation.CompanyId,
            Email = email,
            Name = request.Name.Trim(),
            PasswordHash = passwordHasher.Hash(request.Password),
            Role = invitation.Role,
            DepartmentId = invitation.DepartmentId,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Users.Add(user);

        invitation.Status = InvitationValidation.StatusAccepted;
        invitation.AcceptedAt = now;

        await db.SaveChangesAsync(cancellationToken);

        var jwt = jwtTokenService.IssueToken(new TokenClaims(
            Sub: user.PersonaExternalId ?? user.Id.ToString(),
            Role: user.Role,
            NodoId: user.NodoId,
            Email: user.Email,
            Name: user.Name,
            CompanyId: user.CompanyId.ToString(),
            IsActive: user.IsActive));

        return Results.Json(new TokenResponse(jwt), statusCode: 201);
    }
}
```

- [ ] **Step 5: Register the endpoint**

In `src/ClimateProject.Api/Program.cs`, add after `app.MapInvitationEndpoints();`:

```csharp
app.MapInvitationEndpoints();
app.MapInvitationAcceptEndpoints();
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~InvitationAcceptEndpointTests"`
Expected: PASS, 5/5.

- [ ] **Step 7: Run the full backend suite**

Run: `dotnet test ClimateProject.slnx`
Expected: all pass (154 + 5 = 159; see Task 1 Step 8's note on the known flaky test).

- [ ] **Step 8: Commit**

```bash
git add src/ClimateProject.Application/OrgStructure/InvitationDtos.cs \
        src/ClimateProject.Api/Endpoints/InvitationAcceptEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/OrgStructure/InvitationAcceptEndpointTests.cs
git commit -m "feat: add unauthenticated invitation-accept endpoint"
```

---

## Task 5: Frontend typed API clients

**Files:**
- Create: `web/src/features/org-structure/api/users.ts`
- Create: `web/src/features/org-structure/api/users.test.ts`
- Create: `web/src/features/org-structure/api/invitations.ts`
- Create: `web/src/features/org-structure/api/invitations.test.ts`

**Interfaces:**
- Consumes: `authFetch` (`web/src/api/authFetch.ts`, existing).
- Produces: `listUsers`, `getUser`, `updateUser`, `updateUserRole`, `User`/`UserDetail`/
  `UpdateUserInput` types; `listInvitations`, `createInvitation`, `createShareableLink`,
  `resendInvitation`, `Invitation`/`CreateInvitationInput`/`CreateShareableLinkInput` types
  — Task 6/7 consume these. `acceptInvitation` is separate (Task 8, unauthenticated,
  doesn't use `authFetch`'s bearer-token injection — see that task).

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/org-structure/api/users.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listUsers, getUser, updateUser, updateUserRole } from './users'

const baseUrl = 'http://api.test'

describe('users api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists users with query params', async () => {
    const users = [{ id: '1', email: 'a@b.com', name: 'A', role: 'employee', departmentId: null, isActive: true, lastLoginAt: null, createdAt: '2026-01-01' }]
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ users }), { status: 200 }))

    const result = await listUsers(baseUrl, 'company-1')

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/users?companyId=company-1`, expect.anything())
    expect(result).toEqual(users)
  })

  it('gets a single user', async () => {
    const user = { id: '1', companyId: 'company-1', email: 'a@b.com', name: 'A', role: 'employee', departmentId: null, managerId: null, isActive: true, lastLoginAt: null, createdAt: '2026-01-01' }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))

    const result = await getUser(baseUrl, '1')

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/users/1`, expect.anything())
    expect(result).toEqual(user)
  })

  it('updates a user', async () => {
    const updated = { id: '1', companyId: 'company-1', email: 'a@b.com', name: 'Renamed', role: 'employee', departmentId: null, managerId: null, isActive: false, lastLoginAt: null, createdAt: '2026-01-01' }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }))

    const result = await updateUser(baseUrl, '1', { name: 'Renamed', isActive: false })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/users/1`, expect.objectContaining({ method: 'PUT' }))
    expect(result.name).toBe('Renamed')
  })

  it('updates a user role', async () => {
    const updated = { id: '1', companyId: 'company-1', email: 'a@b.com', name: 'A', role: 'supervisor', departmentId: null, managerId: null, isActive: true, lastLoginAt: null, createdAt: '2026-01-01' }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }))

    const result = await updateUserRole(baseUrl, '1', 'supervisor')

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/users/1/role`, expect.objectContaining({ method: 'PUT' }))
    expect(result.role).toBe('supervisor')
  })
})
```

Create `web/src/features/org-structure/api/invitations.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listInvitations, createInvitation, createShareableLink, resendInvitation } from './invitations'

const baseUrl = 'http://api.test'

describe('invitations api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists invitations for a company', async () => {
    const invitations = [{ id: '1', email: 'a@b.com', companyId: 'company-1', departmentId: null, invitationType: 'employee_direct', role: 'employee', status: 'sent', token: 'tok1', expiresAt: '2026-02-01', sentAt: '2026-01-01', acceptedAt: null, reminderCount: 0 }]
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ invitations }), { status: 200 }))

    const result = await listInvitations(baseUrl, 'company-1')

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/invitations?companyId=company-1`, expect.anything())
    expect(result).toEqual(invitations)
  })

  it('creates an invitation', async () => {
    const created = { id: '1', email: 'a@b.com', companyId: 'company-1', departmentId: null, invitationType: 'employee_direct', role: 'employee', status: 'sent', token: 'tok1', expiresAt: '2026-02-01', sentAt: '2026-01-01', acceptedAt: null, reminderCount: 0 }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }))

    const result = await createInvitation(baseUrl, { invitationType: 'employee_direct', email: 'a@b.com', companyId: 'company-1', departmentId: undefined, role: 'employee' })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/invitations`, expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(created)
  })

  it('creates a shareable link', async () => {
    const created = { id: '1', email: null, companyId: 'company-1', departmentId: null, invitationType: 'employee_self_signup', role: 'employee', status: 'sent', token: 'tok2', expiresAt: '2026-02-01', sentAt: '2026-01-01', acceptedAt: null, reminderCount: 0 }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }))

    const result = await createShareableLink(baseUrl, { companyId: 'company-1', departmentId: undefined, role: 'employee' })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/invitations/shareable-link`, expect.objectContaining({ method: 'POST' }))
    expect(result.email).toBeNull()
  })

  it('resends an invitation', async () => {
    const resent = { id: '1', email: 'a@b.com', companyId: 'company-1', departmentId: null, invitationType: 'employee_direct', role: 'employee', status: 'sent', token: 'tok3', expiresAt: '2026-02-08', sentAt: '2026-01-08', acceptedAt: null, reminderCount: 1 }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(resent), { status: 200 }))

    const result = await resendInvitation(baseUrl, '1')

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/invitations/1/resend`, expect.objectContaining({ method: 'POST' }))
    expect(result.reminderCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- users.test.ts invitations.test.ts` (from `web/`)
Expected: FAIL (modules don't exist yet).

- [ ] **Step 3: Implement the clients**

Create `web/src/features/org-structure/api/users.ts`:

```typescript
import { authFetch } from '../../../api/authFetch'

export interface User {
  id: string
  email: string
  name: string
  role: string
  departmentId: string | null
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface UserDetail extends User {
  companyId: string
  managerId: string | null
}

export interface UpdateUserInput {
  name?: string
  departmentId?: string
  managerId?: string
  isActive?: boolean
}

export async function listUsers(baseUrl: string, companyId: string): Promise<User[]> {
  const response = await authFetch(`${baseUrl}/admin/users?companyId=${companyId}`)
  const body = (await response.json()) as { users: User[] }
  return body.users
}

export async function getUser(baseUrl: string, id: string): Promise<UserDetail> {
  const response = await authFetch(`${baseUrl}/admin/users/${id}`)
  return response.json() as Promise<UserDetail>
}

export async function updateUser(baseUrl: string, id: string, input: UpdateUserInput): Promise<UserDetail> {
  const response = await authFetch(`${baseUrl}/admin/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<UserDetail>
}

export async function updateUserRole(baseUrl: string, id: string, role: string): Promise<UserDetail> {
  const response = await authFetch(`${baseUrl}/admin/users/${id}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  })
  return response.json() as Promise<UserDetail>
}
```

Create `web/src/features/org-structure/api/invitations.ts`:

```typescript
import { authFetch } from '../../../api/authFetch'

export interface Invitation {
  id: string
  email: string | null
  companyId: string
  departmentId: string | null
  invitationType: string
  role: string
  status: string
  token: string
  expiresAt: string
  sentAt: string | null
  acceptedAt: string | null
  reminderCount: number
}

export interface CreateInvitationInput {
  invitationType: string
  email: string
  companyId: string
  departmentId?: string
  role: string
}

export interface CreateShareableLinkInput {
  companyId: string
  departmentId?: string
  role: string
}

export async function listInvitations(baseUrl: string, companyId: string): Promise<Invitation[]> {
  const response = await authFetch(`${baseUrl}/admin/invitations?companyId=${companyId}`)
  const body = (await response.json()) as { invitations: Invitation[] }
  return body.invitations
}

export async function createInvitation(baseUrl: string, input: CreateInvitationInput): Promise<Invitation> {
  const response = await authFetch(`${baseUrl}/admin/invitations`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<Invitation>
}

export async function createShareableLink(baseUrl: string, input: CreateShareableLinkInput): Promise<Invitation> {
  const response = await authFetch(`${baseUrl}/admin/invitations/shareable-link`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<Invitation>
}

export async function resendInvitation(baseUrl: string, id: string): Promise<Invitation> {
  const response = await authFetch(`${baseUrl}/admin/invitations/${id}/resend`, {
    method: 'POST',
  })
  return response.json() as Promise<Invitation>
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test` (from `web/` — never `npx vitest run` directly, see the Node 25
`NODE_OPTIONS` gotcha in Global Constraints' precedent from Slice 1)
Expected: PASS, all tests including the 8 new ones.

- [ ] **Step 5: Run the build**

Run: `npm run build` (from `web/`)
Expected: succeeds, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/org-structure/api/users.ts web/src/features/org-structure/api/users.test.ts \
        web/src/features/org-structure/api/invitations.ts web/src/features/org-structure/api/invitations.test.ts
git commit -m "feat: add typed API clients for users and invitations"
```

---

## Task 6: Frontend — UsersListPage

**Files:**
- Create: `web/src/features/org-structure/components/UserFilters.tsx`
- Create: `web/src/features/org-structure/components/UserList.tsx`
- Create: `web/src/features/org-structure/components/UserForm.tsx`
- Create: `web/src/features/org-structure/components/RoleSelector.tsx`
- Create: `web/src/features/org-structure/pages/UsersListPage.tsx`
- Modify: `web/src/app/router.tsx`
- Modify: `web/src/features/org-structure/pages/CompanyDetailPage.tsx`

**Interfaces:**
- Consumes: `listUsers`, `updateUser`, `updateUserRole` (Task 5), `User`/`UpdateUserInput`
  types (Task 5).
- Produces: `<UserForm>` — Task 7 does not reuse this (invitations use their own form),
  unlike Slice 1's `CompanyForm` reuse pattern.

- [ ] **Step 1: Role selector**

Create `web/src/features/org-structure/components/RoleSelector.tsx`:

```tsx
// Must match Roles.All in src/ClimateProject.Application/Auth/Roles.cs exactly -- that
// backend list has 5 values, NOT the 6-value legacy UserRole enum (no department_admin).
const ROLES = ['employee', 'supervisor', 'leader', 'company_admin', 'super_admin']

interface RoleSelectorProps {
  value: string
  onChange: (role: string) => void
  disabled?: boolean
}

export default function RoleSelector({ value, onChange, disabled }: RoleSelectorProps) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {ROLES.map((role) => (
        <option key={role} value={role}>{role}</option>
      ))}
    </select>
  )
}
```

- [ ] **Step 2: Filters component**

Create `web/src/features/org-structure/components/UserFilters.tsx`:

```tsx
export interface UserFiltersValue {
  search: string
}

interface UserFiltersProps {
  value: UserFiltersValue
  onChange: (value: UserFiltersValue) => void
}

export default function UserFilters({ value, onChange }: UserFiltersProps) {
  return (
    <input
      type="search"
      placeholder="Search by name or email"
      value={value.search}
      onChange={(e) => onChange({ search: e.target.value })}
    />
  )
}
```

- [ ] **Step 3: List component**

Create `web/src/features/org-structure/components/UserList.tsx`:

```tsx
import type { User } from '../api/users'

export default function UserList({ users, onEdit }: { users: User[]; onEdit: (user: User) => void }) {
  if (users.length === 0) {
    return <p>No users found.</p>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Role</th>
          <th>Active</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.id}>
            <td>{user.name}</td>
            <td>{user.email}</td>
            <td>{user.role}</td>
            <td>{user.isActive ? 'Yes' : 'No'}</td>
            <td><button onClick={() => onEdit(user)}>Edit</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 4: Edit form (profile + role change together)**

Create `web/src/features/org-structure/components/UserForm.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import RoleSelector from './RoleSelector'
import type { User } from '../api/users'

export interface UserFormValues {
  name: string
  role: string
  isActive: boolean
}

interface UserFormProps {
  user: User
  canChangeRole: boolean
  onSubmit: (values: UserFormValues) => Promise<void>
}

export default function UserForm({ user, canChangeRole, onSubmit }: UserFormProps) {
  const [values, setValues] = useState<UserFormValues>({ name: user.name, role: user.role, isActive: user.isActive })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit(values)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        Name
        <input value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} required />
      </label>
      <label>
        Role
        <RoleSelector value={values.role} onChange={(role) => setValues({ ...values, role })} disabled={!canChangeRole} />
      </label>
      <label>
        <input type="checkbox" checked={values.isActive} onChange={(e) => setValues({ ...values, isActive: e.target.checked })} />
        Active
      </label>
      <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</button>
    </form>
  )
}
```

- [ ] **Step 5: List page**

Create `web/src/features/org-structure/pages/UsersListPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { listUsers, updateUser, updateUserRole, type User } from '../api/users'
import UserList from '../components/UserList'
import UserFilters, { type UserFiltersValue } from '../components/UserFilters'
import UserForm, { type UserFormValues } from '../components/UserForm'

export default function UsersListPage() {
  const { companyId } = useParams<{ companyId: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<UserFiltersValue>({ search: '' })
  const [editingUser, setEditingUser] = useState<User | null>(null)

  async function reload() {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const result = await listUsers(baseUrl, companyId)
      setUsers(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [companyId])

  const filtered = users.filter((user) => {
    const search = filters.search.toLowerCase()
    if (!search) return true
    return user.name.toLowerCase().includes(search) || user.email.toLowerCase().includes(search)
  })

  async function handleUpdate(values: UserFormValues) {
    if (!editingUser) return
    await updateUser(baseUrl, editingUser.id, { name: values.name, isActive: values.isActive })
    if (values.role !== editingUser.role) {
      await updateUserRole(baseUrl, editingUser.id, values.role)
    }
    setEditingUser(null)
    await reload()
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  return (
    <div>
      <h1>Users</h1>
      <UserFilters value={filters} onChange={setFilters} />
      {editingUser && (
        <UserForm key={editingUser.id} user={editingUser} canChangeRole onSubmit={handleUpdate} />
      )}
      {loading ? <p>Loading…</p> : <UserList users={filtered} onEdit={setEditingUser} />}
    </div>
  )
}
```

Note: `canChangeRole` is hardcoded `true` here — the backend enforces the real
`Roles.SuperAdmin`-only rule (Task 2) and returns 403 if a `CompanyAdmin` submits a role
change, which surfaces through `UserForm`'s existing error state. A role-aware UI hide is
a nice-to-have, not required for correctness, and isn't specified by the design — leaving
it as a follow-up avoids guessing at frontend role-detection plumbing that doesn't exist
yet in this codebase.

- [ ] **Step 6: Wire the route and nav entry**

Modify `web/src/app/router.tsx` — add a new route as a sibling of the companies routes,
inside `AdminLayout`'s children:

```tsx
import CompaniesListPage from '../features/org-structure/pages/CompaniesListPage'
import CompanyDetailPage from '../features/org-structure/pages/CompanyDetailPage'
import UsersListPage from '../features/org-structure/pages/UsersListPage'
```

```tsx
              { path: '/admin/companies', element: <CompaniesListPage /> },
              { path: '/admin/companies/:id', element: <CompanyDetailPage /> },
              { path: '/admin/companies/:companyId/users', element: <UsersListPage /> },
```

There's no single "all users across all companies" list in this design — `UsersListPage`
needs a `:companyId` in its route (matches the backend's `companyId`-required scoping
from Task 2), so it isn't a top-level nav destination. `navSections.ts` stays unchanged
from Slice 1; the real navigation path to a company's users is a link on
`CompanyDetailPage`.

Modify `web/src/features/org-structure/pages/CompanyDetailPage.tsx` — add a link near the
top of the returned JSX, right after the `<h1>{company.name}</h1>` line:

```tsx
      <p><Link to={`/admin/companies/${company.id}/users`}>Manage users</Link></p>
```

This requires adding `Link` to the existing `import { useParams } from 'react-router-dom'`
line — change it to `import { Link, useParams } from 'react-router-dom'`.

Given this link is the real discoverable path (not the redundant nav entry), remove the
redundant `Users` nav entry added above and keep `navSections.ts` unchanged from Slice 1 —
the "Manage users" link on the company detail page is sufficient and avoids a nav item
that doesn't actually do anything more specific than what's already one click away.

- [ ] **Step 7: Verify manually**

Run `npm run build` (from `web/`) to confirm the new page and link type-check and bundle
cleanly — no interactive browser available to this implementer, matching Slice 1's
Task 5-7 precedent for manual-verification steps.

- [ ] **Step 8: Commit**

```bash
git add web/src/features/org-structure/components/RoleSelector.tsx \
        web/src/features/org-structure/components/UserFilters.tsx \
        web/src/features/org-structure/components/UserList.tsx \
        web/src/features/org-structure/components/UserForm.tsx \
        web/src/features/org-structure/pages/UsersListPage.tsx \
        web/src/features/org-structure/pages/CompanyDetailPage.tsx \
        web/src/app/router.tsx
git commit -m "feat: add UsersListPage (list, filter, edit, role change)"
```

---

## Task 7: Frontend — Invitation UI

**Files:**
- Create: `web/src/features/org-structure/components/InvitationList.tsx`
- Create: `web/src/features/org-structure/components/InvitationForm.tsx`
- Create: `web/src/features/org-structure/components/ShareableLinkPanel.tsx`
- Modify: `web/src/features/org-structure/pages/UsersListPage.tsx`

**Interfaces:**
- Consumes: `listInvitations`, `createInvitation`, `createShareableLink`,
  `resendInvitation` (Task 5), `Invitation`/`CreateInvitationInput`/
  `CreateShareableLinkInput` types (Task 5).
- Produces: nothing consumed by a later task — this is the last frontend task before
  Task 8 (which is a standalone, unrelated page).

- [ ] **Step 1: Invitation list with resend action**

Create `web/src/features/org-structure/components/InvitationList.tsx`:

```tsx
import type { Invitation } from '../api/invitations'

export default function InvitationList({ invitations, onResend }: { invitations: Invitation[]; onResend: (invitation: Invitation) => void }) {
  if (invitations.length === 0) {
    return <p>No invitations yet.</p>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Email</th>
          <th>Type</th>
          <th>Role</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {invitations.map((invitation) => (
          <tr key={invitation.id}>
            <td>{invitation.email ?? '(shareable link)'}</td>
            <td>{invitation.invitationType}</td>
            <td>{invitation.role}</td>
            <td>{invitation.status}</td>
            <td>
              {invitation.status !== 'accepted' && (
                <button onClick={() => onResend(invitation)}>Resend</button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 2: Create-invitation form (company_admin_setup / employee_direct)**

Create `web/src/features/org-structure/components/InvitationForm.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import RoleSelector from './RoleSelector'

export interface InvitationFormValues {
  invitationType: string
  email: string
  role: string
}

interface InvitationFormProps {
  allowCompanyAdminSetup: boolean
  onSubmit: (values: InvitationFormValues) => Promise<void>
}

export default function InvitationForm({ allowCompanyAdminSetup, onSubmit }: InvitationFormProps) {
  const [values, setValues] = useState<InvitationFormValues>({
    invitationType: 'employee_direct',
    email: '',
    role: 'employee',
  })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit(values)
      setValues({ invitationType: 'employee_direct', email: '', role: 'employee' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      {allowCompanyAdminSetup && (
        <label>
          Type
          <select value={values.invitationType} onChange={(e) => setValues({ ...values, invitationType: e.target.value })}>
            <option value="employee_direct">Employee</option>
            <option value="company_admin_setup">Company admin</option>
          </select>
        </label>
      )}
      <label>
        Email
        <input type="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} required />
      </label>
      {values.invitationType === 'employee_direct' && (
        <label>
          Role
          <RoleSelector value={values.role} onChange={(role) => setValues({ ...values, role })} />
        </label>
      )}
      <button type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send invitation'}</button>
    </form>
  )
}
```

- [ ] **Step 3: Shareable-link panel**

Create `web/src/features/org-structure/components/ShareableLinkPanel.tsx`:

```tsx
import { useState } from 'react'
import RoleSelector from './RoleSelector'
import type { Invitation } from '../api/invitations'

interface ShareableLinkPanelProps {
  onCreate: (role: string) => Promise<Invitation>
}

export default function ShareableLinkPanel({ onCreate }: ShareableLinkPanelProps) {
  const [role, setRole] = useState('employee')
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    setError(null)
    setCreating(true)
    try {
      const invitation = await onCreate(role)
      setLink(`${window.location.origin}/accept-invitation/${invitation.token}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create link')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <RoleSelector value={role} onChange={setRole} />
      <button onClick={handleCreate} disabled={creating}>{creating ? 'Creating…' : 'Create shareable link'}</button>
      {link && <p>Link (accept-once): <code>{link}</code></p>}
    </div>
  )
}
```

- [ ] **Step 4: Wire into UsersListPage**

Modify `web/src/features/org-structure/pages/UsersListPage.tsx` — add the invitation
imports at the top:

```tsx
import { listInvitations, createInvitation, createShareableLink, resendInvitation, type Invitation } from '../api/invitations'
import InvitationList from '../components/InvitationList'
import InvitationForm, { type InvitationFormValues } from '../components/InvitationForm'
import ShareableLinkPanel from '../components/ShareableLinkPanel'
```

Add invitation state alongside the existing user state:

```tsx
  const [invitations, setInvitations] = useState<Invitation[]>([])
```

Extend `reload()` to also fetch invitations (change the function body to a
`Promise.all`):

```tsx
  async function reload() {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const [usersResult, invitationsResult] = await Promise.all([
        listUsers(baseUrl, companyId),
        listInvitations(baseUrl, companyId),
      ])
      setUsers(usersResult)
      setInvitations(invitationsResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }
```

Add the two handlers, alongside `handleUpdate`:

```tsx
  async function handleCreateInvitation(values: InvitationFormValues) {
    if (!companyId) return
    await createInvitation(baseUrl, {
      invitationType: values.invitationType,
      email: values.email,
      companyId,
      role: values.role,
    })
    await reload()
  }

  async function handleCreateShareableLink(role: string): Promise<Invitation> {
    if (!companyId) throw new Error('Missing companyId')
    const invitation = await createShareableLink(baseUrl, { companyId, role })
    await reload()
    return invitation
  }

  async function handleResend(invitation: Invitation) {
    await resendInvitation(baseUrl, invitation.id)
    await reload()
  }
```

Add the new sections to the returned JSX, after the existing `<UserList ... />` line:

```tsx
      <h2>Invitations</h2>
      <InvitationForm allowCompanyAdminSetup onSubmit={handleCreateInvitation} />
      <ShareableLinkPanel onCreate={handleCreateShareableLink} />
      <InvitationList invitations={invitations} onResend={handleResend} />
```

`allowCompanyAdminSetup` is hardcoded `true` for the same reason `canChangeRole` was in
Task 6 — the backend (Task 3) is the real enforcement point and returns 403 for a
`CompanyAdmin` attempting it, which surfaces through `InvitationForm`'s error state.

- [ ] **Step 5: Verify manually**

Run `npm run build` and `npm test` (from `web/`) to confirm everything still type-checks,
bundles, and the existing test suite is unaffected (this task adds no new automated
tests of its own — component-testing library still not set up, matching every frontend
UI task's precedent since Slice 1 Task 5).

- [ ] **Step 6: Commit**

```bash
git add web/src/features/org-structure/components/InvitationList.tsx \
        web/src/features/org-structure/components/InvitationForm.tsx \
        web/src/features/org-structure/components/ShareableLinkPanel.tsx \
        web/src/features/org-structure/pages/UsersListPage.tsx
git commit -m "feat: add invitation UI (create, shareable link, resend) to UsersListPage"
```

---

## Task 8: Frontend — AcceptInvitationPage (unauthenticated)

**Files:**
- Create: `web/src/features/org-structure/api/acceptInvitation.ts`
- Create: `web/src/features/org-structure/pages/AcceptInvitationPage.tsx`
- Modify: `web/src/app/router.tsx`

**Interfaces:**
- Consumes: `setToken` (`web/src/auth/token.ts`, existing).
- Produces: nothing consumed by a later task — last task in this plan.

- [ ] **Step 1: Unauthenticated accept-invitation API call**

This deliberately does NOT use `authFetch` — there's no bearer token yet (that's the
whole point of this endpoint). Create
`web/src/features/org-structure/api/acceptInvitation.ts`:

```typescript
export interface AcceptInvitationInput {
  email?: string
  name: string
  password: string
}

export async function acceptInvitation(baseUrl: string, token: string, input: AcceptInvitationInput): Promise<string> {
  const response = await fetch(`${baseUrl}/invitations/${token}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error((body && body.message) || `Request failed: ${response.status}`)
  }

  const result = (await response.json()) as { token: string }
  return result.token
}
```

- [ ] **Step 2: Accept-invitation page**

Create `web/src/features/org-structure/pages/AcceptInvitationPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { acceptInvitation } from '../api/acceptInvitation'
import { setToken } from '../../../auth/token'

export default function AcceptInvitationPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!token) return
    setError(null)
    setSubmitting(true)
    try {
      const jwt = await acceptInvitation(baseUrl, token, { email: email || undefined, name, password })
      setToken(jwt)
      navigate('/admin/companies')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1>Accept invitation</h1>
      <form onSubmit={handleSubmit}>
        {error && <p role="alert">{error}</p>}
        <label>
          Email (only needed for a shareable link)
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        <button type="submit" disabled={submitting}>{submitting ? 'Creating account…' : 'Create account'}</button>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Wire the route (unauthenticated, sibling of `/login`)**

Modify `web/src/app/router.tsx` — add the import:

```tsx
import AcceptInvitationPage from '../features/org-structure/pages/AcceptInvitationPage'
```

Add the route as a sibling of `/login`, NOT nested under `RequireAuth`/`AdminLayout`:

```tsx
      { path: '/login', element: <LoginPage /> },
      { path: '/accept-invitation/:token', element: <AcceptInvitationPage /> },
```

- [ ] **Step 4: Verify manually**

Run `npm run build` and `npm test` (from `web/`) — same substitution as every other
frontend UI task in this plan, no browser available to this implementer.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/org-structure/api/acceptInvitation.ts \
        web/src/features/org-structure/pages/AcceptInvitationPage.tsx \
        web/src/app/router.tsx
git commit -m "feat: add unauthenticated AcceptInvitationPage"
```
