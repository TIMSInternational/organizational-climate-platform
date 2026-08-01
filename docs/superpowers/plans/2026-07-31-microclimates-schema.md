# Microclimates Schema (climate-project-api #52) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the full Microclimates domain (issue #52, a slice of epic #49) to the EF Core / Postgres schema in `climate-project-api` — the `Microclimate` aggregate with its four owned 1:1 shapes and department-targeting junction, standalone `microclimate_questions` and `microclimate_ai_insights` tables, the `MicroclimateTemplate` aggregate with its owned settings and question junction, and `microclimate_invitations` — mirroring the exact clean-architecture, snake_case, owned-type, and additive-migration conventions already established by the org-structure domain (Company/User/Department).

**Architecture:** Five sequential PRs, each adding one cohesive cluster of tables on top of the previous one's merged migration. Plain POCO entities go in `src/ClimateProject.Domain/Entities/`, `IEntityTypeConfiguration<T>` Fluent configs in `src/ClimateProject.Infrastructure/Persistence/Configurations/`, registered via `modelBuilder.ApplyConfigurationsFromAssembly` (already wired) plus a new `DbSet<T>` per entity on `ClimateProjectDbContext`. Ordering is dictated by a real FK dependency: `Microclimate.TemplateId` references `microclimate_templates`, so the **Templates cluster is built first** (Task 1), then the **Microclimate core cluster** (Task 2, which is now free to declare that FK for real), then the three leaf tables that hang off `Microclimate` (Tasks 3–5).

**Tech Stack:** .NET 10 / EF Core 10 / Npgsql.EntityFrameworkCore.PostgreSQL 10.0.0, Postgres 16 (via Testcontainers in tests), xUnit, `dotnet-ef` 10.0.10 (already installed globally).

## Global Constraints

- Repo: `/Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api`, branch `main` (verified current tip: `d662463` "feat: add User profile fields..." / migration `AddUserProfileFields`). One feature branch per task, PR via `gh pr create --repo TIMSInternational/climate-project-api`, squash-merge via `gh pr merge --squash --delete-branch`, then `git checkout main && git pull` before starting the next task — identical to every prior #47/#48/#49 task in this repo.
- Clean architecture: POCO entities in `src/ClimateProject.Domain/Entities/`; `IEntityTypeConfiguration<T>` in `src/ClimateProject.Infrastructure/Persistence/Configurations/`; register new `DbSet<T>` properties on `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`.
- snake_case table/column names via explicit `.ToTable(...)`/`.HasColumnName(...)`. EXCEPTION: `Id` primary-key columns stay PascalCase `"Id"` (no `.HasColumnName("id")` override) — matches `companies`/`users`/`departments` exactly.
- Enums stored as plain C# `string` properties (never a C# `enum` type) with `.HasConversion<string>()` **only** when the CLR property type is not already `string` — since every enum-ish property in this domain is declared as `string`/`string?` from the start, no config in this plan calls `.HasConversion<string>()` (avoids the vestigial no-op from org-structure Task 2).
- Owned 1:1 shapes use EF Core owned types via `.OwnsOne(x => x.Prop, owned => { ... })`, inline columns on the owner table, snake_case columns prefixed with the property name (e.g. `Microclimate.Targeting.IncludeManagers` → `targeting_include_managers`).
- **CRITICAL LESSON (real bug already shipped once in org-structure and had to be fixed):** every NOT NULL column with a non-default intended value (owned-type property or plain scalar) MUST have `.HasDefaultValue(...)` in the Fluent config matching the C# object-initializer default, so the generated migration's DDL bakes a real `DEFAULT` clause into the column — not just relying on EF always supplying a value at insert time. Every task below that introduces such a column also writes a raw-SQL-insert-then-EF-read test proving the DB-level default (never an in-memory EF insert-then-read test — that only proves the C# side, not the DDL).
- jsonb columns: CLR type is a plain nullable `string?` property, mapped via `.HasColumnType("jsonb")`. No `JsonDocument`/`Dictionary<string,object>`, no speculative serialization helpers. Every jsonb column in this domain is nullable with no forced default (matches `User.Demographics`) — callers serialize/deserialize as needed.
- Role values stay plain strings matching `ClimateProject.Application.Auth.Roles` constants — not used directly in this domain (no role-typed column here), noted for completeness only.
- Migrations are strictly additive, generated via:
  `dotnet ef migrations add <Name> --project src/ClimateProject.Infrastructure --startup-project src/ClimateProject.Api --output-dir Migrations`
  Never edit a migration a prior task already merged to `main`.
- `Directory.Build.props` sets `TreatWarningsAsErrors=true` — all code must be warning-clean (0 warnings on `dotnet build`).
- Integration tests: Docker must be running. Reuse `tests/ClimateProject.IntegrationTests/Support/PostgresContainerFixture.cs` unchanged; construct `DbContextOptionsBuilder<ClimateProjectDbContext>().UseNpgsql(postgres.ConnectionString)` directly in each new test class, exactly like `DepartmentTests.cs`/`CompanyProfileTests.cs`/`UserProfileTests.cs`.
- Every task: write failing test → run to confirm fail → implement → run to confirm pass → full solution build+test (`dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx`) confirming 0 warnings and all tests (old + new) passing → commit/push/PR/merge/checkout main/pull.
- Before referencing another entity by FK, the plan below is already grounded in the actual current files (`Company.cs`, `User.cs`, `Department.cs`, `ClimateProjectDbContext.cs` as they exist on `main` right now — read 2026-07-31). Note: the org-structure epic also mentions `UserInvitation`/`AuditLog`; as of this reading those exist only as **uncommitted work-in-progress on a separate branch (`schema/user-invitations`)**, not on `main`, and this Microclimates domain has no dependency on them — do not reference them.
- FK delete-behavior convention used throughout this plan:
  - Self-referencing hierarchy FK → `DeleteBehavior.Restrict` (matches `Department.ParentDepartmentId`). Not used in this domain (no self-references).
  - Optional (nullable), non-self-referencing cross-entity FK where the referenced row's deletion should not cascade-delete the child → `DeleteBehavior.SetNull` (matches `User.DepartmentId`).
  - Required parent-owns-child FK, or a required "belongs to the same tenant" FK to `Company` (matches `User.CompanyId`, `Department.CompanyId` — both plain default Cascade with no `OnDelete` call) → default Cascade (no explicit `OnDelete` call).
  - Required, non-owning, cross-aggregate reference to `User` (e.g. "who created this") where the referenced row's deletion must not silently destroy business data → `DeleteBehavior.Restrict`, applied explicitly in this plan to `Microclimate.CreatedBy`, `MicroclimateDepartmentTarget.DepartmentId`, and `MicroclimateInvitation.UserId`. This is a new pattern this domain introduces (no exact precedent yet in org-structure) — documented here so implementers don't re-derive it per task.
- Reserved-word dodge: Postgres reserves `ORDER` as a keyword, so the `Order` C# property on question entities is mapped to column `question_order`, not `order`, to avoid needing to quote it in every hand-written SQL statement (test code and ad-hoc queries alike).

---

## Task 1: Microclimate Templates (`microclimate_templates` + `microclimate_template_questions`)

**Files:**
- Create: `src/ClimateProject.Domain/Entities/MicroclimateTemplate.cs`
- Create: `src/ClimateProject.Domain/Entities/MicroclimateTemplateQuestion.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateTemplateConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateTemplateQuestionConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`
- Create: `tests/ClimateProject.IntegrationTests/Persistence/MicroclimateTemplateTests.cs`
- Migration (generated): `src/ClimateProject.Infrastructure/Migrations/<timestamp>_AddMicroclimateTemplates.cs`

**Interfaces:**
- Consumes: `Company` (`Id` Guid PK, table `companies`), `User` (`Id` Guid PK, table `users`) — both read from the current repo state, unchanged by this task.
- Produces: `MicroclimateTemplate { Guid Id; string Name; string Description; string Category; Guid? CompanyId; Guid? CreatedBy; bool IsSystemTemplate; int UsageCount; bool IsActive; string[] Tags; MicroclimateTemplateSettings Settings; DateTimeOffset CreatedAt; DateTimeOffset UpdatedAt }`, `MicroclimateTemplateSettings { int DefaultDurationMinutes; string SuggestedFrequency; int? MaxParticipants; bool AnonymousByDefault; bool AutoClose; bool ShowLiveResults }`, `MicroclimateTemplateQuestion { Guid Id; Guid TemplateId; string Text; string Type; string[]? Options; bool Required; int Order; string? Category }`. Table names `microclimate_templates` / `microclimate_template_questions`. These are consumed by Task 2 (`Microclimate.TemplateId` FK) and no others.

- [ ] **Step 1: Write the failing test**

Create `tests/ClimateProject.IntegrationTests/Persistence/MicroclimateTemplateTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class MicroclimateTemplateTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<Company> SeedCompanyAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();
        return company;
    }

    private async Task<User> SeedUserAsync(ClimateProjectDbContext db, Guid companyId)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = companyId, Email = "creator@acme.test", Name = "Creator",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    [Fact]
    public async Task Company_template_round_trips_with_owned_settings_and_questions()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);
        var creator = await SeedUserAsync(db, company.Id);

        var template = new MicroclimateTemplate
        {
            Id = Guid.NewGuid(),
            Name = "Weekly Pulse",
            Description = "A short weekly pulse check",
            Category = "pulse_check",
            CompanyId = company.Id,
            CreatedBy = creator.Id,
            Tags = ["pulse", "weekly"],
            Settings = new MicroclimateTemplateSettings { SuggestedFrequency = "daily", MaxParticipants = 50 },
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.MicroclimateTemplates.Add(template);
        await db.SaveChangesAsync();

        var question = new MicroclimateTemplateQuestion
        {
            Id = Guid.NewGuid(),
            TemplateId = template.Id,
            Text = "How are you feeling this week?",
            Type = "emoji_rating",
            Order = 1,
            Category = "mood",
        };
        db.MicroclimateTemplateQuestions.Add(question);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedTemplate = await readDb.MicroclimateTemplates.SingleAsync(t => t.Id == template.Id);
        Assert.Equal("pulse_check", loadedTemplate.Category);
        Assert.False(loadedTemplate.IsSystemTemplate);
        Assert.True(loadedTemplate.IsActive);
        Assert.Equal(0, loadedTemplate.UsageCount);
        Assert.Equal(["pulse", "weekly"], loadedTemplate.Tags);
        Assert.Equal("daily", loadedTemplate.Settings.SuggestedFrequency);
        Assert.Equal(50, loadedTemplate.Settings.MaxParticipants);
        Assert.Equal(30, loadedTemplate.Settings.DefaultDurationMinutes);
        Assert.True(loadedTemplate.Settings.AnonymousByDefault);

        var loadedQuestion = await readDb.MicroclimateTemplateQuestions.SingleAsync(q => q.Id == question.Id);
        Assert.Equal(template.Id, loadedQuestion.TemplateId);
        Assert.Equal("emoji_rating", loadedQuestion.Type);
        Assert.True(loadedQuestion.Required);
        Assert.Equal(1, loadedQuestion.Order);
        Assert.Equal("mood", loadedQuestion.Category);
    }

    [Fact]
    public async Task System_template_allows_null_company_and_creator()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var systemTemplate = new MicroclimateTemplate
        {
            Id = Guid.NewGuid(),
            Name = "System Team Mood",
            Description = "Built-in team mood template",
            Category = "team_mood",
            IsSystemTemplate = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.MicroclimateTemplates.Add(systemTemplate);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.MicroclimateTemplates.SingleAsync(t => t.Id == systemTemplate.Id);
        Assert.Null(loaded.CompanyId);
        Assert.Null(loaded.CreatedBy);
        Assert.True(loaded.IsSystemTemplate);
    }

    [Fact]
    public async Task Minimal_row_inserted_via_raw_SQL_still_loads_with_true_intended_defaults()
    {
        // Proves the migration's DDL bakes real DEFAULT clauses into every NOT NULL column with a
        // non-CLR-default intended value, rather than relying on EF always supplying a value —
        // insert with ONLY the columns that have no intended default, read back via EF, and assert
        // every defaulted column comes back as the true domain default (not the raw CLR default).
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var minimalTemplateId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO microclimate_templates ("Id", name, description, category, created_at, updated_at)
             VALUES ({minimalTemplateId}, {"Minimal Template"}, {"desc"}, {"custom"}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.MicroclimateTemplates.SingleAsync(t => t.Id == minimalTemplateId);
        Assert.False(loaded.IsSystemTemplate);
        Assert.Equal(0, loaded.UsageCount);
        Assert.True(loaded.IsActive);
        Assert.Empty(loaded.Tags);
        Assert.Equal(30, loaded.Settings.DefaultDurationMinutes);
        Assert.Equal("weekly", loaded.Settings.SuggestedFrequency);
        Assert.Null(loaded.Settings.MaxParticipants);
        Assert.True(loaded.Settings.AnonymousByDefault);
        Assert.True(loaded.Settings.AutoClose);
        Assert.True(loaded.Settings.ShowLiveResults);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test ClimateProject.slnx --filter FullyQualifiedName~MicroclimateTemplateTests`
Expected: FAIL to compile — `MicroclimateTemplate`, `MicroclimateTemplateSettings`, `MicroclimateTemplateQuestion`, and `db.MicroclimateTemplates`/`db.MicroclimateTemplateQuestions` do not exist yet.

- [ ] **Step 3: Create the feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/microclimate-templates
```

- [ ] **Step 4: Write the entities**

Create `src/ClimateProject.Domain/Entities/MicroclimateTemplate.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class MicroclimateTemplate
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string Description { get; set; }
    public required string Category { get; set; }
    public Guid? CompanyId { get; set; }
    public Guid? CreatedBy { get; set; }
    public bool IsSystemTemplate { get; set; }
    public int UsageCount { get; set; }
    public bool IsActive { get; set; } = true;
    public string[] Tags { get; set; } = [];
    public MicroclimateTemplateSettings Settings { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class MicroclimateTemplateSettings
{
    public int DefaultDurationMinutes { get; set; } = 30;
    public string SuggestedFrequency { get; set; } = "weekly";
    public int? MaxParticipants { get; set; }
    public bool AnonymousByDefault { get; set; } = true;
    public bool AutoClose { get; set; } = true;
    public bool ShowLiveResults { get; set; } = true;
}
```

Create `src/ClimateProject.Domain/Entities/MicroclimateTemplateQuestion.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class MicroclimateTemplateQuestion
{
    public Guid Id { get; set; }
    public Guid TemplateId { get; set; }
    public required string Text { get; set; }
    public required string Type { get; set; }
    public string[]? Options { get; set; }
    public bool Required { get; set; } = true;
    public int Order { get; set; }
    public string? Category { get; set; }
}
```

- [ ] **Step 5: Write the Fluent configurations**

Create `src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateTemplateConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class MicroclimateTemplateConfiguration : IEntityTypeConfiguration<MicroclimateTemplate>
{
    public void Configure(EntityTypeBuilder<MicroclimateTemplate> builder)
    {
        builder.ToTable("microclimate_templates");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Name).HasColumnName("name").HasMaxLength(100).IsRequired();
        builder.Property(t => t.Description).HasColumnName("description").HasMaxLength(500).IsRequired();
        builder.Property(t => t.Category).HasColumnName("category").HasMaxLength(30).IsRequired();
        builder.Property(t => t.CompanyId).HasColumnName("company_id");
        builder.Property(t => t.CreatedBy).HasColumnName("created_by");
        builder.Property(t => t.IsSystemTemplate).HasColumnName("is_system_template").IsRequired().HasDefaultValue(false);
        builder.Property(t => t.UsageCount).HasColumnName("usage_count").IsRequired().HasDefaultValue(0);
        builder.Property(t => t.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(t => t.Tags).HasColumnName("tags").IsRequired().HasDefaultValue(Array.Empty<string>());
        builder.Property(t => t.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(t => t.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(t => new { t.CompanyId, t.IsActive });
        builder.HasIndex(t => new { t.Category, t.IsActive });

        builder.HasOne<Company>().WithMany().HasForeignKey(t => t.CompanyId);
        builder.HasOne<User>().WithMany().HasForeignKey(t => t.CreatedBy).OnDelete(DeleteBehavior.SetNull);

        builder.OwnsOne(t => t.Settings, settings =>
        {
            settings.Property(s => s.DefaultDurationMinutes).HasColumnName("settings_default_duration_minutes").IsRequired().HasDefaultValue(30);
            settings.Property(s => s.SuggestedFrequency).HasColumnName("settings_suggested_frequency").HasMaxLength(20).IsRequired().HasDefaultValue("weekly");
            settings.Property(s => s.MaxParticipants).HasColumnName("settings_max_participants");
            settings.Property(s => s.AnonymousByDefault).HasColumnName("settings_anonymous_by_default").IsRequired().HasDefaultValue(true);
            settings.Property(s => s.AutoClose).HasColumnName("settings_auto_close").IsRequired().HasDefaultValue(true);
            settings.Property(s => s.ShowLiveResults).HasColumnName("settings_show_live_results").IsRequired().HasDefaultValue(true);
        });
    }
}
```

Create `src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateTemplateQuestionConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class MicroclimateTemplateQuestionConfiguration : IEntityTypeConfiguration<MicroclimateTemplateQuestion>
{
    public void Configure(EntityTypeBuilder<MicroclimateTemplateQuestion> builder)
    {
        builder.ToTable("microclimate_template_questions");
        builder.HasKey(q => q.Id);
        builder.Property(q => q.TemplateId).HasColumnName("template_id").IsRequired();
        builder.Property(q => q.Text).HasColumnName("text").HasMaxLength(300).IsRequired();
        builder.Property(q => q.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(q => q.Options).HasColumnName("options");
        builder.Property(q => q.Required).HasColumnName("required").IsRequired().HasDefaultValue(true);
        builder.Property(q => q.Order).HasColumnName("question_order").IsRequired();
        builder.Property(q => q.Category).HasColumnName("category").HasMaxLength(100);

        builder.HasOne<MicroclimateTemplate>().WithMany().HasForeignKey(q => q.TemplateId);
    }
}
```

- [ ] **Step 6: Register the new DbSets**

Edit `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`:

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
    public DbSet<MicroclimateTemplate> MicroclimateTemplates => Set<MicroclimateTemplate>();
    public DbSet<MicroclimateTemplateQuestion> MicroclimateTemplateQuestions => Set<MicroclimateTemplateQuestion>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
```

- [ ] **Step 7: Generate the migration**

```bash
dotnet ef migrations add AddMicroclimateTemplates --project src/ClimateProject.Infrastructure --startup-project src/ClimateProject.Api --output-dir Migrations
```

Open the generated `<timestamp>_AddMicroclimateTemplates.cs` and confirm every `AddColumn`/`CreateTable` call for a NOT NULL column with an intended default (`is_system_template`, `usage_count`, `is_active`, `tags`, `settings_default_duration_minutes`, `settings_suggested_frequency`, `settings_anonymous_by_default`, `settings_auto_close`, `settings_show_live_results`, `required`) carries the matching `defaultValue:`.

- [ ] **Step 8: Run test to verify it passes**

Run: `dotnet test ClimateProject.slnx --filter FullyQualifiedName~MicroclimateTemplateTests`
Expected: PASS (3 tests) — requires Docker running for the Testcontainers Postgres fixture.

- [ ] **Step 9: Full solution build and test**

```bash
dotnet build ClimateProject.slnx
dotnet test ClimateProject.slnx
```
Expected: 0 warnings, all tests (old + new) passing.

- [ ] **Step 10: Commit, push, PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/MicroclimateTemplate.cs \
        src/ClimateProject.Domain/Entities/MicroclimateTemplateQuestion.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateTemplateConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateTemplateQuestionConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
        src/ClimateProject.Infrastructure/Migrations/ \
        tests/ClimateProject.IntegrationTests/Persistence/MicroclimateTemplateTests.cs
git commit -m "$(cat <<'EOF'
feat: add MicroclimateTemplate entity with owned settings and question junction

Part of #52 (microclimates schema), a slice of the #49 data-model epic.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push -u origin schema/microclimate-templates
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: add MicroclimateTemplate entity with owned settings and question junction" \
  --body "Part of #52 (microclimates schema). Adds \`microclimate_templates\` (owned \`MicroclimateTemplateSettings\`) and \`microclimate_template_questions\`. First of five tasks — this one lands first so Task 2 can declare a real FK from \`microclimates.template_id\` to this table."
gh pr merge --squash --delete-branch
git checkout main
git pull
```

---

## Task 2: Microclimate Core (`microclimates` + 4 owned shapes + `microclimate_department_targets`)

**Files:**
- Create: `src/ClimateProject.Domain/Entities/Microclimate.cs`
- Create: `src/ClimateProject.Domain/Entities/MicroclimateDepartmentTarget.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateDepartmentTargetConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`
- Create: `tests/ClimateProject.IntegrationTests/Persistence/MicroclimateTests.cs`
- Migration (generated): `src/ClimateProject.Infrastructure/Migrations/<timestamp>_AddMicroclimates.cs`

**Interfaces:**
- Consumes: `Company`, `User` (unchanged), `MicroclimateTemplate` (`Id` Guid PK, table `microclimate_templates`, from Task 1), `Department` (`Id` Guid PK, table `departments`, unchanged).
- Produces: `Microclimate { Guid Id; string Title; string? Description; Guid CompanyId; Guid CreatedBy; Guid? TemplateId; string Status; int ResponseCount; int TargetParticipantCount; double ParticipationRate; MicroclimateTargeting Targeting; MicroclimateScheduling Scheduling; MicroclimateRealtimeSettings RealtimeSettings; MicroclimateLiveResults LiveResults; DateTimeOffset CreatedAt; DateTimeOffset UpdatedAt }` and `MicroclimateDepartmentTarget { Guid MicroclimateId; Guid DepartmentId }`. Tables `microclimates` / `microclimate_department_targets`. `Microclimate.Id` is consumed as the FK target by Tasks 3, 4, and 5.

- [ ] **Step 1: Write the failing test**

Create `tests/ClimateProject.IntegrationTests/Persistence/MicroclimateTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class MicroclimateTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User creator, Department dept)> SeedAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var creator = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "creator@acme.test", Name = "Creator",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(creator);

        var dept = new Department
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Engineering",
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Departments.Add(dept);
        await db.SaveChangesAsync();

        return (company, creator, dept);
    }

    [Fact]
    public async Task Microclimate_round_trips_with_all_owned_shapes_template_link_and_department_targets()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, creator, dept) = await SeedAsync(db);

        var template = new MicroclimateTemplate
        {
            Id = Guid.NewGuid(), Name = "Weekly Pulse", Description = "desc", Category = "pulse_check",
            CompanyId = company.Id, CreatedBy = creator.Id,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.MicroclimateTemplates.Add(template);
        await db.SaveChangesAsync();

        var now = DateTimeOffset.UtcNow;
        var microclimate = new Microclimate
        {
            Id = Guid.NewGuid(),
            Title = "Q3 Pulse Check",
            CompanyId = company.Id,
            CreatedBy = creator.Id,
            TemplateId = template.Id,
            Targeting = new MicroclimateTargeting { RoleFilters = ["employee"], MaxParticipants = 25 },
            Scheduling = new MicroclimateScheduling { StartTime = now, EndTime = now.AddMinutes(30), Timezone = "America/Costa_Rica" },
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Microclimates.Add(microclimate);
        await db.SaveChangesAsync();

        db.MicroclimateDepartmentTargets.Add(new MicroclimateDepartmentTarget { MicroclimateId = microclimate.Id, DepartmentId = dept.Id });
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.Microclimates.SingleAsync(m => m.Id == microclimate.Id);
        Assert.Equal("draft", loaded.Status);
        Assert.Equal(0, loaded.ResponseCount);
        Assert.Equal(template.Id, loaded.TemplateId);
        Assert.Equal(["employee"], loaded.Targeting.RoleFilters);
        Assert.True(loaded.Targeting.IncludeManagers);
        Assert.Equal(25, loaded.Targeting.MaxParticipants);
        Assert.Equal("America/Costa_Rica", loaded.Scheduling.Timezone);
        Assert.True(loaded.RealtimeSettings.ShowLiveResults);
        Assert.Equal(3, loaded.RealtimeSettings.ParticipationThreshold);
        Assert.Equal("medium", loaded.LiveResults.EngagementLevel);
        Assert.Empty(loaded.LiveResults.TopThemes);

        var target = await readDb.MicroclimateDepartmentTargets
            .SingleAsync(t => t.MicroclimateId == microclimate.Id && t.DepartmentId == dept.Id);
        Assert.Equal(dept.Id, target.DepartmentId);
    }

    [Fact]
    public async Task Deleting_the_template_sets_microclimate_template_id_to_null()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, creator, _) = await SeedAsync(db);

        var template = new MicroclimateTemplate
        {
            Id = Guid.NewGuid(), Name = "Temp", Description = "desc", Category = "custom",
            CompanyId = company.Id, CreatedBy = creator.Id,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.MicroclimateTemplates.Add(template);

        var now = DateTimeOffset.UtcNow;
        var microclimate = new Microclimate
        {
            Id = Guid.NewGuid(), Title = "Uses Template", CompanyId = company.Id, CreatedBy = creator.Id,
            TemplateId = template.Id,
            Scheduling = new MicroclimateScheduling { StartTime = now, EndTime = now.AddMinutes(30) },
            CreatedAt = now, UpdatedAt = now,
        };
        db.Microclimates.Add(microclimate);
        await db.SaveChangesAsync();

        db.MicroclimateTemplates.Remove(template);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.Microclimates.SingleAsync(m => m.Id == microclimate.Id);
        Assert.Null(loaded.TemplateId);
    }

    [Fact]
    public async Task Minimal_row_inserted_via_raw_SQL_still_loads_with_true_intended_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, creator, _) = await SeedAsync(db);

        var minimalId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO microclimates ("Id", title, company_id, created_by, scheduling_start_time, scheduling_end_time, created_at, updated_at)
             VALUES ({minimalId}, {"Minimal"}, {company.Id}, {creator.Id}, {now}, {now.AddMinutes(30)}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.Microclimates.SingleAsync(m => m.Id == minimalId);
        Assert.Equal("draft", loaded.Status);
        Assert.Equal(0, loaded.ResponseCount);
        Assert.Equal(0, loaded.TargetParticipantCount);
        Assert.Equal(0, loaded.ParticipationRate);
        Assert.True(loaded.Targeting.IncludeManagers);
        Assert.Equal("UTC", loaded.Scheduling.Timezone);
        Assert.True(loaded.RealtimeSettings.ShowLiveResults);
        Assert.True(loaded.RealtimeSettings.AnonymousResponses);
        Assert.True(loaded.RealtimeSettings.AllowComments);
        Assert.True(loaded.RealtimeSettings.WordCloudEnabled);
        Assert.True(loaded.RealtimeSettings.SentimentAnalysisEnabled);
        Assert.Equal(3, loaded.RealtimeSettings.ParticipationThreshold);
        Assert.Equal(0, loaded.LiveResults.SentimentScore);
        Assert.Equal("medium", loaded.LiveResults.EngagementLevel);
        Assert.Empty(loaded.LiveResults.TopThemes);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test ClimateProject.slnx --filter FullyQualifiedName~MicroclimateTests`
Expected: FAIL to compile — `Microclimate`, its owned types, `MicroclimateDepartmentTarget`, and the `db.Microclimates`/`db.MicroclimateDepartmentTargets` DbSets do not exist yet.

- [ ] **Step 3: Create the feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/microclimate-core
```

- [ ] **Step 4: Write the entities**

Create `src/ClimateProject.Domain/Entities/Microclimate.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class Microclimate
{
    public Guid Id { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public Guid CompanyId { get; set; }
    public Guid CreatedBy { get; set; }
    public Guid? TemplateId { get; set; }
    public string Status { get; set; } = "draft";
    public int ResponseCount { get; set; }
    public int TargetParticipantCount { get; set; }
    public double ParticipationRate { get; set; }
    public MicroclimateTargeting Targeting { get; set; } = new();
    public MicroclimateScheduling Scheduling { get; set; } = new();
    public MicroclimateRealtimeSettings RealtimeSettings { get; set; } = new();
    public MicroclimateLiveResults LiveResults { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class MicroclimateTargeting
{
    public string[]? RoleFilters { get; set; }
    public string[]? TenureFilters { get; set; }
    public string? CustomFilters { get; set; }
    public bool IncludeManagers { get; set; } = true;
    public int? MaxParticipants { get; set; }
}

public class MicroclimateScheduling
{
    public DateTimeOffset StartTime { get; set; }
    public DateTimeOffset EndTime { get; set; }
    public string Timezone { get; set; } = "UTC";
    public string? ReminderSchedule { get; set; }
}

public class MicroclimateRealtimeSettings
{
    public bool ShowLiveResults { get; set; } = true;
    public bool AnonymousResponses { get; set; } = true;
    public bool AllowComments { get; set; } = true;
    public bool WordCloudEnabled { get; set; } = true;
    public bool SentimentAnalysisEnabled { get; set; } = true;
    public int ParticipationThreshold { get; set; } = 3;
}

public class MicroclimateLiveResults
{
    public double SentimentScore { get; set; }
    public string EngagementLevel { get; set; } = "medium";
    public string[] TopThemes { get; set; } = [];
    public string? WordCloudData { get; set; }
    public string? ResponseDistribution { get; set; }
}
```

Create `src/ClimateProject.Domain/Entities/MicroclimateDepartmentTarget.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class MicroclimateDepartmentTarget
{
    public Guid MicroclimateId { get; set; }
    public Guid DepartmentId { get; set; }
}
```

- [ ] **Step 5: Write the Fluent configurations**

Create `src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class MicroclimateConfiguration : IEntityTypeConfiguration<Microclimate>
{
    public void Configure(EntityTypeBuilder<Microclimate> builder)
    {
        builder.ToTable("microclimates");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Title).HasColumnName("title").HasMaxLength(150).IsRequired();
        builder.Property(m => m.Description).HasColumnName("description").HasMaxLength(500);
        builder.Property(m => m.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(m => m.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(m => m.TemplateId).HasColumnName("template_id");
        builder.Property(m => m.Status).HasColumnName("status").HasMaxLength(20).IsRequired().HasDefaultValue("draft");
        builder.Property(m => m.ResponseCount).HasColumnName("response_count").IsRequired().HasDefaultValue(0);
        builder.Property(m => m.TargetParticipantCount).HasColumnName("target_participant_count").IsRequired().HasDefaultValue(0);
        builder.Property(m => m.ParticipationRate).HasColumnName("participation_rate").IsRequired().HasDefaultValue(0d);
        builder.Property(m => m.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(m => m.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(m => new { m.CompanyId, m.Status });

        builder.HasOne<Company>().WithMany().HasForeignKey(m => m.CompanyId);
        builder.HasOne<User>().WithMany().HasForeignKey(m => m.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<MicroclimateTemplate>().WithMany().HasForeignKey(m => m.TemplateId).OnDelete(DeleteBehavior.SetNull);

        builder.OwnsOne(m => m.Targeting, targeting =>
        {
            targeting.Property(t => t.RoleFilters).HasColumnName("targeting_role_filters");
            targeting.Property(t => t.TenureFilters).HasColumnName("targeting_tenure_filters");
            targeting.Property(t => t.CustomFilters).HasColumnName("targeting_custom_filters").HasColumnType("jsonb");
            targeting.Property(t => t.IncludeManagers).HasColumnName("targeting_include_managers").IsRequired().HasDefaultValue(true);
            targeting.Property(t => t.MaxParticipants).HasColumnName("targeting_max_participants");
        });

        builder.OwnsOne(m => m.Scheduling, scheduling =>
        {
            scheduling.Property(s => s.StartTime).HasColumnName("scheduling_start_time").IsRequired();
            scheduling.Property(s => s.EndTime).HasColumnName("scheduling_end_time").IsRequired();
            scheduling.Property(s => s.Timezone).HasColumnName("scheduling_timezone").HasMaxLength(100).IsRequired().HasDefaultValue("UTC");
            scheduling.Property(s => s.ReminderSchedule).HasColumnName("scheduling_reminder_schedule").HasColumnType("jsonb");
        });

        builder.OwnsOne(m => m.RealtimeSettings, realtime =>
        {
            realtime.Property(r => r.ShowLiveResults).HasColumnName("realtime_settings_show_live_results").IsRequired().HasDefaultValue(true);
            realtime.Property(r => r.AnonymousResponses).HasColumnName("realtime_settings_anonymous_responses").IsRequired().HasDefaultValue(true);
            realtime.Property(r => r.AllowComments).HasColumnName("realtime_settings_allow_comments").IsRequired().HasDefaultValue(true);
            realtime.Property(r => r.WordCloudEnabled).HasColumnName("realtime_settings_word_cloud_enabled").IsRequired().HasDefaultValue(true);
            realtime.Property(r => r.SentimentAnalysisEnabled).HasColumnName("realtime_settings_sentiment_analysis_enabled").IsRequired().HasDefaultValue(true);
            realtime.Property(r => r.ParticipationThreshold).HasColumnName("realtime_settings_participation_threshold").IsRequired().HasDefaultValue(3);
        });

        builder.OwnsOne(m => m.LiveResults, liveResults =>
        {
            liveResults.Property(l => l.SentimentScore).HasColumnName("live_results_sentiment_score").IsRequired().HasDefaultValue(0d);
            liveResults.Property(l => l.EngagementLevel).HasColumnName("live_results_engagement_level").HasMaxLength(10).IsRequired().HasDefaultValue("medium");
            liveResults.Property(l => l.TopThemes).HasColumnName("live_results_top_themes").IsRequired().HasDefaultValue(Array.Empty<string>());
            liveResults.Property(l => l.WordCloudData).HasColumnName("live_results_word_cloud_data").HasColumnType("jsonb");
            liveResults.Property(l => l.ResponseDistribution).HasColumnName("live_results_response_distribution").HasColumnType("jsonb");
        });
    }
}
```

Create `src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateDepartmentTargetConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class MicroclimateDepartmentTargetConfiguration : IEntityTypeConfiguration<MicroclimateDepartmentTarget>
{
    public void Configure(EntityTypeBuilder<MicroclimateDepartmentTarget> builder)
    {
        builder.ToTable("microclimate_department_targets");
        builder.HasKey(t => new { t.MicroclimateId, t.DepartmentId });
        builder.Property(t => t.MicroclimateId).HasColumnName("microclimate_id").IsRequired();
        builder.Property(t => t.DepartmentId).HasColumnName("department_id").IsRequired();

        builder.HasOne<Microclimate>().WithMany().HasForeignKey(t => t.MicroclimateId);
        builder.HasOne<Department>().WithMany().HasForeignKey(t => t.DepartmentId).OnDelete(DeleteBehavior.Restrict);
    }
}
```

- [ ] **Step 6: Register the new DbSets**

Edit `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`, adding after the Task 1 DbSets:

```csharp
    public DbSet<Microclimate> Microclimates => Set<Microclimate>();
    public DbSet<MicroclimateDepartmentTarget> MicroclimateDepartmentTargets => Set<MicroclimateDepartmentTarget>();
```

- [ ] **Step 7: Generate the migration**

```bash
dotnet ef migrations add AddMicroclimates --project src/ClimateProject.Infrastructure --startup-project src/ClimateProject.Api --output-dir Migrations
```

Confirm the generated migration's `CreateTable` for `microclimates` carries `defaultValue:` for `status`, `response_count`, `target_participant_count`, `participation_rate`, `targeting_include_managers`, `scheduling_timezone`, all six `realtime_settings_*` booleans/int, `live_results_sentiment_score`, `live_results_engagement_level`, and `live_results_top_themes` — and that `scheduling_start_time`/`scheduling_end_time` are `nullable: false` with **no** `defaultValue` (no intended default exists for those).

- [ ] **Step 8: Run test to verify it passes**

Run: `dotnet test ClimateProject.slnx --filter FullyQualifiedName~MicroclimateTests`
Expected: PASS (3 tests).

- [ ] **Step 9: Full solution build and test**

```bash
dotnet build ClimateProject.slnx
dotnet test ClimateProject.slnx
```
Expected: 0 warnings, all tests passing.

- [ ] **Step 10: Commit, push, PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/Microclimate.cs \
        src/ClimateProject.Domain/Entities/MicroclimateDepartmentTarget.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateDepartmentTargetConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
        src/ClimateProject.Infrastructure/Migrations/ \
        tests/ClimateProject.IntegrationTests/Persistence/MicroclimateTests.cs
git commit -m "$(cat <<'EOF'
feat: add Microclimate aggregate with targeting/scheduling/realtime/live-results owned types

Part of #52 (microclimates schema). Adds the microclimates table plus its four
1:1 owned shapes and the microclimate_department_targets junction that replaces
the legacy targeting.department_ids array.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push -u origin schema/microclimate-core
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: add Microclimate aggregate with owned targeting/scheduling/realtime/live-results" \
  --body "Part of #52 (microclimates schema). Second of five tasks — depends on Task 1's microclimate_templates table for the template_id FK."
gh pr merge --squash --delete-branch
git checkout main
git pull
```

---

## Task 3: Microclimate Questions (`microclimate_questions`)

**Files:**
- Create: `src/ClimateProject.Domain/Entities/MicroclimateQuestion.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateQuestionConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`
- Create: `tests/ClimateProject.IntegrationTests/Persistence/MicroclimateQuestionTests.cs`
- Migration (generated): `src/ClimateProject.Infrastructure/Migrations/<timestamp>_AddMicroclimateQuestions.cs`

**Interfaces:**
- Consumes: `Microclimate` (`Id` Guid PK, table `microclimates`, from Task 2), `Company`, `User` (unchanged, used only for seeding in tests).
- Produces: `MicroclimateQuestion { Guid Id; Guid MicroclimateId; string Text; string Type; string[]? Options; bool Required; int Order }`. Table `microclimate_questions`. Not consumed by any later task — this is a leaf table.

- [ ] **Step 1: Write the failing test**

Create `tests/ClimateProject.IntegrationTests/Persistence/MicroclimateQuestionTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class MicroclimateQuestionTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<Microclimate> SeedMicroclimateAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        var creator = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "creator@acme.test", Name = "Creator",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(creator);
        await db.SaveChangesAsync();

        var now = DateTimeOffset.UtcNow;
        var microclimate = new Microclimate
        {
            Id = Guid.NewGuid(), Title = "Pulse", CompanyId = company.Id, CreatedBy = creator.Id,
            Scheduling = new MicroclimateScheduling { StartTime = now, EndTime = now.AddMinutes(30) },
            CreatedAt = now, UpdatedAt = now,
        };
        db.Microclimates.Add(microclimate);
        await db.SaveChangesAsync();
        return microclimate;
    }

    [Fact]
    public async Task Question_round_trips_with_options_and_ordering()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var microclimate = await SeedMicroclimateAsync(db);

        var question = new MicroclimateQuestion
        {
            Id = Guid.NewGuid(),
            MicroclimateId = microclimate.Id,
            Text = "How satisfied are you this week?",
            Type = "multiple_choice",
            Options = ["Very", "Somewhat", "Not really"],
            Order = 1,
        };
        db.MicroclimateQuestions.Add(question);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.MicroclimateQuestions.SingleAsync(q => q.Id == question.Id);
        Assert.Equal(microclimate.Id, loaded.MicroclimateId);
        Assert.Equal("multiple_choice", loaded.Type);
        Assert.Equal(["Very", "Somewhat", "Not really"], loaded.Options);
        Assert.True(loaded.Required);
        Assert.Equal(1, loaded.Order);
    }

    [Fact]
    public async Task Deleting_microclimate_cascades_to_its_questions()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var microclimate = await SeedMicroclimateAsync(db);

        var question = new MicroclimateQuestion
        {
            Id = Guid.NewGuid(), MicroclimateId = microclimate.Id, Text = "Q", Type = "open_ended", Order = 1,
        };
        db.MicroclimateQuestions.Add(question);
        await db.SaveChangesAsync();

        db.Microclimates.Remove(microclimate);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.MicroclimateQuestions.AnyAsync(q => q.Id == question.Id));
    }

    [Fact]
    public async Task Minimal_row_inserted_via_raw_SQL_still_loads_with_true_intended_default_for_required()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var microclimate = await SeedMicroclimateAsync(db);

        var minimalId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO microclimate_questions ("Id", microclimate_id, text, type, question_order)
             VALUES ({minimalId}, {microclimate.Id}, {"Minimal question"}, {"likert"}, {1})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.MicroclimateQuestions.SingleAsync(q => q.Id == minimalId);
        Assert.True(loaded.Required);
        Assert.Null(loaded.Options);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test ClimateProject.slnx --filter FullyQualifiedName~MicroclimateQuestionTests`
Expected: FAIL to compile — `MicroclimateQuestion` and `db.MicroclimateQuestions` do not exist yet.

- [ ] **Step 3: Create the feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/microclimate-questions
```

- [ ] **Step 4: Write the entity**

Create `src/ClimateProject.Domain/Entities/MicroclimateQuestion.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class MicroclimateQuestion
{
    public Guid Id { get; set; }
    public Guid MicroclimateId { get; set; }
    public required string Text { get; set; }
    public required string Type { get; set; }
    public string[]? Options { get; set; }
    public bool Required { get; set; } = true;
    public int Order { get; set; }
}
```

- [ ] **Step 5: Write the Fluent configuration**

Create `src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateQuestionConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class MicroclimateQuestionConfiguration : IEntityTypeConfiguration<MicroclimateQuestion>
{
    public void Configure(EntityTypeBuilder<MicroclimateQuestion> builder)
    {
        builder.ToTable("microclimate_questions");
        builder.HasKey(q => q.Id);
        builder.Property(q => q.MicroclimateId).HasColumnName("microclimate_id").IsRequired();
        builder.Property(q => q.Text).HasColumnName("text").HasMaxLength(300).IsRequired();
        builder.Property(q => q.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(q => q.Options).HasColumnName("options");
        builder.Property(q => q.Required).HasColumnName("required").IsRequired().HasDefaultValue(true);
        builder.Property(q => q.Order).HasColumnName("question_order").IsRequired();

        builder.HasOne<Microclimate>().WithMany().HasForeignKey(q => q.MicroclimateId);
    }
}
```

- [ ] **Step 6: Register the new DbSet**

Edit `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`, adding after the Task 2 DbSets:

```csharp
    public DbSet<MicroclimateQuestion> MicroclimateQuestions => Set<MicroclimateQuestion>();
```

- [ ] **Step 7: Generate the migration**

```bash
dotnet ef migrations add AddMicroclimateQuestions --project src/ClimateProject.Infrastructure --startup-project src/ClimateProject.Api --output-dir Migrations
```

Confirm `required` carries `defaultValue: true` in the generated `CreateTable` call, and that the FK to `microclimates` defaults to `ReferentialAction.Cascade`.

- [ ] **Step 8: Run test to verify it passes**

Run: `dotnet test ClimateProject.slnx --filter FullyQualifiedName~MicroclimateQuestionTests`
Expected: PASS (3 tests).

- [ ] **Step 9: Full solution build and test**

```bash
dotnet build ClimateProject.slnx
dotnet test ClimateProject.slnx
```
Expected: 0 warnings, all tests passing.

- [ ] **Step 10: Commit, push, PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/MicroclimateQuestion.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateQuestionConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
        src/ClimateProject.Infrastructure/Migrations/ \
        tests/ClimateProject.IntegrationTests/Persistence/MicroclimateQuestionTests.cs
git commit -m "$(cat <<'EOF'
feat: add MicroclimateQuestion table

Part of #52 (microclimates schema). A separate table from survey questions by
design — the shared polymorphic questions table across surveys/microclimates
is explicitly deferred to implementation time per the #49 spec.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push -u origin schema/microclimate-questions
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: add MicroclimateQuestion table" \
  --body "Part of #52 (microclimates schema). Third of five tasks — depends on Task 2's microclimates table."
gh pr merge --squash --delete-branch
git checkout main
git pull
```

---

## Task 4: Microclimate AI Insights (`microclimate_ai_insights`)

**Files:**
- Create: `src/ClimateProject.Domain/Entities/MicroclimateAiInsight.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateAiInsightConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`
- Create: `tests/ClimateProject.IntegrationTests/Persistence/MicroclimateAiInsightTests.cs`
- Migration (generated): `src/ClimateProject.Infrastructure/Migrations/<timestamp>_AddMicroclimateAiInsights.cs`

**Interfaces:**
- Consumes: `Microclimate` (`Id` Guid PK, table `microclimates`, from Task 2).
- Produces: `MicroclimateAiInsight { Guid Id; Guid MicroclimateId; string Type; string Message; double Confidence; DateTimeOffset Timestamp }`. Table `microclimate_ai_insights`. Not consumed by any later task — this is a leaf table.

- [ ] **Step 1: Write the failing test**

Create `tests/ClimateProject.IntegrationTests/Persistence/MicroclimateAiInsightTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class MicroclimateAiInsightTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<Microclimate> SeedMicroclimateAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        var creator = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "creator@acme.test", Name = "Creator",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(creator);
        await db.SaveChangesAsync();

        var now = DateTimeOffset.UtcNow;
        var microclimate = new Microclimate
        {
            Id = Guid.NewGuid(), Title = "Pulse", CompanyId = company.Id, CreatedBy = creator.Id,
            Scheduling = new MicroclimateScheduling { StartTime = now, EndTime = now.AddMinutes(30) },
            CreatedAt = now, UpdatedAt = now,
        };
        db.Microclimates.Add(microclimate);
        await db.SaveChangesAsync();
        return microclimate;
    }

    [Fact]
    public async Task Insight_round_trips()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var microclimate = await SeedMicroclimateAsync(db);

        var insight = new MicroclimateAiInsight
        {
            Id = Guid.NewGuid(),
            MicroclimateId = microclimate.Id,
            Type = "alert",
            Message = "Participation is trending below target.",
            Confidence = 0.82,
            Timestamp = DateTimeOffset.UtcNow,
        };
        db.MicroclimateAiInsights.Add(insight);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.MicroclimateAiInsights.SingleAsync(i => i.Id == insight.Id);
        Assert.Equal(microclimate.Id, loaded.MicroclimateId);
        Assert.Equal("alert", loaded.Type);
        Assert.Equal(0.82, loaded.Confidence);
    }

    [Fact]
    public async Task Deleting_microclimate_cascades_to_its_insights()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var microclimate = await SeedMicroclimateAsync(db);

        var insight = new MicroclimateAiInsight
        {
            Id = Guid.NewGuid(), MicroclimateId = microclimate.Id, Type = "pattern",
            Message = "Recurring theme detected.", Confidence = 0.5, Timestamp = DateTimeOffset.UtcNow,
        };
        db.MicroclimateAiInsights.Add(insight);
        await db.SaveChangesAsync();

        db.Microclimates.Remove(microclimate);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.MicroclimateAiInsights.AnyAsync(i => i.Id == insight.Id));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test ClimateProject.slnx --filter FullyQualifiedName~MicroclimateAiInsightTests`
Expected: FAIL to compile — `MicroclimateAiInsight` and `db.MicroclimateAiInsights` do not exist yet.

- [ ] **Step 3: Create the feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/microclimate-ai-insights
```

- [ ] **Step 4: Write the entity**

Create `src/ClimateProject.Domain/Entities/MicroclimateAiInsight.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class MicroclimateAiInsight
{
    public Guid Id { get; set; }
    public Guid MicroclimateId { get; set; }
    public required string Type { get; set; }
    public required string Message { get; set; }
    public double Confidence { get; set; }
    public DateTimeOffset Timestamp { get; set; }
}
```

- [ ] **Step 5: Write the Fluent configuration**

Create `src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateAiInsightConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class MicroclimateAiInsightConfiguration : IEntityTypeConfiguration<MicroclimateAiInsight>
{
    public void Configure(EntityTypeBuilder<MicroclimateAiInsight> builder)
    {
        builder.ToTable("microclimate_ai_insights");
        builder.HasKey(i => i.Id);
        builder.Property(i => i.MicroclimateId).HasColumnName("microclimate_id").IsRequired();
        builder.Property(i => i.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(i => i.Message).HasColumnName("message").HasMaxLength(1000).IsRequired();
        builder.Property(i => i.Confidence).HasColumnName("confidence").IsRequired();
        builder.Property(i => i.Timestamp).HasColumnName("timestamp").IsRequired();

        builder.HasIndex(i => i.MicroclimateId);

        builder.HasOne<Microclimate>().WithMany().HasForeignKey(i => i.MicroclimateId);
    }
}
```

Note: `Confidence` and `Timestamp` are required with no `.HasDefaultValue(...)` — both are always explicitly supplied by the caller (there is no intended domain default distinct from "must be provided"), matching how `CreatedAt`/`UpdatedAt` are handled elsewhere in this codebase.

- [ ] **Step 6: Register the new DbSet**

Edit `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`, adding after the Task 3 DbSet:

```csharp
    public DbSet<MicroclimateAiInsight> MicroclimateAiInsights => Set<MicroclimateAiInsight>();
```

- [ ] **Step 7: Generate the migration**

```bash
dotnet ef migrations add AddMicroclimateAiInsights --project src/ClimateProject.Infrastructure --startup-project src/ClimateProject.Api --output-dir Migrations
```

- [ ] **Step 8: Run test to verify it passes**

Run: `dotnet test ClimateProject.slnx --filter FullyQualifiedName~MicroclimateAiInsightTests`
Expected: PASS (2 tests).

- [ ] **Step 9: Full solution build and test**

```bash
dotnet build ClimateProject.slnx
dotnet test ClimateProject.slnx
```
Expected: 0 warnings, all tests passing.

- [ ] **Step 10: Commit, push, PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/MicroclimateAiInsight.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateAiInsightConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
        src/ClimateProject.Infrastructure/Migrations/ \
        tests/ClimateProject.IntegrationTests/Persistence/MicroclimateAiInsightTests.cs
git commit -m "$(cat <<'EOF'
feat: add MicroclimateAiInsight table

Part of #52 (microclimates schema). A real relational table of discrete
insight events, replacing the legacy embedded ai_insights subdocument array.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push -u origin schema/microclimate-ai-insights
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: add MicroclimateAiInsight table" \
  --body "Part of #52 (microclimates schema). Fourth of five tasks — depends on Task 2's microclimates table."
gh pr merge --squash --delete-branch
git checkout main
git pull
```

---

## Task 5: Microclimate Invitations (`microclimate_invitations`)

**Files:**
- Create: `src/ClimateProject.Domain/Entities/MicroclimateInvitation.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateInvitationConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`
- Create: `tests/ClimateProject.IntegrationTests/Persistence/MicroclimateInvitationTests.cs`
- Migration (generated): `src/ClimateProject.Infrastructure/Migrations/<timestamp>_AddMicroclimateInvitations.cs`

**Interfaces:**
- Consumes: `Microclimate` (`Id` Guid PK, table `microclimates`, from Task 2), `User`, `Company` (unchanged).
- Produces: `MicroclimateInvitation { Guid Id; Guid MicroclimateId; Guid UserId; Guid CompanyId; string Email; string InvitationToken; string Status; DateTimeOffset? SentAt; DateTimeOffset? OpenedAt; DateTimeOffset? StartedAt; DateTimeOffset? CompletedAt; int ReminderCount; DateTimeOffset? LastReminderSent; DateTimeOffset ExpiresAt; string? Metadata; DateTimeOffset CreatedAt; DateTimeOffset UpdatedAt }`. Table `microclimate_invitations`. This is the last task in the plan — nothing downstream consumes it.

- [ ] **Step 1: Write the failing test**

Create `tests/ClimateProject.IntegrationTests/Persistence/MicroclimateInvitationTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class MicroclimateInvitationTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User invitee, Microclimate microclimate)> SeedAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        var creator = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "creator@acme.test", Name = "Creator",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        var invitee = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "invitee@acme.test", Name = "Invitee",
            Role = "employee", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.AddRange(creator, invitee);
        await db.SaveChangesAsync();

        var now = DateTimeOffset.UtcNow;
        var microclimate = new Microclimate
        {
            Id = Guid.NewGuid(), Title = "Pulse", CompanyId = company.Id, CreatedBy = creator.Id,
            Scheduling = new MicroclimateScheduling { StartTime = now, EndTime = now.AddMinutes(30) },
            CreatedAt = now, UpdatedAt = now,
        };
        db.Microclimates.Add(microclimate);
        await db.SaveChangesAsync();

        return (company, invitee, microclimate);
    }

    [Fact]
    public async Task Invitation_round_trips_with_metadata_jsonb()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, invitee, microclimate) = await SeedAsync(db);

        var invitation = new MicroclimateInvitation
        {
            Id = Guid.NewGuid(),
            MicroclimateId = microclimate.Id,
            UserId = invitee.Id,
            CompanyId = company.Id,
            Email = invitee.Email,
            InvitationToken = "tok_abc123",
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
            Metadata = """{"device_type": "mobile"}""",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.MicroclimateInvitations.Add(invitation);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.MicroclimateInvitations.SingleAsync(i => i.Id == invitation.Id);
        Assert.Equal("pending", loaded.Status);
        Assert.Equal(0, loaded.ReminderCount);
        Assert.Contains("mobile", loaded.Metadata);
        Assert.Null(loaded.SentAt);
    }

    [Fact]
    public async Task Invitation_token_is_unique()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, invitee, microclimate) = await SeedAsync(db);

        var first = new MicroclimateInvitation
        {
            Id = Guid.NewGuid(), MicroclimateId = microclimate.Id, UserId = invitee.Id, CompanyId = company.Id,
            Email = invitee.Email, InvitationToken = "duplicate-token", ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.MicroclimateInvitations.Add(first);
        await db.SaveChangesAsync();

        var second = new MicroclimateInvitation
        {
            Id = Guid.NewGuid(), MicroclimateId = microclimate.Id, UserId = invitee.Id, CompanyId = company.Id,
            Email = "other@acme.test", InvitationToken = "duplicate-token", ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.MicroclimateInvitations.Add(second);

        await Assert.ThrowsAnyAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Minimal_row_inserted_via_raw_SQL_still_loads_with_true_intended_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, invitee, microclimate) = await SeedAsync(db);

        var minimalId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO microclimate_invitations
                 ("Id", microclimate_id, user_id, company_id, email, invitation_token, expires_at, created_at, updated_at)
             VALUES
                 ({minimalId}, {microclimate.Id}, {invitee.Id}, {company.Id}, {invitee.Email},
                  {"minimal-token"}, {now.AddDays(7)}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.MicroclimateInvitations.SingleAsync(i => i.Id == minimalId);
        Assert.Equal("pending", loaded.Status);
        Assert.Equal(0, loaded.ReminderCount);
        Assert.Null(loaded.Metadata);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test ClimateProject.slnx --filter FullyQualifiedName~MicroclimateInvitationTests`
Expected: FAIL to compile — `MicroclimateInvitation` and `db.MicroclimateInvitations` do not exist yet.

- [ ] **Step 3: Create the feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/microclimate-invitations
```

- [ ] **Step 4: Write the entity**

Create `src/ClimateProject.Domain/Entities/MicroclimateInvitation.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class MicroclimateInvitation
{
    public Guid Id { get; set; }
    public Guid MicroclimateId { get; set; }
    public Guid UserId { get; set; }
    public Guid CompanyId { get; set; }
    public required string Email { get; set; }
    public required string InvitationToken { get; set; }
    public string Status { get; set; } = "pending";
    public DateTimeOffset? SentAt { get; set; }
    public DateTimeOffset? OpenedAt { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public int ReminderCount { get; set; }
    public DateTimeOffset? LastReminderSent { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public string? Metadata { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
```

Note on `Status`: values are `pending`/`sent`/`opened`/`started`/`completed`/`expired`/`bounced` — `completed` replaces the legacy Mongoose model's `participated` to stay consistent with the spec's renamed `completed_at` timestamp (the legacy `MicroclimateInvitation.ts` uses `participated`/`participated_at`; the approved #49 spec explicitly renames the timestamp to `completed_at`, so the status value is renamed to match).

- [ ] **Step 5: Write the Fluent configuration**

Create `src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateInvitationConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class MicroclimateInvitationConfiguration : IEntityTypeConfiguration<MicroclimateInvitation>
{
    public void Configure(EntityTypeBuilder<MicroclimateInvitation> builder)
    {
        builder.ToTable("microclimate_invitations");
        builder.HasKey(i => i.Id);
        builder.Property(i => i.MicroclimateId).HasColumnName("microclimate_id").IsRequired();
        builder.Property(i => i.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(i => i.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(i => i.Email).HasColumnName("email").HasMaxLength(255).IsRequired();
        builder.Property(i => i.InvitationToken).HasColumnName("invitation_token").HasMaxLength(255).IsRequired();
        builder.Property(i => i.Status).HasColumnName("status").HasMaxLength(20).IsRequired().HasDefaultValue("pending");
        builder.Property(i => i.SentAt).HasColumnName("sent_at");
        builder.Property(i => i.OpenedAt).HasColumnName("opened_at");
        builder.Property(i => i.StartedAt).HasColumnName("started_at");
        builder.Property(i => i.CompletedAt).HasColumnName("completed_at");
        builder.Property(i => i.ReminderCount).HasColumnName("reminder_count").IsRequired().HasDefaultValue(0);
        builder.Property(i => i.LastReminderSent).HasColumnName("last_reminder_sent");
        builder.Property(i => i.ExpiresAt).HasColumnName("expires_at").IsRequired();
        builder.Property(i => i.Metadata).HasColumnName("metadata").HasColumnType("jsonb");
        builder.Property(i => i.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(i => i.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(i => i.InvitationToken).IsUnique();
        builder.HasIndex(i => new { i.MicroclimateId, i.UserId }).IsUnique();
        builder.HasIndex(i => i.Status);
        builder.HasIndex(i => i.ExpiresAt);

        builder.HasOne<Microclimate>().WithMany().HasForeignKey(i => i.MicroclimateId);
        builder.HasOne<User>().WithMany().HasForeignKey(i => i.UserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Company>().WithMany().HasForeignKey(i => i.CompanyId);
    }
}
```

- [ ] **Step 6: Register the new DbSet**

Edit `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`, adding after the Task 4 DbSet:

```csharp
    public DbSet<MicroclimateInvitation> MicroclimateInvitations => Set<MicroclimateInvitation>();
```

- [ ] **Step 7: Generate the migration**

```bash
dotnet ef migrations add AddMicroclimateInvitations --project src/ClimateProject.Infrastructure --startup-project src/ClimateProject.Api --output-dir Migrations
```

Confirm `status` and `reminder_count` carry `defaultValue:` in the generated `CreateTable` call, and that both unique indexes (`invitation_token`, and the composite `microclimate_id`+`user_id`) are present.

- [ ] **Step 8: Run test to verify it passes**

Run: `dotnet test ClimateProject.slnx --filter FullyQualifiedName~MicroclimateInvitationTests`
Expected: PASS (3 tests).

- [ ] **Step 9: Full solution build and test**

```bash
dotnet build ClimateProject.slnx
dotnet test ClimateProject.slnx
```
Expected: 0 warnings, all tests (old + new, across the whole domain) passing.

- [ ] **Step 10: Commit, push, PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/MicroclimateInvitation.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateInvitationConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
        src/ClimateProject.Infrastructure/Migrations/ \
        tests/ClimateProject.IntegrationTests/Persistence/MicroclimateInvitationTests.cs
git commit -m "$(cat <<'EOF'
feat: add MicroclimateInvitation table

Part of #52 (microclimates schema). Final table of the domain — same shape
family as survey_invitations, with completed_at replacing the legacy
participated_at naming per the approved #49 spec.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push -u origin schema/microclimate-invitations
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: add MicroclimateInvitation table" \
  --body "Part of #52 (microclimates schema). Fifth and final task of this plan — depends on Task 2's microclimates table. Completes the #52 slice of the #49 data-model epic."
gh pr merge --squash --delete-branch
git checkout main
git pull
```

---

## Self-Review Notes

- **Spec coverage:** every bullet under "Microclimates -- #52" in the domain-specific spec maps to a task — core microclimate + targeting + scheduling + realtime_settings + live_results + department_targets → Task 2; microclimate_questions → Task 3; microclimate_ai_insights → Task 4; microclimate_templates + template_questions + template_settings → Task 1; microclimate_invitations → Task 5.
- **Ordering deviation from spec's listed order:** the spec lists `microclimates` before `microclimate_templates`, but this plan builds Templates first (Task 1) because `Microclimate.TemplateId` is a real FK into `microclimate_templates` — building in spec-list order would leave that FK dangling or force a later `ALTER TABLE ADD CONSTRAINT` split across two migrations for no benefit.
- **Deviations from the legacy Mongoose shape, called out explicitly per the approved #49 spec:** `microclimate_scheduling` uses `start_time`/`end_time` instead of legacy `duration_minutes`; `department_ids` is replaced by the `microclimate_department_targets` junction; `microclimate_invitations.completed_at`/status `completed` replace legacy `participated_at`/`participated`.
- **Placeholder scan:** no `TBD`/`TODO`/"add appropriate ..." phrasing anywhere in the task bodies; every step has complete, runnable code.
- **Type consistency check:** `Microclimate.Id` (Guid) is the exact type referenced by `MicroclimateQuestion.MicroclimateId`, `MicroclimateAiInsight.MicroclimateId`, `MicroclimateDepartmentTarget.MicroclimateId`, and `MicroclimateInvitation.MicroclimateId` across Tasks 2–5; `MicroclimateTemplate.Id` (Guid) matches `Microclimate.TemplateId` (Guid?) and `MicroclimateTemplateQuestion.TemplateId` (Guid) across Tasks 1–2. DbSet property names (`MicroclimateTemplates`, `MicroclimateTemplateQuestions`, `Microclimates`, `MicroclimateDepartmentTargets`, `MicroclimateQuestions`, `MicroclimateAiInsights`, `MicroclimateInvitations`) are used identically in every task's tests and DbContext edits.
