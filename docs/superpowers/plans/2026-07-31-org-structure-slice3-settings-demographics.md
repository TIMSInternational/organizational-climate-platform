# Org structure Slice 3: Settings + Demographics + Bulk Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship system settings (platform-wide singleton), company settings/branding, demographic field management, and CSV bulk user import, closing out `#50`.

**Architecture:** Same as Slices 1-2 — minimal-API endpoints with manual role checks, `Application/OrgStructure/` services, typed frontend API clients, focused React components.

**Tech Stack:** .NET 10 minimal APIs, EF Core/Postgres, xUnit + Testcontainers, React 19 + Vite + react-router-dom, Vitest.

## Global Constraints

- This plan assumes Slice 2 is already merged to `main` (identity-mapping columns, User/Invitation endpoints, `AuthEndpoints.cs` claim change, router/nav additions all exist). Base this branch off `main` after that merge, not before.
- Schema changes: one new entity, `SystemSettings` (does not exist yet despite being spec'd in `#49` — never actually built). No other schema changes.
- Authorization: `.RequireAuthorization()` + manual role check + `Results.Forbid()`, never `[Authorize(Roles=)]`.
- **Company settings/branding is `Roles.Admin.Contains` (SuperAdmin or own-company CompanyAdmin) — deliberately broader than Slice 1's company-*profile* endpoint, which stays SuperAdmin-only.** Verified against legacy's actual permission check (`src/app/api/admin/company-settings/route.ts:64`, `climate-project` repo), not assumed.
- System settings is a platform-wide singleton — `Roles.SuperAdmin`-only, no company scoping at all.
- Demographic fields and bulk import: same `CanAccessCompany` scoping pattern as Department/User (SuperAdmin any, CompanyAdmin own company).
- Bulk-import CSV parsing is a simple manual comma-split (no new package dependency) — does NOT support embedded commas inside quoted fields. State this limitation in the UI copy; do not silently mis-parse such rows.
- `.NET`: don't touch pinned package versions in any `.csproj`.
- Frontend: Node 20 LTS+.
- Do not build: anything for surveys/microclimates/action-plans/reports/notifications (later domains), i18n/PWA/design tokens beyond `--admin-*` reuse (`#57`).

---

## Task 1: SystemSettings entity + endpoints

**Files:**
- Create: `src/ClimateProject.Domain/Entities/SystemSettings.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/SystemSettingsConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` (add `DbSet<SystemSettings> SystemSettings`)
- Create: EF Core migration
- Create: `src/ClimateProject.Application/OrgStructure/SystemSettingsDtos.cs`
- Create: `src/ClimateProject.Api/Endpoints/SystemSettingsEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs`
- Test: `tests/ClimateProject.IntegrationTests/OrgStructure/SystemSettingsEndpointsTests.cs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `GET/PUT /admin/system-settings` — Task 6 (frontend) consumes.

- [ ] **Step 1: Entity**

Create `src/ClimateProject.Domain/Entities/SystemSettings.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class SystemSettings
{
    public Guid Id { get; set; }
    public bool LoginEnabled { get; set; } = true;
    public bool MaintenanceMode { get; set; }
    public string? MaintenanceMessage { get; set; }
    public int MaxLoginAttempts { get; set; } = 5;
    public int SessionTimeoutMinutes { get; set; } = 60;
    public PasswordPolicy PasswordPolicy { get; set; } = new();
    public SystemEmailSettings EmailSettings { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class PasswordPolicy
{
    public int MinLength { get; set; } = 8;
    public bool RequireUppercase { get; set; } = true;
    public bool RequireLowercase { get; set; } = true;
    public bool RequireNumbers { get; set; } = true;
    public bool RequireSpecialChars { get; set; }
}

public class SystemEmailSettings
{
    public bool SmtpEnabled { get; set; }
    public string? FromEmail { get; set; }
    public string? SmtpHost { get; set; }
    public int? SmtpPort { get; set; }
}
```

(Named `SystemEmailSettings`, not `EmailSettings`, to avoid colliding with any future per-domain email-settings type.)

- [ ] **Step 2: EF Core configuration**

Create `src/ClimateProject.Infrastructure/Persistence/Configurations/SystemSettingsConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SystemSettingsConfiguration : IEntityTypeConfiguration<SystemSettings>
{
    public void Configure(EntityTypeBuilder<SystemSettings> builder)
    {
        builder.ToTable("system_settings");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.LoginEnabled).HasColumnName("login_enabled").IsRequired().HasDefaultValue(true);
        builder.Property(s => s.MaintenanceMode).HasColumnName("maintenance_mode").IsRequired().HasDefaultValue(false);
        builder.Property(s => s.MaintenanceMessage).HasColumnName("maintenance_message").HasMaxLength(500);
        builder.Property(s => s.MaxLoginAttempts).HasColumnName("max_login_attempts").IsRequired().HasDefaultValue(5);
        builder.Property(s => s.SessionTimeoutMinutes).HasColumnName("session_timeout_minutes").IsRequired().HasDefaultValue(60);
        builder.Property(s => s.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(s => s.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.OwnsOne(s => s.PasswordPolicy, policy =>
        {
            policy.Property(p => p.MinLength).HasColumnName("password_min_length").IsRequired().HasDefaultValue(8);
            policy.Property(p => p.RequireUppercase).HasColumnName("password_require_uppercase").IsRequired().HasDefaultValue(true);
            policy.Property(p => p.RequireLowercase).HasColumnName("password_require_lowercase").IsRequired().HasDefaultValue(true);
            policy.Property(p => p.RequireNumbers).HasColumnName("password_require_numbers").IsRequired().HasDefaultValue(true);
            policy.Property(p => p.RequireSpecialChars).HasColumnName("password_require_special_chars").IsRequired().HasDefaultValue(false);
        });

        builder.OwnsOne(s => s.EmailSettings, email =>
        {
            email.Property(e => e.SmtpEnabled).HasColumnName("email_smtp_enabled").IsRequired().HasDefaultValue(false);
            email.Property(e => e.FromEmail).HasColumnName("email_from_email").HasMaxLength(255);
            email.Property(e => e.SmtpHost).HasColumnName("email_smtp_host").HasMaxLength(255);
            email.Property(e => e.SmtpPort).HasColumnName("email_smtp_port");
        });
    }
}
```

- [ ] **Step 3: Register the DbSet and generate the migration**

In `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`, add a `DbSet<SystemSettings> SystemSettings => Set<SystemSettings>();` property alongside the existing `DbSet` properties (match the exact style already used there — read the file first to place it consistently with the others, e.g. near `Companies`/`Users`).

Run from the repo root:

```bash
dotnet ef migrations add AddSystemSettings \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api
```

Confirm the generated migration only creates the `system_settings` table (one new table, no unrelated changes). If it contains anything else, stop and investigate.

- [ ] **Step 4: DTOs**

Create `src/ClimateProject.Application/OrgStructure/SystemSettingsDtos.cs`:

```csharp
namespace ClimateProject.Application.OrgStructure;

public sealed record PasswordPolicyDto(
    int MinLength,
    bool RequireUppercase,
    bool RequireLowercase,
    bool RequireNumbers,
    bool RequireSpecialChars);

public sealed record SystemEmailSettingsDto(
    bool SmtpEnabled,
    string? FromEmail,
    string? SmtpHost,
    int? SmtpPort);

public sealed record SystemSettingsDetail(
    bool LoginEnabled,
    bool MaintenanceMode,
    string? MaintenanceMessage,
    int MaxLoginAttempts,
    int SessionTimeoutMinutes,
    PasswordPolicyDto PasswordPolicy,
    SystemEmailSettingsDto EmailSettings,
    DateTimeOffset UpdatedAt);

public sealed record UpdateSystemSettingsRequest(
    bool? LoginEnabled,
    bool? MaintenanceMode,
    string? MaintenanceMessage,
    int? MaxLoginAttempts,
    int? SessionTimeoutMinutes,
    PasswordPolicyDto? PasswordPolicy,
    SystemEmailSettingsDto? EmailSettings);
```

- [ ] **Step 5: Write the failing tests**

Create `tests/ClimateProject.IntegrationTests/OrgStructure/SystemSettingsEndpointsTests.cs`:

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
public class SystemSettingsEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _emailDomain = $"sysset-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public SystemSettingsEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "SysSet Co", EmailDomain = _emailDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_emailDomain}";
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
    public async Task Get_creates_a_default_row_the_first_time_its_called()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/admin/system-settings");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var settings = await response.Content.ReadFromJsonAsync<SystemSettingsDetail>();
        Assert.True(settings!.LoginEnabled);
        Assert.Equal(5, settings.MaxLoginAttempts);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Equal(1, await db.SystemSettings.CountAsync());
    }

    [Fact]
    public async Task NonSuperAdmin_cannot_read_or_update_system_settings()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var getResponse = await client.GetAsync("/admin/system-settings");
        Assert.Equal(HttpStatusCode.Forbidden, getResponse.StatusCode);

        var putResponse = await client.PutAsJsonAsync("/admin/system-settings", new UpdateSystemSettingsRequest(false, null, null, null, null, null, null));
        Assert.Equal(HttpStatusCode.Forbidden, putResponse.StatusCode);
    }

    [Fact]
    public async Task SuperAdmin_can_update_settings_and_the_change_persists()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        await client.GetAsync("/admin/system-settings");

        var updateResponse = await client.PutAsJsonAsync("/admin/system-settings", new UpdateSystemSettingsRequest(
            LoginEnabled: false,
            MaintenanceMode: true,
            MaintenanceMessage: "Down for maintenance",
            MaxLoginAttempts: 3,
            SessionTimeoutMinutes: 30,
            PasswordPolicy: null,
            EmailSettings: null));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<SystemSettingsDetail>();
        Assert.False(updated!.LoginEnabled);
        Assert.True(updated.MaintenanceMode);
        Assert.Equal("Down for maintenance", updated.MaintenanceMessage);
        Assert.Equal(3, updated.MaxLoginAttempts);

        var getAgain = await client.GetAsync("/admin/system-settings");
        var reread = await getAgain.Content.ReadFromJsonAsync<SystemSettingsDetail>();
        Assert.False(reread!.LoginEnabled);
    }
}
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~SystemSettingsEndpointsTests"`
Expected: FAIL (compile error).

- [ ] **Step 7: Implement the endpoints**

Create `src/ClimateProject.Api/Endpoints/SystemSettingsEndpoints.cs`:

```csharp
using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class SystemSettingsEndpoints
{
    public static void MapSystemSettingsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/system-settings").RequireAuthorization();

        group.MapGet("", GetAsync);
        group.MapPut("", UpdateAsync);
    }

    private static SystemSettingsDetail ToDetail(SystemSettings s)
        => new(s.LoginEnabled, s.MaintenanceMode, s.MaintenanceMessage, s.MaxLoginAttempts, s.SessionTimeoutMinutes,
            new PasswordPolicyDto(s.PasswordPolicy.MinLength, s.PasswordPolicy.RequireUppercase, s.PasswordPolicy.RequireLowercase, s.PasswordPolicy.RequireNumbers, s.PasswordPolicy.RequireSpecialChars),
            new SystemEmailSettingsDto(s.EmailSettings.SmtpEnabled, s.EmailSettings.FromEmail, s.EmailSettings.SmtpHost, s.EmailSettings.SmtpPort),
            s.UpdatedAt);

    private static async Task<SystemSettings> GetOrCreateAsync(ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var settings = await db.SystemSettings.FirstOrDefaultAsync(cancellationToken);
        if (settings is not null)
        {
            return settings;
        }

        var now = DateTimeOffset.UtcNow;
        settings = new SystemSettings { Id = Guid.NewGuid(), CreatedAt = now, UpdatedAt = now };
        db.SystemSettings.Add(settings);
        await db.SaveChangesAsync(cancellationToken);
        return settings;
    }

    private static async Task<IResult> GetAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var settings = await GetOrCreateAsync(db, cancellationToken);
        return Results.Ok(ToDetail(settings));
    }

    private static async Task<IResult> UpdateAsync(
        UpdateSystemSettingsRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var settings = await GetOrCreateAsync(db, cancellationToken);

        if (request.LoginEnabled.HasValue) settings.LoginEnabled = request.LoginEnabled.Value;
        if (request.MaintenanceMode.HasValue) settings.MaintenanceMode = request.MaintenanceMode.Value;
        if (request.MaintenanceMessage is not null) settings.MaintenanceMessage = request.MaintenanceMessage;
        if (request.MaxLoginAttempts.HasValue) settings.MaxLoginAttempts = request.MaxLoginAttempts.Value;
        if (request.SessionTimeoutMinutes.HasValue) settings.SessionTimeoutMinutes = request.SessionTimeoutMinutes.Value;

        if (request.PasswordPolicy is not null)
        {
            settings.PasswordPolicy.MinLength = request.PasswordPolicy.MinLength;
            settings.PasswordPolicy.RequireUppercase = request.PasswordPolicy.RequireUppercase;
            settings.PasswordPolicy.RequireLowercase = request.PasswordPolicy.RequireLowercase;
            settings.PasswordPolicy.RequireNumbers = request.PasswordPolicy.RequireNumbers;
            settings.PasswordPolicy.RequireSpecialChars = request.PasswordPolicy.RequireSpecialChars;
        }

        if (request.EmailSettings is not null)
        {
            settings.EmailSettings.SmtpEnabled = request.EmailSettings.SmtpEnabled;
            settings.EmailSettings.FromEmail = request.EmailSettings.FromEmail;
            settings.EmailSettings.SmtpHost = request.EmailSettings.SmtpHost;
            settings.EmailSettings.SmtpPort = request.EmailSettings.SmtpPort;
        }

        settings.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(settings));
    }
}
```

- [ ] **Step 8: Register the endpoint group**

In `src/ClimateProject.Api/Program.cs`, add after `app.MapInvitationAcceptEndpoints();`:

```csharp
app.MapSystemSettingsEndpoints();
```

- [ ] **Step 9: Run the tests to verify they pass, then the full suite**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~SystemSettingsEndpointsTests"` — expect PASS, 3/3.
Run: `dotnet test ClimateProject.slnx` — expect all pass (159 baseline from Slice 2 + 3 = 162; retry once if only the known flaky `StartupValidationTests` test fails, per Slice 1/2 precedent).

- [ ] **Step 10: Commit**

```bash
git add src/ClimateProject.Domain/Entities/SystemSettings.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/SystemSettingsConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
        src/ClimateProject.Infrastructure/Migrations/ \
        src/ClimateProject.Application/OrgStructure/SystemSettingsDtos.cs \
        src/ClimateProject.Api/Endpoints/SystemSettingsEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/OrgStructure/SystemSettingsEndpointsTests.cs
git commit -m "feat: add platform-wide SystemSettings entity and endpoints"
```

---

## Task 2: Company settings/branding endpoint

**Files:**
- Create: `src/ClimateProject.Application/OrgStructure/CompanySettingsDtos.cs`
- Modify: `src/ClimateProject.Api/Endpoints/CompanyEndpoints.cs`
- Test: `tests/ClimateProject.IntegrationTests/OrgStructure/CompanySettingsEndpointTests.cs`

**Interfaces:**
- Consumes: `Company.Settings`/`Company.Branding` (existing, `#49`).
- Produces: `PUT /admin/companies/{id}/settings` — Task 6 (frontend) consumes.

- [ ] **Step 1: DTOs**

Create `src/ClimateProject.Application/OrgStructure/CompanySettingsDtos.cs`:

```csharp
namespace ClimateProject.Application.OrgStructure;

public sealed record CompanySettingsDto(
    string SurveyFrequency,
    bool MicroclimateEnabled,
    bool AiInsightsEnabled,
    bool AnonymousSurveys,
    int DataRetentionDays,
    string Timezone,
    string Language);

public sealed record CompanyBrandingDto(
    string? LogoUrl,
    string PrimaryColor,
    string SecondaryColor,
    string FontFamily,
    string? CustomCss);

public sealed record CompanySettingsResponse(
    Guid CompanyId,
    CompanySettingsDto Settings,
    CompanyBrandingDto Branding);

public sealed record UpdateCompanySettingsRequest(
    string? SurveyFrequency,
    bool? MicroclimateEnabled,
    bool? AiInsightsEnabled,
    bool? AnonymousSurveys,
    int? DataRetentionDays,
    string? Timezone,
    string? Language,
    string? LogoUrl,
    string? PrimaryColor,
    string? SecondaryColor,
    string? FontFamily,
    string? CustomCss);
```

- [ ] **Step 2: Write the failing tests**

Create `tests/ClimateProject.IntegrationTests/OrgStructure/CompanySettingsEndpointTests.cs`:

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
public class CompanySettingsEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"csa-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"csb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public CompanySettingsEndpointTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "CS Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "CS Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
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
    public async Task CompanyAdmin_can_update_their_own_companys_settings_and_branding()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PutAsJsonAsync($"/admin/companies/{_companyAId}/settings", new UpdateCompanySettingsRequest(
            SurveyFrequency: "monthly",
            MicroclimateEnabled: false,
            AiInsightsEnabled: null,
            AnonymousSurveys: true,
            DataRetentionDays: null,
            Timezone: null,
            Language: null,
            LogoUrl: "https://example.test/logo.png",
            PrimaryColor: "#000000",
            SecondaryColor: null,
            FontFamily: null,
            CustomCss: null));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<CompanySettingsResponse>();
        Assert.Equal("monthly", result!.Settings.SurveyFrequency);
        Assert.False(result.Settings.MicroclimateEnabled);
        Assert.True(result.Settings.AnonymousSurveys);
        Assert.Equal("https://example.test/logo.png", result.Branding.LogoUrl);
        Assert.Equal("#000000", result.Branding.PrimaryColor);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_update_another_companys_settings()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PutAsJsonAsync($"/admin/companies/{_companyBId}/settings", new UpdateCompanySettingsRequest(
            "monthly", null, null, null, null, null, null, null, null, null, null, null));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Regular_employee_cannot_update_company_settings()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PutAsJsonAsync($"/admin/companies/{_companyAId}/settings", new UpdateCompanySettingsRequest(
            "monthly", null, null, null, null, null, null, null, null, null, null, null));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~CompanySettingsEndpointTests"`
Expected: FAIL (404 -- route doesn't exist).

- [ ] **Step 4: Implement the endpoint**

In `src/ClimateProject.Api/Endpoints/CompanyEndpoints.cs`, add a new route registration inside
`MapCompanyEndpoints` (after the existing `group.MapPut("/{id:guid}", UpdateAsync);` line):

```csharp
        group.MapPut("/{id:guid}/settings", UpdateSettingsAsync);
```

Then add a new private handler method to the same class (place it after `UpdateAsync`):

```csharp
    private static async Task<IResult> UpdateSettingsAsync(
        Guid id,
        UpdateCompanySettingsRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role) || (currentUser.Role != Roles.SuperAdmin && currentUser.CompanyId != id.ToString()))
        {
            return Results.Forbid();
        }

        var company = await db.Companies.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (company is null)
        {
            return Results.Json(new { message = "Company not found" }, statusCode: 404);
        }

        if (!string.IsNullOrWhiteSpace(request.SurveyFrequency)) company.Settings.SurveyFrequency = request.SurveyFrequency;
        if (request.MicroclimateEnabled.HasValue) company.Settings.MicroclimateEnabled = request.MicroclimateEnabled.Value;
        if (request.AiInsightsEnabled.HasValue) company.Settings.AiInsightsEnabled = request.AiInsightsEnabled.Value;
        if (request.AnonymousSurveys.HasValue) company.Settings.AnonymousSurveys = request.AnonymousSurveys.Value;
        if (request.DataRetentionDays.HasValue) company.Settings.DataRetentionDays = request.DataRetentionDays.Value;
        if (!string.IsNullOrWhiteSpace(request.Timezone)) company.Settings.Timezone = request.Timezone;
        if (!string.IsNullOrWhiteSpace(request.Language)) company.Settings.Language = request.Language;

        if (request.LogoUrl is not null) company.Branding.LogoUrl = request.LogoUrl;
        if (!string.IsNullOrWhiteSpace(request.PrimaryColor)) company.Branding.PrimaryColor = request.PrimaryColor;
        if (!string.IsNullOrWhiteSpace(request.SecondaryColor)) company.Branding.SecondaryColor = request.SecondaryColor;
        if (!string.IsNullOrWhiteSpace(request.FontFamily)) company.Branding.FontFamily = request.FontFamily;
        if (request.CustomCss is not null) company.Branding.CustomCss = request.CustomCss;

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new CompanySettingsResponse(
            company.Id,
            new CompanySettingsDto(company.Settings.SurveyFrequency, company.Settings.MicroclimateEnabled, company.Settings.AiInsightsEnabled, company.Settings.AnonymousSurveys, company.Settings.DataRetentionDays, company.Settings.Timezone, company.Settings.Language),
            new CompanyBrandingDto(company.Branding.LogoUrl, company.Branding.PrimaryColor, company.Branding.SecondaryColor, company.Branding.FontFamily, company.Branding.CustomCss)));
    }
```

Note the authorization check: `Roles.Admin.Contains(currentUser.Role)` gates SuperAdmin-or-CompanyAdmin
in general, and the second clause restricts a non-SuperAdmin to their own company specifically
(`currentUser.Role != Roles.SuperAdmin && currentUser.CompanyId != id.ToString()` is the Forbid
condition) — a SuperAdmin always passes since the first half of that `&&` is false for them.

- [ ] **Step 5: Run the tests to verify they pass, then the full suite**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~CompanySettingsEndpointTests"` — expect PASS, 3/3.
Run: `dotnet test ClimateProject.slnx` — expect all pass (162 + 3 = 165).

- [ ] **Step 6: Commit**

```bash
git add src/ClimateProject.Application/OrgStructure/CompanySettingsDtos.cs \
        src/ClimateProject.Api/Endpoints/CompanyEndpoints.cs \
        tests/ClimateProject.IntegrationTests/OrgStructure/CompanySettingsEndpointTests.cs
git commit -m "feat: add company settings/branding endpoint (broader than profile permission)"
```

---

## Task 3: Demographic field endpoints

**Files:**
- Create: `src/ClimateProject.Application/OrgStructure/DemographicFieldDtos.cs`
- Create: `src/ClimateProject.Application/OrgStructure/DemographicFieldValidation.cs`
- Create: `src/ClimateProject.Api/Endpoints/DemographicFieldEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs`
- Test: `tests/ClimateProject.IntegrationTests/OrgStructure/DemographicFieldEndpointsTests.cs`

**Interfaces:**
- Consumes: `DemographicField` entity (existing, `#49`).
- Produces: list/create/update endpoints — Task 7 (frontend) consumes.

- [ ] **Step 1: Validation constants and DTOs**

Create `src/ClimateProject.Application/OrgStructure/DemographicFieldValidation.cs`:

```csharp
namespace ClimateProject.Application.OrgStructure;

public static class DemographicFieldValidation
{
    public static readonly string[] ValidTypes = ["select", "text", "number", "date"];
}
```

Create `src/ClimateProject.Application/OrgStructure/DemographicFieldDtos.cs`:

```csharp
namespace ClimateProject.Application.OrgStructure;

public sealed record DemographicFieldDetail(
    Guid Id,
    Guid CompanyId,
    string Field,
    string Label,
    string Type,
    List<string>? Options,
    bool Required,
    int Order,
    bool IsActive);

public sealed record DemographicFieldListResponse(IReadOnlyList<DemographicFieldDetail> Fields);

public sealed record CreateDemographicFieldRequest(
    Guid CompanyId,
    string Field,
    string Label,
    string Type,
    List<string>? Options,
    bool Required,
    int Order);

public sealed record UpdateDemographicFieldRequest(
    string? Label,
    List<string>? Options,
    bool? Required,
    int? Order,
    bool? IsActive);
```

- [ ] **Step 2: Write the failing tests**

Create `tests/ClimateProject.IntegrationTests/OrgStructure/DemographicFieldEndpointsTests.cs`:

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
public class DemographicFieldEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"dfa-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"dfb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public DemographicFieldEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "DF Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "DF Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
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
    public async Task CompanyAdmin_can_create_list_and_update_fields_in_their_own_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/demographic-fields", new CreateDemographicFieldRequest(
            _companyAId, "gender", "Gender", "select", new List<string> { "Male", "Female", "Other" }, true, 1));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<DemographicFieldDetail>();

        var listResponse = await client.GetAsync($"/admin/demographic-fields?companyId={_companyAId}");
        var list = await listResponse.Content.ReadFromJsonAsync<DemographicFieldListResponse>();
        Assert.Contains(list!.Fields, f => f.Id == created!.Id);

        var updateResponse = await client.PutAsJsonAsync($"/admin/demographic-fields/{created!.Id}", new UpdateDemographicFieldRequest("Gender Identity", null, null, null, false));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<DemographicFieldDetail>();
        Assert.Equal("Gender Identity", updated!.Label);
        Assert.False(updated.IsActive);
    }

    [Fact]
    public async Task Select_type_field_requires_non_empty_options()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/demographic-fields", new CreateDemographicFieldRequest(
            _companyAId, "region", "Region", "select", null, false, 2));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_manage_fields_in_another_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/demographic-fields", new CreateDemographicFieldRequest(
            _companyBId, "tenure", "Tenure", "number", null, false, 1));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        var listResponse = await client.GetAsync($"/admin/demographic-fields?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.Forbidden, listResponse.StatusCode);
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~DemographicFieldEndpointsTests"`
Expected: FAIL (compile error).

- [ ] **Step 4: Implement the endpoints**

Create `src/ClimateProject.Api/Endpoints/DemographicFieldEndpoints.cs`:

```csharp
using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class DemographicFieldEndpoints
{
    public static void MapDemographicFieldEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/demographic-fields").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || currentUser.CompanyId == companyId.ToString();

    private static DemographicFieldDetail ToDetail(DemographicField f)
        => new(f.Id, f.CompanyId, f.Field, f.Label, f.Type, f.Options, f.Required, f.Order, f.IsActive);

    private static bool IsValidCreate(CreateDemographicFieldRequest request, out string? error)
    {
        if (string.IsNullOrWhiteSpace(request.Field) || string.IsNullOrWhiteSpace(request.Label))
        {
            error = "Field and label are required";
            return false;
        }

        if (!DemographicFieldValidation.ValidTypes.Contains(request.Type))
        {
            error = $"Invalid type: {request.Type}";
            return false;
        }

        if (request.Type == "select" && (request.Options is null || request.Options.Count == 0))
        {
            error = "Select fields require at least one option";
            return false;
        }

        error = null;
        return true;
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

        var fields = await db.DemographicFields
            .Where(f => f.CompanyId == companyId)
            .OrderBy(f => f.Order)
            .Select(f => new DemographicFieldDetail(f.Id, f.CompanyId, f.Field, f.Label, f.Type, f.Options, f.Required, f.Order, f.IsActive))
            .ToListAsync(cancellationToken);

        return Results.Ok(new DemographicFieldListResponse(fields));
    }

    private static async Task<IResult> CreateAsync(
        CreateDemographicFieldRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        if (!IsValidCreate(request, out var error))
        {
            return Results.Json(new { message = error }, statusCode: 400);
        }

        var now = DateTimeOffset.UtcNow;
        var field = new DemographicField
        {
            Id = Guid.NewGuid(),
            CompanyId = request.CompanyId,
            Field = request.Field.Trim(),
            Label = request.Label.Trim(),
            Type = request.Type,
            Options = request.Options,
            Required = request.Required,
            Order = request.Order,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };

        db.DemographicFields.Add(field);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(ToDetail(field), statusCode: 201);
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateDemographicFieldRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var field = await db.DemographicFields.FirstOrDefaultAsync(f => f.Id == id, cancellationToken);
        if (field is null)
        {
            return Results.Json(new { message = "Demographic field not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, field.CompanyId))
        {
            return Results.Forbid();
        }

        if (!string.IsNullOrWhiteSpace(request.Label)) field.Label = request.Label.Trim();
        if (request.Options is not null) field.Options = request.Options;
        if (request.Required.HasValue) field.Required = request.Required.Value;
        if (request.Order.HasValue) field.Order = request.Order.Value;
        if (request.IsActive.HasValue) field.IsActive = request.IsActive.Value;

        field.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(field));
    }
}
```

- [ ] **Step 5: Register the endpoint group**

In `src/ClimateProject.Api/Program.cs`, add after `app.MapSystemSettingsEndpoints();`:

```csharp
app.MapDemographicFieldEndpoints();
```

- [ ] **Step 6: Run the tests to verify they pass, then the full suite**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~DemographicFieldEndpointsTests"` — expect PASS, 3/3.
Run: `dotnet test ClimateProject.slnx` — expect all pass (165 + 3 = 168).

- [ ] **Step 7: Commit**

```bash
git add src/ClimateProject.Application/OrgStructure/DemographicFieldDtos.cs \
        src/ClimateProject.Application/OrgStructure/DemographicFieldValidation.cs \
        src/ClimateProject.Api/Endpoints/DemographicFieldEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/OrgStructure/DemographicFieldEndpointsTests.cs
git commit -m "feat: add demographic field CRUD endpoints"
```

---

## Task 4: Bulk user import endpoint

**Files:**
- Create: `src/ClimateProject.Application/OrgStructure/BulkImportDtos.cs`
- Create: `src/ClimateProject.Application/OrgStructure/CsvUserImportParser.cs`
- Create: `src/ClimateProject.Api/Endpoints/BulkImportEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs`
- Test: `tests/ClimateProject.UnitTests/OrgStructure/CsvUserImportParserTests.cs`
- Test: `tests/ClimateProject.IntegrationTests/OrgStructure/BulkImportEndpointsTests.cs`

**Interfaces:**
- Consumes: `IPasswordHasher` (existing, `Application.Auth`).
- Produces: `POST /admin/users/bulk-import` — Task 8 (frontend) consumes.

- [ ] **Step 1: DTOs**

Create `src/ClimateProject.Application/OrgStructure/BulkImportDtos.cs`:

```csharp
namespace ClimateProject.Application.OrgStructure;

public sealed record BulkImportRowResult(
    int RowNumber,
    string Name,
    string Email,
    string Role,
    string? Department,
    string Status,
    IReadOnlyList<string> Errors);

public sealed record BulkImportResponse(
    IReadOnlyList<BulkImportRowResult> Rows,
    int SuccessCount,
    int ErrorCount);

public sealed record ParsedImportRow(int RowNumber, string Name, string Email, string Role, string? Department);
```

- [ ] **Step 2: Write the failing unit tests for the CSV parser**

Create `tests/ClimateProject.UnitTests/OrgStructure/CsvUserImportParserTests.cs`:

```csharp
using ClimateProject.Application.OrgStructure;

namespace ClimateProject.UnitTests.OrgStructure;

public class CsvUserImportParserTests
{
    [Fact]
    public void Parses_valid_rows_with_header()
    {
        var csv = "name,email,role,department\nJane Doe,jane@example.test,employee,Engineering\nJohn Roe,john@example.test,supervisor,";

        var rows = CsvUserImportParser.Parse(csv);

        Assert.Equal(2, rows.Count);
        Assert.Equal("Jane Doe", rows[0].Name);
        Assert.Equal("jane@example.test", rows[0].Email);
        Assert.Equal("employee", rows[0].Role);
        Assert.Equal("Engineering", rows[0].Department);
        Assert.Null(rows[1].Department);
        Assert.Equal(2, rows[0].RowNumber);
        Assert.Equal(3, rows[1].RowNumber);
    }

    [Fact]
    public void Skips_blank_lines()
    {
        var csv = "name,email,role,department\nJane Doe,jane@example.test,employee,\n\n\nJohn Roe,john@example.test,employee,";

        var rows = CsvUserImportParser.Parse(csv);

        Assert.Equal(2, rows.Count);
    }

    [Fact]
    public void Trims_whitespace_around_each_field()
    {
        var csv = "name,email,role,department\n  Jane Doe  ,  jane@example.test  ,  employee  ,  Engineering  ";

        var rows = CsvUserImportParser.Parse(csv);

        Assert.Equal("Jane Doe", rows[0].Name);
        Assert.Equal("jane@example.test", rows[0].Email);
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~CsvUserImportParserTests"`
Expected: FAIL (compile error).

- [ ] **Step 4: Implement the parser**

Create `src/ClimateProject.Application/OrgStructure/CsvUserImportParser.cs`:

```csharp
namespace ClimateProject.Application.OrgStructure;

// Simple comma-split parser -- does NOT handle embedded commas inside quoted
// fields. Acceptable for this slice's scope (name/email/role/department are
// all comma-free in practice); do not extend this to richer CSV without
// switching to a real CSV parsing approach.
public static class CsvUserImportParser
{
    public static IReadOnlyList<ParsedImportRow> Parse(string csv)
    {
        var lines = csv.Replace("\r\n", "\n").Split('\n');
        var rows = new List<ParsedImportRow>();

        for (var i = 1; i < lines.Length; i++) // skip header row
        {
            var line = lines[i];
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            var parts = line.Split(',');
            var name = parts.Length > 0 ? parts[0].Trim() : string.Empty;
            var email = parts.Length > 1 ? parts[1].Trim() : string.Empty;
            var role = parts.Length > 2 ? parts[2].Trim() : string.Empty;
            var department = parts.Length > 3 ? parts[3].Trim() : string.Empty;

            rows.Add(new ParsedImportRow(
                RowNumber: i + 1, // 1-based, header is row 1
                Name: name,
                Email: email,
                Role: role,
                Department: string.IsNullOrEmpty(department) ? null : department));
        }

        return rows;
    }
}
```

- [ ] **Step 5: Run the parser tests to verify they pass**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~CsvUserImportParserTests"`
Expected: PASS, 3/3.

- [ ] **Step 6: Write the failing integration tests for the endpoint**

Create `tests/ClimateProject.IntegrationTests/OrgStructure/BulkImportEndpointsTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
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
public class BulkImportEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"bulk-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public BulkImportEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Bulk Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
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

    private static MultipartFormDataContent BuildForm(string csv, Guid companyId, bool preview)
    {
        var form = new MultipartFormDataContent();
        var fileContent = new StringContent(csv, Encoding.UTF8, "text/csv");
        form.Add(fileContent, "file", "import.csv");
        form.Add(new StringContent(companyId.ToString()), "companyId");
        form.Add(new StringContent(preview.ToString().ToLowerInvariant()), "preview");
        return form;
    }

    [Fact]
    public async Task Preview_mode_validates_without_creating_users()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var csv = "name,email,role,department\nNew Person,newperson@example.test,employee,";
        var response = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: true));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<BulkImportResponse>();
        Assert.Equal(1, result!.SuccessCount);
        Assert.Equal("valid", result.Rows[0].Status);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Null(await db.Users.FirstOrDefaultAsync(u => u.Email == "newperson@example.test"));
    }

    [Fact]
    public async Task Non_preview_mode_creates_valid_rows_and_reports_errors_for_invalid_ones()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var csv = "name,email,role,department\nGood Person,goodperson@example.test,employee,\nBad Person,not-an-email,employee,\nBad Role,badrole@example.test,not_a_role,";
        var response = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: false));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<BulkImportResponse>();
        Assert.Equal(1, result!.SuccessCount);
        Assert.Equal(2, result.ErrorCount);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.NotNull(await db.Users.FirstOrDefaultAsync(u => u.Email == "goodperson@example.test"));
        Assert.Null(await db.Users.FirstOrDefaultAsync(u => u.Email == "not-an-email"));
    }

    [Fact]
    public async Task Duplicate_email_within_the_same_csv_is_reported_as_an_error_on_the_second_occurrence()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var csv = "name,email,role,department\nFirst,dup@example.test,employee,\nSecond,dup@example.test,employee,";
        var response = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: false));

        var result = await response.Content.ReadFromJsonAsync<BulkImportResponse>();
        Assert.Equal(1, result!.SuccessCount);
        Assert.Equal("duplicate", result.Rows[1].Status);
    }

    [Fact]
    public async Task Employee_cannot_bulk_import_users()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.Employee);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var csv = "name,email,role,department\nSomeone,someone@example.test,employee,";
        var response = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: true));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
```

- [ ] **Step 7: Run the integration tests to verify they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~BulkImportEndpointsTests"`
Expected: FAIL (compile error).

- [ ] **Step 8: Implement the endpoint**

Create `src/ClimateProject.Api/Endpoints/BulkImportEndpoints.cs`:

```csharp
using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class BulkImportEndpoints
{
    public static void MapBulkImportEndpoints(this WebApplication app)
    {
        app.MapPost("/admin/users/bulk-import", ImportAsync).RequireAuthorization();
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || currentUser.CompanyId == companyId.ToString();

    private static bool IsValidEmail(string email)
        => !string.IsNullOrWhiteSpace(email) && email.Contains('@') && email.Split('@').Length == 2 && email.Split('@')[1].Contains('.');

    private static async Task<IResult> ImportAsync(
        HttpRequest httpRequest,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IPasswordHasher passwordHasher,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        if (!httpRequest.HasFormContentType)
        {
            return Results.Json(new { message = "Expected multipart form data" }, statusCode: 400);
        }

        var form = await httpRequest.ReadFormAsync(cancellationToken);
        var file = form.Files["file"];
        if (file is null || file.Length == 0)
        {
            return Results.Json(new { message = "A CSV file is required" }, statusCode: 400);
        }

        if (!Guid.TryParse(form["companyId"], out var companyId))
        {
            return Results.Json(new { message = "A valid companyId is required" }, statusCode: 400);
        }

        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        var isPreview = bool.TryParse(form["preview"], out var previewValue) && previewValue;

        using var reader = new StreamReader(file.OpenReadStream());
        var csv = await reader.ReadToEndAsync(cancellationToken);
        var parsedRows = CsvUserImportParser.Parse(csv);

        var departments = await db.Departments.Where(d => d.CompanyId == companyId).ToListAsync(cancellationToken);
        var existingEmails = (await db.Users.Where(u => u.CompanyId == companyId).Select(u => u.Email).ToListAsync(cancellationToken)).ToHashSet();
        var seenInThisFile = new HashSet<string>();

        var results = new List<BulkImportRowResult>();
        var now = DateTimeOffset.UtcNow;

        foreach (var row in parsedRows)
        {
            var errors = new List<string>();
            var email = row.Email.ToLowerInvariant();

            if (string.IsNullOrWhiteSpace(row.Name))
            {
                errors.Add("Name is required");
            }

            if (!IsValidEmail(email))
            {
                errors.Add("Invalid email format");
            }

            if (!Roles.All.Contains(row.Role))
            {
                errors.Add($"Invalid role: {row.Role}");
            }

            Department? department = null;
            if (row.Department is not null)
            {
                department = departments.FirstOrDefault(d => d.Name == row.Department);
                if (department is null)
                {
                    errors.Add($"Department not found: {row.Department}");
                }
            }

            string status;
            if (errors.Count > 0)
            {
                status = "error";
            }
            else if (existingEmails.Contains(email) || !seenInThisFile.Add(email))
            {
                status = "duplicate";
                errors.Add("A user with this email already exists or appears twice in this file");
            }
            else if (isPreview)
            {
                status = "valid";
            }
            else
            {
                var user = new User
                {
                    Id = Guid.NewGuid(),
                    CompanyId = companyId,
                    Email = email,
                    Name = row.Name.Trim(),
                    PasswordHash = passwordHasher.Hash(Guid.NewGuid().ToString("N")),
                    Role = row.Role,
                    DepartmentId = department?.Id,
                    IsActive = true,
                    CreatedAt = now,
                    UpdatedAt = now,
                };
                db.Users.Add(user);
                existingEmails.Add(email);
                status = "created";
            }

            results.Add(new BulkImportRowResult(row.RowNumber, row.Name, email, row.Role, row.Department, status, errors));
        }

        if (!isPreview)
        {
            await db.SaveChangesAsync(cancellationToken);
        }

        var successCount = results.Count(r => r.Status is "valid" or "created");
        var errorCount = results.Count - successCount;

        return Results.Ok(new BulkImportResponse(results, successCount, errorCount));
    }
}
```

- [ ] **Step 9: Register the endpoint**

In `src/ClimateProject.Api/Program.cs`, add after `app.MapDemographicFieldEndpoints();`:

```csharp
app.MapBulkImportEndpoints();
```

- [ ] **Step 10: Run the tests to verify they pass, then the full suite**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~BulkImportEndpointsTests"` — expect PASS, 4/4.
Run: `dotnet test ClimateProject.slnx` — expect all pass. Baseline after Task 3 was 168 (16 unit + 152 integration); Task 4 adds 3 unit tests (Step 5) + 4 integration tests (Step 7) = 175 total (19 unit + 156 integration).

- [ ] **Step 11: Commit**

```bash
git add src/ClimateProject.Application/OrgStructure/BulkImportDtos.cs \
        src/ClimateProject.Application/OrgStructure/CsvUserImportParser.cs \
        src/ClimateProject.Api/Endpoints/BulkImportEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.UnitTests/OrgStructure/CsvUserImportParserTests.cs \
        tests/ClimateProject.IntegrationTests/OrgStructure/BulkImportEndpointsTests.cs
git commit -m "feat: add CSV bulk user import endpoint (preview + create modes)"
```

---

## Task 5: Frontend typed API clients

**Files:**
- Create: `web/src/features/org-structure/api/companySettings.ts` + `.test.ts`
- Create: `web/src/features/org-structure/api/systemSettings.ts` + `.test.ts`
- Create: `web/src/features/org-structure/api/demographicFields.ts` + `.test.ts`
- Create: `web/src/features/org-structure/api/bulkImport.ts`

**Interfaces:**
- Consumes: `authFetch` (existing).
- Produces: typed clients for Tasks 6-8.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/org-structure/api/companySettings.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { updateCompanySettings } from './companySettings'

const baseUrl = 'http://api.test'

describe('companySettings api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('updates company settings', async () => {
    const result = {
      companyId: 'c1',
      settings: { surveyFrequency: 'monthly', microclimateEnabled: true, aiInsightsEnabled: true, anonymousSurveys: false, dataRetentionDays: 2555, timezone: 'UTC', language: 'en' },
      branding: { logoUrl: null, primaryColor: '#3B82F6', secondaryColor: '#1F2937', fontFamily: 'Inter', customCss: null },
    }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }))

    const response = await updateCompanySettings(baseUrl, 'c1', { surveyFrequency: 'monthly' })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/companies/c1/settings`, expect.objectContaining({ method: 'PUT' }))
    expect(response.settings.surveyFrequency).toBe('monthly')
  })
})
```

Create `web/src/features/org-structure/api/systemSettings.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { getSystemSettings, updateSystemSettings } from './systemSettings'

const baseUrl = 'http://api.test'

describe('systemSettings api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  const settings = {
    loginEnabled: true, maintenanceMode: false, maintenanceMessage: null, maxLoginAttempts: 5, sessionTimeoutMinutes: 60,
    passwordPolicy: { minLength: 8, requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: false },
    emailSettings: { smtpEnabled: false, fromEmail: null, smtpHost: null, smtpPort: null },
    updatedAt: '2026-01-01',
  }

  it('gets system settings', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(settings), { status: 200 }))
    const result = await getSystemSettings(baseUrl)
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/system-settings`, expect.anything())
    expect(result).toEqual(settings)
  })

  it('updates system settings', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...settings, loginEnabled: false }), { status: 200 }))
    const result = await updateSystemSettings(baseUrl, { loginEnabled: false })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/system-settings`, expect.objectContaining({ method: 'PUT' }))
    expect(result.loginEnabled).toBe(false)
  })
})
```

Create `web/src/features/org-structure/api/demographicFields.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listDemographicFields, createDemographicField, updateDemographicField } from './demographicFields'

const baseUrl = 'http://api.test'

describe('demographicFields api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists fields for a company', async () => {
    const fields = [{ id: 'f1', companyId: 'c1', field: 'gender', label: 'Gender', type: 'select', options: ['A', 'B'], required: true, order: 1, isActive: true }]
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ fields }), { status: 200 }))
    const result = await listDemographicFields(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/demographic-fields?companyId=c1`, expect.anything())
    expect(result).toEqual(fields)
  })

  it('creates a field', async () => {
    const created = { id: 'f1', companyId: 'c1', field: 'gender', label: 'Gender', type: 'select', options: ['A', 'B'], required: true, order: 1, isActive: true }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }))
    const result = await createDemographicField(baseUrl, { companyId: 'c1', field: 'gender', label: 'Gender', type: 'select', options: ['A', 'B'], required: true, order: 1 })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/demographic-fields`, expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(created)
  })

  it('updates a field', async () => {
    const updated = { id: 'f1', companyId: 'c1', field: 'gender', label: 'Gender Identity', type: 'select', options: ['A', 'B'], required: true, order: 1, isActive: true }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }))
    const result = await updateDemographicField(baseUrl, 'f1', { label: 'Gender Identity' })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/demographic-fields/f1`, expect.objectContaining({ method: 'PUT' }))
    expect(result.label).toBe('Gender Identity')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- companySettings.test.ts systemSettings.test.ts demographicFields.test.ts` (from `web/`)
Expected: FAIL (modules don't exist yet).

- [ ] **Step 3: Implement the clients**

Create `web/src/features/org-structure/api/companySettings.ts`:

```typescript
import { authFetch } from '../../../api/authFetch'

export interface CompanySettingsData {
  surveyFrequency: string
  microclimateEnabled: boolean
  aiInsightsEnabled: boolean
  anonymousSurveys: boolean
  dataRetentionDays: number
  timezone: string
  language: string
}

export interface CompanyBranding {
  logoUrl: string | null
  primaryColor: string
  secondaryColor: string
  fontFamily: string
  customCss: string | null
}

export interface CompanySettingsResponse {
  companyId: string
  settings: CompanySettingsData
  branding: CompanyBranding
}

export interface UpdateCompanySettingsInput {
  surveyFrequency?: string
  microclimateEnabled?: boolean
  aiInsightsEnabled?: boolean
  anonymousSurveys?: boolean
  dataRetentionDays?: number
  timezone?: string
  language?: string
  logoUrl?: string
  primaryColor?: string
  secondaryColor?: string
  fontFamily?: string
  customCss?: string
}

export async function updateCompanySettings(baseUrl: string, companyId: string, input: UpdateCompanySettingsInput): Promise<CompanySettingsResponse> {
  const response = await authFetch(`${baseUrl}/admin/companies/${companyId}/settings`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<CompanySettingsResponse>
}
```

Create `web/src/features/org-structure/api/systemSettings.ts`:

```typescript
import { authFetch } from '../../../api/authFetch'

export interface PasswordPolicy {
  minLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireNumbers: boolean
  requireSpecialChars: boolean
}

export interface SystemEmailSettings {
  smtpEnabled: boolean
  fromEmail: string | null
  smtpHost: string | null
  smtpPort: number | null
}

export interface SystemSettingsData {
  loginEnabled: boolean
  maintenanceMode: boolean
  maintenanceMessage: string | null
  maxLoginAttempts: number
  sessionTimeoutMinutes: number
  passwordPolicy: PasswordPolicy
  emailSettings: SystemEmailSettings
  updatedAt: string
}

export interface UpdateSystemSettingsInput {
  loginEnabled?: boolean
  maintenanceMode?: boolean
  maintenanceMessage?: string
  maxLoginAttempts?: number
  sessionTimeoutMinutes?: number
  passwordPolicy?: PasswordPolicy
  emailSettings?: SystemEmailSettings
}

export async function getSystemSettings(baseUrl: string): Promise<SystemSettingsData> {
  const response = await authFetch(`${baseUrl}/admin/system-settings`)
  return response.json() as Promise<SystemSettingsData>
}

export async function updateSystemSettings(baseUrl: string, input: UpdateSystemSettingsInput): Promise<SystemSettingsData> {
  const response = await authFetch(`${baseUrl}/admin/system-settings`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<SystemSettingsData>
}
```

Create `web/src/features/org-structure/api/demographicFields.ts`:

```typescript
import { authFetch } from '../../../api/authFetch'

export interface DemographicField {
  id: string
  companyId: string
  field: string
  label: string
  type: string
  options: string[] | null
  required: boolean
  order: number
  isActive: boolean
}

export interface CreateDemographicFieldInput {
  companyId: string
  field: string
  label: string
  type: string
  options?: string[]
  required: boolean
  order: number
}

export interface UpdateDemographicFieldInput {
  label?: string
  options?: string[]
  required?: boolean
  order?: number
  isActive?: boolean
}

export async function listDemographicFields(baseUrl: string, companyId: string): Promise<DemographicField[]> {
  const response = await authFetch(`${baseUrl}/admin/demographic-fields?companyId=${companyId}`)
  const body = (await response.json()) as { fields: DemographicField[] }
  return body.fields
}

export async function createDemographicField(baseUrl: string, input: CreateDemographicFieldInput): Promise<DemographicField> {
  const response = await authFetch(`${baseUrl}/admin/demographic-fields`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<DemographicField>
}

export async function updateDemographicField(baseUrl: string, id: string, input: UpdateDemographicFieldInput): Promise<DemographicField> {
  const response = await authFetch(`${baseUrl}/admin/demographic-fields/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<DemographicField>
}
```

Create `web/src/features/org-structure/api/bulkImport.ts` (no test file — this one does its own
`fetch` with `FormData`, deliberately not going through `authFetch`'s JSON `Content-Type` header,
since a multipart body must set its own boundary-bearing content type that `fetch` derives
automatically from a `FormData` body; it still needs the bearer token, so it reads it directly):

```typescript
import { getToken } from '../../../auth/token'

export interface BulkImportRowResult {
  rowNumber: number
  name: string
  email: string
  role: string
  department: string | null
  status: string
  errors: string[]
}

export interface BulkImportResponse {
  rows: BulkImportRowResult[]
  successCount: number
  errorCount: number
}

export async function bulkImportUsers(baseUrl: string, companyId: string, file: File, preview: boolean): Promise<BulkImportResponse> {
  const form = new FormData()
  form.append('file', file)
  form.append('companyId', companyId)
  form.append('preview', String(preview))

  const token = getToken()
  const headers = new Headers()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${baseUrl}/admin/users/bulk-import`, {
    method: 'POST',
    headers,
    body: form,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error((body && body.message) || `Request failed: ${response.status}`)
  }

  return response.json() as Promise<BulkImportResponse>
}
```

- [ ] **Step 4: Run the tests to verify they pass, run the build**

Run: `npm test` (from `web/`) — expect PASS, all tests including the 8 new ones.
Run: `npm run build` (from `web/`) — expect success.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/org-structure/api/companySettings.ts web/src/features/org-structure/api/companySettings.test.ts \
        web/src/features/org-structure/api/systemSettings.ts web/src/features/org-structure/api/systemSettings.test.ts \
        web/src/features/org-structure/api/demographicFields.ts web/src/features/org-structure/api/demographicFields.test.ts \
        web/src/features/org-structure/api/bulkImport.ts
git commit -m "feat: add typed API clients for company settings, system settings, demographic fields, bulk import"
```

---

## Task 6: Frontend — SystemSettingsPage + CompanySettingsForm

**Files:**
- Create: `web/src/features/org-structure/components/SystemSettingsForm.tsx`
- Create: `web/src/features/org-structure/pages/SystemSettingsPage.tsx`
- Create: `web/src/features/org-structure/components/CompanySettingsForm.tsx`
- Modify: `web/src/features/org-structure/pages/CompanyDetailPage.tsx`
- Modify: `web/src/app/router.tsx`

**Interfaces:**
- Consumes: `getSystemSettings`, `updateSystemSettings` (Task 5), `updateCompanySettings` (Task 5).
- Produces: nothing consumed by a later task.

- [ ] **Step 1: System settings form + page**

Create `web/src/features/org-structure/components/SystemSettingsForm.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import type { SystemSettingsData } from '../api/systemSettings'

interface SystemSettingsFormProps {
  settings: SystemSettingsData
  onSubmit: (values: { loginEnabled: boolean; maintenanceMode: boolean; maintenanceMessage: string; maxLoginAttempts: number; sessionTimeoutMinutes: number }) => Promise<void>
}

export default function SystemSettingsForm({ settings, onSubmit }: SystemSettingsFormProps) {
  const [loginEnabled, setLoginEnabled] = useState(settings.loginEnabled)
  const [maintenanceMode, setMaintenanceMode] = useState(settings.maintenanceMode)
  const [maintenanceMessage, setMaintenanceMessage] = useState(settings.maintenanceMessage ?? '')
  const [maxLoginAttempts, setMaxLoginAttempts] = useState(settings.maxLoginAttempts)
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(settings.sessionTimeoutMinutes)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit({ loginEnabled, maintenanceMode, maintenanceMessage, maxLoginAttempts, sessionTimeoutMinutes })
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
        <input type="checkbox" checked={loginEnabled} onChange={(e) => setLoginEnabled(e.target.checked)} />
        Login enabled
      </label>
      <label>
        <input type="checkbox" checked={maintenanceMode} onChange={(e) => setMaintenanceMode(e.target.checked)} />
        Maintenance mode
      </label>
      <label>
        Maintenance message
        <input value={maintenanceMessage} onChange={(e) => setMaintenanceMessage(e.target.value)} />
      </label>
      <label>
        Max login attempts
        <input type="number" value={maxLoginAttempts} onChange={(e) => setMaxLoginAttempts(Number(e.target.value))} min={1} />
      </label>
      <label>
        Session timeout (minutes)
        <input type="number" value={sessionTimeoutMinutes} onChange={(e) => setSessionTimeoutMinutes(Number(e.target.value))} min={1} />
      </label>
      <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</button>
    </form>
  )
}
```

Create `web/src/features/org-structure/pages/SystemSettingsPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { getSystemSettings, updateSystemSettings, type SystemSettingsData } from '../api/systemSettings'
import SystemSettingsForm from '../components/SystemSettingsForm'

export default function SystemSettingsPage() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [settings, setSettings] = useState<SystemSettingsData | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setError(null)
    try {
      const result = await getSystemSettings(baseUrl)
      setSettings(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load system settings')
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleSubmit(values: { loginEnabled: boolean; maintenanceMode: boolean; maintenanceMessage: string; maxLoginAttempts: number; sessionTimeoutMinutes: number }) {
    await updateSystemSettings(baseUrl, values)
    await reload()
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  return (
    <div>
      <h1>System settings</h1>
      {settings ? <SystemSettingsForm settings={settings} onSubmit={handleSubmit} /> : <p>Loading…</p>}
    </div>
  )
}
```

- [ ] **Step 2: Company settings form (embedded in CompanyDetailPage)**

Create `web/src/features/org-structure/components/CompanySettingsForm.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import type { CompanySettingsData, CompanyBranding } from '../api/companySettings'

export interface CompanySettingsFormValues {
  surveyFrequency: string
  microclimateEnabled: boolean
  anonymousSurveys: boolean
  primaryColor: string
}

interface CompanySettingsFormProps {
  settings: CompanySettingsData
  branding: CompanyBranding
  onSubmit: (values: CompanySettingsFormValues) => Promise<void>
}

export default function CompanySettingsForm({ settings, branding, onSubmit }: CompanySettingsFormProps) {
  const [values, setValues] = useState<CompanySettingsFormValues>({
    surveyFrequency: settings.surveyFrequency,
    microclimateEnabled: settings.microclimateEnabled,
    anonymousSurveys: settings.anonymousSurveys,
    primaryColor: branding.primaryColor,
  })
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
        Survey frequency
        <input value={values.surveyFrequency} onChange={(e) => setValues({ ...values, surveyFrequency: e.target.value })} />
      </label>
      <label>
        <input type="checkbox" checked={values.microclimateEnabled} onChange={(e) => setValues({ ...values, microclimateEnabled: e.target.checked })} />
        Microclimates enabled
      </label>
      <label>
        <input type="checkbox" checked={values.anonymousSurveys} onChange={(e) => setValues({ ...values, anonymousSurveys: e.target.checked })} />
        Anonymous surveys
      </label>
      <label>
        Primary color
        <input type="color" value={values.primaryColor} onChange={(e) => setValues({ ...values, primaryColor: e.target.value })} />
      </label>
      <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save settings'}</button>
    </form>
  )
}
```

- [ ] **Step 3: Wire into CompanyDetailPage**

Modify `web/src/features/org-structure/pages/CompanyDetailPage.tsx` — add the imports:

```tsx
import { updateCompanySettings, type CompanySettingsResponse } from '../api/companySettings'
import CompanySettingsForm, { type CompanySettingsFormValues } from '../components/CompanySettingsForm'
```

Add state for the settings response (fetched lazily since `CompanyDetail` from `getCompany`
doesn't include settings/branding — this is a separate concern per the design):

```tsx
  const [companySettings, setCompanySettings] = useState<CompanySettingsResponse | null>(null)
```

Add a handler:

```tsx
  async function handleUpdateSettings(values: CompanySettingsFormValues) {
    if (!id) return
    const result = await updateCompanySettings(baseUrl, id, values)
    setCompanySettings(result)
  }
```

Add a section to the returned JSX, after the existing company-edit block and before the
`<h2>Departments</h2>` line:

```tsx
      <h2>Settings</h2>
      {companySettings ? (
        <CompanySettingsForm settings={companySettings.settings} branding={companySettings.branding} onSubmit={handleUpdateSettings} />
      ) : (
        <button onClick={() => updateCompanySettings(baseUrl, id!, {}).then(setCompanySettings)}>Load settings</button>
      )}
```

The "Load settings" button is a deliberate simplification: there's no `GET` endpoint for company
settings in this plan (only `PUT`, matching the design doc's endpoint table), so the first `PUT`
call with an empty body (no fields set — every field is optional and a no-op when absent, per
Task 2's handler) doubles as a fetch. This avoids adding a fifth backend endpoint for a
read-only view that isn't otherwise needed.

- [ ] **Step 4: Wire the SystemSettingsPage route**

Modify `web/src/app/router.tsx` — add the import:

```tsx
import SystemSettingsPage from '../features/org-structure/pages/SystemSettingsPage'
```

Add the route as a sibling of the other `AdminLayout` children:

```tsx
              { path: '/admin/system-settings', element: <SystemSettingsPage /> },
```

- [ ] **Step 5: Verify manually**

Run `npm run build` and `npm test` (from `web/`) — no browser available to this implementer,
matching every prior frontend UI task's precedent.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/org-structure/components/SystemSettingsForm.tsx \
        web/src/features/org-structure/pages/SystemSettingsPage.tsx \
        web/src/features/org-structure/components/CompanySettingsForm.tsx \
        web/src/features/org-structure/pages/CompanyDetailPage.tsx \
        web/src/app/router.tsx
git commit -m "feat: add SystemSettingsPage and company settings/branding form"
```

---

## Task 7: Frontend — DemographicFieldsPage

**Files:**
- Create: `web/src/features/org-structure/components/DemographicFieldList.tsx`
- Create: `web/src/features/org-structure/components/DemographicFieldForm.tsx`
- Create: `web/src/features/org-structure/pages/DemographicFieldsPage.tsx`
- Modify: `web/src/app/router.tsx`
- Modify: `web/src/features/org-structure/pages/CompanyDetailPage.tsx`

**Interfaces:**
- Consumes: `listDemographicFields`, `createDemographicField`, `updateDemographicField` (Task 5).
- Produces: nothing consumed by a later task.

- [ ] **Step 1: List component**

Create `web/src/features/org-structure/components/DemographicFieldList.tsx`:

```tsx
import type { DemographicField } from '../api/demographicFields'

export default function DemographicFieldList({ fields, onEdit }: { fields: DemographicField[]; onEdit: (field: DemographicField) => void }) {
  if (fields.length === 0) {
    return <p>No demographic fields defined yet.</p>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Label</th>
          <th>Type</th>
          <th>Required</th>
          <th>Active</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <tr key={field.id}>
            <td>{field.label}</td>
            <td>{field.type}</td>
            <td>{field.required ? 'Yes' : 'No'}</td>
            <td>{field.isActive ? 'Yes' : 'No'}</td>
            <td><button onClick={() => onEdit(field)}>Edit</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 2: Create/edit form**

Create `web/src/features/org-structure/components/DemographicFieldForm.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import type { DemographicField } from '../api/demographicFields'

export interface DemographicFieldFormValues {
  field: string
  label: string
  type: string
  optionsText: string
  required: boolean
  order: number
}

interface DemographicFieldFormProps {
  initialValues?: Partial<DemographicField>
  submitLabel: string
  onSubmit: (values: DemographicFieldFormValues) => Promise<void>
}

const TYPES = ['select', 'text', 'number', 'date']

export default function DemographicFieldForm({ initialValues, submitLabel, onSubmit }: DemographicFieldFormProps) {
  const [values, setValues] = useState<DemographicFieldFormValues>({
    field: initialValues?.field ?? '',
    label: initialValues?.label ?? '',
    type: initialValues?.type ?? 'text',
    optionsText: (initialValues?.options ?? []).join(', '),
    required: initialValues?.required ?? false,
    order: initialValues?.order ?? 0,
  })
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
        Field key
        <input value={values.field} onChange={(e) => setValues({ ...values, field: e.target.value })} required disabled={Boolean(initialValues?.field)} />
      </label>
      <label>
        Label
        <input value={values.label} onChange={(e) => setValues({ ...values, label: e.target.value })} required />
      </label>
      <label>
        Type
        <select value={values.type} onChange={(e) => setValues({ ...values, type: e.target.value })} disabled={Boolean(initialValues?.field)}>
          {TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </label>
      {values.type === 'select' && (
        <label>
          Options (comma-separated)
          <input value={values.optionsText} onChange={(e) => setValues({ ...values, optionsText: e.target.value })} />
        </label>
      )}
      <label>
        <input type="checkbox" checked={values.required} onChange={(e) => setValues({ ...values, required: e.target.checked })} />
        Required
      </label>
      <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</button>
    </form>
  )
}
```

`field` and `type` are disabled on edit (the backend's `UpdateDemographicFieldRequest` doesn't
accept either — matching Task 3's DTO exactly, so the UI doesn't offer a control that would
silently no-op).

- [ ] **Step 3: List page**

Create `web/src/features/org-structure/pages/DemographicFieldsPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { listDemographicFields, createDemographicField, updateDemographicField, type DemographicField } from '../api/demographicFields'
import DemographicFieldList from '../components/DemographicFieldList'
import DemographicFieldForm, { type DemographicFieldFormValues } from '../components/DemographicFieldForm'

export default function DemographicFieldsPage() {
  const { companyId } = useParams<{ companyId: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [fields, setFields] = useState<DemographicField[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editingField, setEditingField] = useState<DemographicField | null>(null)
  const [creating, setCreating] = useState(false)

  async function reload() {
    if (!companyId) return
    setError(null)
    try {
      const result = await listDemographicFields(baseUrl, companyId)
      setFields(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load demographic fields')
    }
  }

  useEffect(() => {
    reload()
  }, [companyId])

  function parseOptions(optionsText: string): string[] | undefined {
    const trimmed = optionsText.split(',').map((o) => o.trim()).filter(Boolean)
    return trimmed.length > 0 ? trimmed : undefined
  }

  async function handleCreate(values: DemographicFieldFormValues) {
    if (!companyId) return
    await createDemographicField(baseUrl, {
      companyId,
      field: values.field,
      label: values.label,
      type: values.type,
      options: parseOptions(values.optionsText),
      required: values.required,
      order: values.order,
    })
    setCreating(false)
    await reload()
  }

  async function handleUpdate(values: DemographicFieldFormValues) {
    if (!editingField) return
    await updateDemographicField(baseUrl, editingField.id, {
      label: values.label,
      options: parseOptions(values.optionsText),
      required: values.required,
      order: values.order,
    })
    setEditingField(null)
    await reload()
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  return (
    <div>
      <h1>Demographic fields</h1>
      <button onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : 'New field'}</button>
      {creating && <DemographicFieldForm submitLabel="Create field" onSubmit={handleCreate} />}
      {editingField && (
        <DemographicFieldForm key={editingField.id} initialValues={editingField} submitLabel="Save field" onSubmit={handleUpdate} />
      )}
      <DemographicFieldList fields={fields} onEdit={setEditingField} />
    </div>
  )
}
```

- [ ] **Step 4: Wire the route and a link from CompanyDetailPage**

Modify `web/src/app/router.tsx` — add the import:

```tsx
import DemographicFieldsPage from '../features/org-structure/pages/DemographicFieldsPage'
```

Add the route as a sibling of the users route:

```tsx
              { path: '/admin/companies/:companyId/demographic-fields', element: <DemographicFieldsPage /> },
```

Modify `web/src/features/org-structure/pages/CompanyDetailPage.tsx` — add a link next to the
existing "Manage users" link (from Slice 2 Task 6):

```tsx
      <p><Link to={`/admin/companies/${company.id}/demographic-fields`}>Manage demographic fields</Link></p>
```

- [ ] **Step 5: Verify manually**

Run `npm run build` and `npm test` (from `web/`).

- [ ] **Step 6: Commit**

```bash
git add web/src/features/org-structure/components/DemographicFieldList.tsx \
        web/src/features/org-structure/components/DemographicFieldForm.tsx \
        web/src/features/org-structure/pages/DemographicFieldsPage.tsx \
        web/src/app/router.tsx \
        web/src/features/org-structure/pages/CompanyDetailPage.tsx
git commit -m "feat: add DemographicFieldsPage (list, create, edit)"
```

---

## Task 8: Frontend — BulkImportPanel

**Files:**
- Create: `web/src/features/org-structure/components/BulkImportPanel.tsx`
- Modify: `web/src/features/org-structure/pages/UsersListPage.tsx`

**Interfaces:**
- Consumes: `bulkImportUsers` (Task 5).
- Produces: nothing consumed by a later task — last task in this plan.

- [ ] **Step 1: Bulk import panel**

Create `web/src/features/org-structure/components/BulkImportPanel.tsx`:

```tsx
import { useState } from 'react'
import { bulkImportUsers, type BulkImportResponse } from '../api/bulkImport'

interface BulkImportPanelProps {
  baseUrl: string
  companyId: string
  onImported: () => void
}

export default function BulkImportPanel({ baseUrl, companyId, onImported }: BulkImportPanelProps) {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<BulkImportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handlePreview() {
    if (!file) return
    setError(null)
    setSubmitting(true)
    try {
      const response = await bulkImportUsers(baseUrl, companyId, file, true)
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleConfirm() {
    if (!file) return
    setError(null)
    setSubmitting(true)
    try {
      const response = await bulkImportUsers(baseUrl, companyId, file, false)
      setResult(response)
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <p>CSV columns: name, email, role, department. Embedded commas inside a field are not supported.</p>
      <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button onClick={handlePreview} disabled={!file || submitting}>Preview</button>
      <button onClick={handleConfirm} disabled={!file || submitting}>Import</button>
      {result && (
        <table>
          <thead>
            <tr><th>Row</th><th>Name</th><th>Email</th><th>Status</th><th>Errors</th></tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.rowNumber}>
                <td>{row.rowNumber}</td>
                <td>{row.name}</td>
                <td>{row.email}</td>
                <td>{row.status}</td>
                <td>{row.errors.join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire into UsersListPage**

Modify `web/src/features/org-structure/pages/UsersListPage.tsx` — add the import:

```tsx
import BulkImportPanel from '../components/BulkImportPanel'
```

Add a section to the returned JSX, after the existing `<InvitationList ... />` line (from
Slice 2 Task 7):

```tsx
      <h2>Bulk import</h2>
      {companyId && <BulkImportPanel baseUrl={baseUrl} companyId={companyId} onImported={reload} />}
```

- [ ] **Step 3: Verify manually**

Run `npm run build` and `npm test` (from `web/`).

- [ ] **Step 4: Commit**

```bash
git add web/src/features/org-structure/components/BulkImportPanel.tsx \
        web/src/features/org-structure/pages/UsersListPage.tsx
git commit -m "feat: add BulkImportPanel to UsersListPage"
```
