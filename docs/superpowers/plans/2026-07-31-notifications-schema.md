# climate-project-api Notifications Schema (#55 slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Notifications domain (#55, the smallest remaining slice of #49's full data-model epic) to `climate-project-api`'s Postgres schema — a high-write-volume, mostly-immutable `notifications` table, plus `notification_templates` and its two junction tables (`notification_template_variables`, `notification_personalization_rules`) — on top of the Company/User/Department schema already merged to `main` (org-structure slice, commits `46033a5`/`b90bfa5`/`d662463`).

**Architecture:** Same clean-architecture layering as every prior #49 slice: plain POCO entities in `ClimateProject.Domain/Entities/`, `IEntityTypeConfiguration<T>` classes in `ClimateProject.Infrastructure/Persistence/Configurations/`, applied via `modelBuilder.ApplyConfigurationsFromAssembly`, new EF Core migrations added on top of the current tip (`20260731100805_AddUserProfileFields`). `Notification.Metadata` is an EF Core **owned type** (`NotificationMetadata`) — always-present, inline columns on `notifications`, matching `CompanyBranding`/`UserPreferences`/etc. `NotificationTemplate`, `NotificationTemplateVariable`, and `NotificationPersonalizationRule` are **plain FK-linked entities**, not owned types — the design spec calls the latter two "junction" tables and they're independently-queryable child rows of a template (parallel to `Department`/`User` being independent tables linked by FK, not owned shapes), each with their own `IEntityTypeConfiguration<T>` and their own `Id`. `Notification.Data`, `NotificationTemplateVariable.DefaultValue`, and `NotificationPersonalizationRule.Modifications` are `string?` jsonb columns per the established convention — plain nullable string, no `JsonDocument`/`Dictionary`, no DB-level default (matches `User.Demographics`, `UserInvitation.Metadata`/`InvitationData`, `AuditLog.Details` — none of which enforce NOT NULL or a default at the DB layer even where the legacy Mongoose model marks the field required or defaults it to `{}`; "required" is an application-layer concern for whichever future task builds the actual send/render logic, not a DB constraint here).

**Tech Stack:** .NET 10, EF Core + Npgsql, xUnit, Testcontainers.PostgreSql (all already in place — no new packages).

## Global Constraints

- Repo: `/Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api`, branch `main`, currently at commit `d662463` (tip migration: `20260731100805_AddUserProfileFields`). Work directly on `main` via a new feature branch per task, PR (`gh pr create --repo TIMSInternational/climate-project-api`), squash-merge (`gh pr merge --squash --delete-branch`) — same convention every prior #49 task used.
- **EF Core conventions** (mirror the org-structure slice exactly): snake_case table/column names via explicit `.ToTable(...)`/`.HasColumnName(...)` in `Infrastructure/Persistence/Configurations/`. **Exception**: `Id` primary-key columns stay PascalCase `"Id"` (no `.HasColumnName("id")` override) — matches `companies`/`users`/`departments` exactly.
- **Enums stay plain C# strings**, no C# enum type. Skip `.HasConversion<string>()` entirely on any property whose CLR type is already `string` (it's a no-op — `DepartmentConfiguration.Settings.MicroclimateFrequency` has this vestigial call from an earlier task; do not repeat it). None of this domain's entities need `.HasConversion<string>()` anywhere since `Type`/`Channel`/`Priority`/`Status`/`NotificationTemplateVariable.Type` are all declared as plain `string`/`string?` CLR properties from the start.
- **Owned types**: `Notification.Metadata` (`NotificationMetadata`) via `.OwnsOne(n => n.Metadata, ...)`, inline columns prefixed `metadata_*`. It is the only owned shape in this domain — `NotificationTemplate`'s variables/rules are separate tables (see Architecture), not owned collections.
- **CRITICAL LESSON reminder**: every NOT NULL column with a non-zero/non-empty intended default MUST have `.HasDefaultValue(...)` in the Fluent config, and each task's tests must include a raw-SQL-insert-then-EF-read test proving the DB-level default (not just the C# object-initializer default) is what a minimal insert actually gets. In this domain that applies to `Notification.Priority` (`"medium"`), `Notification.Status` (`"pending"`), `Notification.MaxRetries` (`3`), `Notification.RetryCount` (`0` — needed so a minimal raw-SQL insert that omits the column doesn't hit a NOT NULL violation), `NotificationTemplate.IsActive` (`true`), `NotificationTemplate.IsDefault` (`false`), and `NotificationTemplateVariable.Required` (`false`).
- **jsonb columns**: `string?` CLR property, `.HasColumnType("jsonb")`, no `JsonDocument`/`Dictionary<string,object>`, no default, not required — applies to `Notification.Data`, `NotificationTemplateVariable.DefaultValue`, `NotificationPersonalizationRule.Modifications`.
- **Real enum values, confirmed from the legacy Mongoose models** (`climate-project/src/models/Notification.ts`, `NotificationTemplate.ts`) — use exactly these, lowercase/snake_case, as plain strings (no `.HasConversion<string>()` needed since the CLR type is already `string`):
  - `Notification.Type` / `NotificationTemplate.Type`: `survey_invitation`, `survey_reminder`, `survey_completion`, `microclimate_invitation`, `user_invitation`, `action_plan_alert`, `deadline_reminder`, `ai_insight_alert`, `system_notification` (the legacy `NotificationTemplate.type` enum omits `user_invitation`, but per the "no CHECK constraints, DB doesn't enforce enum membership" convention already used for every other string-enum in this codebase, both columns share one unconstrained `character varying(32)` shape — no DB-level difference).
  - `Notification.Channel` / `NotificationTemplate.Channel`: `email`, `in_app`, `push`, `sms`
  - `Notification.Priority`: `low`, `medium`, `high`, `critical` (default `medium`)
  - `Notification.Status`: `pending`, `sent`, `delivered`, `opened`, `failed`, `cancelled` (default `pending`)
  - `NotificationTemplateVariable.Type`: `string`, `number`, `date`, `boolean`, `object`
- **Column length choices**: `character varying(32)` for `Type`/`NotificationTemplate.Type` (longest legacy value `microclimate_invitation` = 23 chars), `character varying(20)` for `Channel`/`Priority`/`Status`/`NotificationTemplateVariable.Type` (matches the established "short enum string" precedent already used for `CompanySettings.SurveyFrequency`/`Company.Size`/`Company.SubscriptionTier`/`DepartmentSettings.MicroclimateFrequency`, all `20`). `Title`/`Subject` at `500`. `Message`/`Content`/`HtmlContent`/`Condition` as `text` (unbounded — template bodies and evaluation conditions have no natural cap). `FailureReason`/`NotificationTemplateVariable.Description` at `1000` (matches `Department.Description`'s precedent).
- `Directory.Build.props` sets `TreatWarningsAsErrors=true` — all code must be warning-clean. Every task ends with a full `dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx` run, 0 warnings, before commit.
- Integration tests: Docker required. Reuse the existing `tests/ClimateProject.IntegrationTests/Support/PostgresContainerFixture.cs` unchanged — construct `DbContextOptionsBuilder<ClimateProjectDbContext>().UseNpgsql(postgres.ConnectionString)` directly in each test class exactly like `DepartmentTests.cs`/`CompanyProfileTests.cs`/`UserProfileTests.cs` already do.
- Migrations are strictly additive on top of `20260731100805_AddUserProfileFields` — never modify or regenerate a prior migration. Generate via: `dotnet ef migrations add <Name> --project src/ClimateProject.Infrastructure --startup-project src/ClimateProject.Api --output-dir Migrations` (`dotnet-ef` v10.0.10 already installed globally).
- Cross-aggregate FK ordering: `Notification.TemplateId` references `NotificationTemplate`, which doesn't exist until Task 2. Task 1 adds `template_id` as a bare nullable `Guid` column with **no** FK constraint (same pattern the org-structure plan used for `Department.ManagerId` before `User` existed). Task 2 retrofits the FK (`OnDelete(DeleteBehavior.SetNull)` — an optional cross-entity link, template deletion shouldn't take notifications down with it) once `notification_templates` exists, via an additive `AddForeignKey` migration in the same task that creates the table.
- `Notification.UserId`/`CompanyId` and `NotificationTemplate.CreatedBy` are required parent-owns-child-shaped FKs → default `Cascade` (no `OnDelete` override), matching `Department.CompanyId`/`User.CompanyId`. `NotificationTemplate.CompanyId` is optional (nullable, "company-specific vs. global default" per the legacy model) → `OnDelete(DeleteBehavior.SetNull)`, matching `User.DepartmentId`. `NotificationTemplateVariable.NotificationTemplateId` and `NotificationPersonalizationRule.NotificationTemplateId` are required parent-owns-child FKs (a variable/rule belongs to exactly one template, the literal "Question belonging to a Survey" example from the established convention) → default `Cascade`.

---

### Task 1: Notification entity + owned NotificationMetadata

**Files:**
- Create: `src/ClimateProject.Domain/Entities/Notification.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/NotificationConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — add `DbSet<Notification> Notifications`
- Create: `src/ClimateProject.Infrastructure/Migrations/*` (generated)
- Test: `tests/ClimateProject.IntegrationTests/Persistence/NotificationTests.cs`

**Interfaces:**
- Consumes: `Company`, `User` (required FKs).
- Produces: `Notification { Id, UserId, CompanyId, Type, Channel, Priority="medium", Status="pending", Title, Message, Data (jsonb?), TemplateId (Guid?, no FK yet), ScheduledFor, SentAt?, DeliveredAt?, OpenedAt?, FailedAt?, FailureReason?, RetryCount=0, MaxRetries=3, Metadata (owned), CreatedAt, UpdatedAt }`. Task 2 adds the `TemplateId` → `NotificationTemplate` FK constraint.

- [ ] **Step 1: Create a feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/notifications
```

- [ ] **Step 2: Write the Notification entity**

`src/ClimateProject.Domain/Entities/Notification.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class Notification
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid CompanyId { get; set; }
    public required string Type { get; set; }
    public required string Channel { get; set; }
    public string Priority { get; set; } = "medium";
    public string Status { get; set; } = "pending";
    public required string Title { get; set; }
    public required string Message { get; set; }
    public string? Data { get; set; }
    public Guid? TemplateId { get; set; }
    public DateTimeOffset ScheduledFor { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public DateTimeOffset? DeliveredAt { get; set; }
    public DateTimeOffset? OpenedAt { get; set; }
    public DateTimeOffset? FailedAt { get; set; }
    public string? FailureReason { get; set; }
    public int RetryCount { get; set; }
    public int MaxRetries { get; set; } = 3;
    public NotificationMetadata Metadata { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class NotificationMetadata
{
    public string? UserAgent { get; set; }
    public string? IpAddress { get; set; }
    public string? EmailClient { get; set; }
    public string? DeviceType { get; set; }
}
```

- [ ] **Step 3: Write the NotificationConfiguration**

`src/ClimateProject.Infrastructure/Persistence/Configurations/NotificationConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class NotificationConfiguration : IEntityTypeConfiguration<Notification>
{
    public void Configure(EntityTypeBuilder<Notification> builder)
    {
        builder.ToTable("notifications");
        builder.HasKey(n => n.Id);
        builder.Property(n => n.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(n => n.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(n => n.Type).HasColumnName("type").HasMaxLength(32).IsRequired();
        builder.Property(n => n.Channel).HasColumnName("channel").HasMaxLength(20).IsRequired();
        builder.Property(n => n.Priority).HasColumnName("priority").HasMaxLength(20).IsRequired().HasDefaultValue("medium");
        builder.Property(n => n.Status).HasColumnName("status").HasMaxLength(20).IsRequired().HasDefaultValue("pending");
        builder.Property(n => n.Title).HasColumnName("title").HasMaxLength(500).IsRequired();
        builder.Property(n => n.Message).HasColumnName("message").HasColumnType("text").IsRequired();
        builder.Property(n => n.Data).HasColumnName("data").HasColumnType("jsonb");
        builder.Property(n => n.TemplateId).HasColumnName("template_id");
        builder.Property(n => n.ScheduledFor).HasColumnName("scheduled_for").IsRequired();
        builder.Property(n => n.SentAt).HasColumnName("sent_at");
        builder.Property(n => n.DeliveredAt).HasColumnName("delivered_at");
        builder.Property(n => n.OpenedAt).HasColumnName("opened_at");
        builder.Property(n => n.FailedAt).HasColumnName("failed_at");
        builder.Property(n => n.FailureReason).HasColumnName("failure_reason").HasMaxLength(1000);
        builder.Property(n => n.RetryCount).HasColumnName("retry_count").IsRequired().HasDefaultValue(0);
        builder.Property(n => n.MaxRetries).HasColumnName("max_retries").IsRequired().HasDefaultValue(3);
        builder.Property(n => n.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(n => n.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(n => new { n.UserId, n.CreatedAt });
        builder.HasIndex(n => new { n.CompanyId, n.CreatedAt });
        builder.HasIndex(n => new { n.Status, n.ScheduledFor });
        builder.HasIndex(n => new { n.Type, n.Status });
        builder.HasIndex(n => new { n.Priority, n.ScheduledFor });
        builder.HasIndex(n => new { n.UserId, n.Status, n.CreatedAt });
        builder.HasIndex(n => new { n.CompanyId, n.Status, n.CreatedAt });

        builder.HasOne<User>().WithMany().HasForeignKey(n => n.UserId);
        builder.HasOne<Company>().WithMany().HasForeignKey(n => n.CompanyId);

        builder.OwnsOne(n => n.Metadata, metadata =>
        {
            metadata.Property(m => m.UserAgent).HasColumnName("metadata_user_agent").HasMaxLength(500);
            metadata.Property(m => m.IpAddress).HasColumnName("metadata_ip_address").HasMaxLength(64);
            metadata.Property(m => m.EmailClient).HasColumnName("metadata_email_client").HasMaxLength(200);
            metadata.Property(m => m.DeviceType).HasColumnName("metadata_device_type").HasMaxLength(100);
        });
    }
}
```

(Seven indexes mirror the legacy Mongoose schema's index list exactly — `notifications` is called out as high-write-volume with several hot query shapes: by user/company feed, by status+schedule for the delivery worker, by type+status and priority+schedule for triage/retry sweeps. `TemplateId` has no FK constraint yet — `notification_templates` doesn't exist until Task 2; the column is a bare nullable `Guid`, matching the org-structure plan's `Department.ManagerId`-before-`User`-existed precedent. `NotificationMetadata`'s four fields are all optional/nullable with no intended non-empty default, so no `.HasDefaultValue(...)` is needed on any of them — unlike `Company.Branding`/`User.Preferences`, this owned type has no NOT NULL members.)

- [ ] **Step 4: Register the DbSet**

Modify `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Persistence;

public class ClimateProjectDbContext(DbContextOptions<ClimateProjectDbContext> options)
    : DbContext(options)
{
    public DbSet<Company> Companies => Set<Company>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<Notification> Notifications => Set<Notification>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
```

- [ ] **Step 5: Generate the migration**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
dotnet ef migrations add AddNotifications \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

Expected: succeeds, creates a new `*_AddNotifications.cs` migration that `CreateTable`s `notifications` with all scalar + `metadata_*` owned columns, the `user_id`/`company_id` FK constraints, and all seven indexes — without touching `InitialAuthSchema`, `AddDepartments`, `AddCompanyProfileFields`, or `AddUserProfileFields`.

- [ ] **Step 6: Write the failing tests**

`tests/ClimateProject.IntegrationTests/Persistence/NotificationTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class NotificationTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user)> SeedCompanyAndUserAsync(ClimateProjectDbContext db, string emailSuffix)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"person-{emailSuffix}@acme.test", Name = "Person",
            Role = "employee", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (company, user);
    }

    [Fact]
    public async Task Notification_round_trips_with_owned_metadata_and_jsonb_data()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db, "1");

        var notification = new Notification
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            CompanyId = company.Id,
            Type = "survey_invitation",
            Channel = "email",
            Priority = "high",
            Status = "sent",
            Title = "New survey available",
            Message = "Please complete the Q3 climate survey.",
            Data = """{"survey_id": "abc123"}""",
            ScheduledFor = DateTimeOffset.UtcNow,
            SentAt = DateTimeOffset.UtcNow,
            RetryCount = 1,
            MaxRetries = 5,
            Metadata = new NotificationMetadata { UserAgent = "Mozilla/5.0", DeviceType = "desktop" },
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Notifications.Add(notification);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.Notifications.SingleAsync(n => n.Id == notification.Id);
        Assert.Equal("survey_invitation", loaded.Type);
        Assert.Equal("high", loaded.Priority);
        Assert.Equal("sent", loaded.Status);
        Assert.Contains("abc123", loaded.Data);
        Assert.Equal(1, loaded.RetryCount);
        Assert.Equal(5, loaded.MaxRetries);
        Assert.Equal("Mozilla/5.0", loaded.Metadata.UserAgent);
        Assert.Equal("desktop", loaded.Metadata.DeviceType);
        Assert.Null(loaded.Metadata.IpAddress);
    }

    [Fact]
    public async Task Minimal_notification_inserted_via_raw_SQL_still_loads_with_DB_level_defaults()
    {
        // Proves the DB-level column defaults (declared via .HasDefaultValue(...) in the Fluent
        // config, baked into the migration's CreateTable column definitions) are what a row gets
        // when only the truly-required columns are set — not merely the C# object-initializer
        // defaults that a raw-SQL insert (or any non-EF writer) would never pick up.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db, "2");

        var minimalId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO notifications ("Id", user_id, company_id, type, channel, title, message, scheduled_for, created_at, updated_at)
             VALUES ({minimalId}, {user.Id}, {company.Id}, {"system_notification"}, {"in_app"}, {"System notice"}, {"Something happened."}, {now}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.Notifications.SingleAsync(n => n.Id == minimalId);
        Assert.Equal("medium", loaded.Priority);
        Assert.Equal("pending", loaded.Status);
        Assert.Equal(0, loaded.RetryCount);
        Assert.Equal(3, loaded.MaxRetries);
        Assert.Null(loaded.Data);
        Assert.Null(loaded.TemplateId);
        Assert.Null(loaded.SentAt);
        Assert.Null(loaded.Metadata.UserAgent);
        Assert.Null(loaded.Metadata.IpAddress);
        Assert.Null(loaded.Metadata.EmailClient);
        Assert.Null(loaded.Metadata.DeviceType);
    }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter NotificationTests`
Expected: PASS (2/2). Requires Docker running.

- [ ] **Step 8: Run the full solution build and test suite**

Run: `dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx`
Expected: builds clean (0 warnings), all existing tests (52) + 2 new = 54 pass.

- [ ] **Step 9: Commit, push, open a PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/Notification.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/NotificationConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
  src/ClimateProject.Infrastructure/Migrations/ \
  tests/ClimateProject.IntegrationTests/Persistence/NotificationTests.cs
git commit -m "feat: add Notification entity with owned NotificationMetadata"
git push -u origin schema/notifications
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: Notification entity" \
  --body "First piece of #49's Notifications slice (#55). Adds the high-write-volume notifications table — type/channel/priority/status as plain strings, owned NotificationMetadata, jsonb Data, and the seven indexes the legacy Mongoose schema defined for user/company feeds, status+schedule delivery sweeps, and type/priority triage. TemplateId is a bare nullable column with no FK yet — notification_templates lands in the next PR, which retrofits that constraint."
gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch
git checkout main && git pull
```

---

### Task 2: NotificationTemplate + NotificationTemplateVariable + NotificationPersonalizationRule

**Files:**
- Create: `src/ClimateProject.Domain/Entities/NotificationTemplate.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/NotificationTemplateConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/NotificationTemplateVariableConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/NotificationPersonalizationRuleConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/Configurations/NotificationConfiguration.cs` — add the `TemplateId` → `NotificationTemplate` FK
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — add `DbSet<NotificationTemplate>`, `DbSet<NotificationTemplateVariable>`, `DbSet<NotificationPersonalizationRule>`
- Create: `src/ClimateProject.Infrastructure/Migrations/*` (generated)
- Test: `tests/ClimateProject.IntegrationTests/Persistence/NotificationTemplateTests.cs`

**Interfaces:**
- Consumes: `Company` (optional FK), `User` (`CreatedBy`, required FK), `Notification` (Task 1 — retrofits `TemplateId`'s FK).
- Produces: `NotificationTemplate { Id, Name, Type, Channel, Subject?, Title, Content, HtmlContent?, CompanyId?, IsActive=true, IsDefault=false, CreatedBy, CreatedAt, UpdatedAt }`, `NotificationTemplateVariable { Id, NotificationTemplateId, Name, Type, Required=false, Description, DefaultValue (jsonb?) }`, `NotificationPersonalizationRule { Id, NotificationTemplateId, Condition, Modifications (jsonb?) }`. This is the plan's terminal task — completes #55.

- [ ] **Step 1: Create a feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/notification-templates
```

- [ ] **Step 2: Write the NotificationTemplate entity + its two child entities**

`src/ClimateProject.Domain/Entities/NotificationTemplate.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class NotificationTemplate
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string Type { get; set; }
    public required string Channel { get; set; }
    public string? Subject { get; set; }
    public required string Title { get; set; }
    public required string Content { get; set; }
    public string? HtmlContent { get; set; }
    public Guid? CompanyId { get; set; }
    public bool IsActive { get; set; } = true;
    public bool IsDefault { get; set; }
    public Guid CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class NotificationTemplateVariable
{
    public Guid Id { get; set; }
    public Guid NotificationTemplateId { get; set; }
    public required string Name { get; set; }
    public required string Type { get; set; }
    public bool Required { get; set; }
    public required string Description { get; set; }
    public string? DefaultValue { get; set; }
}

public class NotificationPersonalizationRule
{
    public Guid Id { get; set; }
    public Guid NotificationTemplateId { get; set; }
    public required string Condition { get; set; }
    public string? Modifications { get; set; }
}
```

- [ ] **Step 3: Write NotificationTemplateConfiguration**

`src/ClimateProject.Infrastructure/Persistence/Configurations/NotificationTemplateConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class NotificationTemplateConfiguration : IEntityTypeConfiguration<NotificationTemplate>
{
    public void Configure(EntityTypeBuilder<NotificationTemplate> builder)
    {
        builder.ToTable("notification_templates");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(t => t.Type).HasColumnName("type").HasMaxLength(32).IsRequired();
        builder.Property(t => t.Channel).HasColumnName("channel").HasMaxLength(20).IsRequired();
        builder.Property(t => t.Subject).HasColumnName("subject").HasMaxLength(500);
        builder.Property(t => t.Title).HasColumnName("title").HasMaxLength(500).IsRequired();
        builder.Property(t => t.Content).HasColumnName("content").HasColumnType("text").IsRequired();
        builder.Property(t => t.HtmlContent).HasColumnName("html_content").HasColumnType("text");
        builder.Property(t => t.CompanyId).HasColumnName("company_id");
        builder.Property(t => t.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(t => t.IsDefault).HasColumnName("is_default").IsRequired().HasDefaultValue(false);
        builder.Property(t => t.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(t => t.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(t => t.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(t => new { t.Type, t.Channel });
        builder.HasIndex(t => new { t.CompanyId, t.IsActive });
        builder.HasIndex(t => new { t.IsDefault, t.IsActive });

        builder.HasOne<Company>().WithMany().HasForeignKey(t => t.CompanyId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<User>().WithMany().HasForeignKey(t => t.CreatedBy);
    }
}
```

- [ ] **Step 4: Write NotificationTemplateVariableConfiguration**

`src/ClimateProject.Infrastructure/Persistence/Configurations/NotificationTemplateVariableConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class NotificationTemplateVariableConfiguration : IEntityTypeConfiguration<NotificationTemplateVariable>
{
    public void Configure(EntityTypeBuilder<NotificationTemplateVariable> builder)
    {
        builder.ToTable("notification_template_variables");
        builder.HasKey(v => v.Id);
        builder.Property(v => v.NotificationTemplateId).HasColumnName("notification_template_id").IsRequired();
        builder.Property(v => v.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(v => v.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(v => v.Required).HasColumnName("required").IsRequired().HasDefaultValue(false);
        builder.Property(v => v.Description).HasColumnName("description").HasMaxLength(1000).IsRequired();
        builder.Property(v => v.DefaultValue).HasColumnName("default_value").HasColumnType("jsonb");

        builder.HasOne<NotificationTemplate>().WithMany().HasForeignKey(v => v.NotificationTemplateId);
    }
}
```

- [ ] **Step 5: Write NotificationPersonalizationRuleConfiguration**

`src/ClimateProject.Infrastructure/Persistence/Configurations/NotificationPersonalizationRuleConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class NotificationPersonalizationRuleConfiguration : IEntityTypeConfiguration<NotificationPersonalizationRule>
{
    public void Configure(EntityTypeBuilder<NotificationPersonalizationRule> builder)
    {
        builder.ToTable("notification_personalization_rules");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.NotificationTemplateId).HasColumnName("notification_template_id").IsRequired();
        builder.Property(r => r.Condition).HasColumnName("condition").HasColumnType("text").IsRequired();
        builder.Property(r => r.Modifications).HasColumnName("modifications").HasColumnType("jsonb");

        builder.HasOne<NotificationTemplate>().WithMany().HasForeignKey(r => r.NotificationTemplateId);
    }
}
```

(Both junction FKs use the default `Cascade` — a variable/rule belongs to exactly one template, the "Question belonging to a Survey" case from the established convention: deleting the template should delete its variables/rules with it. `NotificationTemplate.CompanyId` uses `SetNull` — same "optional cross-entity link" reasoning as `User.DepartmentId`, a company-specific template shouldn't vanish or block company deletion, it should fall back to being a global/default-owning-company-less template. `CreatedBy` is a required FK to `User` with no `OnDelete` override — default `Cascade`, consistent with how every other required cross-entity FK in this codebase (`Department.CompanyId`, `User.CompanyId`, `Notification.UserId`/`CompanyId`) is left unconfigured.)

- [ ] **Step 6: Retrofit the `Notification.TemplateId` → `NotificationTemplate` FK**

Modify `src/ClimateProject.Infrastructure/Persistence/Configurations/NotificationConfiguration.cs` — add one line inside `Configure`, immediately after the existing `HasOne<Company>()` call:

```csharp
        builder.HasOne<User>().WithMany().HasForeignKey(n => n.UserId);
        builder.HasOne<Company>().WithMany().HasForeignKey(n => n.CompanyId);
        builder.HasOne<NotificationTemplate>().WithMany().HasForeignKey(n => n.TemplateId).OnDelete(DeleteBehavior.SetNull);
```

(The rest of the file is unchanged from Task 1. `SetNull` — an optional cross-entity link: a notification whose template gets deleted should keep existing, just lose the link, matching `User.DepartmentId`'s reasoning.)

- [ ] **Step 7: Register the three new DbSets**

Modify `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Persistence;

public class ClimateProjectDbContext(DbContextOptions<ClimateProjectDbContext> options)
    : DbContext(options)
{
    public DbSet<Company> Companies => Set<Company>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<NotificationTemplate> NotificationTemplates => Set<NotificationTemplate>();
    public DbSet<NotificationTemplateVariable> NotificationTemplateVariables => Set<NotificationTemplateVariable>();
    public DbSet<NotificationPersonalizationRule> NotificationPersonalizationRules => Set<NotificationPersonalizationRule>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
```

- [ ] **Step 8: Generate the migration**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
dotnet ef migrations add AddNotificationTemplates \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

Expected: succeeds, one migration that `CreateTable`s `notification_templates`, `notification_template_variables`, and `notification_personalization_rules` (with their FKs/indexes) **and** adds the `FK_notifications_notification_templates_template_id` foreign key onto the existing `notifications.template_id` column — all additive, `AddNotifications` and every earlier migration untouched.

- [ ] **Step 9: Write the failing tests**

`tests/ClimateProject.IntegrationTests/Persistence/NotificationTemplateTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class NotificationTemplateTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User creator)> SeedCompanyAndCreatorAsync(ClimateProjectDbContext db, string emailSuffix)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        var creator = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{emailSuffix}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(creator);
        await db.SaveChangesAsync();
        return (company, creator);
    }

    [Fact]
    public async Task NotificationTemplate_round_trips_with_variables_and_personalization_rules()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, creator) = await SeedCompanyAndCreatorAsync(db, "1");

        var template = new NotificationTemplate
        {
            Id = Guid.NewGuid(),
            Name = "Survey Invitation - Company Branded",
            Type = "survey_invitation",
            Channel = "email",
            Subject = "You're invited: {{survey_name}}",
            Title = "New survey",
            Content = "Hi {{user_name}}, please complete {{survey_name}}.",
            HtmlContent = "<p>Hi {{user_name}}, please complete {{survey_name}}.</p>",
            CompanyId = company.Id,
            IsActive = true,
            IsDefault = false,
            CreatedBy = creator.Id,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.NotificationTemplates.Add(template);
        await db.SaveChangesAsync();

        var variable = new NotificationTemplateVariable
        {
            Id = Guid.NewGuid(),
            NotificationTemplateId = template.Id,
            Name = "survey_name",
            Type = "string",
            Required = true,
            Description = "The name of the survey being sent",
            DefaultValue = """{"fallback": "Climate Survey"}""",
        };
        var rule = new NotificationPersonalizationRule
        {
            Id = Guid.NewGuid(),
            NotificationTemplateId = template.Id,
            Condition = "user.role === 'leader'",
            Modifications = """{"title": "Leader survey reminder"}""",
        };
        db.NotificationTemplateVariables.Add(variable);
        db.NotificationPersonalizationRules.Add(rule);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedTemplate = await readDb.NotificationTemplates.SingleAsync(t => t.Id == template.Id);
        Assert.Equal("survey_invitation", loadedTemplate.Type);
        Assert.Equal(company.Id, loadedTemplate.CompanyId);
        Assert.Equal(creator.Id, loadedTemplate.CreatedBy);

        var loadedVariable = await readDb.NotificationTemplateVariables.SingleAsync(v => v.Id == variable.Id);
        Assert.True(loadedVariable.Required);
        Assert.Contains("Climate Survey", loadedVariable.DefaultValue);

        var loadedRule = await readDb.NotificationPersonalizationRules.SingleAsync(r => r.Id == rule.Id);
        Assert.Contains("leader", loadedRule.Condition);
        Assert.Contains("Leader survey reminder", loadedRule.Modifications);
    }

    [Fact]
    public async Task Minimal_template_and_variable_inserted_via_raw_SQL_still_load_with_DB_level_defaults()
    {
        // Proves is_active/is_default (NotificationTemplate) and required (NotificationTemplateVariable)
        // are real Postgres column defaults, not just C# object-initializer defaults a raw-SQL
        // insert would never see.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, creator) = await SeedCompanyAndCreatorAsync(db, "2");

        var minimalTemplateId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO notification_templates ("Id", name, type, channel, title, content, created_by, created_at, updated_at)
             VALUES ({minimalTemplateId}, {"Minimal Template"}, {"system_notification"}, {"in_app"}, {"Notice"}, {"Body text"}, {creator.Id}, {now}, {now})
             """);

        var minimalVariableId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO notification_template_variables ("Id", notification_template_id, name, type, description)
             VALUES ({minimalVariableId}, {minimalTemplateId}, {"user_name"}, {"string"}, {"The recipient's display name"})
             """);

        await using var readDb = CreateContext();
        var loadedTemplate = await readDb.NotificationTemplates.SingleAsync(t => t.Id == minimalTemplateId);
        Assert.True(loadedTemplate.IsActive);
        Assert.False(loadedTemplate.IsDefault);
        Assert.Null(loadedTemplate.CompanyId);
        Assert.Null(loadedTemplate.Subject);

        var loadedVariable = await readDb.NotificationTemplateVariables.SingleAsync(v => v.Id == minimalVariableId);
        Assert.False(loadedVariable.Required);
        Assert.Null(loadedVariable.DefaultValue);
    }

    [Fact]
    public async Task Notification_TemplateId_references_notification_templates_after_the_retrofitted_FK()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, creator) = await SeedCompanyAndCreatorAsync(db, "3");

        var template = new NotificationTemplate
        {
            Id = Guid.NewGuid(), Name = "Deadline reminder", Type = "deadline_reminder", Channel = "in_app",
            Title = "Deadline approaching", Content = "Your deadline is near.", CreatedBy = creator.Id,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.NotificationTemplates.Add(template);

        var recipient = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "recipient@acme.test", Name = "Recipient",
            Role = "employee", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(recipient);
        await db.SaveChangesAsync();

        var notification = new Notification
        {
            Id = Guid.NewGuid(), UserId = recipient.Id, CompanyId = company.Id, Type = "deadline_reminder",
            Channel = "in_app", Title = "Deadline approaching", Message = "Your deadline is near.",
            TemplateId = template.Id, ScheduledFor = DateTimeOffset.UtcNow,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Notifications.Add(notification);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.Notifications.SingleAsync(n => n.Id == notification.Id);
        Assert.Equal(template.Id, loaded.TemplateId);

        // Deleting the template should SetNull the notification's TemplateId, not cascade-delete it.
        await using var deleteDb = CreateContext();
        var templateToDelete = await deleteDb.NotificationTemplates.SingleAsync(t => t.Id == template.Id);
        deleteDb.NotificationTemplates.Remove(templateToDelete);
        await deleteDb.SaveChangesAsync();

        await using var verifyDb = CreateContext();
        var stillThere = await verifyDb.Notifications.SingleAsync(n => n.Id == notification.Id);
        Assert.Null(stillThere.TemplateId);
    }
}
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter NotificationTemplateTests`
Expected: PASS (3/3).

- [ ] **Step 11: Run the full solution build and test suite**

Run: `dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx`
Expected: builds clean (0 warnings), all tests pass (54 + 3 = 57).

- [ ] **Step 12: Commit, push, open a PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/NotificationTemplate.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/NotificationTemplateConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/NotificationTemplateVariableConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/NotificationPersonalizationRuleConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/NotificationConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
  src/ClimateProject.Infrastructure/Migrations/ \
  tests/ClimateProject.IntegrationTests/Persistence/NotificationTemplateTests.cs
git commit -m "feat: add NotificationTemplate entity with variables and personalization rules"
git push -u origin schema/notification-templates
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: NotificationTemplate + variables + personalization rules" \
  --body "Second and final piece of #49's Notifications slice (#55). Adds notification_templates (company-specific or global-default) plus its two junction tables — notification_template_variables and notification_personalization_rules, both FK'd to the template with cascade delete. Retrofits the Notification.TemplateId FK from the first PR now that notification_templates exists (SetNull on delete). Completes #55."
gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch
git checkout main && git pull
```

---

## Self-Review Notes

- **Spec coverage**: every table from the approved #55 design (`notifications`, `notification_templates`, `notification_template_variables`, `notification_personalization_rules`) has a task. Sizing matches the domain hint exactly — 2 tasks, `notifications` alone then `notification_templates` plus both junctions together.
- **No placeholders**: every task has complete entity/config/DbContext/test file content; enum values are the real ones read from `climate-project/src/models/Notification.ts` and `NotificationTemplate.ts`, not invented.
- **FK ordering respected**: `Notification.TemplateId` is added as a bare column in Task 1 (target table doesn't exist yet) and gets its real FK constraint retrofitted in Task 2 in the same migration that creates `notification_templates` — no task ever generates a migration referencing a table that doesn't exist at that point in the sequence.
- **jsonb consistency**: `Notification.Data`, `NotificationTemplateVariable.DefaultValue`, `NotificationPersonalizationRule.Modifications` are all `string?` + `.HasColumnType("jsonb")`, no default, not required — matching every jsonb column already in the codebase (`User.Demographics`), even though the legacy Mongoose model marks some of these fields as `required`/defaulted — that's a conscious, explicitly-noted deviation-avoidance choice (Architecture section), not an oversight.
- **CRITICAL LESSON applied**: `Priority`, `Status`, `RetryCount`, `MaxRetries` (Task 1) and `IsActive`, `IsDefault`, `Required` (Task 2) all get explicit `.HasDefaultValue(...)` plus a raw-SQL-insert-then-EF-read test proving the DB-level default, not just the C# initializer default.
- **No vestigial `.HasConversion<string>()`**: every enum-shaped property in this domain (`Type`, `Channel`, `Priority`, `Status`, `NotificationTemplateVariable.Type`) is declared as plain `string`/`string?` from the start, so no `.HasConversion<string>()` call appears anywhere in either task's configs — the Task 2 vestigial-no-op bug from the org-structure slice is not repeated.
