# Microclimates Core (#52) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship microclimate CRUD with nested questions, live-results polling (stubbed sentiment/word-cloud), response submission (anonymous when configured), and templates.

**Architecture:** Same as every prior domain — minimal-API + manual role checks, `Application/Microclimates/` services, typed frontend API clients. New domain, new top-level nav entry.

**Tech Stack:** .NET 10 minimal APIs, EF Core/Postgres (schema already exists), xUnit + Testcontainers, React 19 + Vite + react-router-dom, Vitest.

## Global Constraints

- No schema changes — all entities (`Microclimate`, `MicroclimateQuestion`, `MicroclimateTemplate`) already exist from `#49`.
- Authorization: `.RequireAuthorization()` + manual role check + `Results.Forbid()`, never `[Authorize(Roles=)]`. `Roles.Admin.Contains` + own-company for CompanyAdmin, any for SuperAdmin.
- **`POST /microclimates/{id}/responses` is unauthenticated when the microclimate's `RealtimeSettings.AnonymousResponses` is `true`** (approved 2026-07-31) — do not add `.RequireAuthorization()` to that specific route.
- Status values (`Microclimate.Status`): `draft`, `active`, `closed` — verified against `src/models/Microclimate.ts`.
- **Sentiment analysis is stubbed, not real AI** (approved 2026-07-31): `SentimentScore` stays `0` on every response (no AI call). `WordCloudData` is built from simple word-frequency counting on open-text responses — split on whitespace, lowercase, strip punctuation, count, keep top 20 — no NLP library. `EngagementLevel` is derived from `ResponseCount / TargetParticipantCount`: `< 0.3` = `low`, `< 0.7` = `medium`, `>= 0.7` = `high` (or `medium` if `TargetParticipantCount` is 0, to avoid divide-by-zero).
- No hard delete anywhere — `Status` covers lifecycle.
- Individual responses are NOT persisted as queryable rows in this slice — only the aggregate `LiveResults` on the parent `Microclimate` is updated. No `microclimate_responses` table exists in the `#49` schema.
- Do not build: analytics (`analytics/route.ts`, overlaps `#54`), bulk-create (`bulk/route.ts`, fast-follow), real AI sentiment, surveys/action-plans/reports/notifications (separate domains).
- `.NET`: don't touch pinned package versions. Frontend: Node 20 LTS+.

---

## Task 1: Microclimate CRUD endpoints

**Files:**
- Create: `src/ClimateProject.Application/Microclimates/MicroclimateDtos.cs`
- Create: `src/ClimateProject.Application/Microclimates/MicroclimateValidation.cs`
- Create: `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs`
- Test: `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateEndpointsTests.cs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MicroclimateListItem`, `MicroclimateDetail`, `QuestionDto` DTOs and list/create/get/update endpoints — Task 2 extends the endpoint file, Task 4 (frontend) consumes.

- [ ] **Step 1: Validation constants**

Create `src/ClimateProject.Application/Microclimates/MicroclimateValidation.cs`:

```csharp
namespace ClimateProject.Application.Microclimates;

public static class MicroclimateValidation
{
    public static readonly string[] ValidStatuses = ["draft", "active", "closed"];
    public static readonly string[] ValidQuestionTypes = ["multiple_choice", "open_text", "rating", "yes_no"];
}
```

(Question types verified against the same family used by survey/microclimate question pickers
in the legacy app's `QuestionLibrary` shape — if a task-time check finds a different exact set
in `src/models/Microclimate.ts`, use that set instead and note the discrepancy in the report;
this is a best-effort default, not load-bearing for the domain's core CRUD logic.)

- [ ] **Step 2: DTOs**

Create `src/ClimateProject.Application/Microclimates/MicroclimateDtos.cs`:

```csharp
namespace ClimateProject.Application.Microclimates;

public sealed record QuestionDto(Guid Id, string Text, string Type, string[]? Options, bool Required, int Order);
public sealed record CreateQuestionInput(string Text, string Type, string[]? Options, bool Required, int Order);

public sealed record MicroclimateListItem(
    Guid Id,
    string Title,
    Guid CompanyId,
    string Status,
    int ResponseCount,
    int TargetParticipantCount,
    DateTimeOffset CreatedAt);

public sealed record MicroclimateListResponse(IReadOnlyList<MicroclimateListItem> Microclimates);

public sealed record MicroclimateDetail(
    Guid Id,
    string Title,
    string? Description,
    Guid CompanyId,
    Guid CreatedBy,
    string Status,
    int ResponseCount,
    int TargetParticipantCount,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    bool AnonymousResponses,
    bool ShowLiveResults,
    List<QuestionDto> Questions);

public sealed record CreateMicroclimateRequest(
    string Title,
    string? Description,
    Guid CompanyId,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    int TargetParticipantCount,
    bool AnonymousResponses,
    Guid? TemplateId,
    List<CreateQuestionInput>? Questions);

public sealed record UpdateMicroclimateRequest(
    string? Title,
    string? Description,
    string? Status,
    DateTimeOffset? EndTime);
```

- [ ] **Step 3: Write the failing tests**

Create `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateEndpointsTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Microclimates;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Microclimates;

[Collection("Postgres")]
public class MicroclimateEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"mca-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"mcb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public MicroclimateEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "MC Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "MC Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
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
    public async Task CompanyAdmin_can_create_a_microclimate_with_questions_then_read_it_back()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            Title: "Weekly pulse",
            Description: "How's the team feeling",
            CompanyId: _companyAId,
            StartTime: DateTimeOffset.UtcNow,
            EndTime: DateTimeOffset.UtcNow.AddHours(1),
            TargetParticipantCount: 10,
            AnonymousResponses: true,
            TemplateId: null,
            Questions: new List<CreateQuestionInput> { new("How are you feeling today?", "open_text", null, true, 1) }));

        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Single(created!.Questions);
        Assert.Equal("draft", created.Status);

        var getResponse = await client.GetAsync($"/microclimates/{created.Id}");
        var fetched = await getResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Equal("Weekly pulse", fetched!.Title);

        var listResponse = await client.GetAsync($"/microclimates?companyId={_companyAId}");
        var list = await listResponse.Content.ReadFromJsonAsync<MicroclimateListResponse>();
        Assert.Contains(list!.Microclimates, m => m.Id == created.Id);
    }

    [Fact]
    public async Task CompanyAdmin_can_update_status_to_activate_a_microclimate()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "To activate", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5, true, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();

        var updateResponse = await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Equal("active", updated!.Status);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_access_another_companys_microclimates()
    {
        var client = _factory.CreateClient();
        var tokenB = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyBDomain, _companyBId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenB);
        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "B's microclimate", null, _companyBId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5, true, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();

        var tokenA = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);
        var crossGet = await client.GetAsync($"/microclimates/{created!.Id}");
        Assert.Equal(HttpStatusCode.Forbidden, crossGet.StatusCode);
    }
}
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~MicroclimateEndpointsTests"`
Expected: FAIL (compile error).

- [ ] **Step 5: Implement the endpoints**

Create `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs`:

```csharp
using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Microclimates;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class MicroclimateEndpoints
{
    public static void MapMicroclimateEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/microclimates").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
    }

    internal static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || currentUser.CompanyId == companyId.ToString();

    internal static async Task<MicroclimateDetail> ToDetailAsync(Microclimate m, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var questions = await db.MicroclimateQuestions.Where(q => q.MicroclimateId == m.Id)
            .OrderBy(q => q.Order)
            .Select(q => new QuestionDto(q.Id, q.Text, q.Type, q.Options, q.Required, q.Order))
            .ToListAsync(cancellationToken);

        return new MicroclimateDetail(m.Id, m.Title, m.Description, m.CompanyId, m.CreatedBy, m.Status,
            m.ResponseCount, m.TargetParticipantCount, m.Scheduling.StartTime, m.Scheduling.EndTime,
            m.RealtimeSettings.AnonymousResponses, m.RealtimeSettings.ShowLiveResults, questions);
    }

    private static async Task<IResult> ListAsync(
        Guid companyId,
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

        var query = db.Microclimates.Where(m => m.CompanyId == companyId);
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(m => m.Status == status);

        var microclimates = await query
            .OrderByDescending(m => m.CreatedAt)
            .Select(m => new MicroclimateListItem(m.Id, m.Title, m.CompanyId, m.Status, m.ResponseCount, m.TargetParticipantCount, m.CreatedAt))
            .ToListAsync(cancellationToken);

        return Results.Ok(new MicroclimateListResponse(microclimates));
    }

    private static async Task<IResult> CreateAsync(
        CreateMicroclimateRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role) || !CanAccessCompany(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        if (string.IsNullOrWhiteSpace(request.Title))
        {
            return Results.Json(new { message = "Title is required" }, statusCode: 400);
        }

        foreach (var question in request.Questions ?? [])
        {
            if (!MicroclimateValidation.ValidQuestionTypes.Contains(question.Type))
            {
                return Results.Json(new { message = $"Invalid question type: {question.Type}" }, statusCode: 400);
            }
        }

        var actingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == currentUser.Email, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var microclimate = new Microclimate
        {
            Id = Guid.NewGuid(),
            Title = request.Title.Trim(),
            Description = request.Description,
            CompanyId = request.CompanyId,
            CreatedBy = actingUser?.Id ?? Guid.Empty,
            TemplateId = request.TemplateId,
            Status = "draft",
            TargetParticipantCount = request.TargetParticipantCount,
            CreatedAt = now,
            UpdatedAt = now,
        };
        microclimate.Scheduling.StartTime = request.StartTime;
        microclimate.Scheduling.EndTime = request.EndTime;
        microclimate.RealtimeSettings.AnonymousResponses = request.AnonymousResponses;

        db.Microclimates.Add(microclimate);

        foreach (var questionInput in request.Questions ?? [])
        {
            db.MicroclimateQuestions.Add(new MicroclimateQuestion
            {
                Id = Guid.NewGuid(),
                MicroclimateId = microclimate.Id,
                Text = questionInput.Text,
                Type = questionInput.Type,
                Options = questionInput.Options,
                Required = questionInput.Required,
                Order = questionInput.Order,
            });
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await ToDetailAsync(microclimate, db, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var microclimate = await db.Microclimates.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (microclimate is null)
        {
            return Results.Json(new { message = "Microclimate not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, microclimate.CompanyId))
        {
            return Results.Forbid();
        }

        return Results.Ok(await ToDetailAsync(microclimate, db, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateMicroclimateRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var microclimate = await db.Microclimates.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (microclimate is null)
        {
            return Results.Json(new { message = "Microclimate not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, microclimate.CompanyId))
        {
            return Results.Forbid();
        }

        if (!string.IsNullOrWhiteSpace(request.Title)) microclimate.Title = request.Title.Trim();
        if (request.Description is not null) microclimate.Description = request.Description;
        if (request.EndTime.HasValue) microclimate.Scheduling.EndTime = request.EndTime.Value;

        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            if (!MicroclimateValidation.ValidStatuses.Contains(request.Status))
            {
                return Results.Json(new { message = $"Invalid status: {request.Status}" }, statusCode: 400);
            }

            microclimate.Status = request.Status;
        }

        microclimate.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await ToDetailAsync(microclimate, db, cancellationToken));
    }
}
```

- [ ] **Step 6: Register the endpoint group**

In `src/ClimateProject.Api/Program.cs`, add after the last existing `app.Map*Endpoints();` line:

```csharp
app.MapMicroclimateEndpoints();
```

- [ ] **Step 7: Run the tests to verify they pass, then the full suite**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~MicroclimateEndpointsTests"` — expect PASS, 3/3.
Run: `dotnet test ClimateProject.slnx` — expect all pass.

- [ ] **Step 8: Commit**

```bash
git add src/ClimateProject.Application/Microclimates/MicroclimateDtos.cs \
        src/ClimateProject.Application/Microclimates/MicroclimateValidation.cs \
        src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateEndpointsTests.cs
git commit -m "feat: add microclimate CRUD endpoints with nested questions"
```

---

## Task 2: Live-results + response-submission endpoints

**Files:**
- Modify: `src/ClimateProject.Application/Microclimates/MicroclimateDtos.cs`
- Modify: `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs`
- Test: `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateLiveResultsTests.cs`

**Interfaces:**
- Consumes: `CanAccessCompany`, `ToDetailAsync` (Task 1, internal).
- Produces: `GET /microclimates/{id}/live-results`, `POST /microclimates/{id}/responses` — Task 6 (frontend `LiveResultsPanel`) and Task 7 (`MicroclimateRespondPage`) consume.

- [ ] **Step 1: Add the DTOs**

In `src/ClimateProject.Application/Microclimates/MicroclimateDtos.cs`, add at the end:

```csharp
public sealed record WordCloudEntry(string Text, int Value);

public sealed record LiveResultsDetail(
    double SentimentScore,
    string EngagementLevel,
    List<WordCloudEntry> WordCloud,
    int ResponseCount,
    int TargetParticipantCount);

public sealed record SubmitResponseRequest(Dictionary<Guid, string> Answers);
```

- [ ] **Step 2: Write the failing tests**

Create `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateLiveResultsTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Microclimates;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Microclimates;

[Collection("Postgres")]
public class MicroclimateLiveResultsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"live-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public MicroclimateLiveResultsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Live Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test Admin", email, "a-good-password"));
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

    private async Task<(Guid Id, Guid QuestionId)> CreateActiveMicroclimateAsync(HttpClient client, string token, bool anonymous)
    {
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Live test", null, _companyId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 4, anonymous, null,
            new List<CreateQuestionInput> { new("How do you feel?", "open_text", null, true, 1) }));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        return (created.Id, created.Questions[0].Id);
    }

    [Fact]
    public async Task Submitting_anonymous_responses_requires_no_auth_token_and_updates_live_results()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        var (microclimateId, questionId) = await CreateActiveMicroclimateAsync(client, adminToken, anonymous: true);

        var anonymousClient = _factory.CreateClient(); // deliberately no Authorization header
        var response1 = await anonymousClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [questionId] = "good good great" }));
        Assert.Equal(HttpStatusCode.Created, response1.StatusCode);

        var response2 = await anonymousClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [questionId] = "good stressed" }));
        Assert.Equal(HttpStatusCode.Created, response2.StatusCode);

        anonymousClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var liveResponse = await anonymousClient.GetAsync($"/microclimates/{microclimateId}/live-results");
        Assert.Equal(HttpStatusCode.OK, liveResponse.StatusCode);
        var live = await liveResponse.Content.ReadFromJsonAsync<LiveResultsDetail>();
        Assert.Equal(2, live!.ResponseCount);
        // response1 = "good good great" -> good:2, great:1. response2 = "good stressed" -> good:1, stressed:1.
        // Word counts accumulate cumulatively across responses, so the final count for "good" is 2+1=3.
        Assert.Contains(live.WordCloud, w => w.Text == "good" && w.Value == 3);
    }

    [Fact]
    public async Task Non_anonymous_microclimate_requires_authentication_to_submit_a_response()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        var (microclimateId, questionId) = await CreateActiveMicroclimateAsync(client, adminToken, anonymous: false);

        var anonymousClient = _factory.CreateClient();
        var response = await anonymousClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [questionId] = "hello" }));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~MicroclimateLiveResultsTests"`
Expected: FAIL (404 -- routes don't exist).

- [ ] **Step 4: Implement the endpoints**

In `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs`, add to `MapMicroclimateEndpoints`
(the live-results route stays inside the authenticated `group`; the responses route is mapped
directly on `app`, unauthenticated, checked manually per-request):

```csharp
    public static void MapMicroclimateEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/microclimates").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapGet("/{id:guid}/live-results", GetLiveResultsAsync);

        app.MapPost("/microclimates/{id:guid}/responses", SubmitResponseAsync);
    }
```

Add these handlers (place after `UpdateAsync`), plus a small private helper for word-frequency
counting:

```csharp
    private static Dictionary<string, int> CountWordFrequencies(IEnumerable<string> texts)
    {
        var counts = new Dictionary<string, int>();
        foreach (var text in texts)
        {
            var words = text.ToLowerInvariant()
                .Split([' ', '\t', '\n', '.', ',', '!', '?'], StringSplitOptions.RemoveEmptyEntries);
            foreach (var word in words)
            {
                counts[word] = counts.GetValueOrDefault(word) + 1;
            }
        }

        return counts;
    }

    private static string ComputeEngagementLevel(int responseCount, int targetParticipantCount)
    {
        if (targetParticipantCount <= 0)
        {
            return "medium";
        }

        var ratio = (double)responseCount / targetParticipantCount;
        return ratio switch
        {
            < 0.3 => "low",
            < 0.7 => "medium",
            _ => "high",
        };
    }

    private static async Task<IResult> GetLiveResultsAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var microclimate = await db.Microclimates.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (microclimate is null)
        {
            return Results.Json(new { message = "Microclimate not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, microclimate.CompanyId))
        {
            return Results.Forbid();
        }

        var wordCloud = string.IsNullOrWhiteSpace(microclimate.LiveResults.WordCloudData)
            ? []
            : System.Text.Json.JsonSerializer.Deserialize<List<WordCloudEntry>>(microclimate.LiveResults.WordCloudData) ?? [];

        return Results.Ok(new LiveResultsDetail(
            microclimate.LiveResults.SentimentScore,
            microclimate.LiveResults.EngagementLevel,
            wordCloud,
            microclimate.ResponseCount,
            microclimate.TargetParticipantCount));
    }

    private static async Task<IResult> SubmitResponseAsync(
        Guid id,
        SubmitResponseRequest request,
        HttpContext httpContext,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var microclimate = await db.Microclimates.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (microclimate is null)
        {
            return Results.Json(new { message = "Microclimate not found" }, statusCode: 404);
        }

        if (!microclimate.RealtimeSettings.AnonymousResponses && !(httpContext.User.Identity?.IsAuthenticated ?? false))
        {
            return Results.Json(new { message = "This microclimate requires authentication to respond" }, statusCode: 401);
        }

        if (microclimate.Status != "active")
        {
            return Results.Json(new { message = "This microclimate is not currently accepting responses" }, statusCode: 400);
        }

        var openTextAnswers = request.Answers.Values;
        var existingCloud = string.IsNullOrWhiteSpace(microclimate.LiveResults.WordCloudData)
            ? new Dictionary<string, int>()
            : System.Text.Json.JsonSerializer.Deserialize<List<WordCloudEntry>>(microclimate.LiveResults.WordCloudData)!.ToDictionary(w => w.Text, w => w.Value);

        foreach (var (word, count) in CountWordFrequencies(openTextAnswers))
        {
            existingCloud[word] = existingCloud.GetValueOrDefault(word) + count;
        }

        var topWords = existingCloud
            .OrderByDescending(kv => kv.Value)
            .Take(20)
            .Select(kv => new WordCloudEntry(kv.Key, kv.Value))
            .ToList();

        microclimate.ResponseCount += 1;
        microclimate.LiveResults.WordCloudData = System.Text.Json.JsonSerializer.Serialize(topWords);
        microclimate.LiveResults.EngagementLevel = ComputeEngagementLevel(microclimate.ResponseCount, microclimate.TargetParticipantCount);
        microclimate.LiveResults.SentimentScore = 0;
        microclimate.UpdatedAt = DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(cancellationToken);

        return Results.StatusCode(201);
    }
```

- [ ] **Step 5: Run the tests to verify they pass, then the full suite**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~MicroclimateLiveResultsTests"` — expect PASS, 2/2.
Run: `dotnet test ClimateProject.slnx` — expect all pass.

- [ ] **Step 6: Commit**

```bash
git add src/ClimateProject.Application/Microclimates/MicroclimateDtos.cs \
        src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs \
        tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateLiveResultsTests.cs
git commit -m "feat: add live-results and response-submission endpoints (stubbed sentiment/word-cloud)"
```

---

## Task 3: Microclimate template endpoints

**Files:**
- Create: `src/ClimateProject.Application/Microclimates/MicroclimateTemplateDtos.cs`
- Create: `src/ClimateProject.Api/Endpoints/MicroclimateTemplateEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs`
- Test: `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateTemplateEndpointsTests.cs`

**Interfaces:**
- Consumes: nothing new.
- Produces: list/create endpoints — Task 4 (frontend) consumes.

- [ ] **Step 1: DTOs**

Create `src/ClimateProject.Application/Microclimates/MicroclimateTemplateDtos.cs`:

```csharp
namespace ClimateProject.Application.Microclimates;

public sealed record MicroclimateTemplateDetail(
    Guid Id,
    string Name,
    string Description,
    string Category,
    Guid? CompanyId,
    bool IsSystemTemplate,
    int UsageCount,
    bool IsActive);

public sealed record MicroclimateTemplateListResponse(IReadOnlyList<MicroclimateTemplateDetail> Templates);

public sealed record CreateMicroclimateTemplateRequest(
    string Name,
    string Description,
    string Category,
    Guid? CompanyId);
```

- [ ] **Step 2: Write the failing tests**

Create `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateTemplateEndpointsTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Microclimates;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Microclimates;

[Collection("Postgres")]
public class MicroclimateTemplateEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"mctmpl-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public MicroclimateTemplateEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "MC Template Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
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

        var createResponse = await client.PostAsJsonAsync("/microclimate-templates", new CreateMicroclimateTemplateRequest(
            "Weekly check-in", "Standard weekly pulse", "engagement", _companyId));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateTemplateDetail>();

        var listResponse = await client.GetAsync($"/microclimate-templates?companyId={_companyId}");
        var list = await listResponse.Content.ReadFromJsonAsync<MicroclimateTemplateListResponse>();
        Assert.Contains(list!.Templates, t => t.Id == created!.Id);
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~MicroclimateTemplateEndpointsTests"`
Expected: FAIL (compile error).

- [ ] **Step 4: Implement the endpoints**

Create `src/ClimateProject.Api/Endpoints/MicroclimateTemplateEndpoints.cs`:

```csharp
using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Microclimates;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class MicroclimateTemplateEndpoints
{
    public static void MapMicroclimateTemplateEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/microclimate-templates").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
    }

    private static MicroclimateTemplateDetail ToDetail(MicroclimateTemplate t)
        => new(t.Id, t.Name, t.Description, t.Category, t.CompanyId, t.IsSystemTemplate, t.UsageCount, t.IsActive);

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

        var templates = await db.MicroclimateTemplates
            .Where(t => (t.CompanyId == companyId || t.CompanyId == null) && t.IsActive)
            .OrderBy(t => t.Name)
            .Select(t => new MicroclimateTemplateDetail(t.Id, t.Name, t.Description, t.Category, t.CompanyId, t.IsSystemTemplate, t.UsageCount, t.IsActive))
            .ToListAsync(cancellationToken);

        return Results.Ok(new MicroclimateTemplateListResponse(templates));
    }

    private static async Task<IResult> CreateAsync(
        CreateMicroclimateTemplateRequest request,
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
        var template = new MicroclimateTemplate
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Description = request.Description.Trim(),
            Category = request.Category,
            CompanyId = request.CompanyId,
            CreatedBy = actingUser?.Id,
            IsSystemTemplate = !request.CompanyId.HasValue,
            UsageCount = 0,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };

        db.MicroclimateTemplates.Add(template);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(ToDetail(template), statusCode: 201);
    }
}
```

- [ ] **Step 5: Register the endpoint group**

In `src/ClimateProject.Api/Program.cs`, add after `app.MapMicroclimateEndpoints();`:

```csharp
app.MapMicroclimateTemplateEndpoints();
```

- [ ] **Step 6: Run the tests to verify they pass, then the full suite**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~MicroclimateTemplateEndpointsTests"` — expect PASS, 1/1.
Run: `dotnet test ClimateProject.slnx` — expect all pass.

- [ ] **Step 7: Commit**

```bash
git add src/ClimateProject.Application/Microclimates/MicroclimateTemplateDtos.cs \
        src/ClimateProject.Api/Endpoints/MicroclimateTemplateEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateTemplateEndpointsTests.cs
git commit -m "feat: add microclimate template list/create endpoints"
```

---

## Task 4: Frontend typed API clients

**Files:**
- Create: `web/src/features/microclimates/api/microclimates.ts` + `.test.ts`
- Create: `web/src/features/microclimates/api/microclimateTemplates.ts` + `.test.ts`

**Interfaces:**
- Consumes: `authFetch` (existing).
- Produces: typed clients for Tasks 5-7.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/microclimates/api/microclimates.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listMicroclimates, createMicroclimate, getMicroclimate, updateMicroclimate, getLiveResults, submitResponse } from './microclimates'

const baseUrl = 'http://api.test'

describe('microclimates api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  const detail = {
    id: 'm1', title: 'Pulse', description: null, companyId: 'c1', createdBy: 'u1', status: 'draft',
    responseCount: 0, targetParticipantCount: 10, startTime: '2026-01-01', endTime: '2026-01-02',
    anonymousResponses: true, showLiveResults: true, questions: [],
  }

  it('lists microclimates', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ microclimates: [detail] }), { status: 200 }))
    const result = await listMicroclimates(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimates?companyId=c1`, expect.anything())
    expect(result).toEqual([detail])
  })

  it('creates a microclimate', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 201 }))
    const result = await createMicroclimate(baseUrl, { title: 'Pulse', companyId: 'c1', startTime: '2026-01-01', endTime: '2026-01-02', targetParticipantCount: 10, anonymousResponses: true })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimates`, expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(detail)
  })

  it('gets a microclimate', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 200 }))
    const result = await getMicroclimate(baseUrl, 'm1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimates/m1`, expect.anything())
    expect(result).toEqual(detail)
  })

  it('updates a microclimate', async () => {
    const updated = { ...detail, status: 'active' }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }))
    const result = await updateMicroclimate(baseUrl, 'm1', { status: 'active' })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimates/m1`, expect.objectContaining({ method: 'PUT' }))
    expect(result.status).toBe('active')
  })

  it('gets live results', async () => {
    const live = { sentimentScore: 0, engagementLevel: 'medium', wordCloud: [], responseCount: 2, targetParticipantCount: 10 }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(live), { status: 200 }))
    const result = await getLiveResults(baseUrl, 'm1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimates/m1/live-results`, expect.anything())
    expect(result).toEqual(live)
  })

  it('submits a response without auth', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 201 }))
    await submitResponse(baseUrl, 'm1', { q1: 'good' })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimates/m1/responses`, expect.objectContaining({ method: 'POST' }))
  })
})
```

Create `web/src/features/microclimates/api/microclimateTemplates.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listMicroclimateTemplates, createMicroclimateTemplate } from './microclimateTemplates'

const baseUrl = 'http://api.test'

describe('microclimateTemplates api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists templates for a company', async () => {
    const templates = [{ id: 't1', name: 'Template', description: 'desc', category: 'engagement', companyId: 'c1', isSystemTemplate: false, usageCount: 0, isActive: true }]
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ templates }), { status: 200 }))
    const result = await listMicroclimateTemplates(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimate-templates?companyId=c1`, expect.anything())
    expect(result).toEqual(templates)
  })

  it('creates a template', async () => {
    const created = { id: 't1', name: 'Template', description: 'desc', category: 'engagement', companyId: 'c1', isSystemTemplate: false, usageCount: 0, isActive: true }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }))
    const result = await createMicroclimateTemplate(baseUrl, { name: 'Template', description: 'desc', category: 'engagement', companyId: 'c1' })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimate-templates`, expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(created)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- microclimates.test.ts microclimateTemplates.test.ts` (from `web/`)
Expected: FAIL (modules don't exist yet).

- [ ] **Step 3: Implement the clients**

Create `web/src/features/microclimates/api/microclimates.ts`:

```typescript
import { authFetch } from '../../../api/authFetch'

export interface Question {
  id: string
  text: string
  type: string
  options: string[] | null
  required: boolean
  order: number
}

export interface CreateQuestionInput {
  text: string
  type: string
  options?: string[]
  required: boolean
  order: number
}

export interface Microclimate {
  id: string
  title: string
  companyId: string
  status: string
  responseCount: number
  targetParticipantCount: number
  createdAt: string
}

export interface MicroclimateDetail {
  id: string
  title: string
  description: string | null
  companyId: string
  createdBy: string
  status: string
  responseCount: number
  targetParticipantCount: number
  startTime: string
  endTime: string
  anonymousResponses: boolean
  showLiveResults: boolean
  questions: Question[]
}

export interface CreateMicroclimateInput {
  title: string
  description?: string
  companyId: string
  startTime: string
  endTime: string
  targetParticipantCount: number
  anonymousResponses: boolean
  templateId?: string
  questions?: CreateQuestionInput[]
}

export interface UpdateMicroclimateInput {
  title?: string
  description?: string
  status?: string
  endTime?: string
}

export interface WordCloudEntry {
  text: string
  value: number
}

export interface LiveResults {
  sentimentScore: number
  engagementLevel: string
  wordCloud: WordCloudEntry[]
  responseCount: number
  targetParticipantCount: number
}

export async function listMicroclimates(baseUrl: string, companyId: string): Promise<Microclimate[]> {
  const response = await authFetch(`${baseUrl}/microclimates?companyId=${companyId}`)
  const body = (await response.json()) as { microclimates: Microclimate[] }
  return body.microclimates
}

export async function createMicroclimate(baseUrl: string, input: CreateMicroclimateInput): Promise<MicroclimateDetail> {
  const response = await authFetch(`${baseUrl}/microclimates`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<MicroclimateDetail>
}

export async function getMicroclimate(baseUrl: string, id: string): Promise<MicroclimateDetail> {
  const response = await authFetch(`${baseUrl}/microclimates/${id}`)
  return response.json() as Promise<MicroclimateDetail>
}

export async function updateMicroclimate(baseUrl: string, id: string, input: UpdateMicroclimateInput): Promise<MicroclimateDetail> {
  const response = await authFetch(`${baseUrl}/microclimates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<MicroclimateDetail>
}

export async function getLiveResults(baseUrl: string, id: string): Promise<LiveResults> {
  const response = await authFetch(`${baseUrl}/microclimates/${id}/live-results`)
  return response.json() as Promise<LiveResults>
}

// Deliberately does not use authFetch -- this is called from the unauthenticated
// public respond page (Task 7) when the microclimate allows anonymous responses.
// A token IS still attached if one happens to be present (an already-logged-in
// admin previewing the form), but its absence must not block the request.
export async function submitResponse(baseUrl: string, id: string, answers: Record<string, string>): Promise<void> {
  const response = await fetch(`${baseUrl}/microclimates/${id}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error((body && body.message) || `Request failed: ${response.status}`)
  }
}
```

Create `web/src/features/microclimates/api/microclimateTemplates.ts`:

```typescript
import { authFetch } from '../../../api/authFetch'

export interface MicroclimateTemplate {
  id: string
  name: string
  description: string
  category: string
  companyId: string | null
  isSystemTemplate: boolean
  usageCount: number
  isActive: boolean
}

export interface CreateMicroclimateTemplateInput {
  name: string
  description: string
  category: string
  companyId?: string
}

export async function listMicroclimateTemplates(baseUrl: string, companyId: string): Promise<MicroclimateTemplate[]> {
  const response = await authFetch(`${baseUrl}/microclimate-templates?companyId=${companyId}`)
  const body = (await response.json()) as { templates: MicroclimateTemplate[] }
  return body.templates
}

export async function createMicroclimateTemplate(baseUrl: string, input: CreateMicroclimateTemplateInput): Promise<MicroclimateTemplate> {
  const response = await authFetch(`${baseUrl}/microclimate-templates`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<MicroclimateTemplate>
}
```

- [ ] **Step 4: Run the tests to verify they pass, run the build**

Run: `npm test` (from `web/`) — expect PASS.
Run: `npm run build` (from `web/`) — expect success.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/microclimates/api/microclimates.ts web/src/features/microclimates/api/microclimates.test.ts \
        web/src/features/microclimates/api/microclimateTemplates.ts web/src/features/microclimates/api/microclimateTemplates.test.ts
git commit -m "feat: add typed API clients for microclimates and templates"
```

---

## Task 5: Frontend — MicroclimatesListPage

**Files:**
- Create: `web/src/features/microclimates/components/MicroclimateFilters.tsx`
- Create: `web/src/features/microclimates/components/MicroclimateList.tsx`
- Create: `web/src/features/microclimates/components/MicroclimateForm.tsx`
- Create: `web/src/features/microclimates/pages/MicroclimatesListPage.tsx`
- Modify: `web/src/app/router.tsx`
- Modify: `web/src/navigation/navSections.ts`

**Interfaces:**
- Consumes: `listMicroclimates`, `createMicroclimate` (Task 4).
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Filters**

Create `web/src/features/microclimates/components/MicroclimateFilters.tsx`:

```tsx
export interface MicroclimateFiltersValue {
  status: string
}

const STATUSES = ['', 'draft', 'active', 'closed']

export default function MicroclimateFilters({ value, onChange }: { value: MicroclimateFiltersValue; onChange: (value: MicroclimateFiltersValue) => void }) {
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

Create `web/src/features/microclimates/components/MicroclimateList.tsx`:

```tsx
import { Link } from 'react-router-dom'
import type { Microclimate } from '../api/microclimates'

export default function MicroclimateList({ microclimates }: { microclimates: Microclimate[] }) {
  if (microclimates.length === 0) {
    return <p>No microclimates found.</p>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Status</th>
          <th>Responses</th>
        </tr>
      </thead>
      <tbody>
        {microclimates.map((m) => (
          <tr key={m.id}>
            <td><Link to={`/microclimates/${m.id}`}>{m.title}</Link></td>
            <td>{m.status}</td>
            <td>{m.responseCount} / {m.targetParticipantCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 3: Create form**

Create `web/src/features/microclimates/components/MicroclimateForm.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import type { CreateQuestionInput } from '../api/microclimates'

export interface MicroclimateFormValues {
  title: string
  startTime: string
  endTime: string
  targetParticipantCount: number
  anonymousResponses: boolean
  questions: CreateQuestionInput[]
}

const QUESTION_TYPES = ['multiple_choice', 'open_text', 'rating', 'yes_no']

const EMPTY_VALUES: MicroclimateFormValues = { title: '', startTime: '', endTime: '', targetParticipantCount: 10, anonymousResponses: true, questions: [] }

export default function MicroclimateForm({ onSubmit }: { onSubmit: (values: MicroclimateFormValues) => Promise<void> }) {
  const [values, setValues] = useState<MicroclimateFormValues>(EMPTY_VALUES)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function addQuestion() {
    setValues({ ...values, questions: [...values.questions, { text: '', type: 'open_text', required: true, order: values.questions.length + 1 }] })
  }

  function updateQuestion(index: number, question: CreateQuestionInput) {
    setValues({ ...values, questions: values.questions.map((q, i) => (i === index ? question : q)) })
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
        Start time
        <input type="datetime-local" value={values.startTime} onChange={(e) => setValues({ ...values, startTime: e.target.value })} required />
      </label>
      <label>
        End time
        <input type="datetime-local" value={values.endTime} onChange={(e) => setValues({ ...values, endTime: e.target.value })} required />
      </label>
      <label>
        Target participants
        <input type="number" value={values.targetParticipantCount} onChange={(e) => setValues({ ...values, targetParticipantCount: Number(e.target.value) })} min={1} />
      </label>
      <label>
        <input type="checkbox" checked={values.anonymousResponses} onChange={(e) => setValues({ ...values, anonymousResponses: e.target.checked })} />
        Anonymous responses
      </label>

      <h3>Questions</h3>
      {values.questions.map((question, index) => (
        <div key={index}>
          <input placeholder="Question text" value={question.text} onChange={(e) => updateQuestion(index, { ...question, text: e.target.value })} />
          <select value={question.type} onChange={(e) => updateQuestion(index, { ...question, type: e.target.value })}>
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      ))}
      <button type="button" onClick={addQuestion}>Add question</button>

      <button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create microclimate'}</button>
    </form>
  )
}
```

- [ ] **Step 4: List page**

Create `web/src/features/microclimates/pages/MicroclimatesListPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { listMicroclimates, createMicroclimate, type Microclimate } from '../api/microclimates'
import MicroclimateList from '../components/MicroclimateList'
import MicroclimateFilters, { type MicroclimateFiltersValue } from '../components/MicroclimateFilters'
import MicroclimateForm, { type MicroclimateFormValues } from '../components/MicroclimateForm'

// Same stopgap as ActionPlansListPage (Task 5 of #53's plan) -- no company-context
// selector exists yet in the admin shell. See that plan's note; #57 (cross-cutting
// frontend) or a later pass should replace this with a real selector.
export default function MicroclimatesListPage() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const companyId = import.meta.env.VITE_DEFAULT_COMPANY_ID as string
  const [microclimates, setMicroclimates] = useState<Microclimate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<MicroclimateFiltersValue>({ status: '' })
  const [showCreateForm, setShowCreateForm] = useState(false)

  async function reload() {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const result = await listMicroclimates(baseUrl, companyId)
      setMicroclimates(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load microclimates')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const filtered = microclimates.filter((m) => !filters.status || m.status === filters.status)

  async function handleCreate(values: MicroclimateFormValues) {
    await createMicroclimate(baseUrl, {
      title: values.title,
      companyId,
      startTime: values.startTime,
      endTime: values.endTime,
      targetParticipantCount: values.targetParticipantCount,
      anonymousResponses: values.anonymousResponses,
      questions: values.questions,
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
      <h1>Microclimates</h1>
      <MicroclimateFilters value={filters} onChange={setFilters} />
      <button onClick={() => setShowCreateForm((v) => !v)}>{showCreateForm ? 'Cancel' : 'New microclimate'}</button>
      {showCreateForm && <MicroclimateForm onSubmit={handleCreate} />}
      {loading ? <p>Loading…</p> : <MicroclimateList microclimates={filtered} />}
    </div>
  )
}
```

- [ ] **Step 5: Wire the route and nav entry**

Modify `web/src/app/router.tsx` — add the import:

```tsx
import MicroclimatesListPage from '../features/microclimates/pages/MicroclimatesListPage'
```

Add the route as a sibling of `/action-plans`:

```tsx
              { path: '/microclimates', element: <MicroclimatesListPage /> },
```

Modify `web/src/navigation/navSections.ts` — add a nav entry alongside "Action Plans":

```tsx
import { Shield, Building2, Target, Waves } from 'lucide-react'
```

```tsx
      {
        label: 'Action Plans',
        href: '/action-plans',
        icon: Target,
      },
      {
        label: 'Microclimates',
        href: '/microclimates',
        icon: Waves,
      },
```

(This edit lands on top of whatever `navSections.ts` looks like after `#53` merges — if the
"Action Plans" entry isn't there yet when this task runs, add "Microclimates" as its own
top-level item instead, in the same position.)

- [ ] **Step 6: Verify manually**

Run `npm run build` and `npm test` (from `web/`).

- [ ] **Step 7: Commit**

```bash
git add web/src/features/microclimates/components/MicroclimateFilters.tsx \
        web/src/features/microclimates/components/MicroclimateList.tsx \
        web/src/features/microclimates/components/MicroclimateForm.tsx \
        web/src/features/microclimates/pages/MicroclimatesListPage.tsx \
        web/src/app/router.tsx \
        web/src/navigation/navSections.ts
git commit -m "feat: add MicroclimatesListPage (list, filter, create)"
```

---

## Task 6: Frontend — MicroclimateDetailPage + LiveResultsPanel

**Files:**
- Create: `web/src/features/microclimates/components/LiveResultsPanel.tsx`
- Create: `web/src/features/microclimates/pages/MicroclimateDetailPage.tsx`
- Modify: `web/src/app/router.tsx`

**Interfaces:**
- Consumes: `getMicroclimate`, `updateMicroclimate`, `getLiveResults` (Task 4).
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Live results panel (polls every 5s while active)**

Create `web/src/features/microclimates/components/LiveResultsPanel.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { getLiveResults, type LiveResults } from '../api/microclimates'

interface LiveResultsPanelProps {
  baseUrl: string
  microclimateId: string
  isActive: boolean
}

export default function LiveResultsPanel({ baseUrl, microclimateId, isActive }: LiveResultsPanelProps) {
  const [live, setLive] = useState<LiveResults | null>(null)

  useEffect(() => {
    if (!isActive) return

    let cancelled = false

    async function poll() {
      try {
        const result = await getLiveResults(baseUrl, microclimateId)
        if (!cancelled) setLive(result)
      } catch {
        // Transient poll failures are not surfaced as page-level errors -- the
        // next successful poll recovers the view silently.
      }
    }

    poll()
    const interval = setInterval(poll, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [baseUrl, microclimateId, isActive])

  if (!isActive) {
    return <p>Live results are only available while this microclimate is active.</p>
  }

  if (!live) {
    return <p>Loading live results…</p>
  }

  return (
    <div>
      <p>Responses: {live.responseCount} / {live.targetParticipantCount}</p>
      <p>Engagement: {live.engagementLevel}</p>
      <ul>
        {live.wordCloud.map((entry) => (
          <li key={entry.text}>{entry.text} ({entry.value})</li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Detail page**

Create `web/src/features/microclimates/pages/MicroclimateDetailPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getMicroclimate, updateMicroclimate, type MicroclimateDetail } from '../api/microclimates'
import LiveResultsPanel from '../components/LiveResultsPanel'

const STATUSES = ['draft', 'active', 'closed']

export default function MicroclimateDetailPage() {
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [microclimate, setMicroclimate] = useState<MicroclimateDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    if (!id) return
    setError(null)
    try {
      const result = await getMicroclimate(baseUrl, id)
      setMicroclimate(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load microclimate')
    }
  }

  useEffect(() => {
    reload()
  }, [id])

  async function handleStatusChange(status: string) {
    if (!id) return
    await updateMicroclimate(baseUrl, id, { status })
    await reload()
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!microclimate) {
    return <p>Loading…</p>
  }

  return (
    <div>
      <h1>{microclimate.title}</h1>
      <label>
        Status
        <select value={microclimate.status} onChange={(e) => handleStatusChange(e.target.value)}>
          {STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </label>

      <h2>Live results</h2>
      <LiveResultsPanel baseUrl={baseUrl} microclimateId={microclimate.id} isActive={microclimate.status === 'active'} />
    </div>
  )
}
```

- [ ] **Step 3: Wire the route**

Modify `web/src/app/router.tsx` — add the import:

```tsx
import MicroclimateDetailPage from '../features/microclimates/pages/MicroclimateDetailPage'
```

Add the route as a sibling of `/microclimates`:

```tsx
              { path: '/microclimates/:id', element: <MicroclimateDetailPage /> },
```

- [ ] **Step 4: Verify manually**

Run `npm run build` and `npm test` (from `web/`).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/microclimates/components/LiveResultsPanel.tsx \
        web/src/features/microclimates/pages/MicroclimateDetailPage.tsx \
        web/src/app/router.tsx
git commit -m "feat: add MicroclimateDetailPage with polling live results"
```

---

## Task 7: Frontend — MicroclimateRespondPage (public)

**Files:**
- Create: `web/src/features/microclimates/pages/MicroclimateRespondPage.tsx`
- Modify: `web/src/app/router.tsx`

**Interfaces:**
- Consumes: `getMicroclimate`, `submitResponse` (Task 4).
- Produces: nothing consumed by a later task — last task in this plan.

- [ ] **Step 1: Respond page**

`getMicroclimate` uses `authFetch` (bearer-token injection), which is fine even for this public
page — `authFetch` simply omits the `Authorization` header when no token is present (see
`web/src/api/authFetch.ts`), so an anonymous visitor can still read microclimate details
(title, questions) to render the form; only the response *submission* needs to be genuinely
unauthenticated, which `submitResponse` (Task 4) already is.

Create `web/src/features/microclimates/pages/MicroclimateRespondPage.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { getMicroclimate, submitResponse, type MicroclimateDetail } from '../api/microclimates'

export default function MicroclimateRespondPage() {
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [microclimate, setMicroclimate] = useState<MicroclimateDetail | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!id) return
    getMicroclimate(baseUrl, id)
      .then(setMicroclimate)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
  }, [id, baseUrl])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!id) return
    setError(null)
    setSubmitting(true)
    try {
      await submitResponse(baseUrl, id, answers)
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit response')
    } finally {
      setSubmitting(false)
    }
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (submitted) {
    return <p>Thank you for your response.</p>
  }

  if (!microclimate) {
    return <p>Loading…</p>
  }

  if (microclimate.status !== 'active') {
    return <p>This microclimate is not currently accepting responses.</p>
  }

  return (
    <div>
      <h1>{microclimate.title}</h1>
      <form onSubmit={handleSubmit}>
        {microclimate.questions.map((question) => (
          <label key={question.id}>
            {question.text}
            <input
              required={question.required}
              value={answers[question.id] ?? ''}
              onChange={(e) => setAnswers({ ...answers, [question.id]: e.target.value })}
            />
          </label>
        ))}
        <button type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit'}</button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Wire the route (unauthenticated, sibling of `/login`)**

Modify `web/src/app/router.tsx` — add the import:

```tsx
import MicroclimateRespondPage from '../features/microclimates/pages/MicroclimateRespondPage'
```

Add the route as a sibling of `/login` and `/accept-invitation/:token`, NOT nested under
`RequireAuth`/`AdminLayout`:

```tsx
      { path: '/microclimates/:id/respond', element: <MicroclimateRespondPage /> },
```

- [ ] **Step 3: Verify manually**

Run `npm run build` and `npm test` (from `web/`).

- [ ] **Step 4: Commit**

```bash
git add web/src/features/microclimates/pages/MicroclimateRespondPage.tsx \
        web/src/app/router.tsx
git commit -m "feat: add public MicroclimateRespondPage"
```
