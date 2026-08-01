# Reports & Analytics Domain (#54) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Report, Benchmark, Analytics Insight, AI Insight, and Demographic Snapshot
CRUD endpoints + frontend pages, with report generation and analytics computation stubbed.

**Architecture:** Minimal-API + manual role checks, `Application/Reports/` +
`Application/Analytics/` DTOs, typed frontend API clients, new pages mirroring
`web/src/features/action-plans/`.

**Tech Stack:** .NET 10 minimal APIs, EF Core/Postgres (schema already exists, no
migration needed), xUnit + Testcontainers, React 19 + Vite + react-router-dom, Vitest.

## Global Constraints

- No schema changes — `Report`, `Benchmark`, `BenchmarkMetric`, `AnalyticsInsight`,
  `AnalyticsMetricData`, `AnalyticsTimeSeries`, `AIInsight`, `DemographicSnapshot`,
  `DemographicSnapshotEntry`, `DemographicSnapshotChange` already exist from `#49`.
  `DemographicField` is a separate, already-shipped domain (org-structure Slice 3) — not
  touched here.
- Authorization: `.RequireAuthorization()` + manual role check + `Results.Forbid()`,
  never `[Authorize(Roles=)]`. `Roles.Admin.Contains` + own-company for `CompanyAdmin`,
  any for `SuperAdmin` (same `CanAccessCompany` pattern as every prior domain).
- **Report generation is stubbed**: creating a `Report` sets `Status = "generating"`,
  then synchronously (no background job) sets `Status = "completed"`,
  `GenerationCompletedAt = now`, `ReportOutput = "Report generation is stubbed — no real
  rendering yet."`. Real PDF/CSV rendering is separate future work.
- **Analytics computation is stubbed**: `AnalyticsInsight`/`AIInsight` endpoints are pure
  CRUD — nothing computes them from real survey data (that needs `#51`, not started).
  `SurveyId`/`DepartmentId` FKs, where present, are validated against the real
  `Surveys`/`Departments` tables (both exist from `#49`'s schema, just empty until `#51`
  lands — validation still real, just against currently-empty tables).
- `Benchmark.PriorPeriodBenchmarkId` (already in the schema) is the `#20`
  prior-year-benchmark fix — accept and validate it against another `Benchmark` row, no
  new field needed.
- No hard delete anywhere — every entity here already has a lifecycle field
  (`Report.Status`, `Benchmark.IsActive`, `AnalyticsInsight.IsCurrent`,
  `AIInsight.IsAcknowledged`, `DemographicSnapshot.IsActive`) covering it.
- `.NET`: don't touch pinned package versions. Frontend: Node 20 LTS+.

---

## Task 1: Report endpoints

**Files:**
- Create: `src/ClimateProject.Application/Reports/ReportDtos.cs`
- Create: `src/ClimateProject.Api/Endpoints/ReportEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs`
- Test: `tests/ClimateProject.IntegrationTests/Reports/ReportEndpointsTests.cs`

**Interfaces:**
- Produces: `ReportDetail`, `ReportListItem`, `CreateReportRequest` records.

- [ ] **Step 1: Write the DTOs**

```csharp
// src/ClimateProject.Application/Reports/ReportDtos.cs
namespace ClimateProject.Application.Reports;

public sealed record ReportListItem(Guid Id, string Title, string Type, Guid CompanyId, string Status, string Format, DateTimeOffset CreatedAt);

public sealed record ReportDetail(
    Guid Id, string Title, string? Description, string Type, Guid CompanyId, Guid CreatedBy,
    string? TemplateId, string Status, string Format, string? ReportOutput, int DownloadCount,
    DateTimeOffset? GenerationStartedAt, DateTimeOffset? GenerationCompletedAt, DateTimeOffset CreatedAt);

public sealed record CreateReportRequest(string Title, string? Description, string Type, Guid CompanyId, string Format, string? TemplateId);
```

- [ ] **Step 2: Write the endpoints**

```csharp
// src/ClimateProject.Api/Endpoints/ReportEndpoints.cs
using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class ReportEndpoints
{
    public static void MapReportEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/reports").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPost("/{id:guid}/download", DownloadAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static async Task<Guid> ResolveCurrentUserIdAsync(CurrentUser currentUser, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        if (Guid.TryParse(currentUser.Sub, out var userId))
        {
            var byId = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
            if (byId is not null) return byId.Id;
        }
        var byExternalId = await db.Users.FirstOrDefaultAsync(u => u.PersonaExternalId == currentUser.Sub, cancellationToken);
        return byExternalId?.Id ?? Guid.Empty;
    }

    private static async Task<IResult> ListAsync(Guid companyId, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId)) return Results.Forbid();

        var reports = await db.Reports
            .Where(r => r.CompanyId == companyId)
            .OrderByDescending(r => r.CreatedAt)
            .Select(r => new ReportListItem(r.Id, r.Title, r.Type, r.CompanyId, r.Status, r.Format, r.CreatedAt))
            .ToListAsync(cancellationToken);

        return Results.Ok(reports);
    }

    private static async Task<IResult> CreateAsync(CreateReportRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, request.CompanyId)) return Results.Forbid();

        var title = request.Title?.Trim();
        if (string.IsNullOrWhiteSpace(title)) return Results.Json(new { message = "Title is required" }, statusCode: 400);

        var createdBy = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var report = new Report
        {
            Id = Guid.NewGuid(),
            Title = title,
            Description = request.Description,
            Type = request.Type,
            CompanyId = request.CompanyId,
            CreatedBy = createdBy,
            TemplateId = request.TemplateId,
            Status = "generating",
            Format = request.Format,
            GenerationStartedAt = now,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Reports.Add(report);
        await db.SaveChangesAsync(cancellationToken);

        // Stub: no real rendering engine yet -- completes synchronously and instantly.
        report.Status = "completed";
        report.GenerationCompletedAt = DateTimeOffset.UtcNow;
        report.ReportOutput = "Report generation is stubbed -- no real rendering yet.";
        report.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(ToDetail(report), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var report = await db.Reports.FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (report is null) return Results.Json(new { message = "Report not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, report.CompanyId)) return Results.Forbid();

        return Results.Ok(ToDetail(report));
    }

    private static async Task<IResult> DownloadAsync(Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var report = await db.Reports.FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (report is null) return Results.Json(new { message = "Report not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, report.CompanyId)) return Results.Forbid();

        if (report.Status != "completed")
        {
            return Results.Json(new { message = "Report is not ready for download" }, statusCode: 400);
        }

        report.DownloadCount += 1;
        report.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(report));
    }

    private static ReportDetail ToDetail(Report r) => new(
        r.Id, r.Title, r.Description, r.Type, r.CompanyId, r.CreatedBy, r.TemplateId,
        r.Status, r.Format, r.ReportOutput, r.DownloadCount, r.GenerationStartedAt, r.GenerationCompletedAt, r.CreatedAt);
}
```

- [ ] **Step 3: Register in `Program.cs`**

Add after `app.MapNotificationEndpoints();` if `#55` already merged, otherwise after
`app.MapActionPlanTemplateEndpoints();` — check the current file and add at the end of
the `app.MapXEndpoints()` block:

```csharp
app.MapReportEndpoints();
```

- [ ] **Step 4: Write the integration tests**

```csharp
// tests/ClimateProject.IntegrationTests/Reports/ReportEndpointsTests.cs
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Reports;

[Collection("Postgres")]
public class ReportEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"rep-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public ReportEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Report Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = _companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    [Fact]
    public async Task CompanyAdmin_creates_a_report_and_it_completes_immediately()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Q3 Climate Report", "Quarterly summary", "climate_summary", _companyId, "pdf", null));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<ReportDetail>();
        Assert.Equal("completed", created!.Status);
        Assert.NotNull(created.ReportOutput);
    }

    [Fact]
    public async Task Download_increments_count_only_when_completed()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Report", null, "type", _companyId, "csv", null));
        var created = await createResponse.Content.ReadFromJsonAsync<ReportDetail>();

        var downloadResponse = await client.PostAsync($"/admin/reports/{created!.Id}/download", null);
        Assert.Equal(HttpStatusCode.OK, downloadResponse.StatusCode);
        var downloaded = await downloadResponse.Content.ReadFromJsonAsync<ReportDetail>();
        Assert.Equal(1, downloaded!.DownloadCount);
    }
}
```

- [ ] **Step 5: Run the tests**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter FullyQualifiedName~ReportEndpointsTests`
Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/ClimateProject.Application/Reports/ReportDtos.cs src/ClimateProject.Api/Endpoints/ReportEndpoints.cs src/ClimateProject.Api/Program.cs tests/ClimateProject.IntegrationTests/Reports/ReportEndpointsTests.cs
git commit -m "feat: add Report endpoints with stubbed generation"
```

---

## Task 2: Benchmark + BenchmarkMetric endpoints

**Files:**
- Create: `src/ClimateProject.Application/Reports/BenchmarkDtos.cs`
- Create: `src/ClimateProject.Api/Endpoints/BenchmarkEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs`
- Test: `tests/ClimateProject.IntegrationTests/Reports/BenchmarkEndpointsTests.cs`

**Interfaces:**
- Produces: `BenchmarkDetail`, `BenchmarkListItem`, `CreateBenchmarkRequest`,
  `BenchmarkMetricDto`, `AddBenchmarkMetricRequest`.

- [ ] **Step 1: Write the DTOs**

```csharp
// src/ClimateProject.Application/Reports/BenchmarkDtos.cs
namespace ClimateProject.Application.Reports;

public sealed record BenchmarkMetricDto(Guid Id, string MetricName, double Value, string Unit, double? Percentile, int? SampleSize);

public sealed record BenchmarkListItem(Guid Id, string Name, string Type, string Category, Guid? CompanyId, bool IsActive, double QualityScore);

public sealed record BenchmarkDetail(
    Guid Id, string Name, string Description, string Type, string Category, string Source,
    string? Industry, string? CompanySize, string? Region, Guid? CompanyId, bool IsActive,
    string ValidationStatus, double QualityScore, Guid? PriorPeriodBenchmarkId,
    IReadOnlyList<BenchmarkMetricDto> Metrics);

public sealed record CreateBenchmarkRequest(
    string Name, string Description, string Type, string Category, string Source,
    string? Industry, string? CompanySize, string? Region, Guid? CompanyId, Guid? PriorPeriodBenchmarkId);

public sealed record AddBenchmarkMetricRequest(string MetricName, double Value, string Unit, double? Percentile, int? SampleSize);
```

- [ ] **Step 2: Write the endpoints**

```csharp
// src/ClimateProject.Api/Endpoints/BenchmarkEndpoints.cs
using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class BenchmarkEndpoints
{
    public static void MapBenchmarkEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/benchmarks").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapPost("/{id:guid}/metrics", AddMetricAsync);
    }

    private static bool CanAccessBenchmark(CurrentUser currentUser, Guid? benchmarkCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (benchmarkCompanyId is null) return currentUser.Role == Roles.CompanyAdmin;
        return currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == benchmarkCompanyId.Value.ToString();
    }

    private static async Task<IResult> ListAsync(Guid? companyId, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        var query = db.Benchmarks.AsQueryable();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            var ownCompanyId = Guid.Parse(currentUser.CompanyId);
            query = query.Where(b => b.CompanyId == null || b.CompanyId == ownCompanyId);
        }
        else if (companyId.HasValue)
        {
            query = query.Where(b => b.CompanyId == companyId.Value);
        }

        var benchmarks = await query
            .OrderBy(b => b.Name)
            .Select(b => new BenchmarkListItem(b.Id, b.Name, b.Type, b.Category, b.CompanyId, b.IsActive, b.QualityScore))
            .ToListAsync(cancellationToken);

        return Results.Ok(benchmarks);
    }

    private static async Task<IResult> CreateAsync(CreateBenchmarkRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessBenchmark(currentUser, request.CompanyId)) return Results.Forbid();

        if (request.PriorPeriodBenchmarkId.HasValue)
        {
            var priorExists = await db.Benchmarks.AnyAsync(b => b.Id == request.PriorPeriodBenchmarkId.Value, cancellationToken);
            if (!priorExists) return Results.Json(new { message = "PriorPeriodBenchmarkId does not reference an existing benchmark" }, statusCode: 400);
        }

        var createdBy = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var benchmark = new Benchmark
        {
            Id = Guid.NewGuid(),
            Name = request.Name,
            Description = request.Description,
            Type = request.Type,
            Category = request.Category,
            Source = request.Source,
            Industry = request.Industry,
            CompanySize = request.CompanySize,
            Region = request.Region,
            CreatedBy = createdBy,
            CompanyId = request.CompanyId,
            IsActive = true,
            ValidationStatus = "pending",
            QualityScore = 0,
            PriorPeriodBenchmarkId = request.PriorPeriodBenchmarkId,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Benchmarks.Add(benchmark);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, benchmark.Id, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var benchmark = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (benchmark is null) return Results.Json(new { message = "Benchmark not found" }, statusCode: 404);
        if (!CanAccessBenchmark(currentUser, benchmark.CompanyId)) return Results.Forbid();

        return Results.Ok(await LoadDetailAsync(db, id, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(Guid id, CreateBenchmarkRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var benchmark = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (benchmark is null) return Results.Json(new { message = "Benchmark not found" }, statusCode: 404);
        if (!CanAccessBenchmark(currentUser, benchmark.CompanyId)) return Results.Forbid();

        benchmark.Name = request.Name;
        benchmark.Description = request.Description;
        benchmark.Industry = request.Industry;
        benchmark.CompanySize = request.CompanySize;
        benchmark.Region = request.Region;
        benchmark.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await LoadDetailAsync(db, id, cancellationToken));
    }

    private static async Task<IResult> AddMetricAsync(Guid id, AddBenchmarkMetricRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var benchmark = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (benchmark is null) return Results.Json(new { message = "Benchmark not found" }, statusCode: 404);
        if (!CanAccessBenchmark(currentUser, benchmark.CompanyId)) return Results.Forbid();

        var metric = new BenchmarkMetric
        {
            Id = Guid.NewGuid(),
            BenchmarkId = id,
            MetricName = request.MetricName,
            Value = request.Value,
            Unit = request.Unit,
            Percentile = request.Percentile,
            SampleSize = request.SampleSize,
        };
        db.BenchmarkMetrics.Add(metric);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, id, cancellationToken), statusCode: 201);
    }

    private static async Task<Guid> ResolveCurrentUserIdAsync(CurrentUser currentUser, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        if (Guid.TryParse(currentUser.Sub, out var userId))
        {
            var byId = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
            if (byId is not null) return byId.Id;
        }
        var byExternalId = await db.Users.FirstOrDefaultAsync(u => u.PersonaExternalId == currentUser.Sub, cancellationToken);
        return byExternalId?.Id ?? Guid.Empty;
    }

    private static async Task<BenchmarkDetail> LoadDetailAsync(ClimateProjectDbContext db, Guid id, CancellationToken cancellationToken)
    {
        var b = await db.Benchmarks.FirstAsync(x => x.Id == id, cancellationToken);
        var metrics = await db.BenchmarkMetrics
            .Where(m => m.BenchmarkId == id)
            .Select(m => new BenchmarkMetricDto(m.Id, m.MetricName, m.Value, m.Unit, m.Percentile, m.SampleSize))
            .ToListAsync(cancellationToken);

        return new BenchmarkDetail(
            b.Id, b.Name, b.Description, b.Type, b.Category, b.Source, b.Industry, b.CompanySize,
            b.Region, b.CompanyId, b.IsActive, b.ValidationStatus, b.QualityScore, b.PriorPeriodBenchmarkId, metrics);
    }
}
```

- [ ] **Step 3: Register in `Program.cs`**

Add after `app.MapReportEndpoints();`:

```csharp
app.MapBenchmarkEndpoints();
```

- [ ] **Step 4: Write the integration tests**

```csharp
// tests/ClimateProject.IntegrationTests/Reports/BenchmarkEndpointsTests.cs
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Reports;

[Collection("Postgres")]
public class BenchmarkEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"bench-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public BenchmarkEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Bench Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = _companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    [Fact]
    public async Task Create_a_benchmark_with_a_prior_period_reference_and_add_a_metric()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var priorResponse = await client.PostAsJsonAsync("/admin/benchmarks", new CreateBenchmarkRequest(
            "2025 Engagement", "d", "industry", "engagement", "internal", null, null, null, null, null));
        var prior = await priorResponse.Content.ReadFromJsonAsync<BenchmarkDetail>();

        var response = await client.PostAsJsonAsync("/admin/benchmarks", new CreateBenchmarkRequest(
            "2026 Engagement", "d", "industry", "engagement", "internal", null, null, null, null, prior!.Id));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<BenchmarkDetail>();
        Assert.Equal(prior.Id, created!.PriorPeriodBenchmarkId);

        var metricResponse = await client.PostAsJsonAsync($"/admin/benchmarks/{created.Id}/metrics", new AddBenchmarkMetricRequest(
            "engagement_score", 78.5, "percent", 65.0, 500));
        Assert.Equal(HttpStatusCode.Created, metricResponse.StatusCode);
        var withMetric = await metricResponse.Content.ReadFromJsonAsync<BenchmarkDetail>();
        Assert.Single(withMetric!.Metrics);
    }

    [Fact]
    public async Task Create_rejects_an_unknown_PriorPeriodBenchmarkId()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/benchmarks", new CreateBenchmarkRequest(
            "X", "d", "t", "c", "s", null, null, null, null, Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
```

- [ ] **Step 5: Run the tests**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter FullyQualifiedName~BenchmarkEndpointsTests`
Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/ClimateProject.Application/Reports/BenchmarkDtos.cs src/ClimateProject.Api/Endpoints/BenchmarkEndpoints.cs src/ClimateProject.Api/Program.cs tests/ClimateProject.IntegrationTests/Reports/BenchmarkEndpointsTests.cs
git commit -m "feat: add Benchmark and BenchmarkMetric endpoints"
```

---

## Task 3: AnalyticsInsight + AnalyticsMetricData + AnalyticsTimeSeries endpoints

**Files:**
- Create: `src/ClimateProject.Application/Analytics/AnalyticsInsightDtos.cs`
- Create: `src/ClimateProject.Api/Endpoints/AnalyticsInsightEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs`
- Test: `tests/ClimateProject.IntegrationTests/Analytics/AnalyticsInsightEndpointsTests.cs`

**Interfaces:**
- Produces: `AnalyticsInsightDetail`, `AnalyticsInsightListItem`,
  `CreateAnalyticsInsightRequest`, `MetricDataPointDto`, `TimeSeriesPointDto`,
  `AddMetricDataRequest`, `AddTimeSeriesPointRequest`.

- [ ] **Step 1: Write the DTOs**

```csharp
// src/ClimateProject.Application/Analytics/AnalyticsInsightDtos.cs
namespace ClimateProject.Application.Analytics;

public sealed record MetricDataPointDto(Guid Id, string Label, double Value, int? Count, double? Percentage);
public sealed record TimeSeriesPointDto(Guid Id, DateTimeOffset Date, double Value, int Count);

public sealed record AnalyticsInsightListItem(Guid Id, Guid CompanyId, string MetricType, string MetricName, bool IsCurrent, DateTimeOffset CalculationDate);

public sealed record AnalyticsInsightDetail(
    Guid Id, Guid? SurveyId, Guid CompanyId, Guid? DepartmentId, string AggregationType,
    string MetricType, string MetricName, string? MetricDescription, int TotalResponses,
    DateTimeOffset CalculationDate, bool IsCurrent,
    IReadOnlyList<MetricDataPointDto> MetricData, IReadOnlyList<TimeSeriesPointDto> TimeSeries);

public sealed record CreateAnalyticsInsightRequest(
    Guid? SurveyId, Guid CompanyId, Guid? DepartmentId, string AggregationType,
    string MetricType, string MetricName, string? MetricDescription, int TotalResponses);

public sealed record AddMetricDataRequest(string Label, double Value, int? Count, double? Percentage);
public sealed record AddTimeSeriesPointRequest(DateTimeOffset Date, double Value, int Count);
```

- [ ] **Step 2: Write the endpoints**

```csharp
// src/ClimateProject.Api/Endpoints/AnalyticsInsightEndpoints.cs
using System.Security.Claims;
using ClimateProject.Application.Analytics;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class AnalyticsInsightEndpoints
{
    public static void MapAnalyticsInsightEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/analytics-insights").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPost("/{id:guid}/metric-data", AddMetricDataAsync);
        group.MapPost("/{id:guid}/time-series", AddTimeSeriesPointAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static async Task<IResult> ListAsync(Guid companyId, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId)) return Results.Forbid();

        var insights = await db.AnalyticsInsights
            .Where(i => i.CompanyId == companyId)
            .OrderByDescending(i => i.CalculationDate)
            .Select(i => new AnalyticsInsightListItem(i.Id, i.CompanyId, i.MetricType, i.MetricName, i.IsCurrent, i.CalculationDate))
            .ToListAsync(cancellationToken);

        return Results.Ok(insights);
    }

    private static async Task<IResult> CreateAsync(CreateAnalyticsInsightRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, request.CompanyId)) return Results.Forbid();

        if (request.SurveyId.HasValue)
        {
            var surveyExists = await db.Surveys.AnyAsync(s => s.Id == request.SurveyId.Value, cancellationToken);
            if (!surveyExists) return Results.Json(new { message = "SurveyId does not reference an existing survey" }, statusCode: 400);
        }
        if (request.DepartmentId.HasValue)
        {
            var deptExists = await db.Departments.AnyAsync(d => d.Id == request.DepartmentId.Value && d.CompanyId == request.CompanyId, cancellationToken);
            if (!deptExists) return Results.Json(new { message = "DepartmentId does not reference an existing department in this company" }, statusCode: 400);
        }

        var now = DateTimeOffset.UtcNow;
        var insight = new AnalyticsInsight
        {
            Id = Guid.NewGuid(),
            SurveyId = request.SurveyId,
            CompanyId = request.CompanyId,
            DepartmentId = request.DepartmentId,
            AggregationType = request.AggregationType,
            MetricType = request.MetricType,
            MetricName = request.MetricName,
            MetricDescription = request.MetricDescription,
            TotalResponses = request.TotalResponses,
            CalculationDate = now,
            IsCurrent = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.AnalyticsInsights.Add(insight);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, insight.Id, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var insight = await db.AnalyticsInsights.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (insight is null) return Results.Json(new { message = "Insight not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, insight.CompanyId)) return Results.Forbid();

        return Results.Ok(await LoadDetailAsync(db, id, cancellationToken));
    }

    private static async Task<IResult> AddMetricDataAsync(Guid id, AddMetricDataRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var insight = await db.AnalyticsInsights.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (insight is null) return Results.Json(new { message = "Insight not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, insight.CompanyId)) return Results.Forbid();

        db.AnalyticsMetricData.Add(new AnalyticsMetricData
        {
            Id = Guid.NewGuid(),
            InsightId = id,
            Label = request.Label,
            Value = request.Value,
            Count = request.Count,
            Percentage = request.Percentage,
        });
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, id, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> AddTimeSeriesPointAsync(Guid id, AddTimeSeriesPointRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var insight = await db.AnalyticsInsights.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (insight is null) return Results.Json(new { message = "Insight not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, insight.CompanyId)) return Results.Forbid();

        db.AnalyticsTimeSeries.Add(new AnalyticsTimeSeries
        {
            Id = Guid.NewGuid(),
            InsightId = id,
            Date = request.Date,
            Value = request.Value,
            Count = request.Count,
        });
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, id, cancellationToken), statusCode: 201);
    }

    private static async Task<AnalyticsInsightDetail> LoadDetailAsync(ClimateProjectDbContext db, Guid id, CancellationToken cancellationToken)
    {
        var i = await db.AnalyticsInsights.FirstAsync(x => x.Id == id, cancellationToken);
        var metricData = await db.AnalyticsMetricData
            .Where(m => m.InsightId == id)
            .Select(m => new MetricDataPointDto(m.Id, m.Label, m.Value, m.Count, m.Percentage))
            .ToListAsync(cancellationToken);
        var timeSeries = await db.AnalyticsTimeSeries
            .Where(t => t.InsightId == id)
            .OrderBy(t => t.Date)
            .Select(t => new TimeSeriesPointDto(t.Id, t.Date, t.Value, t.Count))
            .ToListAsync(cancellationToken);

        return new AnalyticsInsightDetail(
            i.Id, i.SurveyId, i.CompanyId, i.DepartmentId, i.AggregationType, i.MetricType,
            i.MetricName, i.MetricDescription, i.TotalResponses, i.CalculationDate, i.IsCurrent,
            metricData, timeSeries);
    }
}
```

- [ ] **Step 3: Register in `Program.cs`**

Add after `app.MapBenchmarkEndpoints();`:

```csharp
app.MapAnalyticsInsightEndpoints();
```

- [ ] **Step 4: Write the integration tests**

```csharp
// tests/ClimateProject.IntegrationTests/Analytics/AnalyticsInsightEndpointsTests.cs
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Application.Analytics;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Analytics;

[Collection("Postgres")]
public class AnalyticsInsightEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"an-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public AnalyticsInsightEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Analytics Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = _companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    [Fact]
    public async Task Create_an_insight_then_add_metric_data_and_a_time_series_point()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/analytics-insights", new CreateAnalyticsInsightRequest(
            null, _companyId, null, "company_wide", "engagement", "Overall Engagement", null, 0));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<AnalyticsInsightDetail>();

        var metricResponse = await client.PostAsJsonAsync($"/admin/analytics-insights/{created!.Id}/metric-data", new AddMetricDataRequest(
            "Satisfied", 42.5, 120, 60.0));
        Assert.Equal(HttpStatusCode.Created, metricResponse.StatusCode);

        var seriesResponse = await client.PostAsJsonAsync($"/admin/analytics-insights/{created.Id}/time-series", new AddTimeSeriesPointRequest(
            DateTimeOffset.UtcNow, 42.5, 120));
        Assert.Equal(HttpStatusCode.Created, seriesResponse.StatusCode);
        var final = await seriesResponse.Content.ReadFromJsonAsync<AnalyticsInsightDetail>();
        Assert.Single(final!.MetricData);
        Assert.Single(final.TimeSeries);
    }

    [Fact]
    public async Task Create_rejects_an_unknown_SurveyId()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/analytics-insights", new CreateAnalyticsInsightRequest(
            Guid.NewGuid(), _companyId, null, "company_wide", "engagement", "X", null, 0));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
```

- [ ] **Step 5: Run the tests**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter FullyQualifiedName~AnalyticsInsightEndpointsTests`
Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/ClimateProject.Application/Analytics/AnalyticsInsightDtos.cs src/ClimateProject.Api/Endpoints/AnalyticsInsightEndpoints.cs src/ClimateProject.Api/Program.cs tests/ClimateProject.IntegrationTests/Analytics/AnalyticsInsightEndpointsTests.cs
git commit -m "feat: add AnalyticsInsight, AnalyticsMetricData, AnalyticsTimeSeries endpoints"
```

---

## Task 4: AIInsight endpoints

**Files:**
- Create: `src/ClimateProject.Application/Analytics/AIInsightDtos.cs`
- Create: `src/ClimateProject.Api/Endpoints/AIInsightEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs`
- Test: `tests/ClimateProject.IntegrationTests/Analytics/AIInsightEndpointsTests.cs`

**Interfaces:**
- Produces: `AIInsightDetail`, `AIInsightListItem`, `CreateAIInsightRequest`.

- [ ] **Step 1: Write the DTOs**

```csharp
// src/ClimateProject.Application/Analytics/AIInsightDtos.cs
namespace ClimateProject.Application.Analytics;

public sealed record AIInsightListItem(Guid Id, Guid CompanyId, string Type, string Category, string Title, string Priority, bool IsAcknowledged);

public sealed record AIInsightDetail(
    Guid Id, Guid? SurveyId, Guid CompanyId, Guid? DepartmentId, string Type, string Category,
    string Title, string Description, int ConfidenceScore, string Priority,
    IReadOnlyList<string> AffectedSegments, IReadOnlyList<string> RecommendedActions,
    bool IsAcknowledged, Guid? AcknowledgedBy, DateTimeOffset? AcknowledgedAt);

public sealed record CreateAIInsightRequest(
    Guid? SurveyId, Guid CompanyId, Guid? DepartmentId, string Type, string Category,
    string Title, string Description, int ConfidenceScore, string Priority,
    IReadOnlyList<string>? AffectedSegments, IReadOnlyList<string>? RecommendedActions);
```

- [ ] **Step 2: Write the endpoints**

```csharp
// src/ClimateProject.Api/Endpoints/AIInsightEndpoints.cs
using System.Security.Claims;
using ClimateProject.Application.Analytics;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class AIInsightEndpoints
{
    public static void MapAIInsightEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/ai-insights").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPost("/{id:guid}/acknowledge", AcknowledgeAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static async Task<Guid> ResolveCurrentUserIdAsync(CurrentUser currentUser, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        if (Guid.TryParse(currentUser.Sub, out var userId))
        {
            var byId = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
            if (byId is not null) return byId.Id;
        }
        var byExternalId = await db.Users.FirstOrDefaultAsync(u => u.PersonaExternalId == currentUser.Sub, cancellationToken);
        return byExternalId?.Id ?? Guid.Empty;
    }

    private static async Task<IResult> ListAsync(Guid companyId, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId)) return Results.Forbid();

        var insights = await db.AIInsights
            .Where(i => i.CompanyId == companyId)
            .OrderByDescending(i => i.CreatedAt)
            .Select(i => new AIInsightListItem(i.Id, i.CompanyId, i.Type, i.Category, i.Title, i.Priority, i.IsAcknowledged))
            .ToListAsync(cancellationToken);

        return Results.Ok(insights);
    }

    private static async Task<IResult> CreateAsync(CreateAIInsightRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, request.CompanyId)) return Results.Forbid();

        if (request.SurveyId.HasValue)
        {
            var surveyExists = await db.Surveys.AnyAsync(s => s.Id == request.SurveyId.Value, cancellationToken);
            if (!surveyExists) return Results.Json(new { message = "SurveyId does not reference an existing survey" }, statusCode: 400);
        }

        var now = DateTimeOffset.UtcNow;
        var insight = new AIInsight
        {
            Id = Guid.NewGuid(),
            SurveyId = request.SurveyId,
            CompanyId = request.CompanyId,
            DepartmentId = request.DepartmentId,
            Type = request.Type,
            Category = request.Category,
            Title = request.Title,
            Description = request.Description,
            ConfidenceScore = request.ConfidenceScore,
            Priority = request.Priority,
            AffectedSegments = request.AffectedSegments?.ToList() ?? [],
            RecommendedActions = request.RecommendedActions?.ToList() ?? [],
            IsAcknowledged = false,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.AIInsights.Add(insight);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(ToDetail(insight), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var insight = await db.AIInsights.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (insight is null) return Results.Json(new { message = "Insight not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, insight.CompanyId)) return Results.Forbid();

        return Results.Ok(ToDetail(insight));
    }

    private static async Task<IResult> AcknowledgeAsync(Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var insight = await db.AIInsights.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (insight is null) return Results.Json(new { message = "Insight not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, insight.CompanyId)) return Results.Forbid();

        insight.IsAcknowledged = true;
        insight.AcknowledgedBy = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
        insight.AcknowledgedAt = DateTimeOffset.UtcNow;
        insight.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(insight));
    }

    private static AIInsightDetail ToDetail(AIInsight i) => new(
        i.Id, i.SurveyId, i.CompanyId, i.DepartmentId, i.Type, i.Category, i.Title, i.Description,
        i.ConfidenceScore, i.Priority, i.AffectedSegments, i.RecommendedActions,
        i.IsAcknowledged, i.AcknowledgedBy, i.AcknowledgedAt);
}
```

- [ ] **Step 3: Register in `Program.cs`**

Add after `app.MapAnalyticsInsightEndpoints();`:

```csharp
app.MapAIInsightEndpoints();
```

- [ ] **Step 4: Write the integration tests**

```csharp
// tests/ClimateProject.IntegrationTests/Analytics/AIInsightEndpointsTests.cs
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Application.Analytics;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Analytics;

[Collection("Postgres")]
public class AIInsightEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"ai-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public AIInsightEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "AI Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = _companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    [Fact]
    public async Task Create_and_acknowledge_an_ai_insight()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/ai-insights", new CreateAIInsightRequest(
            null, _companyId, null, "trend", "engagement", "Declining engagement in Sales", "Description",
            80, "high", ["Sales"], ["Schedule 1:1s"]));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<AIInsightDetail>();
        Assert.False(created!.IsAcknowledged);

        var ackResponse = await client.PostAsync($"/admin/ai-insights/{created.Id}/acknowledge", null);
        Assert.Equal(HttpStatusCode.OK, ackResponse.StatusCode);
        var acked = await ackResponse.Content.ReadFromJsonAsync<AIInsightDetail>();
        Assert.True(acked!.IsAcknowledged);
        Assert.NotNull(acked.AcknowledgedAt);
    }
}
```

- [ ] **Step 5: Run the tests**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter FullyQualifiedName~AIInsightEndpointsTests`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add src/ClimateProject.Application/Analytics/AIInsightDtos.cs src/ClimateProject.Api/Endpoints/AIInsightEndpoints.cs src/ClimateProject.Api/Program.cs tests/ClimateProject.IntegrationTests/Analytics/AIInsightEndpointsTests.cs
git commit -m "feat: add AIInsight endpoints with acknowledge action"
```

---

## Task 5: DemographicSnapshot + Entry + Change endpoints

**Files:**
- Create: `src/ClimateProject.Application/Analytics/DemographicSnapshotDtos.cs`
- Create: `src/ClimateProject.Api/Endpoints/DemographicSnapshotEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs`
- Test: `tests/ClimateProject.IntegrationTests/Analytics/DemographicSnapshotEndpointsTests.cs`

**Interfaces:**
- Produces: `DemographicSnapshotDetail`, `DemographicSnapshotListItem`,
  `CreateDemographicSnapshotRequest`, `SnapshotEntryDto`, `AddSnapshotEntryRequest`,
  `SnapshotChangeDto`, `AddSnapshotChangeRequest`.

- [ ] **Step 1: Write the DTOs**

```csharp
// src/ClimateProject.Application/Analytics/DemographicSnapshotDtos.cs
namespace ClimateProject.Application.Analytics;

public sealed record SnapshotEntryDto(Guid Id, Guid UserId, string Department, string Role, string Tenure, string? Location, string? Team, string? Level);
public sealed record SnapshotChangeDto(Guid Id, string Field, string? OldValue, string? NewValue, Guid ChangedBy, DateTimeOffset Timestamp, string? Reason);

public sealed record DemographicSnapshotListItem(Guid Id, Guid SurveyId, Guid CompanyId, int Version, DateTimeOffset Timestamp, bool IsActive);

public sealed record DemographicSnapshotDetail(
    Guid Id, Guid SurveyId, Guid CompanyId, int Version, DateTimeOffset Timestamp,
    Guid CreatedBy, string Reason, bool IsActive, int TotalUsers, int DepartmentsCount,
    IReadOnlyList<SnapshotEntryDto> Entries, IReadOnlyList<SnapshotChangeDto> Changes);

public sealed record CreateDemographicSnapshotRequest(Guid SurveyId, Guid CompanyId, string Reason);
public sealed record AddSnapshotEntryRequest(Guid UserId, string Department, string Role, string Tenure, string? Location, string? Team, string? Level);
public sealed record AddSnapshotChangeRequest(string Field, string? OldValue, string? NewValue, string? Reason);
```

- [ ] **Step 2: Write the endpoints**

```csharp
// src/ClimateProject.Api/Endpoints/DemographicSnapshotEndpoints.cs
using System.Security.Claims;
using ClimateProject.Application.Analytics;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class DemographicSnapshotEndpoints
{
    public static void MapDemographicSnapshotEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/demographic-snapshots").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPost("/{id:guid}/entries", AddEntryAsync);
        group.MapPost("/{id:guid}/changes", AddChangeAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static async Task<Guid> ResolveCurrentUserIdAsync(CurrentUser currentUser, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        if (Guid.TryParse(currentUser.Sub, out var userId))
        {
            var byId = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
            if (byId is not null) return byId.Id;
        }
        var byExternalId = await db.Users.FirstOrDefaultAsync(u => u.PersonaExternalId == currentUser.Sub, cancellationToken);
        return byExternalId?.Id ?? Guid.Empty;
    }

    private static async Task<IResult> ListAsync(Guid companyId, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId)) return Results.Forbid();

        var snapshots = await db.DemographicSnapshots
            .Where(s => s.CompanyId == companyId)
            .OrderByDescending(s => s.Version)
            .Select(s => new DemographicSnapshotListItem(s.Id, s.SurveyId, s.CompanyId, s.Version, s.Timestamp, s.IsActive))
            .ToListAsync(cancellationToken);

        return Results.Ok(snapshots);
    }

    private static async Task<IResult> CreateAsync(CreateDemographicSnapshotRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, request.CompanyId)) return Results.Forbid();

        var surveyExists = await db.Surveys.AnyAsync(s => s.Id == request.SurveyId, cancellationToken);
        if (!surveyExists) return Results.Json(new { message = "SurveyId does not reference an existing survey" }, statusCode: 400);

        var nextVersion = 1 + await db.DemographicSnapshots
            .Where(s => s.SurveyId == request.SurveyId)
            .Select(s => (int?)s.Version)
            .MaxAsync(cancellationToken) ?? 1;

        var createdBy = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var snapshot = new DemographicSnapshot
        {
            Id = Guid.NewGuid(),
            SurveyId = request.SurveyId,
            CompanyId = request.CompanyId,
            Version = nextVersion,
            Timestamp = now,
            CreatedBy = createdBy,
            Reason = request.Reason,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.DemographicSnapshots.Add(snapshot);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, snapshot.Id, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var snapshot = await db.DemographicSnapshots.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (snapshot is null) return Results.Json(new { message = "Snapshot not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, snapshot.CompanyId)) return Results.Forbid();

        return Results.Ok(await LoadDetailAsync(db, id, cancellationToken));
    }

    private static async Task<IResult> AddEntryAsync(Guid id, AddSnapshotEntryRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var snapshot = await db.DemographicSnapshots.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (snapshot is null) return Results.Json(new { message = "Snapshot not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, snapshot.CompanyId)) return Results.Forbid();

        db.DemographicSnapshotEntries.Add(new DemographicSnapshotEntry
        {
            Id = Guid.NewGuid(),
            SnapshotId = id,
            UserId = request.UserId,
            Department = request.Department,
            Role = request.Role,
            Tenure = request.Tenure,
            Location = request.Location,
            Team = request.Team,
            Level = request.Level,
        });
        snapshot.Metadata.TotalUsers += 1;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, id, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> AddChangeAsync(Guid id, AddSnapshotChangeRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var snapshot = await db.DemographicSnapshots.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (snapshot is null) return Results.Json(new { message = "Snapshot not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, snapshot.CompanyId)) return Results.Forbid();

        var changedBy = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
        db.DemographicSnapshotChanges.Add(new DemographicSnapshotChange
        {
            Id = Guid.NewGuid(),
            SnapshotId = id,
            Field = request.Field,
            OldValue = request.OldValue,
            NewValue = request.NewValue,
            ChangedBy = changedBy,
            Timestamp = DateTimeOffset.UtcNow,
            Reason = request.Reason,
        });
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, id, cancellationToken), statusCode: 201);
    }

    private static async Task<DemographicSnapshotDetail> LoadDetailAsync(ClimateProjectDbContext db, Guid id, CancellationToken cancellationToken)
    {
        var s = await db.DemographicSnapshots.FirstAsync(x => x.Id == id, cancellationToken);
        var entries = await db.DemographicSnapshotEntries
            .Where(e => e.SnapshotId == id)
            .Select(e => new SnapshotEntryDto(e.Id, e.UserId, e.Department, e.Role, e.Tenure, e.Location, e.Team, e.Level))
            .ToListAsync(cancellationToken);
        var changes = await db.DemographicSnapshotChanges
            .Where(c => c.SnapshotId == id)
            .OrderByDescending(c => c.Timestamp)
            .Select(c => new SnapshotChangeDto(c.Id, c.Field, c.OldValue, c.NewValue, c.ChangedBy, c.Timestamp, c.Reason))
            .ToListAsync(cancellationToken);

        return new DemographicSnapshotDetail(
            s.Id, s.SurveyId, s.CompanyId, s.Version, s.Timestamp, s.CreatedBy, s.Reason, s.IsActive,
            s.Metadata.TotalUsers, s.Metadata.DepartmentsCount, entries, changes);
    }
}
```

- [ ] **Step 3: Register in `Program.cs`**

Add after `app.MapAIInsightEndpoints();`:

```csharp
app.MapDemographicSnapshotEndpoints();
```

- [ ] **Step 4: Write the integration tests**

```csharp
// tests/ClimateProject.IntegrationTests/Analytics/DemographicSnapshotEndpointsTests.cs
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Application.Analytics;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Analytics;

[Collection("Postgres")]
public class DemographicSnapshotEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"ds-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _surveyId;

    public DemographicSnapshotEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Snap Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();

        // Survey schema exists from #49 but the domain isn't built (#51) -- insert a
        // minimal row directly via EF so this endpoint's FK validation has something real
        // to point at, matching how other domains validate against not-yet-built domains'
        // schema-only tables.
        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            CreatedBy = Guid.NewGuid(),
            Title = "Q3 Survey",
            Type = "climate",
            StartDate = DateTimeOffset.UtcNow,
            EndDate = DateTimeOffset.UtcNow.AddDays(14),
            Status = "active",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();
        _surveyId = survey.Id;
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = _companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    [Fact]
    public async Task Create_a_snapshot_then_add_an_entry_and_a_change()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/demographic-snapshots", new CreateDemographicSnapshotRequest(
            _surveyId, _companyId, "Pre-survey baseline"));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<DemographicSnapshotDetail>();
        Assert.Equal(1, created!.Version);

        var entryResponse = await client.PostAsJsonAsync($"/admin/demographic-snapshots/{created.Id}/entries", new AddSnapshotEntryRequest(
            Guid.NewGuid(), "Engineering", "employee", "1-2 years", null, null, null));
        Assert.Equal(HttpStatusCode.Created, entryResponse.StatusCode);

        var changeResponse = await client.PostAsJsonAsync($"/admin/demographic-snapshots/{created.Id}/changes", new AddSnapshotChangeRequest(
            "Department", "Sales", "Engineering", "Reorg"));
        Assert.Equal(HttpStatusCode.Created, changeResponse.StatusCode);
        var final = await changeResponse.Content.ReadFromJsonAsync<DemographicSnapshotDetail>();
        Assert.Single(final!.Entries);
        Assert.Single(final.Changes);
        Assert.Equal(1, final.TotalUsers);
    }

    [Fact]
    public async Task Second_snapshot_for_the_same_survey_increments_version()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        await client.PostAsJsonAsync("/admin/demographic-snapshots", new CreateDemographicSnapshotRequest(_surveyId, _companyId, "First"));
        var secondResponse = await client.PostAsJsonAsync("/admin/demographic-snapshots", new CreateDemographicSnapshotRequest(_surveyId, _companyId, "Second"));
        var second = await secondResponse.Content.ReadFromJsonAsync<DemographicSnapshotDetail>();

        Assert.Equal(2, second!.Version);
    }
}
```

- [ ] **Step 5: Run the tests**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter FullyQualifiedName~DemographicSnapshotEndpointsTests`
Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/ClimateProject.Application/Analytics/DemographicSnapshotDtos.cs src/ClimateProject.Api/Endpoints/DemographicSnapshotEndpoints.cs src/ClimateProject.Api/Program.cs tests/ClimateProject.IntegrationTests/Analytics/DemographicSnapshotEndpointsTests.cs
git commit -m "feat: add DemographicSnapshot, entry, and change endpoints"
```

---

## Task 6: Frontend typed API clients

**Files:**
- Create: `web/src/features/reports/api/reports.ts` + `.test.ts`
- Create: `web/src/features/analytics/api/benchmarks.ts` + `.test.ts`
- Create: `web/src/features/analytics/api/insights.ts` + `.test.ts`

**Interfaces:**
- Consumes: `authFetch` from `../../../api/authFetch`.
- Produces: typed clients consumed by Task 7's pages.

- [ ] **Step 1: Write the reports client**

```typescript
// web/src/features/reports/api/reports.ts
import { authFetch } from '../../../api/authFetch'

export interface Report {
  id: string
  title: string
  description: string | null
  type: string
  companyId: string
  createdBy: string
  templateId: string | null
  status: string
  format: string
  reportOutput: string | null
  downloadCount: number
  generationStartedAt: string | null
  generationCompletedAt: string | null
  createdAt: string
}

export interface CreateReportInput {
  title: string
  description: string | null
  type: string
  companyId: string
  format: string
  templateId: string | null
}

export async function listReports(baseUrl: string, companyId: string): Promise<Report[]> {
  const response = await authFetch(`${baseUrl}/admin/reports?companyId=${companyId}`)
  return response.json() as Promise<Report[]>
}

export async function createReport(baseUrl: string, input: CreateReportInput): Promise<Report> {
  const response = await authFetch(`${baseUrl}/admin/reports`, { method: 'POST', body: JSON.stringify(input) })
  return response.json() as Promise<Report>
}

export async function downloadReport(baseUrl: string, id: string): Promise<Report> {
  const response = await authFetch(`${baseUrl}/admin/reports/${id}/download`, { method: 'POST' })
  return response.json() as Promise<Report>
}
```

- [ ] **Step 2: Write its test**

```typescript
// web/src/features/reports/api/reports.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listReports, createReport, downloadReport } from './reports'

const baseUrl = 'http://api.test'
const sample = {
  id: 'r1', title: 'T', description: null, type: 'summary', companyId: 'c1', createdBy: 'u1',
  templateId: null, status: 'completed', format: 'pdf', reportOutput: 'stub', downloadCount: 0,
  generationStartedAt: null, generationCompletedAt: null, createdAt: '2026-08-01T00:00:00Z',
}

describe('reports api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists reports for a company', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([sample]), { status: 200 }))
    const response = await listReports(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/reports?companyId=c1`, expect.anything())
    expect(response).toHaveLength(1)
  })

  it('creates a report', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(sample), { status: 201 }))
    await createReport(baseUrl, { title: 'T', description: null, type: 'summary', companyId: 'c1', format: 'pdf', templateId: null })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/reports`, expect.objectContaining({ method: 'POST' }))
  })

  it('downloads a report', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...sample, downloadCount: 1 }), { status: 200 }))
    const response = await downloadReport(baseUrl, 'r1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/reports/r1/download`, expect.objectContaining({ method: 'POST' }))
    expect(response.downloadCount).toBe(1)
  })
})
```

- [ ] **Step 3: Write the benchmarks client**

```typescript
// web/src/features/analytics/api/benchmarks.ts
import { authFetch } from '../../../api/authFetch'

export interface BenchmarkMetric {
  id: string
  metricName: string
  value: number
  unit: string
  percentile: number | null
  sampleSize: number | null
}

export interface Benchmark {
  id: string
  name: string
  description: string
  type: string
  category: string
  source: string
  industry: string | null
  companySize: string | null
  region: string | null
  companyId: string | null
  isActive: boolean
  validationStatus: string
  qualityScore: number
  priorPeriodBenchmarkId: string | null
  metrics: BenchmarkMetric[]
}

export interface CreateBenchmarkInput {
  name: string
  description: string
  type: string
  category: string
  source: string
  industry: string | null
  companySize: string | null
  region: string | null
  companyId: string | null
  priorPeriodBenchmarkId: string | null
}

export async function listBenchmarks(baseUrl: string): Promise<Benchmark[]> {
  const response = await authFetch(`${baseUrl}/admin/benchmarks`)
  return response.json() as Promise<Benchmark[]>
}

export async function createBenchmark(baseUrl: string, input: CreateBenchmarkInput): Promise<Benchmark> {
  const response = await authFetch(`${baseUrl}/admin/benchmarks`, { method: 'POST', body: JSON.stringify(input) })
  return response.json() as Promise<Benchmark>
}
```

- [ ] **Step 4: Write its test**

```typescript
// web/src/features/analytics/api/benchmarks.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listBenchmarks, createBenchmark } from './benchmarks'

const baseUrl = 'http://api.test'

describe('benchmarks api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists benchmarks', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    await listBenchmarks(baseUrl)
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/benchmarks`, expect.anything())
  })

  it('creates a benchmark', async () => {
    const result = { id: 'b1', name: 'N', description: 'd', type: 't', category: 'c', source: 's', industry: null, companySize: null, region: null, companyId: null, isActive: true, validationStatus: 'pending', qualityScore: 0, priorPeriodBenchmarkId: null, metrics: [] }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 201 }))
    const response = await createBenchmark(baseUrl, { name: 'N', description: 'd', type: 't', category: 'c', source: 's', industry: null, companySize: null, region: null, companyId: null, priorPeriodBenchmarkId: null })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/benchmarks`, expect.objectContaining({ method: 'POST' }))
    expect(response.name).toBe('N')
  })
})
```

- [ ] **Step 5: Write the insights client**

```typescript
// web/src/features/analytics/api/insights.ts
import { authFetch } from '../../../api/authFetch'

export interface AIInsight {
  id: string
  surveyId: string | null
  companyId: string
  departmentId: string | null
  type: string
  category: string
  title: string
  description: string
  confidenceScore: number
  priority: string
  affectedSegments: string[]
  recommendedActions: string[]
  isAcknowledged: boolean
  acknowledgedBy: string | null
  acknowledgedAt: string | null
}

export async function listAIInsights(baseUrl: string, companyId: string): Promise<AIInsight[]> {
  const response = await authFetch(`${baseUrl}/admin/ai-insights?companyId=${companyId}`)
  return response.json() as Promise<AIInsight[]>
}

export async function acknowledgeAIInsight(baseUrl: string, id: string): Promise<AIInsight> {
  const response = await authFetch(`${baseUrl}/admin/ai-insights/${id}/acknowledge`, { method: 'POST' })
  return response.json() as Promise<AIInsight>
}
```

- [ ] **Step 6: Write its test**

```typescript
// web/src/features/analytics/api/insights.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listAIInsights, acknowledgeAIInsight } from './insights'

const baseUrl = 'http://api.test'
const sample = {
  id: 'i1', surveyId: null, companyId: 'c1', departmentId: null, type: 't', category: 'c',
  title: 'T', description: 'd', confidenceScore: 80, priority: 'high', affectedSegments: [],
  recommendedActions: [], isAcknowledged: false, acknowledgedBy: null, acknowledgedAt: null,
}

describe('insights api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists AI insights for a company', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([sample]), { status: 200 }))
    const response = await listAIInsights(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/ai-insights?companyId=c1`, expect.anything())
    expect(response).toHaveLength(1)
  })

  it('acknowledges an insight', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...sample, isAcknowledged: true }), { status: 200 }))
    const response = await acknowledgeAIInsight(baseUrl, 'i1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/ai-insights/i1/acknowledge`, expect.objectContaining({ method: 'POST' }))
    expect(response.isAcknowledged).toBe(true)
  })
})
```

- [ ] **Step 7: Run the tests**

Run: `cd web && npm test -- --run reports benchmarks insights`
Expected: 7 tests pass (3 reports + 2 benchmarks + 2 insights).

- [ ] **Step 8: Commit**

```bash
git add web/src/features/reports/api web/src/features/analytics/api
git commit -m "feat: add typed frontend API clients for reports and analytics"
```

---

## Task 7: Frontend — ReportsListPage + AnalyticsDashboardPage + nav entries

**Files:**
- Create: `web/src/features/reports/pages/ReportsListPage.tsx`
- Create: `web/src/features/analytics/pages/AnalyticsDashboardPage.tsx`
- Modify: `web/src/app/router.tsx`
- Modify: `web/src/navigation/navSections.ts`
- Modify: `web/src/navigation/navSections.test.ts`

**Interfaces:**
- Consumes: `listReports`, `createReport`, `downloadReport` from Task 6's reports
  client; `listBenchmarks` from the benchmarks client; `listAIInsights`,
  `acknowledgeAIInsight` from the insights client.

- [ ] **Step 1: Write the reports page**

```tsx
// web/src/features/reports/pages/ReportsListPage.tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { listReports, createReport, downloadReport, type Report } from '../api/reports'

const baseUrl = import.meta.env.VITE_API_BASE_URL as string

export default function ReportsListPage() {
  const { companyId } = useParams<{ companyId: string }>()
  const [reports, setReports] = useState<Report[]>([])
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = () => {
    if (!companyId) return
    setLoading(true)
    listReports(baseUrl, companyId)
      .then(setReports)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const handleCreate = async () => {
    if (!companyId || !title.trim()) return
    await createReport(baseUrl, { title, description: null, type: 'summary', companyId, format: 'pdf', templateId: null })
    setTitle('')
    reload()
  }

  const handleDownload = async (id: string) => {
    await downloadReport(baseUrl, id)
    reload()
  }

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">{error}</p>

  return (
    <div>
      <h1>Reports</h1>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Report title" />
      <button onClick={handleCreate}>Create report</button>
      <ul>
        {reports.map((r) => (
          <li key={r.id}>
            {r.title} — {r.status} ({r.downloadCount} downloads)
            {r.status === 'completed' && <button onClick={() => handleDownload(r.id)}>Download</button>}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Write the analytics dashboard page**

```tsx
// web/src/features/analytics/pages/AnalyticsDashboardPage.tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { listBenchmarks, type Benchmark } from '../api/benchmarks'
import { listAIInsights, acknowledgeAIInsight, type AIInsight } from '../api/insights'

const baseUrl = import.meta.env.VITE_API_BASE_URL as string

export default function AnalyticsDashboardPage() {
  const { companyId } = useParams<{ companyId: string }>()
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([])
  const [insights, setInsights] = useState<AIInsight[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = () => {
    if (!companyId) return
    setLoading(true)
    Promise.all([listBenchmarks(baseUrl), listAIInsights(baseUrl, companyId)])
      .then(([b, i]) => {
        setBenchmarks(b)
        setInsights(i)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const handleAcknowledge = async (id: string) => {
    await acknowledgeAIInsight(baseUrl, id)
    reload()
  }

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">{error}</p>

  return (
    <div>
      <h1>Analytics</h1>
      <h2>Benchmarks</h2>
      <ul>
        {benchmarks.map((b) => (
          <li key={b.id}>{b.name} ({b.category})</li>
        ))}
      </ul>
      <h2>AI Insights</h2>
      <ul>
        {insights.map((i) => (
          <li key={i.id} style={{ fontWeight: i.isAcknowledged ? 'normal' : 'bold' }}>
            {i.title} — {i.priority}
            {!i.isAcknowledged && <button onClick={() => handleAcknowledge(i.id)}>Acknowledge</button>}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Register the routes**

Read the current `web/src/app/router.tsx` first — by the time this task runs, `#52`/`#55`
may already have added their own imports/routes on top of what's documented in `#54`'s
sibling plans, so match the file's actual current state rather than a stale snapshot.
Add imports for both new pages from `../features/reports/pages/ReportsListPage` and
`../features/analytics/pages/AnalyticsDashboardPage`, and add these two route entries as
siblings of the other `AdminLayout` children:

```tsx
              { path: '/admin/companies/:companyId/reports', element: <ReportsListPage /> },
              { path: '/admin/companies/:companyId/analytics', element: <AnalyticsDashboardPage /> },
```

- [ ] **Step 4: Add nav entries**

Read the current `web/src/navigation/navSections.ts` first (same reasoning as Step 3 —
other domains may have already extended it). Add "Reports" and "Analytics" nav items
under the `company_admin` branch's admin sub-items list (alongside the existing
"Company settings"/"Users"/"Demographic fields" entries), pointing at
`/admin/companies/${companyId}/reports` and `/admin/companies/${companyId}/analytics`
respectively — company-admin-only, not in the always-visible fallback section (these are
admin dashboards, not a personal inbox like `#55`'s notifications).

- [ ] **Step 5: Extend the nav test**

Read the current `web/src/navigation/navSections.test.ts` and add assertions (matching
its existing style) that a `company_admin` with a `companyId` gets links to both new
paths, and that a `super_admin`/non-admin role does not.

- [ ] **Step 6: Run the tests and build**

Run: `cd web && npm test -- --run && npm run build`
Expected: all tests pass, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/reports/pages/ReportsListPage.tsx web/src/features/analytics/pages/AnalyticsDashboardPage.tsx web/src/app/router.tsx web/src/navigation/navSections.ts web/src/navigation/navSections.test.ts
git commit -m "feat: add ReportsListPage and AnalyticsDashboardPage"
```
