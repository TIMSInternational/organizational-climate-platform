# Notifications Domain (#55) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship notification templates (admin CRUD) and notifications (admin dispatch +
self-service read), with a stubbed delivery sender.

**Architecture:** Minimal-API + manual role checks, `Application/Notifications/` DTOs,
typed frontend API clients, two new pages (admin template management, user's own inbox).

**Tech Stack:** .NET 10 minimal APIs, EF Core/Postgres (schema already exists, no
migration needed), xUnit + Testcontainers, React 19 + Vite + react-router-dom, Vitest.

## Global Constraints

- No schema changes — `Notification`, `NotificationTemplate`,
  `NotificationTemplateVariable`, `NotificationPersonalizationRule` already exist from
  `#49`.
- Authorization: `.RequireAuthorization()` + manual role check + `Results.Forbid()`,
  never `[Authorize(Roles=)]`. Templates: `Roles.Admin.Contains` + own-company for
  `CompanyAdmin` (or `CompanyId == null` for global templates, `SuperAdmin` only may
  create/edit those), any for `SuperAdmin`. Notifications: same `CanAccessCompany`
  pattern for the admin list/create endpoints; the self-service endpoints
  (`/notifications/mine`, mark-read) only require authentication — no company-admin
  check, they're scoped to the caller's own `UserId` by construction.
- No hard delete anywhere — `NotificationTemplate.IsActive` covers lifecycle. Template
  child rows (variables/rules) are fully replaced on update (delete existing, insert the
  new list) — not incrementally diffed.
- `Notification.Status` values: `pending`, `sent`, `delivered`, `failed` — this plan only
  ever produces `sent` (via the stub sender, synchronously at creation) or `failed` (if
  the stub sender throws, which it never does — included for completeness/future use).
- Do not build: a background delivery worker, real email/SMS/push sending, personalization
  rule evaluation (store `Condition`/`Modifications` as opaque strings, don't interpret
  them).
- `.NET`: don't touch pinned package versions. Frontend: Node 20 LTS+.

---

## Task 1: Notification template CRUD endpoints

**Files:**
- Create: `src/ClimateProject.Application/Notifications/NotificationTemplateDtos.cs`
- Create: `src/ClimateProject.Api/Endpoints/NotificationTemplateEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs`
- Test: `tests/ClimateProject.IntegrationTests/Notifications/NotificationTemplateEndpointsTests.cs`

**Interfaces:**
- Produces: `NotificationTemplateDetail`, `NotificationTemplateListItem`,
  `NotificationTemplateVariableDto`, `NotificationPersonalizationRuleDto`,
  `CreateNotificationTemplateRequest`, `UpdateNotificationTemplateRequest` records.

- [ ] **Step 1: Write the DTOs**

```csharp
// src/ClimateProject.Application/Notifications/NotificationTemplateDtos.cs
namespace ClimateProject.Application.Notifications;

public sealed record NotificationTemplateVariableDto(string Name, string Type, bool Required, string Description, string? DefaultValue);

public sealed record NotificationPersonalizationRuleDto(string Condition, string? Modifications);

public sealed record NotificationTemplateListItem(
    Guid Id, string Name, string Type, string Channel, Guid? CompanyId, bool IsActive, bool IsDefault);

public sealed record NotificationTemplateDetail(
    Guid Id,
    string Name,
    string Type,
    string Channel,
    string? Subject,
    string Title,
    string Content,
    string? HtmlContent,
    Guid? CompanyId,
    bool IsActive,
    bool IsDefault,
    Guid CreatedBy,
    IReadOnlyList<NotificationTemplateVariableDto> Variables,
    IReadOnlyList<NotificationPersonalizationRuleDto> Rules);

public sealed record CreateNotificationTemplateRequest(
    string Name,
    string Type,
    string Channel,
    string? Subject,
    string Title,
    string Content,
    string? HtmlContent,
    Guid? CompanyId,
    bool IsDefault,
    IReadOnlyList<NotificationTemplateVariableDto>? Variables,
    IReadOnlyList<NotificationPersonalizationRuleDto>? Rules);

public sealed record UpdateNotificationTemplateRequest(
    string? Name,
    string? Subject,
    string? Title,
    string? Content,
    string? HtmlContent,
    bool? IsActive,
    IReadOnlyList<NotificationTemplateVariableDto>? Variables,
    IReadOnlyList<NotificationPersonalizationRuleDto>? Rules);
```

- [ ] **Step 2: Write the endpoints**

```csharp
// src/ClimateProject.Api/Endpoints/NotificationTemplateEndpoints.cs
using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class NotificationTemplateEndpoints
{
    public static void MapNotificationTemplateEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/notification-templates").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
    }

    private static bool CanAccessTemplate(CurrentUser currentUser, Guid? templateCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin)
        {
            return true;
        }

        if (templateCompanyId is null)
        {
            // Global (company-agnostic) templates: viewable by any admin, only
            // SuperAdmin may create/edit them (enforced separately in Create/Update).
            return currentUser.Role == Roles.CompanyAdmin;
        }

        return currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == templateCompanyId.Value.ToString();
    }

    private static async Task<IResult> ListAsync(
        Guid? companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role))
        {
            return Results.Forbid();
        }

        var query = db.NotificationTemplates.AsQueryable();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            var ownCompanyId = Guid.Parse(currentUser.CompanyId);
            query = query.Where(t => t.CompanyId == null || t.CompanyId == ownCompanyId);
        }
        else if (companyId.HasValue)
        {
            query = query.Where(t => t.CompanyId == companyId.Value);
        }

        var templates = await query
            .OrderBy(t => t.Name)
            .Select(t => new NotificationTemplateListItem(t.Id, t.Name, t.Type, t.Channel, t.CompanyId, t.IsActive, t.IsDefault))
            .ToListAsync(cancellationToken);

        return Results.Ok(templates);
    }

    private static async Task<IResult> CreateAsync(
        CreateNotificationTemplateRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role))
        {
            return Results.Forbid();
        }

        if (request.CompanyId is null && currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        if (request.CompanyId.HasValue && currentUser.Role == Roles.CompanyAdmin
            && currentUser.CompanyId != request.CompanyId.Value.ToString())
        {
            return Results.Forbid();
        }

        var name = request.Name?.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            return Results.Json(new { message = "Name is required" }, statusCode: 400);
        }

        var currentUserGuid = Guid.TryParse(currentUser.Sub, out var parsedSub)
            ? parsedSub
            : (await db.Users.FirstOrDefaultAsync(u => u.PersonaExternalId == currentUser.Sub, cancellationToken))?.Id
              ?? Guid.Empty;

        var template = new NotificationTemplate
        {
            Id = Guid.NewGuid(),
            Name = name,
            Type = request.Type,
            Channel = request.Channel,
            Subject = request.Subject,
            Title = request.Title,
            Content = request.Content,
            HtmlContent = request.HtmlContent,
            CompanyId = request.CompanyId,
            IsActive = true,
            IsDefault = request.IsDefault,
            CreatedBy = currentUserGuid,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.NotificationTemplates.Add(template);
        await db.SaveChangesAsync(cancellationToken);

        foreach (var v in request.Variables ?? [])
        {
            db.NotificationTemplateVariables.Add(new NotificationTemplateVariable
            {
                Id = Guid.NewGuid(),
                NotificationTemplateId = template.Id,
                Name = v.Name,
                Type = v.Type,
                Required = v.Required,
                Description = v.Description,
                DefaultValue = v.DefaultValue,
            });
        }
        foreach (var r in request.Rules ?? [])
        {
            db.NotificationPersonalizationRules.Add(new NotificationPersonalizationRule
            {
                Id = Guid.NewGuid(),
                NotificationTemplateId = template.Id,
                Condition = r.Condition,
                Modifications = r.Modifications,
            });
        }
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, template.Id, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var template = await db.NotificationTemplates.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (template is null)
        {
            return Results.Json(new { message = "Template not found" }, statusCode: 404);
        }

        if (!CanAccessTemplate(currentUser, template.CompanyId))
        {
            return Results.Forbid();
        }

        return Results.Ok(await LoadDetailAsync(db, id, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateNotificationTemplateRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var template = await db.NotificationTemplates.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (template is null)
        {
            return Results.Json(new { message = "Template not found" }, statusCode: 404);
        }

        if (!CanAccessTemplate(currentUser, template.CompanyId))
        {
            return Results.Forbid();
        }

        if (!string.IsNullOrWhiteSpace(request.Name))
        {
            template.Name = request.Name.Trim();
        }
        if (request.Subject is not null)
        {
            template.Subject = request.Subject;
        }
        if (!string.IsNullOrWhiteSpace(request.Title))
        {
            template.Title = request.Title;
        }
        if (!string.IsNullOrWhiteSpace(request.Content))
        {
            template.Content = request.Content;
        }
        if (request.HtmlContent is not null)
        {
            template.HtmlContent = request.HtmlContent;
        }
        if (request.IsActive.HasValue)
        {
            template.IsActive = request.IsActive.Value;
        }
        template.UpdatedAt = DateTimeOffset.UtcNow;

        if (request.Variables is not null)
        {
            var existingVariables = await db.NotificationTemplateVariables.Where(v => v.NotificationTemplateId == id).ToListAsync(cancellationToken);
            db.NotificationTemplateVariables.RemoveRange(existingVariables);
            foreach (var v in request.Variables)
            {
                db.NotificationTemplateVariables.Add(new NotificationTemplateVariable
                {
                    Id = Guid.NewGuid(),
                    NotificationTemplateId = id,
                    Name = v.Name,
                    Type = v.Type,
                    Required = v.Required,
                    Description = v.Description,
                    DefaultValue = v.DefaultValue,
                });
            }
        }
        if (request.Rules is not null)
        {
            var existingRules = await db.NotificationPersonalizationRules.Where(r => r.NotificationTemplateId == id).ToListAsync(cancellationToken);
            db.NotificationPersonalizationRules.RemoveRange(existingRules);
            foreach (var r in request.Rules)
            {
                db.NotificationPersonalizationRules.Add(new NotificationPersonalizationRule
                {
                    Id = Guid.NewGuid(),
                    NotificationTemplateId = id,
                    Condition = r.Condition,
                    Modifications = r.Modifications,
                });
            }
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(await LoadDetailAsync(db, id, cancellationToken));
    }

    private static async Task<NotificationTemplateDetail> LoadDetailAsync(ClimateProjectDbContext db, Guid id, CancellationToken cancellationToken)
    {
        var template = await db.NotificationTemplates.FirstAsync(t => t.Id == id, cancellationToken);
        var variables = await db.NotificationTemplateVariables
            .Where(v => v.NotificationTemplateId == id)
            .Select(v => new NotificationTemplateVariableDto(v.Name, v.Type, v.Required, v.Description, v.DefaultValue))
            .ToListAsync(cancellationToken);
        var rules = await db.NotificationPersonalizationRules
            .Where(r => r.NotificationTemplateId == id)
            .Select(r => new NotificationPersonalizationRuleDto(r.Condition, r.Modifications))
            .ToListAsync(cancellationToken);

        return new NotificationTemplateDetail(
            template.Id, template.Name, template.Type, template.Channel, template.Subject,
            template.Title, template.Content, template.HtmlContent, template.CompanyId,
            template.IsActive, template.IsDefault, template.CreatedBy, variables, rules);
    }
}
```

- [ ] **Step 3: Register in `Program.cs`**

Add after `app.MapActionPlanTemplateEndpoints();`:

```csharp
app.MapNotificationTemplateEndpoints();
```

- [ ] **Step 4: Write the integration tests**

```csharp
// tests/ClimateProject.IntegrationTests/Notifications/NotificationTemplateEndpointsTests.cs
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Notifications;

[Collection("Postgres")]
public class NotificationTemplateEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"nta-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"ntb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public NotificationTemplateEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "Notif Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Notif Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
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
    public async Task CompanyAdmin_can_create_and_list_templates_for_their_own_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/notification-templates", new CreateNotificationTemplateRequest(
            Name: "Welcome", Type: "welcome", Channel: "email", Subject: "Welcome!", Title: "Welcome",
            Content: "Hi {{name}}", HtmlContent: null, CompanyId: _companyAId, IsDefault: false,
            Variables: [new NotificationTemplateVariableDto("name", "string", true, "User's name", null)],
            Rules: null));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<NotificationTemplateDetail>();
        Assert.Single(created!.Variables);

        var listResponse = await client.GetAsync("/notification-templates");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        var list = await listResponse.Content.ReadFromJsonAsync<List<NotificationTemplateListItem>>();
        Assert.Contains(list!, t => t.Id == created.Id);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_create_a_template_for_another_company_or_a_global_one()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var crossCompany = await client.PostAsJsonAsync("/notification-templates", new CreateNotificationTemplateRequest(
            "X", "t", "email", null, "T", "C", null, _companyBId, false, null, null));
        Assert.Equal(HttpStatusCode.Forbidden, crossCompany.StatusCode);

        var global = await client.PostAsJsonAsync("/notification-templates", new CreateNotificationTemplateRequest(
            "X", "t", "email", null, "T", "C", null, null, false, null, null));
        Assert.Equal(HttpStatusCode.Forbidden, global.StatusCode);
    }

    [Fact]
    public async Task Update_replaces_the_variable_list_and_toggles_IsActive()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/notification-templates", new CreateNotificationTemplateRequest(
            "Global", "t", "email", null, "T", "C", null, null, false,
            Variables: [new NotificationTemplateVariableDto("a", "string", true, "d", null)], Rules: null));
        var created = await createResponse.Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        var updateResponse = await client.PutAsJsonAsync($"/notification-templates/{created!.Id}", new UpdateNotificationTemplateRequest(
            Name: null, Subject: null, Title: null, Content: null, HtmlContent: null, IsActive: false,
            Variables: [new NotificationTemplateVariableDto("b", "string", false, "d2", null)], Rules: null));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        Assert.False(updated!.IsActive);
        Assert.Single(updated.Variables);
        Assert.Equal("b", updated.Variables[0].Name);
    }
}
```

- [ ] **Step 5: Run the tests**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter FullyQualifiedName~NotificationTemplateEndpointsTests`
Expected: all 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/ClimateProject.Application/Notifications/NotificationTemplateDtos.cs src/ClimateProject.Api/Endpoints/NotificationTemplateEndpoints.cs src/ClimateProject.Api/Program.cs tests/ClimateProject.IntegrationTests/Notifications/NotificationTemplateEndpointsTests.cs
git commit -m "feat: add notification template CRUD endpoints"
```

---

## Task 2: Notification dispatch + self-service endpoints + stub sender

**Files:**
- Create: `src/ClimateProject.Application/Notifications/INotificationSender.cs`
- Create: `src/ClimateProject.Infrastructure/Notifications/LoggingNotificationSender.cs`
- Create: `src/ClimateProject.Application/Notifications/NotificationDtos.cs`
- Create: `src/ClimateProject.Api/Endpoints/NotificationEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs`
- Test: `tests/ClimateProject.IntegrationTests/Notifications/NotificationEndpointsTests.cs`

**Interfaces:**
- Consumes: nothing new from Task 1 (templates are optional/`TemplateId` is nullable).
- Produces: `NotificationDetail`, `CreateNotificationRequest` — consumed by Task 3's
  frontend client.

- [ ] **Step 1: Write the sender interface + stub**

```csharp
// src/ClimateProject.Application/Notifications/INotificationSender.cs
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Notifications;

public interface INotificationSender
{
    Task SendAsync(Notification notification, CancellationToken cancellationToken);
}
```

```csharp
// src/ClimateProject.Infrastructure/Notifications/LoggingNotificationSender.cs
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Notifications;

public class LoggingNotificationSender(ILogger<LoggingNotificationSender> logger) : INotificationSender
{
    public Task SendAsync(Notification notification, CancellationToken cancellationToken)
    {
        logger.LogInformation(
            "Notification stubbed -- would send to user {UserId} via {Channel}: {Title}",
            notification.UserId, notification.Channel, notification.Title);
        return Task.CompletedTask;
    }
}
```

- [ ] **Step 2: Write the DTOs**

```csharp
// src/ClimateProject.Application/Notifications/NotificationDtos.cs
namespace ClimateProject.Application.Notifications;

public sealed record NotificationDetail(
    Guid Id,
    Guid UserId,
    Guid CompanyId,
    string Type,
    string Channel,
    string Priority,
    string Status,
    string Title,
    string Message,
    Guid? TemplateId,
    DateTimeOffset ScheduledFor,
    DateTimeOffset? SentAt,
    DateTimeOffset? OpenedAt,
    DateTimeOffset CreatedAt);

public sealed record CreateNotificationRequest(
    Guid UserId,
    Guid CompanyId,
    string Type,
    string Channel,
    string Priority,
    string Title,
    string Message,
    Guid? TemplateId,
    DateTimeOffset? ScheduledFor);
```

- [ ] **Step 3: Write the endpoints**

```csharp
// src/ClimateProject.Api/Endpoints/NotificationEndpoints.cs
using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class NotificationEndpoints
{
    public static void MapNotificationEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/notifications").RequireAuthorization();

        group.MapGet("", ListForCompanyAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/mine", ListMineAsync);
        group.MapPost("/{id:guid}/read", MarkReadAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static async Task<Guid> ResolveCurrentUserIdAsync(CurrentUser currentUser, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        if (Guid.TryParse(currentUser.Sub, out var userId))
        {
            var byId = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
            if (byId is not null)
            {
                return byId.Id;
            }
        }

        var byExternalId = await db.Users.FirstOrDefaultAsync(u => u.PersonaExternalId == currentUser.Sub, cancellationToken);
        return byExternalId?.Id ?? Guid.Empty;
    }

    private static async Task<IResult> ListForCompanyAsync(
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

        var notifications = await db.Notifications
            .Where(n => n.CompanyId == companyId)
            .OrderByDescending(n => n.CreatedAt)
            .Select(n => ToDetail(n))
            .ToListAsync(cancellationToken);

        return Results.Ok(notifications);
    }

    private static async Task<IResult> CreateAsync(
        CreateNotificationRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        INotificationSender sender,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        var recipient = await db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId && u.CompanyId == request.CompanyId, cancellationToken);
        if (recipient is null)
        {
            return Results.Json(new { message = "Recipient not found in this company" }, statusCode: 400);
        }

        var notification = new Notification
        {
            Id = Guid.NewGuid(),
            UserId = request.UserId,
            CompanyId = request.CompanyId,
            Type = request.Type,
            Channel = request.Channel,
            Priority = string.IsNullOrWhiteSpace(request.Priority) ? "medium" : request.Priority,
            Status = "pending",
            Title = request.Title,
            Message = request.Message,
            TemplateId = request.TemplateId,
            ScheduledFor = request.ScheduledFor ?? DateTimeOffset.UtcNow,
            RetryCount = 0,
            MaxRetries = 3,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Notifications.Add(notification);
        await db.SaveChangesAsync(cancellationToken);

        await sender.SendAsync(notification, cancellationToken);
        notification.Status = "sent";
        notification.SentAt = DateTimeOffset.UtcNow;
        notification.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(ToDetail(notification), statusCode: 201);
    }

    private static async Task<IResult> ListMineAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var userId = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);

        var notifications = await db.Notifications
            .Where(n => n.UserId == userId)
            .OrderByDescending(n => n.CreatedAt)
            .Select(n => ToDetail(n))
            .ToListAsync(cancellationToken);

        return Results.Ok(notifications);
    }

    private static async Task<IResult> MarkReadAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var userId = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);

        var notification = await db.Notifications.FirstOrDefaultAsync(n => n.Id == id, cancellationToken);
        if (notification is null)
        {
            return Results.Json(new { message = "Notification not found" }, statusCode: 404);
        }

        if (notification.UserId != userId)
        {
            return Results.Forbid();
        }

        notification.OpenedAt ??= DateTimeOffset.UtcNow;
        notification.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(notification));
    }

    private static NotificationDetail ToDetail(Notification n) => new(
        n.Id, n.UserId, n.CompanyId, n.Type, n.Channel, n.Priority, n.Status, n.Title, n.Message,
        n.TemplateId, n.ScheduledFor, n.SentAt, n.OpenedAt, n.CreatedAt);
}
```

- [ ] **Step 4: Register the sender and the endpoints in `Program.cs`**

Add after `builder.Services.AddScoped<IInvitationEmailSender, LoggingInvitationEmailSender>();`:

```csharp
builder.Services.AddScoped<INotificationSender, LoggingNotificationSender>();
```

Add after `app.MapNotificationTemplateEndpoints();`:

```csharp
app.MapNotificationEndpoints();
```

- [ ] **Step 5: Write the integration tests**

```csharp
// tests/ClimateProject.IntegrationTests/Notifications/NotificationEndpointsTests.cs
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Notifications;

[Collection("Postgres")]
public class NotificationEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"notif-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public NotificationEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Notif Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(string token, Guid userId)> SignUpAndGetTokenAsync(HttpClient client, string role)
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
        token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        return (token, user.Id);
    }

    [Fact]
    public async Task CompanyAdmin_can_create_a_notification_and_it_is_immediately_sent()
    {
        var client = _factory.CreateClient();
        var (adminToken, _) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var employeeClient = _factory.CreateClient();
        var (_, employeeUserId) = await SignUpAndGetTokenAsync(employeeClient, Roles.Employee);

        var response = await client.PostAsJsonAsync("/notifications", new CreateNotificationRequest(
            employeeUserId, _companyId, "reminder", "in_app", "medium", "Survey due", "Please complete your survey", null, null));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<NotificationDetail>();
        Assert.Equal("sent", created!.Status);
        Assert.NotNull(created.SentAt);
    }

    [Fact]
    public async Task User_can_list_and_mark_read_only_their_own_notifications()
    {
        var adminClient = _factory.CreateClient();
        var (adminToken, _) = await SignUpAndGetTokenAsync(adminClient, Roles.CompanyAdmin);
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var userAClient = _factory.CreateClient();
        var (userAToken, userAId) = await SignUpAndGetTokenAsync(userAClient, Roles.Employee);
        userAClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", userAToken);

        var userBClient = _factory.CreateClient();
        var (userBToken, userBId) = await SignUpAndGetTokenAsync(userBClient, Roles.Employee);
        userBClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", userBToken);

        var createForA = await adminClient.PostAsJsonAsync("/notifications", new CreateNotificationRequest(
            userAId, _companyId, "reminder", "in_app", "medium", "For A", "Message for A", null, null));
        var notificationForA = await createForA.Content.ReadFromJsonAsync<NotificationDetail>();

        var mineForB = await userBClient.GetAsync("/notifications/mine");
        var listForB = await mineForB.Content.ReadFromJsonAsync<List<NotificationDetail>>();
        Assert.DoesNotContain(listForB!, n => n.Id == notificationForA!.Id);

        var forbiddenMarkRead = await userBClient.PostAsync($"/notifications/{notificationForA!.Id}/read", null);
        Assert.Equal(HttpStatusCode.Forbidden, forbiddenMarkRead.StatusCode);

        var mineForA = await userAClient.GetAsync("/notifications/mine");
        var listForA = await mineForA.Content.ReadFromJsonAsync<List<NotificationDetail>>();
        Assert.Contains(listForA!, n => n.Id == notificationForA.Id);

        var markRead = await userAClient.PostAsync($"/notifications/{notificationForA.Id}/read", null);
        Assert.Equal(HttpStatusCode.OK, markRead.StatusCode);
        var marked = await markRead.Content.ReadFromJsonAsync<NotificationDetail>();
        Assert.NotNull(marked!.OpenedAt);
    }
}
```

- [ ] **Step 6: Run the tests**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter FullyQualifiedName~NotificationEndpointsTests`
Expected: both tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/ClimateProject.Application/Notifications/INotificationSender.cs src/ClimateProject.Infrastructure/Notifications/LoggingNotificationSender.cs src/ClimateProject.Application/Notifications/NotificationDtos.cs src/ClimateProject.Api/Endpoints/NotificationEndpoints.cs src/ClimateProject.Api/Program.cs tests/ClimateProject.IntegrationTests/Notifications/NotificationEndpointsTests.cs
git commit -m "feat: add notification dispatch, self-service read endpoints, and stub sender"
```

---

## Task 3: Frontend typed API clients

**Files:**
- Create: `web/src/features/notifications/api/notificationTemplates.ts`
- Create: `web/src/features/notifications/api/notificationTemplates.test.ts`
- Create: `web/src/features/notifications/api/notifications.ts`
- Create: `web/src/features/notifications/api/notifications.test.ts`

**Interfaces:**
- Consumes: `authFetch` from `../../../api/authFetch`.
- Produces: typed client functions consumed by Task 4's pages.

- [ ] **Step 1: Write the template client**

```typescript
// web/src/features/notifications/api/notificationTemplates.ts
import { authFetch } from '../../../api/authFetch'

export interface NotificationTemplateVariable {
  name: string
  type: string
  required: boolean
  description: string
  defaultValue: string | null
}

export interface NotificationPersonalizationRule {
  condition: string
  modifications: string | null
}

export interface NotificationTemplateListItem {
  id: string
  name: string
  type: string
  channel: string
  companyId: string | null
  isActive: boolean
  isDefault: boolean
}

export interface NotificationTemplateDetail {
  id: string
  name: string
  type: string
  channel: string
  subject: string | null
  title: string
  content: string
  htmlContent: string | null
  companyId: string | null
  isActive: boolean
  isDefault: boolean
  createdBy: string
  variables: NotificationTemplateVariable[]
  rules: NotificationPersonalizationRule[]
}

export interface CreateNotificationTemplateInput {
  name: string
  type: string
  channel: string
  subject: string | null
  title: string
  content: string
  htmlContent: string | null
  companyId: string | null
  isDefault: boolean
  variables: NotificationTemplateVariable[] | null
  rules: NotificationPersonalizationRule[] | null
}

export interface UpdateNotificationTemplateInput {
  name?: string
  subject?: string | null
  title?: string
  content?: string
  htmlContent?: string | null
  isActive?: boolean
  variables?: NotificationTemplateVariable[]
  rules?: NotificationPersonalizationRule[]
}

export async function listNotificationTemplates(baseUrl: string): Promise<NotificationTemplateListItem[]> {
  const response = await authFetch(`${baseUrl}/notification-templates`)
  return response.json() as Promise<NotificationTemplateListItem[]>
}

export async function createNotificationTemplate(baseUrl: string, input: CreateNotificationTemplateInput): Promise<NotificationTemplateDetail> {
  const response = await authFetch(`${baseUrl}/notification-templates`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<NotificationTemplateDetail>
}

export async function updateNotificationTemplate(baseUrl: string, id: string, input: UpdateNotificationTemplateInput): Promise<NotificationTemplateDetail> {
  const response = await authFetch(`${baseUrl}/notification-templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<NotificationTemplateDetail>
}
```

- [ ] **Step 2: Write the template client tests**

```typescript
// web/src/features/notifications/api/notificationTemplates.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listNotificationTemplates, createNotificationTemplate, updateNotificationTemplate } from './notificationTemplates'

const baseUrl = 'http://api.test'

describe('notificationTemplates api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists templates', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    await listNotificationTemplates(baseUrl)
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/notification-templates`, expect.anything())
  })

  it('creates a template', async () => {
    const result = { id: 't1', name: 'Welcome', type: 'welcome', channel: 'email', subject: null, title: 'T', content: 'C', htmlContent: null, companyId: null, isActive: true, isDefault: false, createdBy: 'u1', variables: [], rules: [] }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 201 }))

    const response = await createNotificationTemplate(baseUrl, {
      name: 'Welcome', type: 'welcome', channel: 'email', subject: null, title: 'T', content: 'C',
      htmlContent: null, companyId: null, isDefault: false, variables: null, rules: null,
    })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/notification-templates`, expect.objectContaining({ method: 'POST' }))
    expect(response.name).toBe('Welcome')
  })

  it('updates a template', async () => {
    const result = { id: 't1', name: 'Welcome', type: 'welcome', channel: 'email', subject: null, title: 'T', content: 'C', htmlContent: null, companyId: null, isActive: false, isDefault: false, createdBy: 'u1', variables: [], rules: [] }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }))

    const response = await updateNotificationTemplate(baseUrl, 't1', { isActive: false })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/notification-templates/t1`, expect.objectContaining({ method: 'PUT' }))
    expect(response.isActive).toBe(false)
  })
})
```

- [ ] **Step 3: Write the notification client**

```typescript
// web/src/features/notifications/api/notifications.ts
import { authFetch } from '../../../api/authFetch'

export interface NotificationDetail {
  id: string
  userId: string
  companyId: string
  type: string
  channel: string
  priority: string
  status: string
  title: string
  message: string
  templateId: string | null
  scheduledFor: string
  sentAt: string | null
  openedAt: string | null
  createdAt: string
}

export interface CreateNotificationInput {
  userId: string
  companyId: string
  type: string
  channel: string
  priority: string
  title: string
  message: string
  templateId: string | null
  scheduledFor: string | null
}

export async function listNotificationsForCompany(baseUrl: string, companyId: string): Promise<NotificationDetail[]> {
  const response = await authFetch(`${baseUrl}/notifications?companyId=${companyId}`)
  return response.json() as Promise<NotificationDetail[]>
}

export async function createNotification(baseUrl: string, input: CreateNotificationInput): Promise<NotificationDetail> {
  const response = await authFetch(`${baseUrl}/notifications`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<NotificationDetail>
}

export async function listMyNotifications(baseUrl: string): Promise<NotificationDetail[]> {
  const response = await authFetch(`${baseUrl}/notifications/mine`)
  return response.json() as Promise<NotificationDetail[]>
}

export async function markNotificationRead(baseUrl: string, id: string): Promise<NotificationDetail> {
  const response = await authFetch(`${baseUrl}/notifications/${id}/read`, { method: 'POST' })
  return response.json() as Promise<NotificationDetail>
}
```

- [ ] **Step 4: Write the notification client tests**

```typescript
// web/src/features/notifications/api/notifications.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listNotificationsForCompany, createNotification, listMyNotifications, markNotificationRead } from './notifications'

const baseUrl = 'http://api.test'

const sample = {
  id: 'n1', userId: 'u1', companyId: 'c1', type: 'reminder', channel: 'in_app', priority: 'medium',
  status: 'sent', title: 'T', message: 'M', templateId: null, scheduledFor: '2026-08-01T00:00:00Z',
  sentAt: '2026-08-01T00:00:00Z', openedAt: null, createdAt: '2026-08-01T00:00:00Z',
}

describe('notifications api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists notifications for a company', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([sample]), { status: 200 }))
    const response = await listNotificationsForCompany(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/notifications?companyId=c1`, expect.anything())
    expect(response).toHaveLength(1)
  })

  it('creates a notification', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(sample), { status: 201 }))
    await createNotification(baseUrl, {
      userId: 'u1', companyId: 'c1', type: 'reminder', channel: 'in_app', priority: 'medium',
      title: 'T', message: 'M', templateId: null, scheduledFor: null,
    })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/notifications`, expect.objectContaining({ method: 'POST' }))
  })

  it('lists my notifications', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([sample]), { status: 200 }))
    const response = await listMyNotifications(baseUrl)
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/notifications/mine`, expect.anything())
    expect(response).toHaveLength(1)
  })

  it('marks a notification read', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...sample, openedAt: '2026-08-01T01:00:00Z' }), { status: 200 }))
    const response = await markNotificationRead(baseUrl, 'n1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/notifications/n1/read`, expect.objectContaining({ method: 'POST' }))
    expect(response.openedAt).not.toBeNull()
  })
})
```

- [ ] **Step 5: Run the tests**

Run: `cd web && npm test -- --run notifications`
Expected: 7 tests pass (3 template client + 4 notification client).

- [ ] **Step 6: Commit**

```bash
git add web/src/features/notifications/api
git commit -m "feat: add typed frontend API clients for notifications"
```

---

## Task 4: Frontend — NotificationsInboxPage + admin nav entry

**Files:**
- Create: `web/src/features/notifications/pages/NotificationsInboxPage.tsx`
- Modify: `web/src/app/router.tsx`
- Modify: `web/src/navigation/navSections.ts`
- Test: `web/src/navigation/navSections.test.ts` (extend existing)

**Interfaces:**
- Consumes: `listMyNotifications`, `markNotificationRead` from Task 3.

- [ ] **Step 1: Write the inbox page**

```tsx
// web/src/features/notifications/pages/NotificationsInboxPage.tsx
import { useEffect, useState } from 'react'
import { listMyNotifications, markNotificationRead, type NotificationDetail } from '../api/notifications'

const baseUrl = import.meta.env.VITE_API_BASE_URL as string

export default function NotificationsInboxPage() {
  const [notifications, setNotifications] = useState<NotificationDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = () => {
    setLoading(true)
    listMyNotifications(baseUrl)
      .then(setNotifications)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
  }, [])

  const handleMarkRead = async (id: string) => {
    await markNotificationRead(baseUrl, id)
    reload()
  }

  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">{error}</p>

  return (
    <div>
      <h1>Notifications</h1>
      <ul>
        {notifications.map((n) => (
          <li key={n.id} style={{ fontWeight: n.openedAt ? 'normal' : 'bold' }}>
            <strong>{n.title}</strong>: {n.message}
            {!n.openedAt && (
              <button onClick={() => handleMarkRead(n.id)}>Mark read</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

In `web/src/app/router.tsx`, add the import after the existing `ActionPlanDetailPage`
import:

```tsx
import NotificationsInboxPage from '../features/notifications/pages/NotificationsInboxPage'
```

Add the route as a sibling of the other `AdminLayout` children, after
`/action-plans/:id`:

```tsx
              { path: '/notifications', element: <NotificationsInboxPage /> },
```

- [ ] **Step 3: Add the nav entry for every role**

`buildNavSections` currently returns an empty array for any role other than
`super_admin`/`company_admin` — notifications must be visible to every authenticated
role (self-service inbox, not admin-gated), so this requires adding a fallback branch,
not just appending to the existing two. Replace the full function body in
`web/src/navigation/navSections.ts`:

```tsx
import { Shield, Building2, Settings, Users, Tags, Target, Bell } from 'lucide-react'
```

```tsx
export function buildNavSections(role: string | undefined, companyId: string | undefined): NavSection[] {
  const notificationsItem: NavItem = { label: 'Notifications', href: '/notifications', icon: Bell }

  if (role === 'super_admin') {
    return [
      {
        title: '',
        items: [
          {
            label: 'System Administration',
            href: '/admin/companies',
            icon: Shield,
            sub: [
              { label: 'Companies', href: '/admin/companies', icon: Building2 },
              { label: 'System settings', href: '/admin/system-settings', icon: Settings },
            ],
          },
          notificationsItem,
        ],
      },
    ]
  }

  if (role === 'company_admin' && companyId) {
    return [
      {
        title: '',
        items: [
          {
            label: 'Company Administration',
            href: `/admin/companies/${companyId}`,
            icon: Shield,
            sub: [
              { label: 'Company settings', href: `/admin/companies/${companyId}`, icon: Building2 },
              { label: 'Users', href: `/admin/companies/${companyId}/users`, icon: Users },
              { label: 'Demographic fields', href: `/admin/companies/${companyId}/demographic-fields`, icon: Tags },
            ],
          },
          {
            label: 'Action Plans',
            href: '/action-plans',
            icon: Target,
          },
          notificationsItem,
        ],
      },
    ]
  }

  return [
    {
      title: '',
      items: [notificationsItem],
    },
  ]
}
```

- [ ] **Step 4: Fix the two now-incorrect tests and add coverage for the new nav item**

Two existing tests in `web/src/navigation/navSections.test.ts` assert `toEqual([])` for
cases that now return a notifications-only section — both must be updated, not just
added to. Replace:

```ts
  it('returns no nav for a company_admin with no companyId claim', () => {
    expect(buildNavSections('company_admin', undefined)).toEqual([])
  })

  it.each(['employee', 'supervisor', 'leader', undefined])('returns no nav for %s (no admin page exists for this role yet)', (role) => {
    expect(buildNavSections(role, 'company-1')).toEqual([])
  })
```

with:

```ts
  it('gives a company_admin with no companyId claim only the Notifications link', () => {
    expect(hrefs(buildNavSections('company_admin', undefined))).toEqual(['/notifications'])
  })

  it.each(['employee', 'supervisor', 'leader', undefined])('gives %s only the Notifications link (no admin page exists for this role yet)', (role) => {
    expect(hrefs(buildNavSections(role, 'company-1'))).toEqual(['/notifications'])
  })

  it('gives a super_admin a Notifications link alongside System Administration', () => {
    expect(hrefs(buildNavSections('super_admin', 'company-1'))).toContain('/notifications')
  })

  it('gives a company_admin a Notifications link alongside their other links', () => {
    expect(hrefs(buildNavSections('company_admin', 'company-1'))).toContain('/notifications')
  })
```

- [ ] **Step 5: Run the tests and build**

Run: `cd web && npm test -- --run && npm run build`
Expected: all tests pass, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/notifications/pages/NotificationsInboxPage.tsx web/src/app/router.tsx web/src/navigation/navSections.ts web/src/navigation/navSections.test.ts
git commit -m "feat: add NotificationsInboxPage and nav entry"
```
