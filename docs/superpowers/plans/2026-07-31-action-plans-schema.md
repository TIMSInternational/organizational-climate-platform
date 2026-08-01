# climate-project-api Action Plans Schema (#53 slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `climate-project-api`'s Postgres schema with the Action Plans domain (#53) — action plans, their KPIs/objectives, a fully-normalized append-only progress-update audit trail, and reusable templates — as a slice of #49's full data-model epic, mirroring the org-structure domain's already-merged Company/User/Department schema exactly.

**Architecture:** Same clean-architecture layering already established: plain POCO entities in `ClimateProject.Domain/Entities/`, one `IEntityTypeConfiguration<T>` per entity in `ClimateProject.Infrastructure/Persistence/Configurations/`, applied via `modelBuilder.ApplyConfigurationsFromAssembly`, one new additive EF Core migration per task on top of whatever is at the tip of `Infrastructure/Migrations/`. Unlike the org-structure domain (which used EF Core **owned types** for always-present 1:1 value objects like `CompanySettings`), every nested shape in the Action Plans domain — KPIs, qualitative objectives, progress updates, and their template variants — is a **real, independently-queryable junction table** per the approved #49 design spec ("show progress over time for KPI X" requires joining/filtering rows, which an owned type embedded on the parent table cannot do). No owned types and no jsonb columns appear anywhere in this plan.

**Tech Stack:** .NET 10, EF Core + Npgsql 10.0.0, xUnit, Testcontainers.PostgreSql (all already in place — no new packages needed).

## Global Constraints

- Repo: `/Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api`, branch `main`. Work directly on `main` via a new feature branch per task, PR (`gh pr create --repo TIMSInternational/climate-project-api`), squash-merge (`gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch`), same convention every prior task (#48, org-structure) used.
- **Grounded current repo state** (confirmed by reading the live code before writing this plan): only `Company`, `User`, and `Department` entities exist today. `UserInvitation` and `AuditLog` (org-structure Task 4/5) have **not** been implemented yet — do not assume they exist, do not reference them. Migration tip is `20260731100805_AddUserProfileFields`. No `Survey`/`ai_insights` tables exist anywhere in the codebase yet either (confirmed via repo-wide grep) — this directly affects `ActionPlan.SourceSurveyId`/`SourceInsightId` below.
- **EF Core conventions** (mirror #48/org-structure exactly): snake_case table/column names via explicit `.ToTable(...)`/`.HasColumnName(...)`. **Exception:** the `Id` primary-key column stays PascalCase `"Id"` (no `.HasColumnName("id")` override) — matches `companies`/`users`/`departments` exactly, do not "fix" it.
- **Enums stored as plain C# strings**, never a C# enum type. Since every enum-shaped property in this domain (`Status`, `Priority`, `MeasurementFrequency`, etc.) is already CLR-typed `string`, **do not call `.HasConversion<string>()` anywhere in this plan** — it would be a vestigial no-op (the exact bug flagged as already having shipped once in org-structure Task 2). Only add `.HasMaxLength(N)`.
- **No owned types in this plan.** Every nested shape (KPI, qualitative objective, progress update, and their template variants) is modeled as its own entity + table + `IEntityTypeConfiguration<T>`, with a required FK back to its parent. This is a deliberate divergence from the org-structure domain's owned-type pattern, mandated by the approved #49 design spec because these rows are independently queried/updated over time, not an atomic always-present value object.
- **No jsonb columns in this plan** — nothing in the #53 spec calls for schemaless/dynamic data. Do not add one speculatively.
- **`text[]` array columns** (`ai_recommendations`, `tags` on `action_plans`; `ai_recommendation_templates`, `tags` on `action_plan_templates`): CLR type is `string[]`, mapped automatically by the Npgsql EF provider to `text[]` — no `.HasColumnType(...)` override needed. Every one of these is `NOT NULL` with an intended empty-array default (`[]`), which is **not** the CLR default (`null`) for a reference-typed property that isn't initialized — so per the CRITICAL LESSON below, each needs `.HasDefaultValue(Array.Empty<string>())` plus a raw-SQL-backed test.
- **CRITICAL LESSON (a real bug already shipped once and had to be fixed in org-structure Task 2):** every `NOT NULL` column with an intended default that differs from EF's raw CLR fallback (`null`/`false`/`0`/`""`) **MUST** have `.HasDefaultValue(...)` in the Fluent config matching the C# object-initializer default. Without it, a raw-SQL `INSERT` (or a future manual/legacy row) that omits the column gets the wrong value silently. Every task below that introduces such a column includes a test that `INSERT`s a row via raw SQL setting **only** the columns not covered by this rule, then reads it back via EF, asserting the true intended defaults — never an in-memory EF insert-then-read test, which would pass even with a missing default because EF's own C# object initializer papers over the gap.
- **FK delete-behavior policy for this domain** (extending the established pattern — `Restrict` for self-referencing hierarchy FKs, `SetNull` for optional cross-entity links, default `Cascade` for a required parent-owns-child FK):
  - `CompanyId` (required, on `action_plans` and `action_plan_templates`) → default `Cascade`, no explicit `.OnDelete(...)` call — matches `Department.CompanyId`/`User.CompanyId` exactly (company deletion cascades away everything scoped to it).
  - `DepartmentId` (nullable, on `action_plans`) and `TemplateId` (nullable, on `action_plans`) and `CompanyId` (nullable, on `action_plan_templates`, `null` = global template) → `SetNull` — matches `User.DepartmentId` exactly (deleting the optional linked row clears the pointer, never cascades).
  - `ActionPlanId`/`TemplateId` (required, on every direct child table: `action_plan_kpis`, `action_plan_objectives`, `action_plan_progress_updates`, `action_plan_template_kpis`, `action_plan_template_objectives`) → default `Cascade`, no explicit call — this is the true "parent owns child" relationship (matches the `Question`-belonging-to-`Survey` example in the global conventions).
  - `CreatedBy` (required, on `action_plans` and `action_plan_templates`) and `UpdatedBy` (required, on `action_plan_progress_updates`) → **explicit** `Restrict` — these reference the *acting* `User`, not an owning parent; deleting a user must never silently cascade-delete the action plans/templates/progress history they created. This mirrors `User.ManagerId`'s `Restrict` (same "reference to another user, not a hierarchy, not an owner" shape), applied here to a cross-aggregate reference instead of a self-reference.
  - `ProgressUpdateId` (required, on `action_plan_kpi_updates`/`action_plan_objective_updates`) → default `Cascade` (owning parent — a progress update owns its own KPI/objective update rows).
  - `KpiId`/`ObjectiveId` (required, on `action_plan_kpi_updates`/`action_plan_objective_updates`) → **explicit** `Cascade` (not `Restrict`). These are required references but not the owning parent (`ProgressUpdateId` is), so they don't fit the implicit-default-Cascade "obvious owning parent" case the way `CompanyId` does — hence explicit, with the reasoning spelled out inline: (a) semantically, deleting a KPI/objective should take its own historical audit rows with it, since there's nothing left to show progress "for"; (b) mechanically, `Restrict` here would be actively dangerous — Postgres checks `RESTRICT` FKs immediately per row during a cascading multi-table `DELETE`, and a full `action_plans` deletion cascades into `action_plan_kpis` (via the `Cascade` above) at the same time it cascades into `action_plan_kpi_updates` (via `ProgressUpdateId`'s `Cascade`); if the `KpiId` FK were `Restrict`, the two cascade paths could race and abort the whole transaction depending on delete order. Making both paths into `action_plan_kpi_updates` (and `action_plan_objective_updates`) `Cascade` removes the race entirely — whichever path fires first deletes the row, Postgres tolerates the second path finding it already gone.
  - `SourceSurveyId`/`SourceInsightId` (both nullable `Guid` on `action_plans`): **no FK constraint at all** — per the approved #49 spec for `source_insight_id` (the `ai_insights` table belongs to a different, not-yet-built domain slice), and, grounded in this plan's own repo check, `source_survey_id` is in the identical situation today (no `Survey`/`surveys` table exists anywhere in the current repo). Add both FK constraints in whichever future task first creates those target tables.
- **Deliberately excluded from this plan (YAGNI, scope discipline):** the legacy Mongoose `ActionPlan.assigned_to: string[]` field is **not** part of the approved #49 field list quoted for `action_plans` and is not implemented here. Modeling "who is this plan assigned to" properly is a many-to-many relationship (a junction table), which the approved spec doesn't call for — add it in a future task if a real requirement emerges, rather than guessing its shape now.
- **Role values** stay plain strings matching `ClimateProject.Application.Auth.Roles` (`super_admin`/`company_admin`/`leader`/`supervisor`/`employee`) — not used directly in this domain's schema (no `role` column here), but any seed `User` rows created in tests must use one of these real values.
- `Directory.Build.props` sets `TreatWarningsAsErrors=true` — every task's code must be warning-clean. `dotnet-ef` v10.0.10 is already installed globally.
- Migrations are strictly **additive** — every `dotnet ef migrations add` in this plan runs on top of whatever the previous task left at the tip of `Infrastructure/Migrations/`; never modify or regenerate a prior migration.

  ```
  dotnet ef migrations add <Name> \
    --project src/ClimateProject.Infrastructure \
    --startup-project src/ClimateProject.Api \
    --output-dir Migrations
  ```

- **Task ordering is FK-dependency-driven, not spec-list-order**: `ActionPlanTemplate` (Task 1) is built before `ActionPlan` (Task 3) because `ActionPlan.TemplateId` FKs to it; `ActionPlanKpi`/`ActionPlanObjective`/`ActionPlanProgressUpdate` (Tasks 4–6) are built before `ActionPlanKpiUpdate`/`ActionPlanObjectiveUpdate` (Task 7) because the latter FK to all three.
- Integration tests reuse `tests/ClimateProject.IntegrationTests/Support/PostgresContainerFixture.cs` **unchanged** — construct a `DbContextOptionsBuilder<ClimateProjectDbContext>` with `.UseNpgsql(postgres.ConnectionString)` directly in each new test class, exactly like `DepartmentTests.cs`/`CompanyProfileTests.cs`/`UserProfileTests.cs` already do. Docker must be running for these.
- Every task's step sequence: create feature branch → write entity + config code → generate migration → write failing test(s) → run to confirm fail → (nothing to "implement" beyond what was just written — the fail is expected to be "table doesn't exist"/compile error until the migration + config are in place, so "confirm fail" here means confirming the test fails for the *right* reason before the migration is generated, per Step ordering below) → run to confirm pass → full solution `dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx` confirming 0 warnings and all tests (old + new) passing → commit/push/PR/merge/checkout main/pull.
- Baseline at the start of this plan: **51 existing test methods**, all passing (confirmed via `grep -rhoE '^\s*\[(Fact|Theory)' tests | wc -l` against the live repo before writing this plan). Each task below states its own running total.

---

### Task 1: ActionPlanTemplate entity

**Files:**
- Create: `src/ClimateProject.Domain/Entities/ActionPlanTemplate.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanTemplateConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — add `DbSet<ActionPlanTemplate> ActionPlanTemplates`
- Create: `src/ClimateProject.Infrastructure/Migrations/*` (generated)
- Test: `tests/ClimateProject.IntegrationTests/Persistence/ActionPlanTemplateTests.cs`

**Interfaces:**
- Consumes: `Company` (nullable FK — `null` means a global template), `User` (for `CreatedBy`).
- Produces: `ActionPlanTemplate { Id (Guid), Name (string), Description (string), Category (string), CompanyId (Guid?), CreatedBy (Guid), AiRecommendationTemplates (string[]), Tags (string[]), UsageCount (int), IsActive (bool), CreatedAt (DateTimeOffset), UpdatedAt (DateTimeOffset) }`. Task 2 (`ActionPlanTemplateKpi`/`ActionPlanTemplateObjective`) and Task 3 (`ActionPlan.TemplateId`) both FK to this table.

- [ ] **Step 1: Create a feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/action-plan-templates
```

- [ ] **Step 2: Write the ActionPlanTemplate entity**

`src/ClimateProject.Domain/Entities/ActionPlanTemplate.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class ActionPlanTemplate
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string Description { get; set; }
    public required string Category { get; set; }
    public Guid? CompanyId { get; set; }
    public Guid CreatedBy { get; set; }
    public string[] AiRecommendationTemplates { get; set; } = [];
    public string[] Tags { get; set; } = [];
    public int UsageCount { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
```

- [ ] **Step 3: Write ActionPlanTemplateConfiguration**

`src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanTemplateConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanTemplateConfiguration : IEntityTypeConfiguration<ActionPlanTemplate>
{
    public void Configure(EntityTypeBuilder<ActionPlanTemplate> builder)
    {
        builder.ToTable("action_plan_templates");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(t => t.Description).HasColumnName("description").HasColumnType("text").IsRequired();
        builder.Property(t => t.Category).HasColumnName("category").HasMaxLength(100).IsRequired();
        builder.Property(t => t.CompanyId).HasColumnName("company_id");
        builder.Property(t => t.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(t => t.AiRecommendationTemplates).HasColumnName("ai_recommendation_templates").IsRequired().HasDefaultValue(Array.Empty<string>());
        builder.Property(t => t.Tags).HasColumnName("tags").IsRequired().HasDefaultValue(Array.Empty<string>());
        builder.Property(t => t.UsageCount).HasColumnName("usage_count").IsRequired().HasDefaultValue(0);
        builder.Property(t => t.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(t => t.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(t => t.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(t => new { t.CompanyId, t.Category });
        builder.HasIndex(t => t.IsActive);
        builder.HasIndex(t => t.UsageCount);

        builder.HasOne<Company>().WithMany().HasForeignKey(t => t.CompanyId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<User>().WithMany().HasForeignKey(t => t.CreatedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
```

(`CompanyId` nullable + `SetNull` — a `null` `company_id` means a global template usable by every company, per the legacy Mongoose comment `// null for global templates`; a company-scoped template's link is cleared, not cascade-deleted, if the company goes away. `CreatedBy` uses `Restrict` per the Global Constraints policy for "acting user" references.)

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
    public DbSet<ActionPlanTemplate> ActionPlanTemplates => Set<ActionPlanTemplate>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
```

- [ ] **Step 5: Generate the migration**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
dotnet ef migrations add AddActionPlanTemplates \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

Expected: succeeds, creates a new `*_AddActionPlanTemplates.cs` migration that `CreateTable`s `action_plan_templates` with all columns/defaults/indexes/FKs above, without touching any prior migration.

- [ ] **Step 6: Write the failing tests**

`tests/ClimateProject.IntegrationTests/Persistence/ActionPlanTemplateTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ActionPlanTemplateTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user)> SeedCompanyAndUserAsync(ClimateProjectDbContext db, string suffix)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = $"Acme {suffix}", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{suffix}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (company, user);
    }

    [Fact]
    public async Task ActionPlanTemplate_round_trips_company_scoped_and_global_variants()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db, "1");

        var scoped = new ActionPlanTemplate
        {
            Id = Guid.NewGuid(),
            Name = "Engagement Boost",
            Description = "Standard playbook for low engagement scores.",
            Category = "engagement",
            CompanyId = company.Id,
            CreatedBy = user.Id,
            AiRecommendationTemplates = ["Schedule 1:1s", "Run a pulse survey"],
            Tags = ["engagement", "quarterly"],
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        var global = new ActionPlanTemplate
        {
            Id = Guid.NewGuid(),
            Name = "Generic Improvement",
            Description = "Global default template.",
            Category = "general",
            CompanyId = null,
            CreatedBy = user.Id,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.ActionPlanTemplates.AddRange(scoped, global);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedScoped = await readDb.ActionPlanTemplates.SingleAsync(t => t.Id == scoped.Id);
        Assert.Equal(company.Id, loadedScoped.CompanyId);
        Assert.Equal(["Schedule 1:1s", "Run a pulse survey"], loadedScoped.AiRecommendationTemplates);
        Assert.Equal(["engagement", "quarterly"], loadedScoped.Tags);

        var loadedGlobal = await readDb.ActionPlanTemplates.SingleAsync(t => t.Id == global.Id);
        Assert.Null(loadedGlobal.CompanyId);
    }

    [Fact]
    public async Task Existing_template_row_without_explicit_values_gets_intended_defaults()
    {
        // Proves the migration's CreateTable declares real SQL-level defaults, not just C#
        // object-initializer defaults that only apply when inserting through EF.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (_, user) = await SeedCompanyAndUserAsync(db, "2");

        var minimalId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO action_plan_templates ("Id", name, description, category, created_by, created_at, updated_at)
             VALUES ({minimalId}, {"Minimal Template"}, {"desc"}, {"general"}, {user.Id}, {DateTimeOffset.UtcNow}, {DateTimeOffset.UtcNow})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlanTemplates.SingleAsync(t => t.Id == minimalId);
        Assert.Null(loaded.CompanyId);
        Assert.Empty(loaded.AiRecommendationTemplates);
        Assert.Empty(loaded.Tags);
        Assert.Equal(0, loaded.UsageCount);
        Assert.True(loaded.IsActive);
    }

    [Fact]
    public async Task Deleting_the_creating_user_is_restricted()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (_, user) = await SeedCompanyAndUserAsync(db, "3");

        db.ActionPlanTemplates.Add(new ActionPlanTemplate
        {
            Id = Guid.NewGuid(), Name = "T", Description = "d", Category = "general",
            CreatedBy = user.Id, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();

        db.Users.Remove(user);
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}
```

- [ ] **Step 7: Run the tests to verify they fail first, for the right reason**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter ActionPlanTemplateTests`
Expected (before Step 5's migration exists, or if you're following strict outside-in TDD, run this check between Steps 2–3 and Step 5): compile/runtime failure because `action_plan_templates` doesn't exist yet. Since Steps 2–5 above are written in dependency order (entity → config → DbSet → migration) rather than strict red-green-refactor, the practical checkpoint here is: after Step 5's migration is generated, run the tests once to confirm they were red beforehand isn't re-creatable — instead confirm the suite is fully green now (Step 8) and treat Steps 2–6 collectively as "the failing state was 'this code doesn't exist yet', now it does."

- [ ] **Step 8: Run the tests to verify they pass**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter ActionPlanTemplateTests`
Expected: PASS (3/3). Requires Docker running.

- [ ] **Step 9: Run the full solution build and test suite**

Run: `dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx`
Expected: builds clean (0 warnings), all tests pass (51 + 3 = 54).

- [ ] **Step 10: Commit, push, open a PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/ActionPlanTemplate.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanTemplateConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
  src/ClimateProject.Infrastructure/Migrations/ \
  tests/ClimateProject.IntegrationTests/Persistence/ActionPlanTemplateTests.cs
git commit -m "feat: add ActionPlanTemplate entity"
git push -u origin schema/action-plan-templates
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: ActionPlanTemplate entity" \
  --body "First piece of #53's Action Plans schema slice (part of #49). Adds action_plan_templates — company-scoped or global (null company_id) reusable templates. No changes to existing schema. Built before ActionPlan (this plan's Task 3) since ActionPlan.TemplateId FKs to it."
gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch
git checkout main && git pull
```

---

### Task 2: ActionPlanTemplateKpi + ActionPlanTemplateObjective entities

**Files:**
- Create: `src/ClimateProject.Domain/Entities/ActionPlanTemplateKpi.cs`
- Create: `src/ClimateProject.Domain/Entities/ActionPlanTemplateObjective.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanTemplateKpiConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanTemplateObjectiveConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — add `DbSet<ActionPlanTemplateKpi> ActionPlanTemplateKpis`, `DbSet<ActionPlanTemplateObjective> ActionPlanTemplateObjectives`
- Create: `src/ClimateProject.Infrastructure/Migrations/*` (generated)
- Test: `tests/ClimateProject.IntegrationTests/Persistence/ActionPlanTemplateItemsTests.cs`

**Interfaces:**
- Consumes: `ActionPlanTemplate` (Task 1) for `TemplateId`.
- Produces: `ActionPlanTemplateKpi { Id, TemplateId, Name, TargetValue (decimal), Unit, MeasurementFrequency }`; `ActionPlanTemplateObjective { Id, TemplateId, Description, SuccessCriteria }`.

- [ ] **Step 1: Create a feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/action-plan-template-items
```

- [ ] **Step 2: Write the two entities**

`src/ClimateProject.Domain/Entities/ActionPlanTemplateKpi.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class ActionPlanTemplateKpi
{
    public Guid Id { get; set; }
    public Guid TemplateId { get; set; }
    public required string Name { get; set; }
    public decimal TargetValue { get; set; }
    public required string Unit { get; set; }
    public required string MeasurementFrequency { get; set; }
}
```

`src/ClimateProject.Domain/Entities/ActionPlanTemplateObjective.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class ActionPlanTemplateObjective
{
    public Guid Id { get; set; }
    public Guid TemplateId { get; set; }
    public required string Description { get; set; }
    public required string SuccessCriteria { get; set; }
}
```

(`MeasurementFrequency` is the real enum values confirmed from the legacy Mongoose `KPITemplateSchema`: `daily`/`weekly`/`monthly`/`quarterly`, required with no default — callers must always supply one, so no `.HasDefaultValue(...)` is needed for it.)

- [ ] **Step 3: Write the two configurations**

`src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanTemplateKpiConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanTemplateKpiConfiguration : IEntityTypeConfiguration<ActionPlanTemplateKpi>
{
    public void Configure(EntityTypeBuilder<ActionPlanTemplateKpi> builder)
    {
        builder.ToTable("action_plan_template_kpis");
        builder.HasKey(k => k.Id);
        builder.Property(k => k.TemplateId).HasColumnName("template_id").IsRequired();
        builder.Property(k => k.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(k => k.TargetValue).HasColumnName("target_value").IsRequired();
        builder.Property(k => k.Unit).HasColumnName("unit").HasMaxLength(50).IsRequired();
        builder.Property(k => k.MeasurementFrequency).HasColumnName("measurement_frequency").HasMaxLength(20).IsRequired();

        builder.HasOne<ActionPlanTemplate>().WithMany().HasForeignKey(k => k.TemplateId);
    }
}
```

`src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanTemplateObjectiveConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanTemplateObjectiveConfiguration : IEntityTypeConfiguration<ActionPlanTemplateObjective>
{
    public void Configure(EntityTypeBuilder<ActionPlanTemplateObjective> builder)
    {
        builder.ToTable("action_plan_template_objectives");
        builder.HasKey(o => o.Id);
        builder.Property(o => o.TemplateId).HasColumnName("template_id").IsRequired();
        builder.Property(o => o.Description).HasColumnName("description").HasColumnType("text").IsRequired();
        builder.Property(o => o.SuccessCriteria).HasColumnName("success_criteria").HasColumnType("text").IsRequired();

        builder.HasOne<ActionPlanTemplate>().WithMany().HasForeignKey(o => o.TemplateId);
    }
}
```

(Both `TemplateId` FKs use the implicit default `Cascade` — no `.OnDelete(...)` call — matching the "required parent-owns-child" policy: deleting a template deletes its KPI/objective template rows with it.)

- [ ] **Step 4: Register the two DbSets**

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
    public DbSet<ActionPlanTemplate> ActionPlanTemplates => Set<ActionPlanTemplate>();
    public DbSet<ActionPlanTemplateKpi> ActionPlanTemplateKpis => Set<ActionPlanTemplateKpi>();
    public DbSet<ActionPlanTemplateObjective> ActionPlanTemplateObjectives => Set<ActionPlanTemplateObjective>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
```

- [ ] **Step 5: Generate the migration**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
dotnet ef migrations add AddActionPlanTemplateItems \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

Expected: succeeds, creates `action_plan_template_kpis` and `action_plan_template_objectives`, both with a cascading FK to `action_plan_templates`.

- [ ] **Step 6: Write the failing tests**

`tests/ClimateProject.IntegrationTests/Persistence/ActionPlanTemplateItemsTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ActionPlanTemplateItemsTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<ActionPlanTemplate> SeedTemplateAsync(ClimateProjectDbContext db, string suffix)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = $"Acme {suffix}", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{suffix}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        var template = new ActionPlanTemplate
        {
            Id = Guid.NewGuid(), Name = "T", Description = "d", Category = "general", CompanyId = company.Id,
            CreatedBy = user.Id, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        db.ActionPlanTemplates.Add(template);
        await db.SaveChangesAsync();
        return template;
    }

    [Fact]
    public async Task Template_kpi_and_objective_rows_round_trip()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var template = await SeedTemplateAsync(db, "1");

        var kpi = new ActionPlanTemplateKpi
        {
            Id = Guid.NewGuid(), TemplateId = template.Id, Name = "Response rate",
            TargetValue = 85m, Unit = "%", MeasurementFrequency = "monthly",
        };
        var objective = new ActionPlanTemplateObjective
        {
            Id = Guid.NewGuid(), TemplateId = template.Id,
            Description = "Improve team cohesion", SuccessCriteria = "Two team events run",
        };
        db.ActionPlanTemplateKpis.Add(kpi);
        db.ActionPlanTemplateObjectives.Add(objective);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedKpi = await readDb.ActionPlanTemplateKpis.SingleAsync(k => k.Id == kpi.Id);
        Assert.Equal(85m, loadedKpi.TargetValue);
        Assert.Equal("monthly", loadedKpi.MeasurementFrequency);

        var loadedObjective = await readDb.ActionPlanTemplateObjectives.SingleAsync(o => o.Id == objective.Id);
        Assert.Equal("Two team events run", loadedObjective.SuccessCriteria);
    }

    [Fact]
    public async Task Deleting_a_template_cascades_delete_of_its_kpi_and_objective_rows()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var template = await SeedTemplateAsync(db, "2");

        var kpiId = Guid.NewGuid();
        var objectiveId = Guid.NewGuid();
        db.ActionPlanTemplateKpis.Add(new ActionPlanTemplateKpi
        {
            Id = kpiId, TemplateId = template.Id, Name = "K", TargetValue = 1m, Unit = "count", MeasurementFrequency = "weekly",
        });
        db.ActionPlanTemplateObjectives.Add(new ActionPlanTemplateObjective
        {
            Id = objectiveId, TemplateId = template.Id, Description = "d", SuccessCriteria = "s",
        });
        await db.SaveChangesAsync();

        db.ActionPlanTemplates.Remove(template);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.ActionPlanTemplateKpis.AnyAsync(k => k.Id == kpiId));
        Assert.False(await readDb.ActionPlanTemplateObjectives.AnyAsync(o => o.Id == objectiveId));
    }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter ActionPlanTemplateItemsTests`
Expected: PASS (2/2).

- [ ] **Step 8: Run the full solution build and test suite**

Run: `dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx`
Expected: builds clean, all tests pass (54 + 2 = 56).

- [ ] **Step 9: Commit, push, open a PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/ActionPlanTemplateKpi.cs \
  src/ClimateProject.Domain/Entities/ActionPlanTemplateObjective.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanTemplateKpiConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanTemplateObjectiveConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
  src/ClimateProject.Infrastructure/Migrations/ \
  tests/ClimateProject.IntegrationTests/Persistence/ActionPlanTemplateItemsTests.cs
git commit -m "feat: add ActionPlanTemplateKpi and ActionPlanTemplateObjective entities"
git push -u origin schema/action-plan-template-items
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: ActionPlanTemplateKpi + ActionPlanTemplateObjective" \
  --body "Second piece of #53's schema slice. Adds the template variants of KPI/objective — action_plan_template_kpis and action_plan_template_objectives, both cascade-deleted with their parent template."
gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch
git checkout main && git pull
```

---

### Task 3: ActionPlan core entity

**Files:**
- Create: `src/ClimateProject.Domain/Entities/ActionPlan.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — add `DbSet<ActionPlan> ActionPlans`
- Create: `src/ClimateProject.Infrastructure/Migrations/*` (generated)
- Test: `tests/ClimateProject.IntegrationTests/Persistence/ActionPlanTests.cs`

**Interfaces:**
- Consumes: `Company` (required), `Department` (nullable), `User` (for `CreatedBy`), `ActionPlanTemplate` (Task 1, nullable).
- Produces: `ActionPlan { Id, Title, Description, CompanyId, DepartmentId (Guid?), CreatedBy, DueDate (DateTimeOffset), Status (string, default "not_started"), Priority (string, default "medium"), AiRecommendations (string[]), Tags (string[]), TemplateId (Guid?), SourceSurveyId (Guid?, no FK), SourceInsightId (Guid?, no FK), CreatedAt, UpdatedAt }`. Tasks 4–6 (`ActionPlanKpi`/`ActionPlanObjective`/`ActionPlanProgressUpdate`) all FK to this table via `ActionPlanId`.

- [ ] **Step 1: Create a feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/action-plans
```

- [ ] **Step 2: Write the ActionPlan entity**

`src/ClimateProject.Domain/Entities/ActionPlan.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class ActionPlan
{
    public Guid Id { get; set; }
    public required string Title { get; set; }
    public required string Description { get; set; }
    public Guid CompanyId { get; set; }
    public Guid? DepartmentId { get; set; }
    public Guid CreatedBy { get; set; }
    public DateTimeOffset DueDate { get; set; }
    public string Status { get; set; } = "not_started";
    public string Priority { get; set; } = "medium";
    public string[] AiRecommendations { get; set; } = [];
    public string[] Tags { get; set; } = [];
    public Guid? TemplateId { get; set; }
    public Guid? SourceSurveyId { get; set; }
    public Guid? SourceInsightId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
```

(`Status`/`Priority` real enum values confirmed from the legacy Mongoose `ActionPlanSchema`: `Status` is one of `not_started`/`in_progress`/`completed`/`overdue`/`cancelled`, default `not_started`; `Priority` is one of `low`/`medium`/`high`/`critical`, default `medium`. `SourceSurveyId`/`SourceInsightId` are bare `Guid?` with no navigation property — no target table exists yet for either, per the Global Constraints note.)

- [ ] **Step 3: Write ActionPlanConfiguration**

`src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanConfiguration : IEntityTypeConfiguration<ActionPlan>
{
    public void Configure(EntityTypeBuilder<ActionPlan> builder)
    {
        builder.ToTable("action_plans");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Title).HasColumnName("title").HasMaxLength(300).IsRequired();
        builder.Property(a => a.Description).HasColumnName("description").HasColumnType("text").IsRequired();
        builder.Property(a => a.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(a => a.DepartmentId).HasColumnName("department_id");
        builder.Property(a => a.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(a => a.DueDate).HasColumnName("due_date").IsRequired();
        builder.Property(a => a.Status).HasColumnName("status").HasMaxLength(20).IsRequired().HasDefaultValue("not_started");
        builder.Property(a => a.Priority).HasColumnName("priority").HasMaxLength(20).IsRequired().HasDefaultValue("medium");
        builder.Property(a => a.AiRecommendations).HasColumnName("ai_recommendations").IsRequired().HasDefaultValue(Array.Empty<string>());
        builder.Property(a => a.Tags).HasColumnName("tags").IsRequired().HasDefaultValue(Array.Empty<string>());
        builder.Property(a => a.TemplateId).HasColumnName("template_id");
        builder.Property(a => a.SourceSurveyId).HasColumnName("source_survey_id");
        builder.Property(a => a.SourceInsightId).HasColumnName("source_insight_id");
        builder.Property(a => a.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(a => a.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(a => new { a.CompanyId, a.Status });
        builder.HasIndex(a => a.DueDate);

        builder.HasOne<Company>().WithMany().HasForeignKey(a => a.CompanyId);
        builder.HasOne<Department>().WithMany().HasForeignKey(a => a.DepartmentId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<User>().WithMany().HasForeignKey(a => a.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ActionPlanTemplate>().WithMany().HasForeignKey(a => a.TemplateId).OnDelete(DeleteBehavior.SetNull);
    }
}
```

(No FK is declared for `SourceSurveyId`/`SourceInsightId` — they're plain indexless `Guid?` columns, intentionally. The `(company_id, status)` and `due_date` indexes mirror the legacy Mongoose indexes `{ company_id: 1, status: 1 }` and `{ due_date: 1 }`; `created_by` already gets an automatic index from the FK convention, matching how `IX_users_department_id`/`IX_users_manager_id` were auto-created in the org-structure migrations.)

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
    public DbSet<ActionPlanTemplate> ActionPlanTemplates => Set<ActionPlanTemplate>();
    public DbSet<ActionPlanTemplateKpi> ActionPlanTemplateKpis => Set<ActionPlanTemplateKpi>();
    public DbSet<ActionPlanTemplateObjective> ActionPlanTemplateObjectives => Set<ActionPlanTemplateObjective>();
    public DbSet<ActionPlan> ActionPlans => Set<ActionPlan>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
```

- [ ] **Step 5: Generate the migration**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
dotnet ef migrations add AddActionPlans \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

Expected: succeeds, creates `action_plans` with all columns/defaults/indexes/FKs above.

- [ ] **Step 6: Write the failing tests**

`tests/ClimateProject.IntegrationTests/Persistence/ActionPlanTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ActionPlanTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, Department department, User user, ActionPlanTemplate template)> SeedScaffoldAsync(
        ClimateProjectDbContext db, string suffix)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = $"Acme {suffix}", CreatedAt = DateTimeOffset.UtcNow };
        var department = new Department
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Eng",
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{suffix}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        var template = new ActionPlanTemplate
        {
            Id = Guid.NewGuid(), Name = "T", Description = "d", Category = "general", CompanyId = company.Id,
            CreatedBy = user.Id, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Departments.Add(department);
        db.Users.Add(user);
        db.ActionPlanTemplates.Add(template);
        await db.SaveChangesAsync();
        return (company, department, user, template);
    }

    [Fact]
    public async Task ActionPlan_round_trips_with_arrays_and_optional_links()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, department, user, template) = await SeedScaffoldAsync(db, "1");
        var surveyId = Guid.NewGuid();
        var insightId = Guid.NewGuid();

        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(),
            Title = "Improve engineering morale",
            Description = "Quarterly follow-up on the last engagement survey.",
            CompanyId = company.Id,
            DepartmentId = department.Id,
            CreatedBy = user.Id,
            DueDate = DateTimeOffset.UtcNow.AddMonths(3),
            Status = "in_progress",
            Priority = "high",
            AiRecommendations = ["Run more 1:1s", "Increase async updates"],
            Tags = ["morale", "q3"],
            TemplateId = template.Id,
            SourceSurveyId = surveyId,
            SourceInsightId = insightId,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.ActionPlans.Add(plan);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlans.SingleAsync(a => a.Id == plan.Id);
        Assert.Equal("in_progress", loaded.Status);
        Assert.Equal("high", loaded.Priority);
        Assert.Equal(["Run more 1:1s", "Increase async updates"], loaded.AiRecommendations);
        Assert.Equal(["morale", "q3"], loaded.Tags);
        Assert.Equal(template.Id, loaded.TemplateId);
        Assert.Equal(surveyId, loaded.SourceSurveyId);
        Assert.Equal(insightId, loaded.SourceInsightId);
    }

    [Fact]
    public async Task Existing_action_plan_row_without_explicit_values_gets_intended_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, _, user, _) = await SeedScaffoldAsync(db, "2");

        var minimalId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO action_plans ("Id", title, description, company_id, created_by, due_date, created_at, updated_at)
             VALUES ({minimalId}, {"Minimal Plan"}, {"desc"}, {company.Id}, {user.Id}, {DateTimeOffset.UtcNow.AddDays(30)}, {DateTimeOffset.UtcNow}, {DateTimeOffset.UtcNow})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlans.SingleAsync(a => a.Id == minimalId);
        Assert.Equal("not_started", loaded.Status);
        Assert.Equal("medium", loaded.Priority);
        Assert.Empty(loaded.AiRecommendations);
        Assert.Empty(loaded.Tags);
        Assert.Null(loaded.DepartmentId);
        Assert.Null(loaded.TemplateId);
    }

    [Fact]
    public async Task Deleting_department_sets_action_plan_department_id_null()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, department, user, _) = await SeedScaffoldAsync(db, "3");

        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(), Title = "P", Description = "d", CompanyId = company.Id, DepartmentId = department.Id,
            CreatedBy = user.Id, DueDate = DateTimeOffset.UtcNow.AddDays(30),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.ActionPlans.Add(plan);
        await db.SaveChangesAsync();

        db.Departments.Remove(department);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlans.SingleAsync(a => a.Id == plan.Id);
        Assert.Null(loaded.DepartmentId);
    }

    [Fact]
    public async Task Deleting_template_sets_action_plan_template_id_null()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, _, user, template) = await SeedScaffoldAsync(db, "4");

        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(), Title = "P", Description = "d", CompanyId = company.Id, TemplateId = template.Id,
            CreatedBy = user.Id, DueDate = DateTimeOffset.UtcNow.AddDays(30),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.ActionPlans.Add(plan);
        await db.SaveChangesAsync();

        db.ActionPlanTemplates.Remove(template);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlans.SingleAsync(a => a.Id == plan.Id);
        Assert.Null(loaded.TemplateId);
    }

    [Fact]
    public async Task Deleting_company_cascades_delete_of_its_action_plans()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, _, user, _) = await SeedScaffoldAsync(db, "5");

        var planId = Guid.NewGuid();
        db.ActionPlans.Add(new ActionPlan
        {
            Id = planId, Title = "P", Description = "d", CompanyId = company.Id,
            CreatedBy = user.Id, DueDate = DateTimeOffset.UtcNow.AddDays(30),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();

        db.Companies.Remove(company);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.ActionPlans.AnyAsync(a => a.Id == planId));
    }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter ActionPlanTests`
Expected: PASS (5/5).

- [ ] **Step 8: Run the full solution build and test suite**

Run: `dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx`
Expected: builds clean, all tests pass (56 + 5 = 61).

- [ ] **Step 9: Commit, push, open a PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/ActionPlan.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
  src/ClimateProject.Infrastructure/Migrations/ \
  tests/ClimateProject.IntegrationTests/Persistence/ActionPlanTests.cs
git commit -m "feat: add ActionPlan core entity"
git push -u origin schema/action-plans
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: ActionPlan core entity" \
  --body "Third piece of #53's schema slice. Adds action_plans — the central aggregate. company_id (required, cascades), department_id + template_id (optional, set-null), created_by (required, restrict). source_survey_id/source_insight_id are bare Guid columns with no FK yet since neither target table exists in the repo today. assigned_to from the legacy Mongoose model is deliberately NOT included — not part of the approved #49 field list."
gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch
git checkout main && git pull
```

---

### Task 4: ActionPlanKpi entity

**Files:**
- Create: `src/ClimateProject.Domain/Entities/ActionPlanKpi.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanKpiConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — add `DbSet<ActionPlanKpi> ActionPlanKpis`
- Create: `src/ClimateProject.Infrastructure/Migrations/*` (generated)
- Test: `tests/ClimateProject.IntegrationTests/Persistence/ActionPlanKpiTests.cs`

**Interfaces:**
- Consumes: `ActionPlan` (Task 3) for `ActionPlanId`.
- Produces: `ActionPlanKpi { Id, ActionPlanId, Name, TargetValue (decimal), CurrentValue (decimal, default 0), Unit, MeasurementFrequency }`. Task 7 (`ActionPlanKpiUpdate`) FKs to this table via `KpiId`.

- [ ] **Step 1: Create a feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/action-plan-kpis
```

- [ ] **Step 2: Write the ActionPlanKpi entity**

`src/ClimateProject.Domain/Entities/ActionPlanKpi.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class ActionPlanKpi
{
    public Guid Id { get; set; }
    public Guid ActionPlanId { get; set; }
    public required string Name { get; set; }
    public decimal TargetValue { get; set; }
    public decimal CurrentValue { get; set; }
    public required string Unit { get; set; }
    public required string MeasurementFrequency { get; set; }
}
```

- [ ] **Step 3: Write ActionPlanKpiConfiguration**

`src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanKpiConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanKpiConfiguration : IEntityTypeConfiguration<ActionPlanKpi>
{
    public void Configure(EntityTypeBuilder<ActionPlanKpi> builder)
    {
        builder.ToTable("action_plan_kpis");
        builder.HasKey(k => k.Id);
        builder.Property(k => k.ActionPlanId).HasColumnName("action_plan_id").IsRequired();
        builder.Property(k => k.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(k => k.TargetValue).HasColumnName("target_value").IsRequired();
        builder.Property(k => k.CurrentValue).HasColumnName("current_value").IsRequired().HasDefaultValue(0m);
        builder.Property(k => k.Unit).HasColumnName("unit").HasMaxLength(50).IsRequired();
        builder.Property(k => k.MeasurementFrequency).HasColumnName("measurement_frequency").HasMaxLength(20).IsRequired();

        builder.HasOne<ActionPlan>().WithMany().HasForeignKey(k => k.ActionPlanId);
    }
}
```

(`CurrentValue` default `0m` matches the legacy Mongoose `KPISchema.current_value: { default: 0 }`. `ActionPlanId` uses the implicit default `Cascade` — deleting an action plan deletes its KPIs.)

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
    public DbSet<ActionPlanTemplate> ActionPlanTemplates => Set<ActionPlanTemplate>();
    public DbSet<ActionPlanTemplateKpi> ActionPlanTemplateKpis => Set<ActionPlanTemplateKpi>();
    public DbSet<ActionPlanTemplateObjective> ActionPlanTemplateObjectives => Set<ActionPlanTemplateObjective>();
    public DbSet<ActionPlan> ActionPlans => Set<ActionPlan>();
    public DbSet<ActionPlanKpi> ActionPlanKpis => Set<ActionPlanKpi>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
```

- [ ] **Step 5: Generate the migration**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
dotnet ef migrations add AddActionPlanKpis \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

- [ ] **Step 6: Write the failing tests**

`tests/ClimateProject.IntegrationTests/Persistence/ActionPlanKpiTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ActionPlanKpiTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<ActionPlan> SeedActionPlanAsync(ClimateProjectDbContext db, string suffix)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = $"Acme {suffix}", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{suffix}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(), Title = "P", Description = "d", CompanyId = company.Id,
            CreatedBy = user.Id, DueDate = DateTimeOffset.UtcNow.AddDays(30),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        db.ActionPlans.Add(plan);
        await db.SaveChangesAsync();
        return plan;
    }

    [Fact]
    public async Task ActionPlanKpi_round_trips_and_defaults_current_value_to_zero()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var plan = await SeedActionPlanAsync(db, "1");

        var minimalId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO action_plan_kpis ("Id", action_plan_id, name, target_value, unit, measurement_frequency)
             VALUES ({minimalId}, {plan.Id}, {"eNPS"}, {50m}, {"points"}, {"quarterly"})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlanKpis.SingleAsync(k => k.Id == minimalId);
        Assert.Equal(50m, loaded.TargetValue);
        Assert.Equal(0m, loaded.CurrentValue);
        Assert.Equal("quarterly", loaded.MeasurementFrequency);
    }

    [Fact]
    public async Task Deleting_action_plan_cascades_delete_of_its_kpis()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var plan = await SeedActionPlanAsync(db, "2");

        var kpiId = Guid.NewGuid();
        db.ActionPlanKpis.Add(new ActionPlanKpi
        {
            Id = kpiId, ActionPlanId = plan.Id, Name = "K", TargetValue = 1m, Unit = "count", MeasurementFrequency = "weekly",
        });
        await db.SaveChangesAsync();

        db.ActionPlans.Remove(plan);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.ActionPlanKpis.AnyAsync(k => k.Id == kpiId));
    }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter ActionPlanKpiTests`
Expected: PASS (2/2).

- [ ] **Step 8: Run the full solution build and test suite**

Run: `dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx`
Expected: builds clean, all tests pass (61 + 2 = 63).

- [ ] **Step 9: Commit, push, open a PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/ActionPlanKpi.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanKpiConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
  src/ClimateProject.Infrastructure/Migrations/ \
  tests/ClimateProject.IntegrationTests/Persistence/ActionPlanKpiTests.cs
git commit -m "feat: add ActionPlanKpi entity"
git push -u origin schema/action-plan-kpis
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: ActionPlanKpi entity" \
  --body "Fourth piece of #53's schema slice. Adds action_plan_kpis — a real junction table (not owned), each KPI independently updatable and queryable, matching the approved #49 spec's requirement to normalize this rather than embed it."
gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch
git checkout main && git pull
```

---

### Task 5: ActionPlanObjective entity

**Files:**
- Create: `src/ClimateProject.Domain/Entities/ActionPlanObjective.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanObjectiveConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — add `DbSet<ActionPlanObjective> ActionPlanObjectives`
- Create: `src/ClimateProject.Infrastructure/Migrations/*` (generated)
- Test: `tests/ClimateProject.IntegrationTests/Persistence/ActionPlanObjectiveTests.cs`

**Interfaces:**
- Consumes: `ActionPlan` (Task 3) for `ActionPlanId`.
- Produces: `ActionPlanObjective { Id, ActionPlanId, Description, SuccessCriteria, CurrentStatus (string, default ""), CompletionPercentage (int, default 0) }`. Task 7 (`ActionPlanObjectiveUpdate`) FKs to this table via `ObjectiveId`.

- [ ] **Step 1: Create a feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/action-plan-objectives
```

- [ ] **Step 2: Write the ActionPlanObjective entity**

`src/ClimateProject.Domain/Entities/ActionPlanObjective.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class ActionPlanObjective
{
    public Guid Id { get; set; }
    public Guid ActionPlanId { get; set; }
    public required string Description { get; set; }
    public required string SuccessCriteria { get; set; }
    public string CurrentStatus { get; set; } = "";
    public int CompletionPercentage { get; set; }
}
```

(`CurrentStatus` defaults to `""` and `CompletionPercentage` to `0`, matching the legacy Mongoose `QualitativeObjectiveSchema`'s `current_status: { default: '' }` and `completion_percentage: { default: 0, min: 0, max: 100 }`.)

- [ ] **Step 3: Write ActionPlanObjectiveConfiguration**

`src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanObjectiveConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanObjectiveConfiguration : IEntityTypeConfiguration<ActionPlanObjective>
{
    public void Configure(EntityTypeBuilder<ActionPlanObjective> builder)
    {
        builder.ToTable("action_plan_objectives");
        builder.HasKey(o => o.Id);
        builder.Property(o => o.ActionPlanId).HasColumnName("action_plan_id").IsRequired();
        builder.Property(o => o.Description).HasColumnName("description").HasColumnType("text").IsRequired();
        builder.Property(o => o.SuccessCriteria).HasColumnName("success_criteria").HasColumnType("text").IsRequired();
        builder.Property(o => o.CurrentStatus).HasColumnName("current_status").HasColumnType("text").IsRequired().HasDefaultValue("");
        builder.Property(o => o.CompletionPercentage).HasColumnName("completion_percentage").IsRequired().HasDefaultValue(0);

        builder.HasOne<ActionPlan>().WithMany().HasForeignKey(o => o.ActionPlanId);
    }
}
```

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
    public DbSet<ActionPlanTemplate> ActionPlanTemplates => Set<ActionPlanTemplate>();
    public DbSet<ActionPlanTemplateKpi> ActionPlanTemplateKpis => Set<ActionPlanTemplateKpi>();
    public DbSet<ActionPlanTemplateObjective> ActionPlanTemplateObjectives => Set<ActionPlanTemplateObjective>();
    public DbSet<ActionPlan> ActionPlans => Set<ActionPlan>();
    public DbSet<ActionPlanKpi> ActionPlanKpis => Set<ActionPlanKpi>();
    public DbSet<ActionPlanObjective> ActionPlanObjectives => Set<ActionPlanObjective>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
```

- [ ] **Step 5: Generate the migration**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
dotnet ef migrations add AddActionPlanObjectives \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

- [ ] **Step 6: Write the failing tests**

`tests/ClimateProject.IntegrationTests/Persistence/ActionPlanObjectiveTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ActionPlanObjectiveTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<ActionPlan> SeedActionPlanAsync(ClimateProjectDbContext db, string suffix)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = $"Acme {suffix}", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{suffix}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(), Title = "P", Description = "d", CompanyId = company.Id,
            CreatedBy = user.Id, DueDate = DateTimeOffset.UtcNow.AddDays(30),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        db.ActionPlans.Add(plan);
        await db.SaveChangesAsync();
        return plan;
    }

    [Fact]
    public async Task ActionPlanObjective_round_trips_and_defaults_status_and_completion()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var plan = await SeedActionPlanAsync(db, "1");

        var minimalId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO action_plan_objectives ("Id", action_plan_id, description, success_criteria)
             VALUES ({minimalId}, {plan.Id}, {"Improve onboarding"}, {"New hires rate onboarding 8+/10"})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlanObjectives.SingleAsync(o => o.Id == minimalId);
        Assert.Equal("", loaded.CurrentStatus);
        Assert.Equal(0, loaded.CompletionPercentage);
    }

    [Fact]
    public async Task Deleting_action_plan_cascades_delete_of_its_objectives()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var plan = await SeedActionPlanAsync(db, "2");

        var objectiveId = Guid.NewGuid();
        db.ActionPlanObjectives.Add(new ActionPlanObjective
        {
            Id = objectiveId, ActionPlanId = plan.Id, Description = "d", SuccessCriteria = "s",
        });
        await db.SaveChangesAsync();

        db.ActionPlans.Remove(plan);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.ActionPlanObjectives.AnyAsync(o => o.Id == objectiveId));
    }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter ActionPlanObjectiveTests`
Expected: PASS (2/2).

- [ ] **Step 8: Run the full solution build and test suite**

Run: `dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx`
Expected: builds clean, all tests pass (63 + 2 = 65).

- [ ] **Step 9: Commit, push, open a PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/ActionPlanObjective.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanObjectiveConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
  src/ClimateProject.Infrastructure/Migrations/ \
  tests/ClimateProject.IntegrationTests/Persistence/ActionPlanObjectiveTests.cs
git commit -m "feat: add ActionPlanObjective entity"
git push -u origin schema/action-plan-objectives
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: ActionPlanObjective entity" \
  --body "Fifth piece of #53's schema slice. Adds action_plan_objectives — qualitative objectives as a real junction table, mirroring ActionPlanKpi's normalization."
gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch
git checkout main && git pull
```

---

### Task 6: ActionPlanProgressUpdate entity

**Files:**
- Create: `src/ClimateProject.Domain/Entities/ActionPlanProgressUpdate.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanProgressUpdateConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — add `DbSet<ActionPlanProgressUpdate> ActionPlanProgressUpdates`
- Create: `src/ClimateProject.Infrastructure/Migrations/*` (generated)
- Test: `tests/ClimateProject.IntegrationTests/Persistence/ActionPlanProgressUpdateTests.cs`

**Interfaces:**
- Consumes: `ActionPlan` (Task 3) for `ActionPlanId`, `User` (for `UpdatedBy`).
- Produces: `ActionPlanProgressUpdate { Id, ActionPlanId, UpdateDate (DateTimeOffset), OverallNotes (string, default ""), UpdatedBy }`. Task 7 (`ActionPlanKpiUpdate`/`ActionPlanObjectiveUpdate`) FKs to this table via `ProgressUpdateId`.

- [ ] **Step 1: Create a feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/action-plan-progress-updates
```

- [ ] **Step 2: Write the ActionPlanProgressUpdate entity**

`src/ClimateProject.Domain/Entities/ActionPlanProgressUpdate.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class ActionPlanProgressUpdate
{
    public Guid Id { get; set; }
    public Guid ActionPlanId { get; set; }
    public DateTimeOffset UpdateDate { get; set; }
    public string OverallNotes { get; set; } = "";
    public Guid UpdatedBy { get; set; }
}
```

(`UpdateDate` has no DB-level default — matches the codebase's established pattern of `CreatedAt`/`UpdatedAt` always being set explicitly by application code, never relying on a database `now()` default, even though the legacy Mongoose schema used `default: Date.now`.)

- [ ] **Step 3: Write ActionPlanProgressUpdateConfiguration**

`src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanProgressUpdateConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanProgressUpdateConfiguration : IEntityTypeConfiguration<ActionPlanProgressUpdate>
{
    public void Configure(EntityTypeBuilder<ActionPlanProgressUpdate> builder)
    {
        builder.ToTable("action_plan_progress_updates");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.ActionPlanId).HasColumnName("action_plan_id").IsRequired();
        builder.Property(p => p.UpdateDate).HasColumnName("update_date").IsRequired();
        builder.Property(p => p.OverallNotes).HasColumnName("overall_notes").HasColumnType("text").IsRequired().HasDefaultValue("");
        builder.Property(p => p.UpdatedBy).HasColumnName("updated_by").IsRequired();

        builder.HasOne<ActionPlan>().WithMany().HasForeignKey(p => p.ActionPlanId);
        builder.HasOne<User>().WithMany().HasForeignKey(p => p.UpdatedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
```

(`ActionPlanId` implicit default `Cascade` — owning parent. `UpdatedBy` explicit `Restrict` — same "acting user" policy as `ActionPlan.CreatedBy`.)

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
    public DbSet<ActionPlanTemplate> ActionPlanTemplates => Set<ActionPlanTemplate>();
    public DbSet<ActionPlanTemplateKpi> ActionPlanTemplateKpis => Set<ActionPlanTemplateKpi>();
    public DbSet<ActionPlanTemplateObjective> ActionPlanTemplateObjectives => Set<ActionPlanTemplateObjective>();
    public DbSet<ActionPlan> ActionPlans => Set<ActionPlan>();
    public DbSet<ActionPlanKpi> ActionPlanKpis => Set<ActionPlanKpi>();
    public DbSet<ActionPlanObjective> ActionPlanObjectives => Set<ActionPlanObjective>();
    public DbSet<ActionPlanProgressUpdate> ActionPlanProgressUpdates => Set<ActionPlanProgressUpdate>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
```

- [ ] **Step 5: Generate the migration**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
dotnet ef migrations add AddActionPlanProgressUpdates \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

- [ ] **Step 6: Write the failing tests**

`tests/ClimateProject.IntegrationTests/Persistence/ActionPlanProgressUpdateTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ActionPlanProgressUpdateTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(ActionPlan plan, User user)> SeedActionPlanAsync(ClimateProjectDbContext db, string suffix)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = $"Acme {suffix}", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{suffix}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(), Title = "P", Description = "d", CompanyId = company.Id,
            CreatedBy = user.Id, DueDate = DateTimeOffset.UtcNow.AddDays(30),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        db.ActionPlans.Add(plan);
        await db.SaveChangesAsync();
        return (plan, user);
    }

    [Fact]
    public async Task ActionPlanProgressUpdate_round_trips_and_defaults_overall_notes_to_empty_string()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (plan, user) = await SeedActionPlanAsync(db, "1");

        var minimalId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO action_plan_progress_updates ("Id", action_plan_id, update_date, updated_by)
             VALUES ({minimalId}, {plan.Id}, {DateTimeOffset.UtcNow}, {user.Id})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlanProgressUpdates.SingleAsync(p => p.Id == minimalId);
        Assert.Equal("", loaded.OverallNotes);
    }

    [Fact]
    public async Task Deleting_action_plan_cascades_delete_of_its_progress_updates()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (plan, user) = await SeedActionPlanAsync(db, "2");

        var progressId = Guid.NewGuid();
        db.ActionPlanProgressUpdates.Add(new ActionPlanProgressUpdate
        {
            Id = progressId, ActionPlanId = plan.Id, UpdateDate = DateTimeOffset.UtcNow, UpdatedBy = user.Id,
        });
        await db.SaveChangesAsync();

        db.ActionPlans.Remove(plan);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.ActionPlanProgressUpdates.AnyAsync(p => p.Id == progressId));
    }

    [Fact]
    public async Task Deleting_the_updating_user_is_restricted()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (plan, user) = await SeedActionPlanAsync(db, "3");

        db.ActionPlanProgressUpdates.Add(new ActionPlanProgressUpdate
        {
            Id = Guid.NewGuid(), ActionPlanId = plan.Id, UpdateDate = DateTimeOffset.UtcNow, UpdatedBy = user.Id,
        });
        await db.SaveChangesAsync();

        db.Users.Remove(user);
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter ActionPlanProgressUpdateTests`
Expected: PASS (3/3).

- [ ] **Step 8: Run the full solution build and test suite**

Run: `dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx`
Expected: builds clean, all tests pass (65 + 3 = 68).

- [ ] **Step 9: Commit, push, open a PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/ActionPlanProgressUpdate.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanProgressUpdateConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
  src/ClimateProject.Infrastructure/Migrations/ \
  tests/ClimateProject.IntegrationTests/Persistence/ActionPlanProgressUpdateTests.cs
git commit -m "feat: add ActionPlanProgressUpdate entity"
git push -u origin schema/action-plan-progress-updates
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: ActionPlanProgressUpdate entity" \
  --body "Sixth piece of #53's schema slice. Adds action_plan_progress_updates — the header row of the append-only progress audit trail. Task 7 adds the per-KPI/per-objective detail rows underneath this."
gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch
git checkout main && git pull
```

---

### Task 7: ActionPlanKpiUpdate + ActionPlanObjectiveUpdate entities

**Files:**
- Create: `src/ClimateProject.Domain/Entities/ActionPlanKpiUpdate.cs`
- Create: `src/ClimateProject.Domain/Entities/ActionPlanObjectiveUpdate.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanKpiUpdateConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanObjectiveUpdateConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — add `DbSet<ActionPlanKpiUpdate> ActionPlanKpiUpdates`, `DbSet<ActionPlanObjectiveUpdate> ActionPlanObjectiveUpdates`
- Create: `src/ClimateProject.Infrastructure/Migrations/*` (generated)
- Test: `tests/ClimateProject.IntegrationTests/Persistence/ActionPlanProgressUpdateItemsTests.cs`

**Interfaces:**
- Consumes: `ActionPlanProgressUpdate` (Task 6) for `ProgressUpdateId`, `ActionPlanKpi` (Task 4) for `KpiId`, `ActionPlanObjective` (Task 5) for `ObjectiveId`.
- Produces: `ActionPlanKpiUpdate { Id, ProgressUpdateId, KpiId, NewValue (decimal), Notes (string?) }`; `ActionPlanObjectiveUpdate { Id, ProgressUpdateId, ObjectiveId, StatusUpdate, CompletionPercentage (int?), Notes (string?) }`. This is the plan's terminal task — completes the full #53 schema.

- [ ] **Step 1: Create a feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/action-plan-progress-update-items
```

- [ ] **Step 2: Write the two entities**

`src/ClimateProject.Domain/Entities/ActionPlanKpiUpdate.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class ActionPlanKpiUpdate
{
    public Guid Id { get; set; }
    public Guid ProgressUpdateId { get; set; }
    public Guid KpiId { get; set; }
    public decimal NewValue { get; set; }
    public string? Notes { get; set; }
}
```

`src/ClimateProject.Domain/Entities/ActionPlanObjectiveUpdate.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class ActionPlanObjectiveUpdate
{
    public Guid Id { get; set; }
    public Guid ProgressUpdateId { get; set; }
    public Guid ObjectiveId { get; set; }
    public required string StatusUpdate { get; set; }
    public int? CompletionPercentage { get; set; }
    public string? Notes { get; set; }
}
```

(Both match the legacy Mongoose `ProgressUpdateSchema`'s nested `kpi_updates`/`qualitative_updates` arrays field-for-field: `new_value`/`status_update` required with no default, `notes` always optional, `completion_percentage` optional with no default on the update row — unlike `ActionPlanObjective.CompletionPercentage`, which always has a value.)

- [ ] **Step 3: Write the two configurations**

`src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanKpiUpdateConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanKpiUpdateConfiguration : IEntityTypeConfiguration<ActionPlanKpiUpdate>
{
    public void Configure(EntityTypeBuilder<ActionPlanKpiUpdate> builder)
    {
        builder.ToTable("action_plan_kpi_updates");
        builder.HasKey(u => u.Id);
        builder.Property(u => u.ProgressUpdateId).HasColumnName("progress_update_id").IsRequired();
        builder.Property(u => u.KpiId).HasColumnName("kpi_id").IsRequired();
        builder.Property(u => u.NewValue).HasColumnName("new_value").IsRequired();
        builder.Property(u => u.Notes).HasColumnName("notes").HasColumnType("text");

        builder.HasOne<ActionPlanProgressUpdate>().WithMany().HasForeignKey(u => u.ProgressUpdateId);
        builder.HasOne<ActionPlanKpi>().WithMany().HasForeignKey(u => u.KpiId).OnDelete(DeleteBehavior.Cascade);
    }
}
```

`src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanObjectiveUpdateConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanObjectiveUpdateConfiguration : IEntityTypeConfiguration<ActionPlanObjectiveUpdate>
{
    public void Configure(EntityTypeBuilder<ActionPlanObjectiveUpdate> builder)
    {
        builder.ToTable("action_plan_objective_updates");
        builder.HasKey(u => u.Id);
        builder.Property(u => u.ProgressUpdateId).HasColumnName("progress_update_id").IsRequired();
        builder.Property(u => u.ObjectiveId).HasColumnName("objective_id").IsRequired();
        builder.Property(u => u.StatusUpdate).HasColumnName("status_update").HasColumnType("text").IsRequired();
        builder.Property(u => u.CompletionPercentage).HasColumnName("completion_percentage");
        builder.Property(u => u.Notes).HasColumnName("notes").HasColumnType("text");

        builder.HasOne<ActionPlanProgressUpdate>().WithMany().HasForeignKey(u => u.ProgressUpdateId);
        builder.HasOne<ActionPlanObjective>().WithMany().HasForeignKey(u => u.ObjectiveId).OnDelete(DeleteBehavior.Cascade);
    }
}
```

(`ProgressUpdateId` uses the implicit default `Cascade` — the true owning parent. `KpiId`/`ObjectiveId` use an **explicit** `Cascade` — per the Global Constraints reasoning, this avoids a `Restrict`-vs-cascading-multi-path-delete race when an entire `ActionPlan` is deleted, and matches the domain semantics that a KPI/objective's own historical audit trail has nothing left to report on once the KPI/objective itself is gone.)

- [ ] **Step 4: Register the two DbSets**

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
    public DbSet<ActionPlanTemplate> ActionPlanTemplates => Set<ActionPlanTemplate>();
    public DbSet<ActionPlanTemplateKpi> ActionPlanTemplateKpis => Set<ActionPlanTemplateKpi>();
    public DbSet<ActionPlanTemplateObjective> ActionPlanTemplateObjectives => Set<ActionPlanTemplateObjective>();
    public DbSet<ActionPlan> ActionPlans => Set<ActionPlan>();
    public DbSet<ActionPlanKpi> ActionPlanKpis => Set<ActionPlanKpi>();
    public DbSet<ActionPlanObjective> ActionPlanObjectives => Set<ActionPlanObjective>();
    public DbSet<ActionPlanProgressUpdate> ActionPlanProgressUpdates => Set<ActionPlanProgressUpdate>();
    public DbSet<ActionPlanKpiUpdate> ActionPlanKpiUpdates => Set<ActionPlanKpiUpdate>();
    public DbSet<ActionPlanObjectiveUpdate> ActionPlanObjectiveUpdates => Set<ActionPlanObjectiveUpdate>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
```

- [ ] **Step 5: Generate the migration**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
dotnet ef migrations add AddActionPlanProgressUpdateItems \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

Expected: succeeds, creates `action_plan_kpi_updates` and `action_plan_objective_updates`, completing the full #53 schema.

- [ ] **Step 6: Write the failing tests**

`tests/ClimateProject.IntegrationTests/Persistence/ActionPlanProgressUpdateItemsTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ActionPlanProgressUpdateItemsTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private record Scaffold(ActionPlan Plan, ActionPlanKpi Kpi, ActionPlanObjective Objective, User User);

    private async Task<Scaffold> SeedScaffoldAsync(ClimateProjectDbContext db, string suffix)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = $"Acme {suffix}", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{suffix}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(), Title = "P", Description = "d", CompanyId = company.Id,
            CreatedBy = user.Id, DueDate = DateTimeOffset.UtcNow.AddDays(30),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        db.ActionPlans.Add(plan);
        await db.SaveChangesAsync();

        var kpi = new ActionPlanKpi
        {
            Id = Guid.NewGuid(), ActionPlanId = plan.Id, Name = "eNPS", TargetValue = 50m, Unit = "points", MeasurementFrequency = "quarterly",
        };
        var objective = new ActionPlanObjective
        {
            Id = Guid.NewGuid(), ActionPlanId = plan.Id, Description = "d", SuccessCriteria = "s",
        };
        db.ActionPlanKpis.Add(kpi);
        db.ActionPlanObjectives.Add(objective);
        await db.SaveChangesAsync();

        return new Scaffold(plan, kpi, objective, user);
    }

    [Fact]
    public async Task Kpi_and_objective_updates_round_trip_the_full_progress_audit_trail()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var scaffold = await SeedScaffoldAsync(db, "1");

        var progress = new ActionPlanProgressUpdate
        {
            Id = Guid.NewGuid(), ActionPlanId = scaffold.Plan.Id, UpdateDate = DateTimeOffset.UtcNow,
            OverallNotes = "First monthly check-in.", UpdatedBy = scaffold.User.Id,
        };
        db.ActionPlanProgressUpdates.Add(progress);
        await db.SaveChangesAsync();

        var kpiUpdate = new ActionPlanKpiUpdate
        {
            Id = Guid.NewGuid(), ProgressUpdateId = progress.Id, KpiId = scaffold.Kpi.Id, NewValue = 42m, Notes = "Trending up.",
        };
        var objectiveUpdate = new ActionPlanObjectiveUpdate
        {
            Id = Guid.NewGuid(), ProgressUpdateId = progress.Id, ObjectiveId = scaffold.Objective.Id,
            StatusUpdate = "On track", CompletionPercentage = 40,
        };
        db.ActionPlanKpiUpdates.Add(kpiUpdate);
        db.ActionPlanObjectiveUpdates.Add(objectiveUpdate);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var progressOverTimeForKpi = await readDb.ActionPlanKpiUpdates
            .Where(u => u.KpiId == scaffold.Kpi.Id)
            .Join(readDb.ActionPlanProgressUpdates, u => u.ProgressUpdateId, p => p.Id, (u, p) => new { u.NewValue, p.UpdateDate })
            .OrderBy(x => x.UpdateDate)
            .ToListAsync();
        Assert.Single(progressOverTimeForKpi);
        Assert.Equal(42m, progressOverTimeForKpi[0].NewValue);

        var loadedObjectiveUpdate = await readDb.ActionPlanObjectiveUpdates.SingleAsync(u => u.Id == objectiveUpdate.Id);
        Assert.Equal("On track", loadedObjectiveUpdate.StatusUpdate);
        Assert.Equal(40, loadedObjectiveUpdate.CompletionPercentage);
    }

    [Fact]
    public async Task Deleting_progress_update_cascades_delete_of_its_kpi_and_objective_updates()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var scaffold = await SeedScaffoldAsync(db, "2");

        var progress = new ActionPlanProgressUpdate
        {
            Id = Guid.NewGuid(), ActionPlanId = scaffold.Plan.Id, UpdateDate = DateTimeOffset.UtcNow, UpdatedBy = scaffold.User.Id,
        };
        db.ActionPlanProgressUpdates.Add(progress);
        await db.SaveChangesAsync();

        var kpiUpdateId = Guid.NewGuid();
        var objectiveUpdateId = Guid.NewGuid();
        db.ActionPlanKpiUpdates.Add(new ActionPlanKpiUpdate { Id = kpiUpdateId, ProgressUpdateId = progress.Id, KpiId = scaffold.Kpi.Id, NewValue = 1m });
        db.ActionPlanObjectiveUpdates.Add(new ActionPlanObjectiveUpdate { Id = objectiveUpdateId, ProgressUpdateId = progress.Id, ObjectiveId = scaffold.Objective.Id, StatusUpdate = "s" });
        await db.SaveChangesAsync();

        db.ActionPlanProgressUpdates.Remove(progress);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.ActionPlanKpiUpdates.AnyAsync(u => u.Id == kpiUpdateId));
        Assert.False(await readDb.ActionPlanObjectiveUpdates.AnyAsync(u => u.Id == objectiveUpdateId));
    }

    [Fact]
    public async Task Deleting_the_whole_action_plan_cascades_through_both_update_paths_without_conflict()
    {
        // Regression test for the deliberate Cascade-not-Restrict choice on KpiId/ObjectiveId:
        // deleting the ActionPlan cascades into action_plan_kpis AND (via progress updates)
        // into action_plan_kpi_updates at the same time. If KpiId's FK were Restrict, this
        // could abort depending on delete ordering. It must not.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var scaffold = await SeedScaffoldAsync(db, "3");

        var progress = new ActionPlanProgressUpdate
        {
            Id = Guid.NewGuid(), ActionPlanId = scaffold.Plan.Id, UpdateDate = DateTimeOffset.UtcNow, UpdatedBy = scaffold.User.Id,
        };
        db.ActionPlanProgressUpdates.Add(progress);
        await db.SaveChangesAsync();

        db.ActionPlanKpiUpdates.Add(new ActionPlanKpiUpdate { Id = Guid.NewGuid(), ProgressUpdateId = progress.Id, KpiId = scaffold.Kpi.Id, NewValue = 1m });
        db.ActionPlanObjectiveUpdates.Add(new ActionPlanObjectiveUpdate { Id = Guid.NewGuid(), ProgressUpdateId = progress.Id, ObjectiveId = scaffold.Objective.Id, StatusUpdate = "s" });
        await db.SaveChangesAsync();

        db.ActionPlans.Remove(scaffold.Plan);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.ActionPlans.AnyAsync(a => a.Id == scaffold.Plan.Id));
        Assert.False(await readDb.ActionPlanKpis.AnyAsync(k => k.Id == scaffold.Kpi.Id));
        Assert.False(await readDb.ActionPlanKpiUpdates.AnyAsync(u => u.KpiId == scaffold.Kpi.Id));
    }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter ActionPlanProgressUpdateItemsTests`
Expected: PASS (3/3).

- [ ] **Step 8: Run the full solution build and test suite**

Run: `dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx`
Expected: builds clean, all tests pass (68 + 3 = 71).

- [ ] **Step 9: Commit, push, open a PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/ActionPlanKpiUpdate.cs \
  src/ClimateProject.Domain/Entities/ActionPlanObjectiveUpdate.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanKpiUpdateConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/ActionPlanObjectiveUpdateConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
  src/ClimateProject.Infrastructure/Migrations/ \
  tests/ClimateProject.IntegrationTests/Persistence/ActionPlanProgressUpdateItemsTests.cs
git commit -m "feat: add ActionPlanKpiUpdate and ActionPlanObjectiveUpdate entities"
git push -u origin schema/action-plan-progress-update-items
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: ActionPlanKpiUpdate + ActionPlanObjectiveUpdate" \
  --body "Seventh and final piece of #53's Action Plans schema slice (part of #49). Adds action_plan_kpi_updates and action_plan_objective_updates — the detail rows of the append-only progress audit trail, completing the full normalized shape 'show progress over time for KPI X' needs. KpiId/ObjectiveId FKs are explicit Cascade (not Restrict) to avoid a cascade-path race when a whole ActionPlan is deleted — see inline comment and the regression test covering it."
gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch
git checkout main && git pull
```

---

## Self-Review Notes

- **Spec coverage**: every table in the approved #53 design — `action_plans`, `action_plan_kpis`, `action_plan_objectives`, `action_plan_progress_updates`, `action_plan_kpi_updates`, `action_plan_objective_updates`, `action_plan_templates`, `action_plan_template_kpis`, `action_plan_template_objectives` — has a task (9 tables across 7 tasks; Tasks 2 and 7 each pair two small, always-created-together junction tables). `source_insight_id`'s no-FK treatment is per the spec's own explicit instruction; `source_survey_id` gets the identical treatment because this plan's own repo check found no `Survey` table exists yet either — a grounded decision, not a guess. `assigned_to` is explicitly and deliberately excluded (not in the approved field list) rather than silently dropped.
- **No placeholders**: every task has complete entity/config/test code; every enum/default value is the real one confirmed from the legacy Mongoose models (`ActionPlan.ts`, `ActionPlanTemplate.ts`), not invented.
- **Type/name consistency**: `ActionPlanTemplate.Id` (Task 1) is referenced as `Guid TemplateId` by `ActionPlanTemplateKpi`/`ActionPlanTemplateObjective` (Task 2) and `ActionPlan.TemplateId` (Task 3) with identical FK/column naming (`template_id`). `ActionPlan.Id` (Task 3) is referenced as `Guid ActionPlanId` by `ActionPlanKpi`/`ActionPlanObjective`/`ActionPlanProgressUpdate` (Tasks 4–6) with identical naming (`action_plan_id`). `ActionPlanProgressUpdate.Id`/`ActionPlanKpi.Id`/`ActionPlanObjective.Id` are referenced as `ProgressUpdateId`/`KpiId`/`ObjectiveId` by Task 7 with identical naming (`progress_update_id`, `kpi_id`, `objective_id`). No `.HasConversion<string>()` appears anywhere (every enum-shaped property is already CLR `string`), avoiding the exact vestigial-call bug already fixed once in org-structure Task 2.
- **Ordering**: tasks are sequenced so no migration ever references a table that doesn't exist yet — `ActionPlanTemplate` (Task 1) before `ActionPlan.TemplateId`'s FK (Task 3); `ActionPlan` (Task 3) before its children (Tasks 4–6); `ActionPlanKpi`/`ActionPlanObjective`/`ActionPlanProgressUpdate` (Tasks 4–6) before the update-detail tables that FK to all three (Task 7).
- **CRITICAL LESSON compliance**: every `NOT NULL` column with an intended non-CLR-default value (`ActionPlanTemplate.IsActive`/`AiRecommendationTemplates`/`Tags`/`UsageCount`; `ActionPlan.Status`/`Priority`/`AiRecommendations`/`Tags`; `ActionPlanKpi.CurrentValue`; `ActionPlanObjective.CurrentStatus`/`CompletionPercentage`; `ActionPlanProgressUpdate.OverallNotes`) has both `.HasDefaultValue(...)` in its Fluent config and a raw-SQL-insert-then-EF-read test proving the DB-level default, not just an in-memory EF round-trip.