# Tracking-Module Integration — climate-project-api side (#56) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give climate-tracking a real `.NET` internal API to call into (replacing the old Next.js `/internal/*` routes), give the frontend real Postgres-backed nodo/persona picker endpoints, and ship a typed frontend client for calling climate-tracking directly.

**Architecture:** Three independent pieces in one plan (same repo, no cross-repo dependency for this half of #56): (1) JWT-authed picker endpoints reading `Departments`/`Users` directly for admin UI pickers, (2) a separately-authed (static API key, not JWT) internal endpoint group matching climate-tracking's `ClimateProjectClient` contract exactly (snake_case DTOs), with 3 of 5 routes shipped as explicit stubs pending `#51`/`#55`, (3) a typed frontend API client calling climate-tracking's real endpoints directly — no proxy through this backend.

**Tech Stack:** .NET 10 minimal APIs, EF Core/Postgres (no schema changes — `Department.LegacyExternalId`/`User.PersonaExternalId`/`User.NodoId` already exist from Slice 2/3), xUnit + Testcontainers, React 19 + Vite + Vitest.

## Global Constraints

- No schema changes — `Department.LegacyExternalId`, `User.PersonaExternalId`, `User.NodoId` already exist from org-structure Slice 2/3.
- Picker endpoints: `.RequireAuthorization()` + manual role check + `Results.Forbid()`, never `[Authorize(Roles=)]` — `Roles.Admin.Contains` + own-company for `CompanyAdmin`, any for `SuperAdmin` (same `CanAccessCompany` pattern as every prior domain).
- The 5 `/api/internal/*` endpoints use a **completely separate** auth mechanism — a static API-key `IEndpointFilter`, not JWT, not `.RequireAuthorization()` — because the caller is climate-tracking itself, not a logged-in user.
- Snake_case JSON applies **only** to the `/api/internal/*` endpoint group, via a `JsonSerializerOptions` passed explicitly to each `Results.Json(...)` call in that group. Every other endpoint in this codebase (including the picker endpoints in this plan) stays default camelCase — do not add a global serializer override.
- External identifier convention (must match exactly, mirrors `AuthEndpoints.cs`'s existing `Sub` claim-minting fallback): nodo id = `department.LegacyExternalId ?? department.Id.ToString()`; persona id = `user.PersonaExternalId ?? user.Id.ToString()`. Do not invent a different fallback.
- Route paths use the `/api/internal/*` prefix (**with** `/api`) — confirmed against climate-tracking's actual call sites in `ClimateProjectClient.cs` (`_options.BaseUrl` + `"/api/internal/nodos"` etc.), not the shorter `/internal/*` shorthand used in the design doc's prose.
- `ciclos-encuesta`, `hallazgos`, `send-notification` internal endpoints ship as explicit stubs (empty list / no-op) — surveys (`#51`) and notifications (`#55`) don't exist yet. Do not attempt real implementations; a later plan swaps the stub bodies.
- Frontend: no tracking-module pages in this plan (no planes-de-acción list/detail/tablero/bitácora UI) — this plan ships the integration layer only (picker endpoints, typed API client). Building actual tracking pages is separate future scope.
- Frontend: new `VITE_TRACKING_API_BASE_URL` env var — the first multi-base-URL client in this codebase. Don't touch the existing `VITE_API_BASE_URL` pattern.
- `.NET`: don't touch pinned package versions. Frontend: Node 20 LTS+.

---

## Task 1: External identifier helpers + Nodo/Persona picker endpoints

**Files:**
- Create: `src/ClimateProject.Application/Tracking/TrackingIdentifiers.cs`
- Create: `src/ClimateProject.Application/Tracking/TrackingPickerDtos.cs`
- Create: `src/ClimateProject.Api/Endpoints/TrackingPickerEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs` (register `app.MapTrackingPickerEndpoints();` after the existing `app.MapBulkImportEndpoints();` line)
- Test: `tests/ClimateProject.IntegrationTests/Tracking/TrackingPickerEndpointsTests.cs`

**Interfaces:**
- Produces: `TrackingIdentifiers.ExternalNodoId(Department department): string`, `TrackingIdentifiers.ExternalPersonaId(User user): string` — used again by Task 2's internal endpoints.
- Produces: `NodoPickerItem(string Id, string Name)`, `PersonaPickerItem(string Id, string Name, string Email)` records, `NodoPickerResponse(IReadOnlyList<NodoPickerItem> Nodos)`, `PersonaPickerResponse(IReadOnlyList<PersonaPickerItem> Personas)`.

- [ ] **Step 1: Write the identifier helper**

```csharp
// src/ClimateProject.Application/Tracking/TrackingIdentifiers.cs
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Tracking;

public static class TrackingIdentifiers
{
    public static string ExternalNodoId(Department department) => department.LegacyExternalId ?? department.Id.ToString();

    public static string ExternalPersonaId(User user) => user.PersonaExternalId ?? user.Id.ToString();
}
```

- [ ] **Step 2: Write the picker DTOs**

```csharp
// src/ClimateProject.Application/Tracking/TrackingPickerDtos.cs
namespace ClimateProject.Application.Tracking;

public sealed record NodoPickerItem(string Id, string Name);

public sealed record NodoPickerResponse(IReadOnlyList<NodoPickerItem> Nodos);

public sealed record PersonaPickerItem(string Id, string Name, string Email);

public sealed record PersonaPickerResponse(IReadOnlyList<PersonaPickerItem> Personas);
```

- [ ] **Step 3: Write the picker endpoints**

```csharp
// src/ClimateProject.Api/Endpoints/TrackingPickerEndpoints.cs
using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Tracking;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class TrackingPickerEndpoints
{
    public static void MapTrackingPickerEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/tracking/picker").RequireAuthorization();

        group.MapGet("/nodos", ListNodosAsync);
        group.MapGet("/personas", ListPersonasAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static async Task<IResult> ListNodosAsync(
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

        var departments = await db.Departments
            .Where(d => d.CompanyId == companyId && d.IsActive)
            .OrderBy(d => d.Name)
            .ToListAsync(cancellationToken);

        var items = departments
            .Select(d => new NodoPickerItem(TrackingIdentifiers.ExternalNodoId(d), d.Name))
            .ToList();

        return Results.Ok(new NodoPickerResponse(items));
    }

    private static async Task<IResult> ListPersonasAsync(
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

        var users = await db.Users
            .Where(u => u.CompanyId == companyId && u.IsActive)
            .OrderBy(u => u.Name)
            .ToListAsync(cancellationToken);

        var items = users
            .Select(u => new PersonaPickerItem(TrackingIdentifiers.ExternalPersonaId(u), u.Name, u.Email))
            .ToList();

        return Results.Ok(new PersonaPickerResponse(items));
    }
}
```

- [ ] **Step 4: Register the endpoint group in `Program.cs`**

In `src/ClimateProject.Api/Program.cs`, add this line after the existing `app.MapBulkImportEndpoints();` line (before `app.Run();`) — the `using ClimateProject.Api.Endpoints;` import at the top of the file already covers it:

```csharp
app.MapTrackingPickerEndpoints();
```

- [ ] **Step 5: Write the integration tests**

```csharp
// tests/ClimateProject.IntegrationTests/Tracking/TrackingPickerEndpointsTests.cs
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Tracking;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Tracking;

[Collection("Postgres")]
public class TrackingPickerEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"picka-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"pickb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public TrackingPickerEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "Picker Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Picker Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;

        db.Departments.Add(new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyAId,
            Name = "Engineering",
            LegacyExternalId = "legacy-nodo-1",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        db.Departments.Add(new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyAId,
            Name = "Fresh Department",
            LegacyExternalId = null,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
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
    public async Task CompanyAdmin_can_list_nodos_for_their_own_company_with_legacy_id_fallback()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync($"/tracking/picker/nodos?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<NodoPickerResponse>();

        Assert.Contains(body!.Nodos, n => n.Id == "legacy-nodo-1" && n.Name == "Engineering");
        Assert.Contains(body.Nodos, n => n.Name == "Fresh Department" && Guid.TryParse(n.Id, out _));
    }

    [Fact]
    public async Task CompanyAdmin_cannot_list_nodos_or_personas_for_another_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var nodosResponse = await client.GetAsync($"/tracking/picker/nodos?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.Forbidden, nodosResponse.StatusCode);

        var personasResponse = await client.GetAsync($"/tracking/picker/personas?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.Forbidden, personasResponse.StatusCode);
    }

    [Fact]
    public async Task SuperAdmin_can_list_personas_with_persona_external_id_fallback()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync($"/tracking/picker/personas?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<PersonaPickerResponse>();

        // The signed-up user has no PersonaExternalId set, so ExternalPersonaId falls back to their own Guid Id.
        Assert.Contains(body!.Personas, p => Guid.TryParse(p.Id, out _));
    }
}
```

- [ ] **Step 6: Run the tests**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter FullyQualifiedName~TrackingPickerEndpointsTests`
Expected: all 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/ClimateProject.Application/Tracking/TrackingIdentifiers.cs src/ClimateProject.Application/Tracking/TrackingPickerDtos.cs src/ClimateProject.Api/Endpoints/TrackingPickerEndpoints.cs src/ClimateProject.Api/Program.cs tests/ClimateProject.IntegrationTests/Tracking/TrackingPickerEndpointsTests.cs
git commit -m "feat: add nodo/persona picker endpoints for tracking-module integration"
```

---

## Task 2: Internal API-key auth filter + real internal nodos/personas endpoints

> **Amendment (2026-08-01, post-implementation, recorded during final review fixes):** Step 4's
> literal code below resolves persona `nodo_id` from `u.NodoId ?? string.Empty`. The shipped
> implementation deviates from this: `grep -rn "NodoId = " src/` returns zero writers of
> `User.NodoId`, so the literal plan code would always emit an empty string. It instead
> resolves `nodo_id` via `User.DepartmentId -> TrackingIdentifiers.ExternalNodoId(department)`,
> falling back to a synthetic `TrackingIdentifiers.UnassignedNodoId(companyId)` for users with
> no department (see the further amendment on the departmentless-user fix below). This is
> covered by tests and is the correct behavior; `User.NodoId` is tracked as a dead column for
> cleanup in `climate-project#73`.
>
> **Second amendment (2026-08-01):** the first fix above still emitted `nodo_id: ""` for any
> user with no `DepartmentId` — the common case, since plain `/auth/signup` and Google login
> never set it (only bulk-import, admin user-create/invitation flows do). Since
> climate-tracking's `PersonaDto.NodoId` is non-nullable and used for tablero authorization
> scoping, an empty value is a real bug, not just a cosmetic gap. Fixed by having `/personas`
> fall back to `TrackingIdentifiers.UnassignedNodoId(companyId)` for departmentless users, and
> having `/nodos` include a matching synthetic "Sin nodo asignado" entry whenever a company has
> at least one such user, so the id always resolves to something present in `/nodos`.

**Files:**
- Create: `src/ClimateProject.Api/Infrastructure/InternalApiKeyFilter.cs`
- Create: `src/ClimateProject.Application/Tracking/TrackingInternalDtos.cs`
- Create: `src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs`
- Modify: `src/ClimateProject.Api/appsettings.json` (add `"InternalApiKey": ""`)
- Modify: `tests/ClimateProject.IntegrationTests/Support/AuthWebApplicationFactory.cs` (add a known test value for `InternalApiKey`)
- Modify: `src/ClimateProject.Api/Program.cs` (register `app.MapTrackingInternalEndpoints();`)
- Test: `tests/ClimateProject.IntegrationTests/Tracking/TrackingInternalEndpointsTests.cs`

**Interfaces:**
- Consumes: `TrackingIdentifiers.ExternalNodoId`/`ExternalPersonaId` from Task 1.
- Produces: `Envelope<TData>(bool Success, TData Data)`, `NodosData(IReadOnlyList<NodoInternalDto> Nodos)`, `PersonasData(IReadOnlyList<PersonaInternalDto> Personas)` — Task 3 adds `CiclosData`/`HallazgosData` to the same file.

- [ ] **Step 1: Add the `InternalApiKey` config key**

In `src/ClimateProject.Api/appsettings.json`, add a new top-level key alongside the existing `TrackingJwtSecret`:

```json
{
  "ConnectionStrings": {
    "ClimateProject": ""
  },
  "TrackingJwtSecret": "",
  "InternalApiKey": "",
  "GoogleClientId": "",
  "Cors": {
    "AllowedOrigins": [],
    "AllowedWildcardOrigins": []
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*"
}
```

- [ ] **Step 2: Write the internal API-key filter**

```csharp
// src/ClimateProject.Api/Infrastructure/InternalApiKeyFilter.cs
namespace ClimateProject.Api.Infrastructure;

public sealed class InternalApiKeyFilter(IConfiguration configuration) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var expectedKey = configuration["InternalApiKey"];
        if (string.IsNullOrWhiteSpace(expectedKey))
        {
            return Results.Json(new { message = "Internal API is not configured." }, statusCode: 500);
        }

        const string prefix = "Bearer ";
        var authHeader = context.HttpContext.Request.Headers.Authorization.ToString();
        if (!authHeader.StartsWith(prefix, StringComparison.Ordinal) || authHeader[prefix.Length..] != expectedKey)
        {
            return Results.Json(new { message = "Invalid or missing internal API key." }, statusCode: 401);
        }

        return await next(context);
    }
}
```

- [ ] **Step 3: Write the internal DTOs (nodos + personas)**

```csharp
// src/ClimateProject.Application/Tracking/TrackingInternalDtos.cs
namespace ClimateProject.Application.Tracking;

public sealed record Envelope<TData>(bool Success, TData Data);

public sealed record NodoInternalDto(
    string NodoId,
    string Nombre,
    string? NodoPadreId,
    string? LiderId,
    int CantidadColaboradores,
    bool Activo,
    string CompanyId);

public sealed record NodosData(IReadOnlyList<NodoInternalDto> Nodos);

public sealed record PersonaInternalDto(
    string PersonaId,
    string NombreCompleto,
    string Correo,
    string NodoId,
    string? ManagerId,
    string Rol,
    bool Activo,
    string CompanyId);

public sealed record PersonasData(IReadOnlyList<PersonaInternalDto> Personas);
```

- [ ] **Step 4: Write the internal endpoints (nodos + personas)**

```csharp
// src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs
using System.Text.Json;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Tracking;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class TrackingInternalEndpoints
{
    private static readonly JsonSerializerOptions SnakeCaseOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    public static void MapTrackingInternalEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/internal").AddEndpointFilter<InternalApiKeyFilter>();

        group.MapGet("/nodos", ListNodosAsync);
        group.MapGet("/personas", ListPersonasAsync);
    }

    private static async Task<IResult> ListNodosAsync(
        [FromQuery(Name = "company_id")] string companyId,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(companyId, out var companyGuid))
        {
            return Results.Json(new { message = "company_id must be a valid GUID." }, statusCode: 400);
        }

        var departments = await db.Departments
            .Where(d => d.CompanyId == companyGuid)
            .ToListAsync(cancellationToken);

        var departmentsById = departments.ToDictionary(d => d.Id);
        var managerIds = departments.Where(d => d.ManagerId.HasValue).Select(d => d.ManagerId!.Value).ToList();
        var managers = await db.Users
            .Where(u => managerIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, cancellationToken);

        var nodos = departments.Select(d => new NodoInternalDto(
            NodoId: TrackingIdentifiers.ExternalNodoId(d),
            Nombre: d.Name,
            NodoPadreId: d.ParentDepartmentId.HasValue && departmentsById.TryGetValue(d.ParentDepartmentId.Value, out var parent)
                ? TrackingIdentifiers.ExternalNodoId(parent)
                : null,
            LiderId: d.ManagerId.HasValue && managers.TryGetValue(d.ManagerId.Value, out var manager)
                ? TrackingIdentifiers.ExternalPersonaId(manager)
                : null,
            CantidadColaboradores: d.EmployeeCount,
            Activo: d.IsActive,
            CompanyId: d.CompanyId.ToString()))
            .ToList();

        return Results.Json(new Envelope<NodosData>(true, new NodosData(nodos)), SnakeCaseOptions);
    }

    private static async Task<IResult> ListPersonasAsync(
        [FromQuery(Name = "company_id")] string companyId,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(companyId, out var companyGuid))
        {
            return Results.Json(new { message = "company_id must be a valid GUID." }, statusCode: 400);
        }

        var users = await db.Users
            .Where(u => u.CompanyId == companyGuid)
            .ToListAsync(cancellationToken);

        var usersById = users.ToDictionary(u => u.Id);

        var personas = users.Select(u => new PersonaInternalDto(
            PersonaId: TrackingIdentifiers.ExternalPersonaId(u),
            NombreCompleto: u.Name,
            Correo: u.Email,
            NodoId: u.NodoId ?? string.Empty,
            ManagerId: u.ManagerId.HasValue && usersById.TryGetValue(u.ManagerId.Value, out var manager)
                ? TrackingIdentifiers.ExternalPersonaId(manager)
                : null,
            Rol: u.Role,
            Activo: u.IsActive,
            CompanyId: u.CompanyId.ToString()))
            .ToList();

        return Results.Json(new Envelope<PersonasData>(true, new PersonasData(personas)), SnakeCaseOptions);
    }
}
```

- [ ] **Step 5: Register the endpoint group and add the test config value**

In `src/ClimateProject.Api/Program.cs`, add after `app.MapTrackingPickerEndpoints();`:

```csharp
app.MapTrackingInternalEndpoints();
```

In `tests/ClimateProject.IntegrationTests/Support/AuthWebApplicationFactory.cs`, add a `TestInternalApiKey` constant and wire it into the in-memory config:

```csharp
public const string TestJwtSecret = "integration-test-tracking-jwt-secret-32-bytes-min";
public const string TestInternalApiKey = "integration-test-internal-api-key";
```

And add `["InternalApiKey"] = TestInternalApiKey,` to the `AddInMemoryCollection` dictionary (alongside the existing `TrackingJwtSecret` and `GoogleClientId` entries).

- [ ] **Step 6: Write the integration tests**

```csharp
// tests/ClimateProject.IntegrationTests/Tracking/TrackingInternalEndpointsTests.cs
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Tracking;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Tracking;

[Collection("Postgres")]
public class TrackingInternalEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly JsonSerializerOptions _snakeCaseOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    private Guid _companyId;

    public TrackingInternalEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Internal Co", EmailDomain = $"internal-{Guid.NewGuid():N}.test", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;

        db.Departments.Add(new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            Name = "Engineering",
            LegacyExternalId = "legacy-nodo-42",
            EmployeeCount = 3,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        db.Users.Add(new User
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            Email = "persona@internal.test",
            Name = "Test Persona",
            Role = "employee",
            PersonaExternalId = "legacy-persona-7",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Returns_nodos_with_snake_case_envelope_shape()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.GetAsync($"/api/internal/nodos?company_id={_companyId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var envelope = await response.Content.ReadFromJsonAsync<Envelope<NodosData>>(_snakeCaseOptions);
        Assert.True(envelope!.Success);
        Assert.Contains(envelope.Data.Nodos, n => n.NodoId == "legacy-nodo-42" && n.Nombre == "Engineering" && n.CantidadColaboradores == 3);
    }

    [Fact]
    public async Task Returns_personas_with_persona_external_id()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.GetAsync($"/api/internal/personas?company_id={_companyId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var envelope = await response.Content.ReadFromJsonAsync<Envelope<PersonasData>>(_snakeCaseOptions);
        Assert.True(envelope!.Success);
        Assert.Contains(envelope.Data.Personas, p => p.PersonaId == "legacy-persona-7" && p.Correo == "persona@internal.test");
    }

    [Fact]
    public async Task Rejects_request_with_missing_or_wrong_api_key()
    {
        var client = _factory.CreateClient();

        var missingKey = await client.GetAsync($"/api/internal/nodos?company_id={_companyId}");
        Assert.Equal(HttpStatusCode.Unauthorized, missingKey.StatusCode);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "wrong-key");
        var wrongKey = await client.GetAsync($"/api/internal/nodos?company_id={_companyId}");
        Assert.Equal(HttpStatusCode.Unauthorized, wrongKey.StatusCode);
    }
}
```

- [ ] **Step 7: Run the tests**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter FullyQualifiedName~TrackingInternalEndpointsTests`
Expected: all 3 tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/ClimateProject.Api/Infrastructure/InternalApiKeyFilter.cs src/ClimateProject.Application/Tracking/TrackingInternalDtos.cs src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs src/ClimateProject.Api/appsettings.json src/ClimateProject.Api/Program.cs tests/ClimateProject.IntegrationTests/Support/AuthWebApplicationFactory.cs tests/ClimateProject.IntegrationTests/Tracking/TrackingInternalEndpointsTests.cs
git commit -m "feat: add internal API-key auth and real /api/internal/nodos,personas endpoints"
```

---

## Task 3: Internal endpoint stubs (ciclos-encuesta, hallazgos, send-notification)

> **Amendment (2026-08-01):** Step 2's stub bodies below are unconditional empty/no-op
> responses with no `company_id` validation, as written. A later, unreviewed pass added the
> same GUID validation the real `/nodos`/`/personas` endpoints use to these stub routes,
> to "close a drift" — that was an unrequested contract change nobody approved, and it made
> the stub routes fail closed (400) exactly when the plan intended them to degrade gracefully
> instead (empty results, regardless of `company_id`). Reverted during final review fixes to
> match this section's literal contract; see the class-level comment on
> `TrackingInternalEndpoints` for the full rationale.

**Files:**
- Modify: `src/ClimateProject.Application/Tracking/TrackingInternalDtos.cs`
- Modify: `src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs`
- Test: `tests/ClimateProject.IntegrationTests/Tracking/TrackingInternalStubEndpointsTests.cs`

**Interfaces:**
- Consumes: `Envelope<TData>` from Task 2.
- Produces: `CiclosData`, `HallazgosData`, `HallazgoInternalDto`, `CicloInternalDto` — for `#51` to replace the stub bodies against later.

- [ ] **Step 1: Add the stub DTOs**

Append to `src/ClimateProject.Application/Tracking/TrackingInternalDtos.cs`:

```csharp
public sealed record CicloInternalDto(
    string CicloId,
    DateTimeOffset FechaApertura,
    DateTimeOffset FechaCierre,
    int NumeroPreguntas,
    string Estado,
    string CompanyId);

public sealed record CiclosData(IReadOnlyList<CicloInternalDto> Ciclos);

public sealed record HallazgoInternalDto(
    string HallazgoId,
    string NodoId,
    string Categoria,
    decimal ResultadoPct,
    decimal? BenchmarkSectorPct,
    decimal? ResultadoAnioAnteriorPct,
    string? CicloId);

public sealed record HallazgosData(IReadOnlyList<HallazgoInternalDto> Hallazgos);
```

Note the `CicloId` field on `HallazgoInternalDto` — this is new relative to climate-tracking's current `HallazgoDto` (which has no `CicloId`); Plan B adds the matching field on climate-tracking's side so the `#2` gap fix (Plan B, on-demand hallazgo lookup) can read it once `#51` makes this endpoint real.

- [ ] **Step 2: Add the stub endpoints**

In `src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs`, add to `MapTrackingInternalEndpoints`:

```csharp
group.MapGet("/ciclos-encuesta", ListCiclosAsync);
group.MapGet("/hallazgos", ListHallazgosAsync);
group.MapPost("/send-notification", SendNotificationAsync);
```

And add the three handler methods:

```csharp
private static Task<IResult> ListCiclosAsync(
    [FromQuery(Name = "company_id")] string companyId)
{
    // Stub: surveys domain (#51) doesn't exist yet. Always returns an empty list;
    // #51 replaces this body with a real query once survey-cycle data exists.
    return Task.FromResult(Results.Json(new Envelope<CiclosData>(true, new CiclosData([])), SnakeCaseOptions));
}

private static Task<IResult> ListHallazgosAsync(
    [FromQuery(Name = "company_id")] string companyId,
    [FromQuery(Name = "ciclo_id")] string? cicloId,
    [FromQuery(Name = "hallazgo_id")] string? hallazgoId)
{
    // Stub: surveys domain (#51) doesn't exist yet. Always returns an empty list
    // regardless of the ciclo_id/hallazgo_id filters; #51 replaces this body with a
    // real query and MUST honor both filters at that point (the old Next.js
    // /internal/hallazgos silently ignored ciclo_id -- don't repeat that here).
    return Task.FromResult(Results.Json(new Envelope<HallazgosData>(true, new HallazgosData([])), SnakeCaseOptions));
}

private static IResult SendNotificationAsync()
{
    // Stub: notifications domain (#55) doesn't exist yet. No-op success response;
    // #55 replaces this body with a real send once notification infrastructure exists.
    return Results.Json(new Envelope<object?>(true, null), SnakeCaseOptions);
}
```

- [ ] **Step 3: Write the contract tests**

```csharp
// tests/ClimateProject.IntegrationTests/Tracking/TrackingInternalStubEndpointsTests.cs
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Tracking;
using ClimateProject.IntegrationTests.Support;

namespace ClimateProject.IntegrationTests.Tracking;

[Collection("Postgres")]
public class TrackingInternalStubEndpointsTests
{
    private readonly JsonSerializerOptions _snakeCaseOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    public TrackingInternalStubEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    private readonly AuthWebApplicationFactory _factory;

    [Fact]
    public async Task Ciclos_endpoint_returns_empty_envelope_with_correct_shape()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.GetAsync($"/api/internal/ciclos-encuesta?company_id={Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var envelope = await response.Content.ReadFromJsonAsync<Envelope<CiclosData>>(_snakeCaseOptions);
        Assert.True(envelope!.Success);
        Assert.Empty(envelope.Data.Ciclos);
    }

    [Fact]
    public async Task Hallazgos_endpoint_accepts_ciclo_id_and_hallazgo_id_filters_and_returns_empty()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.GetAsync($"/api/internal/hallazgos?company_id={Guid.NewGuid()}&ciclo_id=some-ciclo&hallazgo_id=some-hallazgo");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var envelope = await response.Content.ReadFromJsonAsync<Envelope<HallazgosData>>(_snakeCaseOptions);
        Assert.True(envelope!.Success);
        Assert.Empty(envelope.Data.Hallazgos);
    }

    [Fact]
    public async Task SendNotification_endpoint_returns_success_envelope()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.PostAsync("/api/internal/send-notification", new StringContent("{}", System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter FullyQualifiedName~TrackingInternalStubEndpointsTests`
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ClimateProject.Application/Tracking/TrackingInternalDtos.cs src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs tests/ClimateProject.IntegrationTests/Tracking/TrackingInternalStubEndpointsTests.cs
git commit -m "feat: add stubbed /api/internal/ciclos-encuesta,hallazgos,send-notification endpoints"
```

---

## Task 4: Frontend typed API client for direct climate-tracking calls

> **Amendment (2026-08-01):** as shipped, this client had zero callers anywhere in `web/src`
> (by design -- this plan explicitly excludes tracking pages, see Global Constraints), and
> `VITE_TRACKING_API_BASE_URL` was referenced only in `web/.env.example`, never read in code.
> Fixed by adding `web/src/features/tracking/api/config.ts` (`getTrackingApiBaseUrl()`) and
> defaulting every export's `baseUrl` parameter to it, and by adding an opt-in
> `trackingApi.live.test.ts` (skipped unless `TRACKING_API_LIVE_URL` is set) so the client can
> actually be verified against a real climate-tracking instance instead of only a stubbed
> fetch. Wiring an actual page to this client remains out of scope here and is tracked as
> `climate-project#74`.

**Files:**
- Modify: `web/.env.example` (add `VITE_TRACKING_API_BASE_URL`)
- Create: `web/src/features/tracking/api/trackingApi.ts`
- Test: `web/src/features/tracking/api/trackingApi.test.ts`

**Interfaces:**
- Consumes: `authFetch` from `web/src/api/authFetch.ts` (existing).
- Produces: `getConsolidado`, `getTablero`, `getMisTareas`, `listPlanesAccion`, `getPlanAccion`, `createPlanAccion`, `registrarAvance`, `marcarCumplido`, `agregarInvolucrado` — for future tracking-page work to consume.

- [ ] **Step 1: Add the env var**

In `web/.env.example`, add a second line:

```
VITE_API_BASE_URL=http://localhost:5080
VITE_TRACKING_API_BASE_URL=http://localhost:5081
```

- [ ] **Step 2: Write the typed client**

```typescript
// web/src/features/tracking/api/trackingApi.ts
import { authFetch } from '../../../api/authFetch'

export interface SemaforoCounts {
  rojo: number
  amarillo: number
  verde: number
}

export interface PlanAccion {
  id: string
  planCode: string
  nodoExternalId: string
  liderExternalId: string
  hallazgoExternalId: string | null
  descripcionQue: string
  metodologiaComo: string
  responsableEjecucionExternalId: string
  fechaCreacion: string
  fechaCompromiso: string
  porcentajeAvance: number
  estadoSemaforo: string
  cicloEncuestaExternalId: string | null
  fechaUltimaActualizacion: string
  cumplido: boolean
  involucradosExternalIds: string[]
}

export interface TableroResponse {
  nodoExternalId: string
  conteos: SemaforoCounts
  planes: PlanAccion[]
}

export interface NodoConsolidado {
  nodoExternalId: string
  conteos: SemaforoCounts
  totalPlanes: number
}

export interface ConsolidadoResponse {
  conteos: SemaforoCounts
  porNodo: NodoConsolidado[]
}

export interface CreatePlanAccionInput {
  nodoExternalId: string
  hallazgoExternalId?: string | null
  descripcionQue: string
  metodologiaComo: string
  responsableEjecucionExternalId: string
  fechaCompromiso: string
  involucrados?: string[] | null
}

export interface RegistrarAvanceInput {
  porcentajeAvance: number
  comentario?: string | null
  fecha: string
}

export interface MarcarCumplidoInput {
  fecha: string
}

export interface AgregarInvolucradoInput {
  personaExternalId: string
}

export interface ListPlanesAccionFilters {
  nodoId?: string
  estado?: string
}

export async function getConsolidado(baseUrl: string): Promise<ConsolidadoResponse> {
  const response = await authFetch(`${baseUrl}/api/consolidado`)
  return response.json() as Promise<ConsolidadoResponse>
}

export async function getTablero(baseUrl: string, nodoId?: string): Promise<TableroResponse> {
  const query = nodoId ? `?nodoId=${encodeURIComponent(nodoId)}` : ''
  const response = await authFetch(`${baseUrl}/api/tablero-seguimiento${query}`)
  return response.json() as Promise<TableroResponse>
}

export async function getMisTareas(baseUrl: string): Promise<PlanAccion[]> {
  const response = await authFetch(`${baseUrl}/api/mis-tareas`)
  return response.json() as Promise<PlanAccion[]>
}

export async function listPlanesAccion(baseUrl: string, filters: ListPlanesAccionFilters = {}): Promise<PlanAccion[]> {
  const params = new URLSearchParams()
  if (filters.nodoId) params.set('nodoId', filters.nodoId)
  if (filters.estado) params.set('estado', filters.estado)
  const query = params.toString() ? `?${params.toString()}` : ''
  const response = await authFetch(`${baseUrl}/api/planes-accion${query}`)
  return response.json() as Promise<PlanAccion[]>
}

export async function getPlanAccion(baseUrl: string, id: string): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion/${id}`)
  return response.json() as Promise<PlanAccion>
}

export async function createPlanAccion(baseUrl: string, input: CreatePlanAccionInput): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<PlanAccion>
}

export async function registrarAvance(baseUrl: string, id: string, input: RegistrarAvanceInput): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion/${id}/avance`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<PlanAccion>
}

export async function marcarCumplido(baseUrl: string, id: string, input: MarcarCumplidoInput): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion/${id}/cumplir`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<PlanAccion>
}

export async function agregarInvolucrado(baseUrl: string, id: string, input: AgregarInvolucradoInput): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion/${id}/involucrados`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<PlanAccion>
}
```

- [ ] **Step 3: Write the tests**

```typescript
// web/src/features/tracking/api/trackingApi.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
  getConsolidado,
  getTablero,
  getMisTareas,
  listPlanesAccion,
  getPlanAccion,
  createPlanAccion,
  registrarAvance,
  marcarCumplido,
  agregarInvolucrado,
} from './trackingApi'

const baseUrl = 'http://tracking.test'

const samplePlan = {
  id: 'p1',
  planCode: 'PA-2026-00001',
  nodoExternalId: 'n1',
  liderExternalId: 'l1',
  hallazgoExternalId: null,
  descripcionQue: 'Improve onboarding',
  metodologiaComo: 'Weekly check-ins',
  responsableEjecucionExternalId: 'r1',
  fechaCreacion: '2026-08-01',
  fechaCompromiso: '2026-09-01',
  porcentajeAvance: 0,
  estadoSemaforo: 'Verde',
  cicloEncuestaExternalId: null,
  fechaUltimaActualizacion: '2026-08-01',
  cumplido: false,
  involucradosExternalIds: [],
}

describe('trackingApi client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('gets consolidado', async () => {
    const result = { conteos: { rojo: 1, amarillo: 2, verde: 3 }, porNodo: [] }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }))

    const response = await getConsolidado(baseUrl)

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/consolidado`, expect.anything())
    expect(response.conteos.verde).toBe(3)
  })

  it('gets tablero with an optional nodoId filter', async () => {
    const result = { nodoExternalId: 'n1', conteos: { rojo: 0, amarillo: 0, verde: 1 }, planes: [samplePlan] }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }))

    const response = await getTablero(baseUrl, 'n1')

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/tablero-seguimiento?nodoId=n1`, expect.anything())
    expect(response.planes).toHaveLength(1)
  })

  it('gets mis tareas', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([samplePlan]), { status: 200 }))

    const response = await getMisTareas(baseUrl)

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/mis-tareas`, expect.anything())
    expect(response).toHaveLength(1)
  })

  it('lists planes de accion with filters', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([samplePlan]), { status: 200 }))

    await listPlanesAccion(baseUrl, { nodoId: 'n1', estado: 'Verde' })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/planes-accion?nodoId=n1&estado=Verde`, expect.anything())
  })

  it('gets a single plan de accion', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(samplePlan), { status: 200 }))

    const response = await getPlanAccion(baseUrl, 'p1')

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/planes-accion/p1`, expect.anything())
    expect(response.id).toBe('p1')
  })

  it('creates a plan de accion', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(samplePlan), { status: 201 }))

    await createPlanAccion(baseUrl, {
      nodoExternalId: 'n1',
      descripcionQue: 'Improve onboarding',
      metodologiaComo: 'Weekly check-ins',
      responsableEjecucionExternalId: 'r1',
      fechaCompromiso: '2026-09-01',
    })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/planes-accion`, expect.objectContaining({ method: 'POST' }))
  })

  it('registers avance', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...samplePlan, porcentajeAvance: 50 }), { status: 200 }))

    const response = await registrarAvance(baseUrl, 'p1', { porcentajeAvance: 50, fecha: '2026-08-15' })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/planes-accion/p1/avance`, expect.objectContaining({ method: 'POST' }))
    expect(response.porcentajeAvance).toBe(50)
  })

  it('marks a plan as cumplido', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...samplePlan, cumplido: true }), { status: 200 }))

    const response = await marcarCumplido(baseUrl, 'p1', { fecha: '2026-09-01' })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/planes-accion/p1/cumplir`, expect.objectContaining({ method: 'POST' }))
    expect(response.cumplido).toBe(true)
  })

  it('adds an involucrado', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...samplePlan, involucradosExternalIds: ['p2'] }), { status: 200 }))

    const response = await agregarInvolucrado(baseUrl, 'p1', { personaExternalId: 'p2' })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/planes-accion/p1/involucrados`, expect.objectContaining({ method: 'POST' }))
    expect(response.involucradosExternalIds).toContain('p2')
  })
})
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npm test -- --run trackingApi.test.ts`
Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/.env.example web/src/features/tracking/api/trackingApi.ts web/src/features/tracking/api/trackingApi.test.ts
git commit -m "feat: add typed frontend API client for direct climate-tracking calls"
```
