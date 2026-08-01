# Action Plans Core (#53) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship action-plan CRUD with nested KPIs/objectives, progress tracking, and templates.

**Architecture:** Same as every prior domain — minimal-API + manual role checks, `Application/ActionPlans/` services, typed frontend API clients. New domain, new top-level nav entry.

**Tech Stack:** .NET 10 minimal APIs, EF Core/Postgres (schema already exists, no migration needed), xUnit + Testcontainers, React 19 + Vite + react-router-dom, Vitest.

## Global Constraints

- No schema changes — all 9 entities (`ActionPlan`, `ActionPlanKpi`, `ActionPlanObjective`, `ActionPlanProgressUpdate`, `ActionPlanKpiUpdate`, `ActionPlanObjectiveUpdate`, `ActionPlanTemplate`, `ActionPlanTemplateKpi`, `ActionPlanTemplateObjective`) already exist from `#49`.
- Authorization: `.RequireAuthorization()` + manual role check + `Results.Forbid()`, never `[Authorize(Roles=)]`. `Roles.Admin.Contains` + own-company for CompanyAdmin, any for SuperAdmin (same `CanAccessCompany` pattern as every prior domain, duplicated per endpoint file per established precedent).
- Status values (`ActionPlan.Status`): `not_started`, `in_progress`, `completed`, `overdue`, `cancelled` — verified against legacy `src/models/ActionPlan.ts:46`, do not invent different values.
- Priority values: `low`, `medium`, `high`, `critical` — verified against `src/models/ActionPlan.ts:47`.
- `MeasurementFrequency` values (on KPIs): `daily`, `weekly`, `monthly`, `quarterly` — verified against `src/models/ActionPlan.ts:68`.
- No hard delete anywhere — `Status` covers lifecycle.
- `SourceSurveyId`/`SourceInsightId` are write-only pass-through in this plan (accepted if provided, not validated against Survey/Insight tables — those domains don't exist yet).
- Do not build: alerts, follow-up-microclimates, reports/metrics/commitments, bulk-create (all deferred per the design doc — separate future work).
- `.NET`: don't touch pinned package versions. Frontend: Node 20 LTS+.

---

## Task 1: Action plan CRUD endpoints

**Files:**
- Create: `src/ClimateProject.Application/ActionPlans/ActionPlanDtos.cs`
- Create: `src/ClimateProject.Application/ActionPlans/ActionPlanValidation.cs`
- Create: `src/ClimateProject.Api/Endpoints/ActionPlanEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs`
- Test: `tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanEndpointsTests.cs`

**Interfaces:**
- Consumes: nothing new (existing entities).
- Produces: `ActionPlanListItem`, `ActionPlanDetail`, `KpiDto`, `ObjectiveDto` DTOs and the
  list/create/get/update endpoints — Task 2 (progress endpoint) extends `ActionPlanDetail`'s
  shape, Task 4 (frontend) consumes.

- [ ] **Step 1: Validation constants**

Create `src/ClimateProject.Application/ActionPlans/ActionPlanValidation.cs`:

```csharp
namespace ClimateProject.Application.ActionPlans;

public static class ActionPlanValidation
{
    public static readonly string[] ValidStatuses = ["not_started", "in_progress", "completed", "overdue", "cancelled"];
    public static readonly string[] ValidPriorities = ["low", "medium", "high", "critical"];
    public static readonly string[] ValidMeasurementFrequencies = ["daily", "weekly", "monthly", "quarterly"];
}
```

- [ ] **Step 2: DTOs**

Create `src/ClimateProject.Application/ActionPlans/ActionPlanDtos.cs`:

```csharp
namespace ClimateProject.Application.ActionPlans;

public sealed record KpiDto(Guid Id, string Name, decimal TargetValue, decimal CurrentValue, string Unit, string MeasurementFrequency);
public sealed record ObjectiveDto(Guid Id, string Description, string SuccessCriteria, string CurrentStatus, int CompletionPercentage);

public sealed record ActionPlanListItem(
    Guid Id,
    string Title,
    Guid CompanyId,
    Guid? DepartmentId,
    DateTimeOffset DueDate,
    string Status,
    string Priority,
    DateTimeOffset CreatedAt);

public sealed record ActionPlanListResponse(IReadOnlyList<ActionPlanListItem> ActionPlans);

public sealed record ActionPlanDetail(
    Guid Id,
    string Title,
    string Description,
    Guid CompanyId,
    Guid? DepartmentId,
    Guid CreatedBy,
    DateTimeOffset DueDate,
    string Status,
    string Priority,
    string[] Tags,
    Guid? TemplateId,
    List<KpiDto> Kpis,
    List<ObjectiveDto> Objectives);

public sealed record CreateKpiInput(string Name, decimal TargetValue, string Unit, string MeasurementFrequency);
public sealed record CreateObjectiveInput(string Description, string SuccessCriteria);

public sealed record CreateActionPlanRequest(
    string Title,
    string Description,
    Guid CompanyId,
    Guid? DepartmentId,
    DateTimeOffset DueDate,
    string Priority,
    string[]? Tags,
    Guid? TemplateId,
    Guid? SourceSurveyId,
    Guid? SourceInsightId,
    List<CreateKpiInput>? Kpis,
    List<CreateObjectiveInput>? Objectives);

public sealed record UpdateActionPlanRequest(
    string? Title,
    string? Description,
    DateTimeOffset? DueDate,
    string? Status,
    string? Priority,
    string[]? Tags);
```

- [ ] **Step 3: Write the failing tests**

Create `tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanEndpointsTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.ActionPlans;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.ActionPlans;

[Collection("Postgres")]
public class ActionPlanEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"apa-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"apb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public ActionPlanEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "AP Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "AP Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
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
    public async Task CompanyAdmin_can_create_a_plan_with_kpis_and_objectives_then_read_it_back()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            Title: "Improve onboarding",
            Description: "Reduce time-to-productivity for new hires",
            CompanyId: _companyAId,
            DepartmentId: null,
            DueDate: DateTimeOffset.UtcNow.AddDays(30),
            Priority: "high",
            Tags: new[] { "onboarding" },
            TemplateId: null,
            SourceSurveyId: null,
            SourceInsightId: null,
            Kpis: new List<CreateKpiInput> { new("Time to productivity", 30, "days", "monthly") },
            Objectives: new List<CreateObjectiveInput> { new("New hires productive within a month", "90% self-report ready") }));

        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Single(created!.Kpis);
        Assert.Single(created.Objectives);
        Assert.Equal("not_started", created.Status);

        var getResponse = await client.GetAsync($"/action-plans/{created.Id}");
        var fetched = await getResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Equal("Improve onboarding", fetched!.Title);
        Assert.Single(fetched.Kpis);

        var listResponse = await client.GetAsync($"/action-plans?companyId={_companyAId}");
        var list = await listResponse.Content.ReadFromJsonAsync<ActionPlanListResponse>();
        Assert.Contains(list!.ActionPlans, p => p.Id == created.Id);
    }

    [Fact]
    public async Task Create_rejects_invalid_priority()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Bad", "Bad plan", _companyAId, null, DateTimeOffset.UtcNow.AddDays(10), "not_a_priority", null, null, null, null, null, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_create_or_read_plans_in_another_company()
    {
        var client = _factory.CreateClient();
        var tokenA = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        var tokenB = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyBDomain, _companyBId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenB);
        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "B's plan", "desc", _companyBId, null, DateTimeOffset.UtcNow.AddDays(10), "low", null, null, null, null, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);
        var crossCreate = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Cross", "desc", _companyBId, null, DateTimeOffset.UtcNow.AddDays(10), "low", null, null, null, null, null, null));
        Assert.Equal(HttpStatusCode.Forbidden, crossCreate.StatusCode);

        var crossGet = await client.GetAsync($"/action-plans/{created!.Id}");
        Assert.Equal(HttpStatusCode.Forbidden, crossGet.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_can_update_status_and_priority()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "To update", "desc", _companyAId, null, DateTimeOffset.UtcNow.AddDays(10), "low", null, null, null, null, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();

        var updateResponse = await client.PutAsJsonAsync($"/action-plans/{created!.Id}", new UpdateActionPlanRequest(null, null, null, "in_progress", "critical", null));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Equal("in_progress", updated!.Status);
        Assert.Equal("critical", updated.Priority);
    }
}
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanEndpointsTests"`
Expected: FAIL (compile error).

- [ ] **Step 5: Implement the endpoints**

Create `src/ClimateProject.Api/Endpoints/ActionPlanEndpoints.cs`:

```csharp
using System.Security.Claims;
using ClimateProject.Application.ActionPlans;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class ActionPlanEndpoints
{
    public static void MapActionPlanEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/action-plans").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || currentUser.CompanyId == companyId.ToString();

    private static async Task<ActionPlanDetail> ToDetailAsync(ActionPlan plan, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var kpis = await db.ActionPlanKpis.Where(k => k.ActionPlanId == plan.Id)
            .Select(k => new KpiDto(k.Id, k.Name, k.TargetValue, k.CurrentValue, k.Unit, k.MeasurementFrequency))
            .ToListAsync(cancellationToken);
        var objectives = await db.ActionPlanObjectives.Where(o => o.ActionPlanId == plan.Id)
            .Select(o => new ObjectiveDto(o.Id, o.Description, o.SuccessCriteria, o.CurrentStatus, o.CompletionPercentage))
            .ToListAsync(cancellationToken);

        return new ActionPlanDetail(plan.Id, plan.Title, plan.Description, plan.CompanyId, plan.DepartmentId, plan.CreatedBy,
            plan.DueDate, plan.Status, plan.Priority, plan.Tags, plan.TemplateId, kpis, objectives);
    }

    private static async Task<IResult> ListAsync(
        Guid companyId,
        Guid? departmentId,
        string? status,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        var query = db.ActionPlans.Where(p => p.CompanyId == companyId);
        if (departmentId.HasValue) query = query.Where(p => p.DepartmentId == departmentId.Value);
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(p => p.Status == status);

        var plans = await query
            .OrderBy(p => p.DueDate)
            .Select(p => new ActionPlanListItem(p.Id, p.Title, p.CompanyId, p.DepartmentId, p.DueDate, p.Status, p.Priority, p.CreatedAt))
            .ToListAsync(cancellationToken);

        return Results.Ok(new ActionPlanListResponse(plans));
    }

    private static async Task<IResult> CreateAsync(
        CreateActionPlanRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role) || !CanAccessCompany(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        if (string.IsNullOrWhiteSpace(request.Title) || string.IsNullOrWhiteSpace(request.Description))
        {
            return Results.Json(new { message = "Title and description are required" }, statusCode: 400);
        }

        if (!ActionPlanValidation.ValidPriorities.Contains(request.Priority))
        {
            return Results.Json(new { message = $"Invalid priority: {request.Priority}" }, statusCode: 400);
        }

        foreach (var kpi in request.Kpis ?? [])
        {
            if (!ActionPlanValidation.ValidMeasurementFrequencies.Contains(kpi.MeasurementFrequency))
            {
                return Results.Json(new { message = $"Invalid measurement frequency: {kpi.MeasurementFrequency}" }, statusCode: 400);
            }
        }

        var actingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == currentUser.Email, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(),
            Title = request.Title.Trim(),
            Description = request.Description.Trim(),
            CompanyId = request.CompanyId,
            DepartmentId = request.DepartmentId,
            CreatedBy = actingUser?.Id ?? Guid.Empty,
            DueDate = request.DueDate,
            Status = "not_started",
            Priority = request.Priority,
            Tags = request.Tags ?? [],
            TemplateId = request.TemplateId,
            SourceSurveyId = request.SourceSurveyId,
            SourceInsightId = request.SourceInsightId,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.ActionPlans.Add(plan);

        foreach (var kpiInput in request.Kpis ?? [])
        {
            db.ActionPlanKpis.Add(new ActionPlanKpi
            {
                Id = Guid.NewGuid(),
                ActionPlanId = plan.Id,
                Name = kpiInput.Name,
                TargetValue = kpiInput.TargetValue,
                CurrentValue = 0,
                Unit = kpiInput.Unit,
                MeasurementFrequency = kpiInput.MeasurementFrequency,
            });
        }

        foreach (var objectiveInput in request.Objectives ?? [])
        {
            db.ActionPlanObjectives.Add(new ActionPlanObjective
            {
                Id = Guid.NewGuid(),
                ActionPlanId = plan.Id,
                Description = objectiveInput.Description,
                SuccessCriteria = objectiveInput.SuccessCriteria,
                CurrentStatus = "not_started",
                CompletionPercentage = 0,
            });
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await ToDetailAsync(plan, db, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var plan = await db.ActionPlans.FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (plan is null)
        {
            return Results.Json(new { message = "Action plan not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, plan.CompanyId))
        {
            return Results.Forbid();
        }

        return Results.Ok(await ToDetailAsync(plan, db, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateActionPlanRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var plan = await db.ActionPlans.FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (plan is null)
        {
            return Results.Json(new { message = "Action plan not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, plan.CompanyId))
        {
            return Results.Forbid();
        }

        if (!string.IsNullOrWhiteSpace(request.Title)) plan.Title = request.Title.Trim();
        if (!string.IsNullOrWhiteSpace(request.Description)) plan.Description = request.Description.Trim();
        if (request.DueDate.HasValue) plan.DueDate = request.DueDate.Value;

        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            if (!ActionPlanValidation.ValidStatuses.Contains(request.Status))
            {
                return Results.Json(new { message = $"Invalid status: {request.Status}" }, statusCode: 400);
            }

            plan.Status = request.Status;
        }

        if (!string.IsNullOrWhiteSpace(request.Priority))
        {
            if (!ActionPlanValidation.ValidPriorities.Contains(request.Priority))
            {
                return Results.Json(new { message = $"Invalid priority: {request.Priority}" }, statusCode: 400);
            }

            plan.Priority = request.Priority;
        }

        if (request.Tags is not null) plan.Tags = request.Tags;

        plan.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await ToDetailAsync(plan, db, cancellationToken));
    }
}
```

- [ ] **Step 6: Register the endpoint group**

In `src/ClimateProject.Api/Program.cs`, add after the last existing `app.Map*Endpoints();` line:

```csharp
app.MapActionPlanEndpoints();
```

- [ ] **Step 7: Run the tests to verify they pass, then the full suite**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanEndpointsTests"` — expect PASS, 4/4.
Run: `dotnet test ClimateProject.slnx` — expect all pass (baseline is whatever Slice 3 ended at + 4; check the actual current count via the test runner's own summary rather than a hardcoded number, since this plan may run after Slice 3 or after other domains depending on final sequencing).

- [ ] **Step 8: Commit**

```bash
git add src/ClimateProject.Application/ActionPlans/ActionPlanDtos.cs \
        src/ClimateProject.Application/ActionPlans/ActionPlanValidation.cs \
        src/ClimateProject.Api/Endpoints/ActionPlanEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanEndpointsTests.cs
git commit -m "feat: add action plan CRUD endpoints with nested KPIs and objectives"
```

---

## Task 2: Progress-update endpoint

**Files:**
- Modify: `src/ClimateProject.Application/ActionPlans/ActionPlanDtos.cs`
- Modify: `src/ClimateProject.Api/Endpoints/ActionPlanEndpoints.cs`
- Test: `tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanProgressEndpointTests.cs`

**Interfaces:**
- Consumes: `ActionPlanKpi`/`ActionPlanObjective` (Task 1, must already exist on the plan).
- Produces: `POST /action-plans/{id}/progress` — Task 5 (frontend) consumes.

- [ ] **Step 1: Add the progress DTOs**

In `src/ClimateProject.Application/ActionPlans/ActionPlanDtos.cs`, add at the end:

```csharp
public sealed record KpiUpdateInput(Guid KpiId, decimal NewValue, string? Notes);
public sealed record ObjectiveUpdateInput(Guid ObjectiveId, string StatusUpdate, int? CompletionPercentage, string? Notes);

public sealed record RecordProgressRequest(
    string OverallNotes,
    List<KpiUpdateInput>? KpiUpdates,
    List<ObjectiveUpdateInput>? ObjectiveUpdates);

public sealed record ProgressUpdateDetail(
    Guid Id,
    DateTimeOffset UpdateDate,
    string OverallNotes,
    Guid UpdatedBy);
```

- [ ] **Step 2: Write the failing test**

Create `tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanProgressEndpointTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.ActionPlans;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.ActionPlans;

[Collection("Postgres")]
public class ActionPlanProgressEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"prog-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public ActionPlanProgressEndpointTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Progress Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
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
    public async Task Recording_progress_updates_kpi_and_objective_current_values()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Plan", "desc", _companyId, null, DateTimeOffset.UtcNow.AddDays(30), "medium", null, null, null, null,
            new List<CreateKpiInput> { new("Adoption", 100, "percent", "monthly") },
            new List<CreateObjectiveInput> { new("Ship feature", "Live in prod") }));
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();
        var kpiId = created!.Kpis[0].Id;
        var objectiveId = created.Objectives[0].Id;

        var progressResponse = await client.PostAsJsonAsync($"/action-plans/{created.Id}/progress", new RecordProgressRequest(
            OverallNotes: "Good progress this month",
            KpiUpdates: new List<KpiUpdateInput> { new(kpiId, 40, "40% adopted so far") },
            ObjectiveUpdates: new List<ObjectiveUpdateInput> { new(objectiveId, "in_progress", 50, "Halfway done") }));

        Assert.Equal(HttpStatusCode.Created, progressResponse.StatusCode);

        var getResponse = await client.GetAsync($"/action-plans/{created.Id}");
        var updated = await getResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();
        Assert.Equal(40, updated!.Kpis[0].CurrentValue);
        Assert.Equal(50, updated.Objectives[0].CompletionPercentage);
        Assert.Equal("in_progress", updated.Objectives[0].CurrentStatus);
    }

    [Fact]
    public async Task Recording_progress_for_a_kpi_that_does_not_belong_to_the_plan_fails()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            "Plan", "desc", _companyId, null, DateTimeOffset.UtcNow.AddDays(30), "medium", null, null, null, null, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanDetail>();

        var progressResponse = await client.PostAsJsonAsync($"/action-plans/{created!.Id}/progress", new RecordProgressRequest(
            "notes", new List<KpiUpdateInput> { new(Guid.NewGuid(), 10, null) }, null));

        Assert.Equal(HttpStatusCode.BadRequest, progressResponse.StatusCode);
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanProgressEndpointTests"`
Expected: FAIL (404 -- route doesn't exist).

- [ ] **Step 4: Implement the endpoint**

In `src/ClimateProject.Api/Endpoints/ActionPlanEndpoints.cs`, add a route registration inside
`MapActionPlanEndpoints` (after `group.MapPut("/{id:guid}", UpdateAsync);`):

```csharp
        group.MapPost("/{id:guid}/progress", RecordProgressAsync);
```

Add the handler after `UpdateAsync`:

```csharp
    private static async Task<IResult> RecordProgressAsync(
        Guid id,
        RecordProgressRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var plan = await db.ActionPlans.FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (plan is null)
        {
            return Results.Json(new { message = "Action plan not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, plan.CompanyId))
        {
            return Results.Forbid();
        }

        var kpis = await db.ActionPlanKpis.Where(k => k.ActionPlanId == id).ToListAsync(cancellationToken);
        var objectives = await db.ActionPlanObjectives.Where(o => o.ActionPlanId == id).ToListAsync(cancellationToken);

        foreach (var kpiUpdate in request.KpiUpdates ?? [])
        {
            if (kpis.All(k => k.Id != kpiUpdate.KpiId))
            {
                return Results.Json(new { message = $"KPI {kpiUpdate.KpiId} does not belong to this action plan" }, statusCode: 400);
            }
        }

        foreach (var objectiveUpdate in request.ObjectiveUpdates ?? [])
        {
            if (objectives.All(o => o.Id != objectiveUpdate.ObjectiveId))
            {
                return Results.Json(new { message = $"Objective {objectiveUpdate.ObjectiveId} does not belong to this action plan" }, statusCode: 400);
            }
        }

        var actingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == currentUser.Email, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var progressUpdate = new ActionPlanProgressUpdate
        {
            Id = Guid.NewGuid(),
            ActionPlanId = id,
            UpdateDate = now,
            OverallNotes = request.OverallNotes,
            UpdatedBy = actingUser?.Id ?? Guid.Empty,
        };
        db.ActionPlanProgressUpdates.Add(progressUpdate);

        foreach (var kpiUpdate in request.KpiUpdates ?? [])
        {
            var kpi = kpis.First(k => k.Id == kpiUpdate.KpiId);
            kpi.CurrentValue = kpiUpdate.NewValue;
            db.ActionPlanKpiUpdates.Add(new ActionPlanKpiUpdate
            {
                Id = Guid.NewGuid(),
                ProgressUpdateId = progressUpdate.Id,
                KpiId = kpiUpdate.KpiId,
                NewValue = kpiUpdate.NewValue,
                Notes = kpiUpdate.Notes,
            });
        }

        foreach (var objectiveUpdate in request.ObjectiveUpdates ?? [])
        {
            var objective = objectives.First(o => o.Id == objectiveUpdate.ObjectiveId);
            objective.CurrentStatus = objectiveUpdate.StatusUpdate;
            if (objectiveUpdate.CompletionPercentage.HasValue)
            {
                objective.CompletionPercentage = objectiveUpdate.CompletionPercentage.Value;
            }

            db.ActionPlanObjectiveUpdates.Add(new ActionPlanObjectiveUpdate
            {
                Id = Guid.NewGuid(),
                ProgressUpdateId = progressUpdate.Id,
                ObjectiveId = objectiveUpdate.ObjectiveId,
                StatusUpdate = objectiveUpdate.StatusUpdate,
                CompletionPercentage = objectiveUpdate.CompletionPercentage,
                Notes = objectiveUpdate.Notes,
            });
        }

        plan.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(new ProgressUpdateDetail(progressUpdate.Id, progressUpdate.UpdateDate, progressUpdate.OverallNotes, progressUpdate.UpdatedBy), statusCode: 201);
    }
```

- [ ] **Step 5: Run the tests to verify they pass, then the full suite**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanProgressEndpointTests"` — expect PASS, 2/2.
Run: `dotnet test ClimateProject.slnx` — expect all pass.

- [ ] **Step 6: Commit**

```bash
git add src/ClimateProject.Application/ActionPlans/ActionPlanDtos.cs \
        src/ClimateProject.Api/Endpoints/ActionPlanEndpoints.cs \
        tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanProgressEndpointTests.cs
git commit -m "feat: add action plan progress-update endpoint"
```

---

## Task 3: Action plan template endpoints

**Files:**
- Create: `src/ClimateProject.Application/ActionPlans/ActionPlanTemplateDtos.cs`
- Create: `src/ClimateProject.Api/Endpoints/ActionPlanTemplateEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs`
- Test: `tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanTemplateEndpointsTests.cs`

**Interfaces:**
- Consumes: nothing new.
- Produces: list/create endpoints — Task 5 (frontend) consumes for the "start from template" flow (not built as auto-population logic in this plan — the frontend just lists templates for reference; wiring template selection into `CreateActionPlanRequest.TemplateId` is a one-field pass-through already supported by Task 1).

- [ ] **Step 1: DTOs**

Create `src/ClimateProject.Application/ActionPlans/ActionPlanTemplateDtos.cs`:

```csharp
namespace ClimateProject.Application.ActionPlans;

public sealed record ActionPlanTemplateDetail(
    Guid Id,
    string Name,
    string Description,
    string Category,
    Guid? CompanyId,
    string[] Tags,
    int UsageCount,
    bool IsActive);

public sealed record ActionPlanTemplateListResponse(IReadOnlyList<ActionPlanTemplateDetail> Templates);

public sealed record CreateActionPlanTemplateRequest(
    string Name,
    string Description,
    string Category,
    Guid? CompanyId,
    string[]? Tags);
```

- [ ] **Step 2: Write the failing tests**

Create `tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanTemplateEndpointsTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.ActionPlans;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.ActionPlans;

[Collection("Postgres")]
public class ActionPlanTemplateEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"tmpl-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public ActionPlanTemplateEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Template Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
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
    public async Task CompanyAdmin_can_create_and_list_their_own_companys_templates()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plan-templates", new CreateActionPlanTemplateRequest(
            "Onboarding template", "Standard onboarding plan", "hr", _companyId, new[] { "onboarding" }));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanTemplateDetail>();

        var listResponse = await client.GetAsync($"/action-plan-templates?companyId={_companyId}");
        var list = await listResponse.Content.ReadFromJsonAsync<ActionPlanTemplateListResponse>();
        Assert.Contains(list!.Templates, t => t.Id == created!.Id);
    }

    [Fact]
    public async Task System_templates_with_no_company_are_visible_to_everyone()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.ActionPlanTemplates.Add(new ActionPlanTemplate
            {
                Id = Guid.NewGuid(),
                Name = "System template",
                Description = "Built-in",
                Category = "general",
                CompanyId = null,
                CreatedBy = Guid.NewGuid(),
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var listResponse = await client.GetAsync($"/action-plan-templates?companyId={_companyId}");
        var list = await listResponse.Content.ReadFromJsonAsync<ActionPlanTemplateListResponse>();
        Assert.Contains(list!.Templates, t => t.Name == "System template");
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanTemplateEndpointsTests"`
Expected: FAIL (compile error).

- [ ] **Step 4: Implement the endpoints**

Create `src/ClimateProject.Api/Endpoints/ActionPlanTemplateEndpoints.cs`:

```csharp
using System.Security.Claims;
using ClimateProject.Application.ActionPlans;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class ActionPlanTemplateEndpoints
{
    public static void MapActionPlanTemplateEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/action-plan-templates").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
    }

    private static ActionPlanTemplateDetail ToDetail(ActionPlanTemplate t)
        => new(t.Id, t.Name, t.Description, t.Category, t.CompanyId, t.Tags, t.UsageCount, t.IsActive);

    private static async Task<IResult> ListAsync(
        Guid companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin && currentUser.CompanyId != companyId.ToString())
        {
            return Results.Forbid();
        }

        var templates = await db.ActionPlanTemplates
            .Where(t => t.CompanyId == companyId || t.CompanyId == null)
            .Where(t => t.IsActive)
            .OrderBy(t => t.Name)
            .Select(t => new ActionPlanTemplateDetail(t.Id, t.Name, t.Description, t.Category, t.CompanyId, t.Tags, t.UsageCount, t.IsActive))
            .ToListAsync(cancellationToken);

        return Results.Ok(new ActionPlanTemplateListResponse(templates));
    }

    private static async Task<IResult> CreateAsync(
        CreateActionPlanTemplateRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role))
        {
            return Results.Forbid();
        }

        if (request.CompanyId.HasValue && currentUser.Role != Roles.SuperAdmin && currentUser.CompanyId != request.CompanyId.Value.ToString())
        {
            return Results.Forbid();
        }

        if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Description) || string.IsNullOrWhiteSpace(request.Category))
        {
            return Results.Json(new { message = "Name, description, and category are required" }, statusCode: 400);
        }

        var actingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == currentUser.Email, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var template = new ActionPlanTemplate
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Description = request.Description.Trim(),
            Category = request.Category,
            CompanyId = request.CompanyId,
            CreatedBy = actingUser?.Id ?? Guid.Empty,
            Tags = request.Tags ?? [],
            UsageCount = 0,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };

        db.ActionPlanTemplates.Add(template);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(ToDetail(template), statusCode: 201);
    }
}
```

- [ ] **Step 5: Register the endpoint group**

In `src/ClimateProject.Api/Program.cs`, add after `app.MapActionPlanEndpoints();`:

```csharp
app.MapActionPlanTemplateEndpoints();
```

- [ ] **Step 6: Run the tests to verify they pass, then the full suite**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanTemplateEndpointsTests"` — expect PASS, 2/2.
Run: `dotnet test ClimateProject.slnx` — expect all pass.

- [ ] **Step 7: Commit**

```bash
git add src/ClimateProject.Application/ActionPlans/ActionPlanTemplateDtos.cs \
        src/ClimateProject.Api/Endpoints/ActionPlanTemplateEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanTemplateEndpointsTests.cs
git commit -m "feat: add action plan template list/create endpoints"
```

---

## Task 4: Frontend typed API clients

**Files:**
- Create: `web/src/features/action-plans/api/actionPlans.ts` + `.test.ts`
- Create: `web/src/features/action-plans/api/actionPlanTemplates.ts` + `.test.ts`

**Interfaces:**
- Consumes: `authFetch` (existing).
- Produces: typed clients for Tasks 5-6.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/action-plans/api/actionPlans.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listActionPlans, createActionPlan, getActionPlan, updateActionPlan, recordProgress } from './actionPlans'

const baseUrl = 'http://api.test'

describe('actionPlans api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  const detail = {
    id: 'p1', title: 'Plan', description: 'desc', companyId: 'c1', departmentId: null, createdBy: 'u1',
    dueDate: '2026-12-01', status: 'not_started', priority: 'medium', tags: [], templateId: null,
    kpis: [], objectives: [],
  }

  it('lists action plans', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ actionPlans: [detail] }), { status: 200 }))
    const result = await listActionPlans(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/action-plans?companyId=c1`, expect.anything())
    expect(result).toEqual([detail])
  })

  it('creates an action plan', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 201 }))
    const result = await createActionPlan(baseUrl, { title: 'Plan', description: 'desc', companyId: 'c1', dueDate: '2026-12-01', priority: 'medium' })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/action-plans`, expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(detail)
  })

  it('gets an action plan', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 200 }))
    const result = await getActionPlan(baseUrl, 'p1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/action-plans/p1`, expect.anything())
    expect(result).toEqual(detail)
  })

  it('updates an action plan', async () => {
    const updated = { ...detail, status: 'in_progress' }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }))
    const result = await updateActionPlan(baseUrl, 'p1', { status: 'in_progress' })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/action-plans/p1`, expect.objectContaining({ method: 'PUT' }))
    expect(result.status).toBe('in_progress')
  })

  it('records progress', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'pu1', updateDate: '2026-01-01', overallNotes: 'notes', updatedBy: 'u1' }), { status: 201 }))
    const result = await recordProgress(baseUrl, 'p1', { overallNotes: 'notes', kpiUpdates: [], objectiveUpdates: [] })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/action-plans/p1/progress`, expect.objectContaining({ method: 'POST' }))
    expect(result.overallNotes).toBe('notes')
  })
})
```

Create `web/src/features/action-plans/api/actionPlanTemplates.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listActionPlanTemplates, createActionPlanTemplate } from './actionPlanTemplates'

const baseUrl = 'http://api.test'

describe('actionPlanTemplates api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists templates for a company', async () => {
    const templates = [{ id: 't1', name: 'Template', description: 'desc', category: 'hr', companyId: 'c1', tags: [], usageCount: 0, isActive: true }]
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ templates }), { status: 200 }))
    const result = await listActionPlanTemplates(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/action-plan-templates?companyId=c1`, expect.anything())
    expect(result).toEqual(templates)
  })

  it('creates a template', async () => {
    const created = { id: 't1', name: 'Template', description: 'desc', category: 'hr', companyId: 'c1', tags: [], usageCount: 0, isActive: true }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }))
    const result = await createActionPlanTemplate(baseUrl, { name: 'Template', description: 'desc', category: 'hr', companyId: 'c1' })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/action-plan-templates`, expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(created)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- actionPlans.test.ts actionPlanTemplates.test.ts` (from `web/`)
Expected: FAIL (modules don't exist yet).

- [ ] **Step 3: Implement the clients**

Create `web/src/features/action-plans/api/actionPlans.ts`:

```typescript
import { authFetch } from '../../../api/authFetch'

export interface Kpi {
  id: string
  name: string
  targetValue: number
  currentValue: number
  unit: string
  measurementFrequency: string
}

export interface Objective {
  id: string
  description: string
  successCriteria: string
  currentStatus: string
  completionPercentage: number
}

export interface ActionPlan {
  id: string
  title: string
  companyId: string
  departmentId: string | null
  dueDate: string
  status: string
  priority: string
  createdAt: string
}

export interface ActionPlanDetail {
  id: string
  title: string
  description: string
  companyId: string
  departmentId: string | null
  createdBy: string
  dueDate: string
  status: string
  priority: string
  tags: string[]
  templateId: string | null
  kpis: Kpi[]
  objectives: Objective[]
}

export interface CreateKpiInput {
  name: string
  targetValue: number
  unit: string
  measurementFrequency: string
}

export interface CreateObjectiveInput {
  description: string
  successCriteria: string
}

export interface CreateActionPlanInput {
  title: string
  description: string
  companyId: string
  departmentId?: string
  dueDate: string
  priority: string
  tags?: string[]
  templateId?: string
  kpis?: CreateKpiInput[]
  objectives?: CreateObjectiveInput[]
}

export interface UpdateActionPlanInput {
  title?: string
  description?: string
  dueDate?: string
  status?: string
  priority?: string
  tags?: string[]
}

export interface KpiUpdateInput {
  kpiId: string
  newValue: number
  notes?: string
}

export interface ObjectiveUpdateInput {
  objectiveId: string
  statusUpdate: string
  completionPercentage?: number
  notes?: string
}

export interface RecordProgressInput {
  overallNotes: string
  kpiUpdates: KpiUpdateInput[]
  objectiveUpdates: ObjectiveUpdateInput[]
}

export interface ProgressUpdateDetail {
  id: string
  updateDate: string
  overallNotes: string
  updatedBy: string
}

export async function listActionPlans(baseUrl: string, companyId: string): Promise<ActionPlan[]> {
  const response = await authFetch(`${baseUrl}/action-plans?companyId=${companyId}`)
  const body = (await response.json()) as { actionPlans: ActionPlan[] }
  return body.actionPlans
}

export async function createActionPlan(baseUrl: string, input: CreateActionPlanInput): Promise<ActionPlanDetail> {
  const response = await authFetch(`${baseUrl}/action-plans`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<ActionPlanDetail>
}

export async function getActionPlan(baseUrl: string, id: string): Promise<ActionPlanDetail> {
  const response = await authFetch(`${baseUrl}/action-plans/${id}`)
  return response.json() as Promise<ActionPlanDetail>
}

export async function updateActionPlan(baseUrl: string, id: string, input: UpdateActionPlanInput): Promise<ActionPlanDetail> {
  const response = await authFetch(`${baseUrl}/action-plans/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<ActionPlanDetail>
}

export async function recordProgress(baseUrl: string, id: string, input: RecordProgressInput): Promise<ProgressUpdateDetail> {
  const response = await authFetch(`${baseUrl}/action-plans/${id}/progress`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<ProgressUpdateDetail>
}
```

Create `web/src/features/action-plans/api/actionPlanTemplates.ts`:

```typescript
import { authFetch } from '../../../api/authFetch'

export interface ActionPlanTemplate {
  id: string
  name: string
  description: string
  category: string
  companyId: string | null
  tags: string[]
  usageCount: number
  isActive: boolean
}

export interface CreateActionPlanTemplateInput {
  name: string
  description: string
  category: string
  companyId?: string
  tags?: string[]
}

export async function listActionPlanTemplates(baseUrl: string, companyId: string): Promise<ActionPlanTemplate[]> {
  const response = await authFetch(`${baseUrl}/action-plan-templates?companyId=${companyId}`)
  const body = (await response.json()) as { templates: ActionPlanTemplate[] }
  return body.templates
}

export async function createActionPlanTemplate(baseUrl: string, input: CreateActionPlanTemplateInput): Promise<ActionPlanTemplate> {
  const response = await authFetch(`${baseUrl}/action-plan-templates`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<ActionPlanTemplate>
}
```

- [ ] **Step 4: Run the tests to verify they pass, run the build**

Run: `npm test` (from `web/`) — expect PASS.
Run: `npm run build` (from `web/`) — expect success.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/action-plans/api/actionPlans.ts web/src/features/action-plans/api/actionPlans.test.ts \
        web/src/features/action-plans/api/actionPlanTemplates.ts web/src/features/action-plans/api/actionPlanTemplates.test.ts
git commit -m "feat: add typed API clients for action plans and templates"
```

---

## Task 5: Frontend — ActionPlansListPage

**Files:**
- Create: `web/src/features/action-plans/components/ActionPlanFilters.tsx`
- Create: `web/src/features/action-plans/components/ActionPlanList.tsx`
- Create: `web/src/features/action-plans/components/ActionPlanForm.tsx`
- Create: `web/src/features/action-plans/pages/ActionPlansListPage.tsx`
- Modify: `web/src/app/router.tsx`
- Modify: `web/src/navigation/navSections.ts`

**Interfaces:**
- Consumes: `listActionPlans`, `createActionPlan` (Task 4).
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Filters**

Create `web/src/features/action-plans/components/ActionPlanFilters.tsx`:

```tsx
export interface ActionPlanFiltersValue {
  status: string
}

interface ActionPlanFiltersProps {
  value: ActionPlanFiltersValue
  onChange: (value: ActionPlanFiltersValue) => void
}

const STATUSES = ['', 'not_started', 'in_progress', 'completed', 'overdue', 'cancelled']

export default function ActionPlanFilters({ value, onChange }: ActionPlanFiltersProps) {
  return (
    <select value={value.status} onChange={(e) => onChange({ status: e.target.value })}>
      {STATUSES.map((status) => (
        <option key={status} value={status}>{status || 'All statuses'}</option>
      ))}
    </select>
  )
}
```

- [ ] **Step 2: List component**

Create `web/src/features/action-plans/components/ActionPlanList.tsx`:

```tsx
import { Link } from 'react-router-dom'
import type { ActionPlan } from '../api/actionPlans'

export default function ActionPlanList({ plans }: { plans: ActionPlan[] }) {
  if (plans.length === 0) {
    return <p>No action plans found.</p>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Status</th>
          <th>Priority</th>
          <th>Due date</th>
        </tr>
      </thead>
      <tbody>
        {plans.map((plan) => (
          <tr key={plan.id}>
            <td><Link to={`/action-plans/${plan.id}`}>{plan.title}</Link></td>
            <td>{plan.status}</td>
            <td>{plan.priority}</td>
            <td>{new Date(plan.dueDate).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 3: Create form**

Create `web/src/features/action-plans/components/ActionPlanForm.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import type { CreateKpiInput, CreateObjectiveInput } from '../api/actionPlans'

export interface ActionPlanFormValues {
  title: string
  description: string
  dueDate: string
  priority: string
  kpis: CreateKpiInput[]
  objectives: CreateObjectiveInput[]
}

const PRIORITIES = ['low', 'medium', 'high', 'critical']
const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly']

const EMPTY_VALUES: ActionPlanFormValues = { title: '', description: '', dueDate: '', priority: 'medium', kpis: [], objectives: [] }

export default function ActionPlanForm({ onSubmit }: { onSubmit: (values: ActionPlanFormValues) => Promise<void> }) {
  const [values, setValues] = useState<ActionPlanFormValues>(EMPTY_VALUES)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function addKpi() {
    setValues({ ...values, kpis: [...values.kpis, { name: '', targetValue: 0, unit: '', measurementFrequency: 'monthly' }] })
  }

  function updateKpi(index: number, kpi: CreateKpiInput) {
    setValues({ ...values, kpis: values.kpis.map((k, i) => (i === index ? kpi : k)) })
  }

  function addObjective() {
    setValues({ ...values, objectives: [...values.objectives, { description: '', successCriteria: '' }] })
  }

  function updateObjective(index: number, objective: CreateObjectiveInput) {
    setValues({ ...values, objectives: values.objectives.map((o, i) => (i === index ? objective : o)) })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit(values)
      setValues(EMPTY_VALUES)
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
        Title
        <input value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} required />
      </label>
      <label>
        Description
        <textarea value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} required />
      </label>
      <label>
        Due date
        <input type="date" value={values.dueDate} onChange={(e) => setValues({ ...values, dueDate: e.target.value })} required />
      </label>
      <label>
        Priority
        <select value={values.priority} onChange={(e) => setValues({ ...values, priority: e.target.value })}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </label>

      <h3>KPIs</h3>
      {values.kpis.map((kpi, index) => (
        <div key={index}>
          <input placeholder="Name" value={kpi.name} onChange={(e) => updateKpi(index, { ...kpi, name: e.target.value })} />
          <input type="number" placeholder="Target" value={kpi.targetValue} onChange={(e) => updateKpi(index, { ...kpi, targetValue: Number(e.target.value) })} />
          <input placeholder="Unit" value={kpi.unit} onChange={(e) => updateKpi(index, { ...kpi, unit: e.target.value })} />
          <select value={kpi.measurementFrequency} onChange={(e) => updateKpi(index, { ...kpi, measurementFrequency: e.target.value })}>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      ))}
      <button type="button" onClick={addKpi}>Add KPI</button>

      <h3>Objectives</h3>
      {values.objectives.map((objective, index) => (
        <div key={index}>
          <input placeholder="Description" value={objective.description} onChange={(e) => updateObjective(index, { ...objective, description: e.target.value })} />
          <input placeholder="Success criteria" value={objective.successCriteria} onChange={(e) => updateObjective(index, { ...objective, successCriteria: e.target.value })} />
        </div>
      ))}
      <button type="button" onClick={addObjective}>Add objective</button>

      <button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create action plan'}</button>
    </form>
  )
}
```

- [ ] **Step 4: List page**

Create `web/src/features/action-plans/pages/ActionPlansListPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { listActionPlans, createActionPlan, type ActionPlan } from '../api/actionPlans'
import ActionPlanList from '../components/ActionPlanList'
import ActionPlanFilters, { type ActionPlanFiltersValue } from '../components/ActionPlanFilters'
import ActionPlanForm, { type ActionPlanFormValues } from '../components/ActionPlanForm'

// This slice has no company-picker UI yet (org-structure's admin shell doesn't
// expose a "current company" concept for a CompanyAdmin browsing their own
// data outside /admin/companies/:id) -- VITE_DEFAULT_COMPANY_ID is a stopgap
// read directly from env for local/manual testing until #57 (cross-cutting
// frontend) or a later pass adds a real company-context selector.
export default function ActionPlansListPage() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const companyId = import.meta.env.VITE_DEFAULT_COMPANY_ID as string
  const [plans, setPlans] = useState<ActionPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ActionPlanFiltersValue>({ status: '' })
  const [showCreateForm, setShowCreateForm] = useState(false)

  async function reload() {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const result = await listActionPlans(baseUrl, companyId)
      setPlans(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load action plans')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const filtered = plans.filter((plan) => !filters.status || plan.status === filters.status)

  async function handleCreate(values: ActionPlanFormValues) {
    await createActionPlan(baseUrl, {
      title: values.title,
      description: values.description,
      companyId,
      dueDate: values.dueDate,
      priority: values.priority,
      kpis: values.kpis,
      objectives: values.objectives,
    })
    setShowCreateForm(false)
    await reload()
  }

  if (!companyId) {
    return <p role="alert">VITE_DEFAULT_COMPANY_ID is not configured.</p>
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  return (
    <div>
      <h1>Action Plans</h1>
      <ActionPlanFilters value={filters} onChange={setFilters} />
      <button onClick={() => setShowCreateForm((v) => !v)}>{showCreateForm ? 'Cancel' : 'New action plan'}</button>
      {showCreateForm && <ActionPlanForm onSubmit={handleCreate} />}
      {loading ? <p>Loading…</p> : <ActionPlanList plans={filtered} />}
    </div>
  )
}
```

- [ ] **Step 5: Wire the route and nav entry**

Modify `web/src/app/router.tsx` — add the import:

```tsx
import ActionPlansListPage from '../features/action-plans/pages/ActionPlansListPage'
```

Add the route as a sibling of the other `AdminLayout` children:

```tsx
              { path: '/action-plans', element: <ActionPlansListPage /> },
```

Modify `web/src/navigation/navSections.ts` — add a new top-level section (this domain isn't
part of org-structure, so it gets its own section, not a sub-item):

```tsx
import { Shield, Building2, Target } from 'lucide-react'
```

```tsx
export const navSections: NavSection[] = [
  {
    title: '',
    items: [
      {
        label: 'System Administration',
        href: '/admin/companies',
        icon: Shield,
        sub: [
          { label: 'Companies', href: '/admin/companies', icon: Building2 },
        ],
      },
      {
        label: 'Action Plans',
        href: '/action-plans',
        icon: Target,
      },
    ],
  },
]
```

- [ ] **Step 6: Verify manually**

Run `npm run build` and `npm test` (from `web/`) — no browser available to this implementer.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/action-plans/components/ActionPlanFilters.tsx \
        web/src/features/action-plans/components/ActionPlanList.tsx \
        web/src/features/action-plans/components/ActionPlanForm.tsx \
        web/src/features/action-plans/pages/ActionPlansListPage.tsx \
        web/src/app/router.tsx \
        web/src/navigation/navSections.ts
git commit -m "feat: add ActionPlansListPage (list, filter, create)"
```

---

## Task 6: Frontend — ActionPlanDetailPage

**Files:**
- Create: `web/src/features/action-plans/components/ProgressUpdateForm.tsx`
- Create: `web/src/features/action-plans/pages/ActionPlanDetailPage.tsx`
- Modify: `web/src/app/router.tsx`

**Interfaces:**
- Consumes: `getActionPlan`, `updateActionPlan`, `recordProgress` (Task 4).
- Produces: nothing consumed by a later task — last task in this plan.

- [ ] **Step 1: Progress update form**

Create `web/src/features/action-plans/components/ProgressUpdateForm.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import type { Kpi, Objective, KpiUpdateInput, ObjectiveUpdateInput } from '../api/actionPlans'

export interface ProgressUpdateFormValues {
  overallNotes: string
  kpiUpdates: KpiUpdateInput[]
  objectiveUpdates: ObjectiveUpdateInput[]
}

interface ProgressUpdateFormProps {
  kpis: Kpi[]
  objectives: Objective[]
  onSubmit: (values: ProgressUpdateFormValues) => Promise<void>
}

export default function ProgressUpdateForm({ kpis, objectives, onSubmit }: ProgressUpdateFormProps) {
  const [overallNotes, setOverallNotes] = useState('')
  const [kpiValues, setKpiValues] = useState<Record<string, number>>(Object.fromEntries(kpis.map((k) => [k.id, k.currentValue])))
  const [objectiveStatuses, setObjectiveStatuses] = useState<Record<string, string>>(Object.fromEntries(objectives.map((o) => [o.id, o.currentStatus])))
  const [objectivePercentages, setObjectivePercentages] = useState<Record<string, number>>(Object.fromEntries(objectives.map((o) => [o.id, o.completionPercentage])))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit({
        overallNotes,
        kpiUpdates: kpis.map((k) => ({ kpiId: k.id, newValue: kpiValues[k.id] })),
        objectiveUpdates: objectives.map((o) => ({ objectiveId: o.id, statusUpdate: objectiveStatuses[o.id], completionPercentage: objectivePercentages[o.id] })),
      })
      setOverallNotes('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record progress')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        Notes
        <textarea value={overallNotes} onChange={(e) => setOverallNotes(e.target.value)} required />
      </label>
      {kpis.map((kpi) => (
        <label key={kpi.id}>
          {kpi.name} ({kpi.unit})
          <input type="number" value={kpiValues[kpi.id]} onChange={(e) => setKpiValues({ ...kpiValues, [kpi.id]: Number(e.target.value) })} />
        </label>
      ))}
      {objectives.map((objective) => (
        <div key={objective.id}>
          <span>{objective.description}</span>
          <input value={objectiveStatuses[objective.id]} onChange={(e) => setObjectiveStatuses({ ...objectiveStatuses, [objective.id]: e.target.value })} />
          <input type="number" min={0} max={100} value={objectivePercentages[objective.id]} onChange={(e) => setObjectivePercentages({ ...objectivePercentages, [objective.id]: Number(e.target.value) })} />
        </div>
      ))}
      <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Record progress'}</button>
    </form>
  )
}
```

- [ ] **Step 2: Detail page**

Create `web/src/features/action-plans/pages/ActionPlanDetailPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getActionPlan, updateActionPlan, recordProgress, type ActionPlanDetail } from '../api/actionPlans'
import ProgressUpdateForm, { type ProgressUpdateFormValues } from '../components/ProgressUpdateForm'

const STATUSES = ['not_started', 'in_progress', 'completed', 'overdue', 'cancelled']

export default function ActionPlanDetailPage() {
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [plan, setPlan] = useState<ActionPlanDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    if (!id) return
    setError(null)
    try {
      const result = await getActionPlan(baseUrl, id)
      setPlan(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load action plan')
    }
  }

  useEffect(() => {
    reload()
  }, [id])

  async function handleStatusChange(status: string) {
    if (!id) return
    await updateActionPlan(baseUrl, id, { status })
    await reload()
  }

  async function handleProgress(values: ProgressUpdateFormValues) {
    if (!id) return
    await recordProgress(baseUrl, id, values)
    await reload()
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!plan) {
    return <p>Loading…</p>
  }

  return (
    <div>
      <h1>{plan.title}</h1>
      <p>{plan.description}</p>
      <label>
        Status
        <select value={plan.status} onChange={(e) => handleStatusChange(e.target.value)}>
          {STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </label>

      <h2>KPIs</h2>
      <ul>
        {plan.kpis.map((kpi) => (
          <li key={kpi.id}>{kpi.name}: {kpi.currentValue} / {kpi.targetValue} {kpi.unit}</li>
        ))}
      </ul>

      <h2>Objectives</h2>
      <ul>
        {plan.objectives.map((objective) => (
          <li key={objective.id}>{objective.description} — {objective.currentStatus} ({objective.completionPercentage}%)</li>
        ))}
      </ul>

      <h2>Record progress</h2>
      <ProgressUpdateForm kpis={plan.kpis} objectives={plan.objectives} onSubmit={handleProgress} />
    </div>
  )
}
```

- [ ] **Step 3: Wire the route**

Modify `web/src/app/router.tsx` — add the import:

```tsx
import ActionPlanDetailPage from '../features/action-plans/pages/ActionPlanDetailPage'
```

Add the route as a sibling of `/action-plans`:

```tsx
              { path: '/action-plans/:id', element: <ActionPlanDetailPage /> },
```

- [ ] **Step 4: Verify manually**

Run `npm run build` and `npm test` (from `web/`).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/action-plans/components/ProgressUpdateForm.tsx \
        web/src/features/action-plans/pages/ActionPlanDetailPage.tsx \
        web/src/app/router.tsx
git commit -m "feat: add ActionPlanDetailPage with progress tracking"
```
