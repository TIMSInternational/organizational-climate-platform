# Tracking Service Fixes — climate-tracking side (#56 + gap fixes) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CORS so the frontend can call this service directly, fix the two known
gaps (`HallazgoCache` never synced, `GeneratePlanCodeAsync` race window), matching the
approved `#56` design and the `services/tracking-api/` consolidation.

**Architecture:** All work happens in `services/tracking-api/` (moved here from the
former `climate-tracking` repo — see `feat/consolidate-climate-tracking`). No new
services, no schema redesign — targeted fixes to the existing `.NET 10` codebase.

**Tech Stack:** .NET 10 minimal APIs, EF Core/Npgsql, xUnit + Testcontainers (via
`PostgresFixture`), Polly (already wired for `ClimateProjectClient`).

## Global Constraints

- All paths in this plan are relative to `services/tracking-api/` (e.g.
  `src/ClimateTracking.Api/Program.cs` means
  `services/tracking-api/src/ClimateTracking.Api/Program.cs`).
- Adding a method to `IClimateProjectClient` breaks every existing implementer at
  compile time — every fake in the test suite (`CacheSyncWorkerTests.cs`,
  `DailySemaforoWorkerTests.cs` has two: `FakeClimateProjectClient` and
  `SelectivelyFailingClient`) must be updated in the same task, or the build breaks.
- `HallazgoCache` has exactly one read site today (`PlanesAccionEndpoints.CreateAsync`)
  and zero write sites — confirmed via full-repo grep. Once the read site is fixed, the
  entity is 100% dead code; remove it completely (entity, EF configuration, `DbSet`,
  the one unit test that constructs it) rather than leaving it unused.
- Don't touch pinned package versions (`Directory.Build.props`, `.csproj` files).
- Test convention: `WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
  builder.UseSetting(...))` for endpoint tests (see
  `tests/ClimateTracking.IntegrationTests/Endpoints/PlanesAccionEndpointsTests.cs` for
  the pattern), `IClassFixture<PostgresFixture>` + `IAsyncLifetime` for DB-backed test
  classes.

---

## Task 1: CORS configuration

**Files:**
- Modify: `src/ClimateTracking.Api/Program.cs`
- Modify: `src/ClimateTracking.Api/appsettings.json`

**Interfaces:**
- Produces: `Cors:AllowedOrigins` config section, `"Frontend"` CORS policy.

- [ ] **Step 1: Add the config section**

In `src/ClimateTracking.Api/appsettings.json`, add a new top-level section:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*",
  "ConnectionStrings": {
    "ClimateTracking": "Host=localhost;Port=5432;Database=climate_tracking;Username=climate_tracking;Password=changeme"
  },
  "TrackingJwtSecret": "",
  "ProcomerCompanyId": "",
  "ClimateProjectBaseUrl": "",
  "ClimateProjectInternalApiKey": "",
  "Cors": {
    "AllowedOrigins": []
  }
}
```

- [ ] **Step 2: Wire up the CORS policy in `Program.cs`**

In `src/ClimateTracking.Api/Program.cs`, add after the existing
`builder.Services.AddOpenApi();` line:

```csharp
builder.Services.AddCors();
builder.Services.AddOptions<Microsoft.AspNetCore.Cors.Infrastructure.CorsOptions>()
    .Configure<IConfiguration>((options, configuration) =>
    {
        var allowedOrigins = configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
        options.AddPolicy("Frontend", policy => policy
            .WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod());
    });
```

Add after the existing `var app = builder.Build();` line, before `app.UseAuthentication();`:

```csharp
app.UseCors("Frontend");
```

- [ ] **Step 3: Verify it builds**

Run: `dotnet build` (from `services/tracking-api/`)
Expected: Build succeeded, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add services/tracking-api/src/ClimateTracking.Api/Program.cs services/tracking-api/src/ClimateTracking.Api/appsettings.json
git commit -m "feat: add CORS support for direct frontend calls to tracking service"
```

---

## Task 2: `GetHallazgoByIdAsync` client method + `HallazgoDto.CicloId`

**Files:**
- Modify: `src/ClimateTracking.Application/ExternalApi/IClimateProjectClient.cs`
- Modify: `src/ClimateTracking.Infrastructure/ExternalApi/ClimateProjectClient.cs`
- Modify: `tests/ClimateTracking.IntegrationTests/Workers/CacheSyncWorkerTests.cs`
- Modify: `tests/ClimateTracking.IntegrationTests/Workers/DailySemaforoWorkerTests.cs`
- Modify: `tests/ClimateTracking.UnitTests/ExternalApi/ClimateProjectClientTests.cs`

**Interfaces:**
- Produces: `HallazgoDto` gains a `CicloId` property (last positional parameter).
  `IClimateProjectClient.GetHallazgoByIdAsync(string hallazgoId, CancellationToken
  cancellationToken): Task<HallazgoDto?>` — consumed by Task 3.

- [ ] **Step 1: Add `CicloId` to `HallazgoDto` and the new interface method**

In `src/ClimateTracking.Application/ExternalApi/IClimateProjectClient.cs`, replace the
`HallazgoDto` record and add the new method:

```csharp
/// <summary>Mirrors /api/internal/hallazgos (organizational-climate-platform's
/// TrackingInternalEndpoints).</summary>
public sealed record HallazgoDto(
    string HallazgoId,
    string NodoId,
    string Categoria,
    decimal ResultadoPct,
    decimal? BenchmarkSectorPct,
    decimal? ResultadoAnioAnteriorPct,
    string? CicloId);
```

Add to the `IClimateProjectClient` interface, after `GetHallazgosAsync`:

```csharp
Task<HallazgoDto?> GetHallazgoByIdAsync(string hallazgoId, CancellationToken cancellationToken);
```

- [ ] **Step 2: Implement it in `ClimateProjectClient`**

In `src/ClimateTracking.Infrastructure/ExternalApi/ClimateProjectClient.cs`, add after
`GetHallazgosAsync`:

```csharp
public async Task<HallazgoDto?> GetHallazgoByIdAsync(string hallazgoId, CancellationToken cancellationToken)
{
    var query = $"/api/internal/hallazgos?hallazgo_id={Uri.EscapeDataString(hallazgoId)}" +
        $"&company_id={Uri.EscapeDataString(_options.ProcomerCompanyId)}";
    var envelope = await GetAsync<Envelope<HallazgosData>>(query, cancellationToken);
    return envelope.Data.Hallazgos.FirstOrDefault();
}
```

- [ ] **Step 3: Update `CacheSyncWorkerTests.cs`'s fake**

In `tests/ClimateTracking.IntegrationTests/Workers/CacheSyncWorkerTests.cs`, add to
`FakeClimateProjectClient` (after its `GetHallazgosAsync` method):

```csharp
public Task<HallazgoDto?> GetHallazgoByIdAsync(string hallazgoId, CancellationToken cancellationToken) =>
    Task.FromResult<HallazgoDto?>(null);
```

- [ ] **Step 4: Update `DailySemaforoWorkerTests.cs`'s two fakes**

In `tests/ClimateTracking.IntegrationTests/Workers/DailySemaforoWorkerTests.cs`, add the
same method to both `FakeClimateProjectClient` and `SelectivelyFailingClient` (after
each class's existing `GetHallazgosAsync` method):

```csharp
public Task<HallazgoDto?> GetHallazgoByIdAsync(string hallazgoId, CancellationToken cancellationToken) =>
    Task.FromResult<HallazgoDto?>(null);
```

- [ ] **Step 5: Add a unit test for the new client method**

In `tests/ClimateTracking.UnitTests/ExternalApi/ClimateProjectClientTests.cs`, add:

```csharp
[Fact]
public async Task GetHallazgoByIdAsync_passes_hallazgo_id_and_company_id_and_returns_first_match()
{
    var handler = new StubHttpMessageHandler(_ => JsonResponse(new
    {
        success = true,
        data = new
        {
            hallazgos = new[]
            {
                new { hallazgo_id = "HAL-1", nodo_id = "ND-1", categoria = "Clima", resultado_pct = 0.5m, benchmark_sector_pct = (decimal?)null, resultado_anio_anterior_pct = (decimal?)null, ciclo_id = "CIC-2026-Q3" },
            },
        },
    }));
    var client = CreateClient(handler);

    var result = await client.GetHallazgoByIdAsync("HAL-1", CancellationToken.None);

    var request = handler.Requests[0];
    Assert.Contains("hallazgo_id=HAL-1", request.RequestUri!.Query);
    Assert.Contains("company_id=CO-014", request.RequestUri!.Query);
    Assert.Equal("CIC-2026-Q3", result!.CicloId);
}

[Fact]
public async Task GetHallazgoByIdAsync_returns_null_when_not_found()
{
    var handler = new StubHttpMessageHandler(_ => JsonResponse(new
    {
        success = true,
        data = new { hallazgos = Array.Empty<object>() },
    }));
    var client = CreateClient(handler);

    var result = await client.GetHallazgoByIdAsync("HAL-missing", CancellationToken.None);

    Assert.Null(result);
}
```

- [ ] **Step 6: Run the tests**

Run: `dotnet test --filter FullyQualifiedName~ClimateProjectClientTests` (from
`services/tracking-api/`)
Expected: all pass, including the 2 new tests.

Run: `dotnet build` (from `services/tracking-api/`)
Expected: Build succeeded — confirms all 3 fakes still satisfy the interface.

- [ ] **Step 7: Commit**

```bash
git add services/tracking-api/src/ClimateTracking.Application/ExternalApi/IClimateProjectClient.cs services/tracking-api/src/ClimateTracking.Infrastructure/ExternalApi/ClimateProjectClient.cs services/tracking-api/tests/ClimateTracking.IntegrationTests/Workers/CacheSyncWorkerTests.cs services/tracking-api/tests/ClimateTracking.IntegrationTests/Workers/DailySemaforoWorkerTests.cs services/tracking-api/tests/ClimateTracking.UnitTests/ExternalApi/ClimateProjectClientTests.cs
git commit -m "feat: add GetHallazgoByIdAsync client method and HallazgoDto.CicloId"
```

---

## Task 3: Remove `HallazgoCache`, fix the on-demand hallazgo lookup

**Files:**
- Delete: `src/ClimateTracking.Domain/Entities/HallazgoCache.cs`
- Delete: `src/ClimateTracking.Infrastructure/Persistence/Configurations/HallazgoCacheConfiguration.cs`
- Modify: `src/ClimateTracking.Infrastructure/Persistence/ClimateTrackingDbContext.cs`
  (remove the `Hallazgos` `DbSet`)
- Modify: `src/ClimateTracking.Api/Endpoints/PlanesAccionEndpoints.cs`
- Modify: `src/ClimateTracking.Workers/CacheSyncWorker.cs` (update stale doc comment)
- Delete: the `HallazgoCache_holds_benchmark_and_prior_year_percentages` test in
  `tests/ClimateTracking.UnitTests/Entities/CacheEntitiesTests.cs`
- Create: `src/ClimateTracking.Infrastructure/Migrations/<timestamp>_DropHallazgosCache.cs`
  (generated by `dotnet ef migrations add`, not hand-written)
- Test: `tests/ClimateTracking.IntegrationTests/Endpoints/PlanesAccionHallazgoLookupTests.cs`

**Interfaces:**
- Consumes: `GetHallazgoByIdAsync` from Task 2.

- [ ] **Step 1: Delete the entity and its EF configuration**

```bash
rm services/tracking-api/src/ClimateTracking.Domain/Entities/HallazgoCache.cs
rm services/tracking-api/src/ClimateTracking.Infrastructure/Persistence/Configurations/HallazgoCacheConfiguration.cs
```

- [ ] **Step 2: Remove the `DbSet` from `ClimateTrackingDbContext`**

In `src/ClimateTracking.Infrastructure/Persistence/ClimateTrackingDbContext.cs`, delete
this line:

```csharp
public DbSet<HallazgoCache> Hallazgos => Set<HallazgoCache>();
```

- [ ] **Step 3: Generate the drop-table migration**

Run (from `services/tracking-api/src/ClimateTracking.Infrastructure/`):
```bash
dotnet ef migrations add DropHallazgosCache --startup-project ../ClimateTracking.Api
```
Expected: a new migration file is generated containing
`migrationBuilder.DropTable(name: "hallazgos_cache");` (and the corresponding index
drop). Inspect the generated file to confirm — do not hand-edit it beyond that
confirmation.

- [ ] **Step 4: Fix the lookup in `PlanesAccionEndpoints.CreateAsync`**

In `src/ClimateTracking.Api/Endpoints/PlanesAccionEndpoints.cs`, replace the method
signature:

```csharp
    private static async Task<IResult> CreateAsync(
        CreatePlanRequest request,
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        CancellationToken cancellationToken)
```

with (minimal APIs resolve the new parameter from DI automatically, same as `db`):

```csharp
    private static async Task<IResult> CreateAsync(
        CreatePlanRequest request,
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        IClimateProjectClient climateProjectClient,
        CancellationToken cancellationToken)
```

Add `using ClimateTracking.Application.ExternalApi;` to the file's using directives if
not already present (it isn't — this file doesn't reference the client today).

Then replace the hallazgo lookup body:

```csharp
        string? cicloExternalId = null;
        if (request.HallazgoExternalId is not null)
        {
            var hallazgo = await db.Hallazgos.FirstOrDefaultAsync(
                h => h.ExternalId == request.HallazgoExternalId, cancellationToken);
            cicloExternalId = hallazgo?.CicloExternalId;
        }
```

with:

```csharp
        string? cicloExternalId = null;
        if (request.HallazgoExternalId is not null)
        {
            var hallazgo = await climateProjectClient.GetHallazgoByIdAsync(request.HallazgoExternalId, cancellationToken);
            cicloExternalId = hallazgo?.CicloId;
        }
```

- [ ] **Step 5: Update the stale doc comment in `CacheSyncWorker.cs`**

In `src/ClimateTracking.Workers/CacheSyncWorker.cs`, replace the class's XML doc comment:

```csharp
/// <summary>
/// Polls climate-project's /internal/nodos, /internal/personas, and /internal/ciclos-encuesta
/// on an interval and upserts the corresponding cache tables.
///
/// KNOWN GAP: HallazgoCache is not populated by this worker or by anything else in this PR.
/// The original plan called for dashboard reads to refresh it on-demand per (ciclo, nodo),
/// but no dashboard endpoint added so far surfaces hallazgo data, so that refresh path was
/// never wired up -- IClimateProjectClient.GetHallazgosAsync exists but is currently unused.
/// PlanesAccionEndpoints.CreateAsync's optional hallazgo→ciclo lookup will silently find
/// nothing until this is built. Flagging here rather than guessing at an implementation.
/// </summary>
```

with:

```csharp
/// <summary>
/// Polls climate-project's /internal/nodos, /internal/personas, and /internal/ciclos-encuesta
/// on an interval and upserts the corresponding cache tables.
///
/// Hallazgos are deliberately NOT synced here -- they're looked up on-demand via
/// IClimateProjectClient.GetHallazgoByIdAsync in PlanesAccionEndpoints.CreateAsync
/// instead of cached, since they're only needed at plan-creation time for a single
/// hallazgo, not queried in bulk like nodos/personas/ciclos.
/// </summary>
```

- [ ] **Step 6: Delete the now-obsolete unit test**

In `tests/ClimateTracking.UnitTests/Entities/CacheEntitiesTests.cs`, delete the
`HallazgoCache_holds_benchmark_and_prior_year_percentages` test method (the `HallazgoCache`
type it references no longer exists).

- [ ] **Step 7: Write the new integration test for the fixed lookup**

```csharp
// tests/ClimateTracking.IntegrationTests/Endpoints/PlanesAccionHallazgoLookupTests.cs
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using ClimateTracking.Application.ExternalApi;
using ClimateTracking.Domain.Entities;
using ClimateTracking.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.Tokens;
using Jwt = System.IdentityModel.Tokens.Jwt;

namespace ClimateTracking.IntegrationTests.Endpoints;

public class PlanesAccionHallazgoLookupTests : IClassFixture<PostgresFixture>, IAsyncLifetime
{
    private const string TrackingJwtSecret = "test-tracking-secret-at-least-32-bytes-long";
    private const string ProcomerCompanyId = "CO-014";

    private readonly PostgresFixture _postgres;
    private WebApplicationFactory<Program> _factory = null!;

    public PlanesAccionHallazgoLookupTests(PostgresFixture postgres)
    {
        _postgres = postgres;
    }

    private sealed class FakeClimateProjectClient : IClimateProjectClient
    {
        public HallazgoDto? HallazgoToReturn { get; set; }

        public Task<IReadOnlyList<NodoDto>> GetNodosAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<NodoDto>>([]);
        public Task<IReadOnlyList<PersonaDto>> GetPersonasAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<PersonaDto>>([]);
        public Task<IReadOnlyList<CicloDto>> GetCiclosAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<CicloDto>>([]);
        public Task<IReadOnlyList<HallazgoDto>> GetHallazgosAsync(string cicloId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<HallazgoDto>>([]);
        public Task<HallazgoDto?> GetHallazgoByIdAsync(string hallazgoId, CancellationToken cancellationToken) =>
            Task.FromResult(HallazgoToReturn);
        public Task SendNotificationAsync(SendNotificationRequest request, CancellationToken cancellationToken) =>
            Task.CompletedTask;
    }

    private readonly FakeClimateProjectClient _fakeClient = new();

    public async Task InitializeAsync()
    {
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("ConnectionStrings:ClimateTracking", _postgres.ConnectionString);
            builder.UseSetting("TrackingJwtSecret", TrackingJwtSecret);
            builder.UseSetting("ProcomerCompanyId", ProcomerCompanyId);
            builder.UseSetting("ClimateProjectBaseUrl", "http://climate-project.test");
            builder.UseSetting("ClimateProjectInternalApiKey", "test-internal-key");
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IClimateProjectClient>();
                services.AddSingleton<IClimateProjectClient>(_fakeClient);
            });
        });

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        await db.Database.MigrateAsync();

        if (!await db.Nodos.AnyAsync(n => n.ExternalId == "ND-014"))
        {
            db.Nodos.Add(new NodoCache
            {
                ExternalId = "ND-014",
                Nombre = "Comercial Exterior",
                LiderExternalId = "PER-0231",
                CantidadColaboradores = 8,
                Activo = true,
                LastSyncedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }
    }

    public async Task DisposeAsync()
    {
        await _factory.DisposeAsync();
    }

    private HttpClient CreateAuthenticatedClient(string sub, string role, string nodoId)
    {
        var client = _factory.CreateClient();
        var handler = new Jwt.JwtSecurityTokenHandler();
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TrackingJwtSecret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var claims = new[]
        {
            new Claim("sub", sub),
            new Claim("role", role),
            new Claim("nodoId", nodoId),
            new Claim("email", $"{sub}@procomer.com"),
            new Claim("name", sub),
            new Claim("companyId", ProcomerCompanyId),
            new Claim("isActive", "true"),
        };
        var token = new Jwt.JwtSecurityToken(claims: claims, expires: DateTime.UtcNow.AddHours(1), signingCredentials: creds);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", handler.WriteToken(token));
        return client;
    }

    [Fact]
    public async Task CreatingAPlanWithAHallazgo_setsCicloEncuestaExternalId_fromTheClientLookup()
    {
        _fakeClient.HallazgoToReturn = new HallazgoDto("HAL-1", "ND-014", "Clima", 0.5m, null, null, "CIC-2026-Q3");
        var client = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");

        var response = await client.PostAsJsonAsync("/api/planes-accion", new
        {
            nodoExternalId = "ND-014",
            hallazgoExternalId = "HAL-1",
            descripcionQue = "Plan con hallazgo",
            metodologiaComo = "N/A",
            responsableEjecucionExternalId = "PER-0231",
            fechaCompromiso = new DateOnly(2026, 12, 31),
            involucrados = (string[]?)null,
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(System.Net.HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("CIC-2026-Q3", body.GetProperty("cicloEncuestaExternalId").GetString());
    }

    [Fact]
    public async Task CreatingAPlanWithAHallazgoTheClientCannotFind_leavesCicloEncuestaExternalIdNull()
    {
        _fakeClient.HallazgoToReturn = null;
        var client = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");

        var response = await client.PostAsJsonAsync("/api/planes-accion", new
        {
            nodoExternalId = "ND-014",
            hallazgoExternalId = "HAL-missing",
            descripcionQue = "Plan con hallazgo inexistente",
            metodologiaComo = "N/A",
            responsableEjecucionExternalId = "PER-0231",
            fechaCompromiso = new DateOnly(2026, 12, 31),
            involucrados = (string[]?)null,
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(System.Net.HttpStatusCode.Created, response.StatusCode);
        Assert.True(body.GetProperty("cicloEncuestaExternalId").ValueKind == JsonValueKind.Null);
    }
}
```

- [ ] **Step 8: Run the tests**

Run: `dotnet test --filter FullyQualifiedName~PlanesAccionHallazgoLookupTests` (from
`services/tracking-api/`)
Expected: both tests pass.

Run: `dotnet test` (from `services/tracking-api/`)
Expected: full suite passes — confirms the deleted `HallazgoCache` type/test and the
new migration didn't break anything else (in particular `ClimateTrackingDbContextTests.cs`,
if it enumerates `DbSet`s).

- [ ] **Step 9: Commit**

```bash
git add -A services/tracking-api
git commit -m "fix: replace dead HallazgoCache lookup with on-demand GetHallazgoByIdAsync call"
```

---

## Task 4: Fix `GeneratePlanCodeAsync` race window

**Files:**
- Modify: `src/ClimateTracking.Api/Endpoints/PlanesAccionEndpoints.cs`
- Test: `tests/ClimateTracking.IntegrationTests/Endpoints/PlanCodeConcurrencyTests.cs`

**Interfaces:**
- No new public interfaces — internal fix to `GeneratePlanCodeAsync`'s implementation.

- [ ] **Step 1: Replace the `COUNT(*)`-based generation with a Postgres sequence**

In `src/ClimateTracking.Api/Endpoints/PlanesAccionEndpoints.cs`, replace:

```csharp
    private static async Task<string> GeneratePlanCodeAsync(ClimateTrackingDbContext db, CancellationToken cancellationToken)
    {
        var year = DateTime.UtcNow.Year;
        var countThisYear = await db.PlanesDeAccion.CountAsync(
            p => p.FechaCreacion.Year == year, cancellationToken);
        return $"PA-{year}-{(countThisYear + 1):D5}";
    }
```

with:

```csharp
    private static async Task<string> GeneratePlanCodeAsync(ClimateTrackingDbContext db, CancellationToken cancellationToken)
    {
        var year = DateTime.UtcNow.Year;
        // Sequence name is built from a server-side int (DateTime.UtcNow.Year), never
        // user input -- safe to interpolate directly; Postgres identifiers can't be
        // bound as query parameters anyway. Created lazily on first use per year rather
        // than pre-migrated, since future years aren't known in advance.
        var sequenceName = $"plan_code_seq_{year}";
        await db.Database.ExecuteSqlRawAsync($"CREATE SEQUENCE IF NOT EXISTS {sequenceName}", cancellationToken);
        var nextVal = await db.Database.SqlQueryRaw<long>($"SELECT nextval('{sequenceName}')").SingleAsync(cancellationToken);
        return $"PA-{year}-{nextVal:D5}";
    }
```

- [ ] **Step 2: Write the concurrency test**

```csharp
// tests/ClimateTracking.IntegrationTests/Endpoints/PlanCodeConcurrencyTests.cs
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using ClimateTracking.Application.Auth;
using ClimateTracking.Domain.Entities;
using ClimateTracking.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Jwt = System.IdentityModel.Tokens.Jwt;

namespace ClimateTracking.IntegrationTests.Endpoints;

public class PlanCodeConcurrencyTests : IClassFixture<PostgresFixture>, IAsyncLifetime
{
    private const string TrackingJwtSecret = "test-tracking-secret-at-least-32-bytes-long";
    private const string ProcomerCompanyId = "CO-014";

    private readonly PostgresFixture _postgres;
    private WebApplicationFactory<Program> _factory = null!;

    public PlanCodeConcurrencyTests(PostgresFixture postgres)
    {
        _postgres = postgres;
    }

    public async Task InitializeAsync()
    {
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("ConnectionStrings:ClimateTracking", _postgres.ConnectionString);
            builder.UseSetting("TrackingJwtSecret", TrackingJwtSecret);
            builder.UseSetting("ProcomerCompanyId", ProcomerCompanyId);
            builder.UseSetting("ClimateProjectBaseUrl", "http://climate-project.test");
            builder.UseSetting("ClimateProjectInternalApiKey", "test-internal-key");
        });

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        await db.Database.MigrateAsync();

        if (!await db.Nodos.AnyAsync(n => n.ExternalId == "ND-CONC"))
        {
            db.Nodos.Add(new NodoCache
            {
                ExternalId = "ND-CONC",
                Nombre = "Concurrency Test Node",
                LiderExternalId = "PER-CONC",
                CantidadColaboradores = 1,
                Activo = true,
                LastSyncedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }
    }

    public async Task DisposeAsync()
    {
        await _factory.DisposeAsync();
    }

    private HttpClient CreateAuthenticatedClient(string sub, string role, string nodoId)
    {
        var client = _factory.CreateClient();
        var handler = new Jwt.JwtSecurityTokenHandler();
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TrackingJwtSecret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var claims = new[]
        {
            new Claim("sub", sub),
            new Claim("role", role),
            new Claim("nodoId", nodoId),
            new Claim("email", $"{sub}@procomer.com"),
            new Claim("name", sub),
            new Claim("companyId", ProcomerCompanyId),
            new Claim("isActive", "true"),
        };
        var token = new Jwt.JwtSecurityToken(claims: claims, expires: DateTime.UtcNow.AddHours(1), signingCredentials: creds);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", handler.WriteToken(token));
        return client;
    }

    [Fact]
    public async Task Concurrent_plan_creation_never_produces_duplicate_plan_codes()
    {
        var client = CreateAuthenticatedClient("PER-CONC", "company_admin", "ND-CONC");

        var tasks = Enumerable.Range(0, 20).Select(async i =>
        {
            var response = await client.PostAsJsonAsync("/api/planes-accion", new
            {
                nodoExternalId = "ND-CONC",
                hallazgoExternalId = (string?)null,
                descripcionQue = $"Concurrent plan {i}",
                metodologiaComo = "N/A",
                responsableEjecucionExternalId = "PER-CONC",
                fechaCompromiso = new DateOnly(2026, 12, 31),
                involucrados = (string[]?)null,
            });
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            return body.GetProperty("planCode").GetString();
        });

        var planCodes = await Task.WhenAll(tasks);

        Assert.Equal(20, planCodes.Distinct().Count());
    }
}
```

- [ ] **Step 3: Run the tests**

Run: `dotnet test --filter FullyQualifiedName~PlanCodeConcurrencyTests` (from
`services/tracking-api/`)
Expected: passes, 20 distinct plan codes.

Run: `dotnet test` (from `services/tracking-api/`)
Expected: full suite passes.

- [ ] **Step 4: Commit**

```bash
git add services/tracking-api/src/ClimateTracking.Api/Endpoints/PlanesAccionEndpoints.cs services/tracking-api/tests/ClimateTracking.IntegrationTests/Endpoints/PlanCodeConcurrencyTests.cs
git commit -m "fix: replace racy COUNT(*)-based plan-code generation with a Postgres sequence"
```
