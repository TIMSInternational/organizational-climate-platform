# climate-project-api Reports & Analytics Schema (#54 slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the "Reports & Analytics" domain (GitHub issue #54, a slice of #49's full data-model epic) to `climate-project-api`'s Postgres schema — reports, benchmarks (+ metrics), analytics insights (+ metric data / time series), AI insights, and demographic fields/snapshots (+ entries / changes) — mirroring the legacy Mongoose models 1:1 in field/enum shape while following every EF Core convention already established by the org-structure schema work (#49's Company/Department/User slice).

**Architecture:** Same clean-architecture layering as the org-structure slice: plain POCO entities in `ClimateProject.Domain/Entities/`, `IEntityTypeConfiguration<T>` classes in `ClimateProject.Infrastructure/Persistence/Configurations/`, one new additive EF Core migration per task on top of whatever is at the tip of `Infrastructure/Migrations/` at the time that task runs. Always-present 1:1 shapes (`DemographicSnapshotMetadata`) are EF Core **owned types** mapped to inline columns via `.OwnsOne()`. Junction/independently-queried collections (`benchmark_metrics`, `analytics_metric_data`, `analytics_time_series`, `demographic_snapshot_entries`, `demographic_snapshot_changes`) are standalone relational tables with their own `Id` and a plain FK back to the owning row — not owned types, since the spec calls out that each row is independently queried/compared. Genuinely dynamic/schemaless data (report filters/config/output, benchmark metadata, AI-insight supporting data, demographic custom attributes/change values) is a `string?` property mapped to a Postgres `jsonb` column via `.HasColumnType("jsonb")`.

**Tech Stack:** .NET 10, EF Core + Npgsql, xUnit, Testcontainers.PostgreSql (all already in place — no new packages needed). `dotnet-ef` v10.0.10 already installed globally.

## Global Constraints

- Repo: `/Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api`, branch `main`, currently at commit `d662463` (tip: `AddUserProfileFields` migration). Work directly on `main` via a new feature branch per task, PR (`gh pr create --repo TIMSInternational/climate-project-api`), squash-merge (`gh pr merge --squash --delete-branch`) — the exact convention every prior task in this repo has used.
- **Grounding correction vs. the org-structure plan's file list:** the task brief that produced this plan named `UserInvitation.cs`/`AuditLog.cs` as "already-merged" files to read for FK-target grounding. As of this writing **neither file exists yet** in `src/ClimateProject.Domain/Entities/` — they're Tasks 4/5 of `docs/superpowers/plans/2026-07-31-climate-project-api-org-structure-schema.md`, which is written but only Tasks 1–3 (Department, Company profile, User profile) have been executed/merged so far. This plan does not reference `UserInvitation` or `AuditLog` anywhere (nothing in the Reports & Analytics domain spec needs them) — flagging this only so the discrepancy is explicit and not silently assumed away.
- **Clean architecture / naming**: `IEntityTypeConfiguration<T>` classes under `Infrastructure/Persistence/Configurations/`, applied via `modelBuilder.ApplyConfigurationsFromAssembly` (already wired in `ClimateProjectDbContext`, no change needed there). snake_case table/column names via explicit `.ToTable(...)`/`.HasColumnName(...)`. **Exception**: `Id` primary-key columns stay PascalCase `"Id"` (no `.HasColumnName("id")` override) — matches `companies`/`users`/`departments` exactly.
- **Enums as plain strings**: every enum-shaped field (`Report.Type`, `Report.Status`, `Report.Format`, `Benchmark.Type`, `Benchmark.ValidationStatus`, `AnalyticsInsight.AggregationType`, `AnalyticsInsight.MetricType`, `AIInsight.Type`, `AIInsight.Priority`, `DemographicField.Type`, etc.) is a plain C# `string` property with `.HasMaxLength(N)` only — **no** `.HasConversion<string>()` call, since the CLR property is already `string` and that call would be a no-op. (`DepartmentConfiguration.cs`/`CompanyConfiguration.cs` already have this exact vestigial call from earlier tasks — do not repeat it here.)
- **jsonb columns**: CLR type is a plain **nullable** `string?` property, `.HasColumnType("jsonb")` in the Fluent config, no `.HasDefaultValue(...)` (nullable columns need no DB default). Never `JsonDocument`/`Dictionary<string,object>`. Applies to: `Report.Filters`/`Config`/`ReportOutput`, `Benchmark.Metadata`, `AIInsight.SupportingData`, `DemographicSnapshotEntry.CustomAttributes`, `DemographicSnapshotChange.OldValue`/`NewValue`, `DemographicSnapshotMetadata.RolesDistribution`/`TenureDistribution`. No serialization helpers are built speculatively — callers `JsonSerializer.Serialize`/`Deserialize` as needed when a future task actually reads/writes through one.
- **Postgres `text[]` array columns**: CLR type `List<string>`, `.HasColumnType("text[]")`. Where the array is semantically "always present, defaults to empty" (`Report.SharedWith`, `AIInsight.AffectedSegments`, `AIInsight.RecommendedActions`) the column is `NOT NULL` with `.HasDefaultValueSql("ARRAY[]::text[]")` — `HasDefaultValueSql` (not `HasDefaultValue`) because Npgsql needs the Postgres array-literal cast syntax for a default on an array column, and this is the first task in the repo introducing array columns so there's no prior in-repo precedent to match against. Where the array is optional and type-dependent (`DemographicField.Options`, only meaningful for `type = "select"`) the column is nullable with no default.
- **CRITICAL LESSON (carried forward from org-structure Task 2, PR #17 — a real bug shipped and had to be fixed)**: every `NOT NULL` property with a non-CLR-default intended value — whether on the aggregate root directly or inside an owned type — **must** have `.HasDefaultValue(...)` (or `.HasDefaultValueSql(...)` for arrays) in the Fluent config, matching the C# object-initializer default exactly. Without it, `dotnet ef migrations add` silently backfills any row inserted outside EF's object-initializer path with EF/Npgsql's raw CLR default (empty string, `false`, `0`) instead of the intended domain default. Every task below has a dedicated raw-SQL-insert-then-EF-read test proving this at the DB level — never substitute an EF-insert-then-EF-read test for it, since EF always reincarnates the C# default and would pass even if the migration's DB-level default were wrong.
- **Cross-entity FK `OnDelete` policy** (mirrors org-structure conventions exactly):
  - Self-referencing hierarchy FK → `DeleteBehavior.Restrict` (matches `Department.ParentDepartmentId`). Used here for `Benchmark.PriorPeriodBenchmarkId`.
  - Optional cross-entity link where the parent's deletion should not cascade-delete the child, just detach it → `DeleteBehavior.SetNull` (matches `User.DepartmentId`). Used here for `Benchmark.CompanyId`, `AnalyticsInsight.DepartmentId`, `AIInsight.DepartmentId`, `AIInsight.AcknowledgedBy`.
  - Required parent-owns-child FK (the child's row only makes sense as part of the parent's aggregate — e.g. `BenchmarkMetric` belongs to `Benchmark`) → default `Cascade`, no override. Used for every `CompanyId` FK (company owns everything it created) and every junction table's FK back to its owning row (`BenchmarkMetric.BenchmarkId`, `AnalyticsMetricData.InsightId`, `AnalyticsTimeSeries.InsightId`, `DemographicSnapshotEntry.SnapshotId`, `DemographicSnapshotChange.SnapshotId`).
  - Required "attribution" FK to `User` that is **not** a parent-owns-child relationship (an audit-style pointer to who created/acknowledged/changed something, where deleting that user account should not silently delete the referencing row's history) → `DeleteBehavior.Restrict`, same reasoning as `Department.ParentDepartmentId`/`User.ManagerId`. Used for `Report.CreatedBy`, `Benchmark.CreatedBy`, `DemographicSnapshot.CreatedBy`, `DemographicSnapshotEntry.UserId`, `DemographicSnapshotChange.ChangedBy`.
- **`SurveyId` fields are stored as plain nullable/required `Guid` columns with NO EF FK relationship wired** (`AnalyticsInsight.SurveyId`, `AIInsight.SurveyId`, `DemographicSnapshot.SurveyId`) — grounded in the actual current repo state: no `Survey` entity/table exists yet anywhere in `climate-project-api` (confirmed via `find . -iname "Survey*.cs"` returning nothing). Wiring a `HasOne<Survey>()` FK today would reference a table that doesn't exist and break every migration. A follow-up migration should add the FK constraint once the Survey/Response domain ships as its own #49 slice. Likewise `Report.TemplateId` stays a plain nullable `string?` with no FK — the domain spec lists it as `template_id nullable` only, with no separate templates table in scope for #54.
- **Role values** (`DemographicSnapshotEntry.Role`) stay plain strings matching `ClimateProject.Application.Auth.Roles` constants (`super_admin`/`company_admin`/`leader`/`supervisor`/`employee`) — never a new C# enum.
- **`ai_insights` shape is a resolved decision, not open for re-litigation**: the codebase has two competing legacy Mongoose models (`Analytics.ts`'s snake_case `AIInsightSchema` with `confidence_score` 0–1 float, `company_id`/`department_id`/`is_acknowledged`/`acknowledged_by`/`acknowledged_at`/`expires_at`/`supporting_data`; and `AIInsight.ts`'s camelCase model with `confidenceScore` 0–100 int and no acknowledgement fields at all). This plan uses `Analytics.ts`'s full field shape (matches the #54 spec's field list verbatim) with `AIInsight.ts`'s `confidence_score` **scale and type** only — `ConfidenceScore` is `int`, intended range 0–100, no DB `CHECK` constraint (no existing config in this repo uses `CHECK` constraints; range validation is an application-layer concern for a future task).
- `Directory.Build.props` sets `TreatWarningsAsErrors=true` — every task's code must build with 0 warnings.
- Integration tests require Docker running. Reuse `tests/ClimateProject.IntegrationTests/Support/PostgresContainerFixture.cs` unchanged — construct a `DbContextOptionsBuilder<ClimateProjectDbContext>().UseNpgsql(postgres.ConnectionString)` directly in each new test class, exactly like `DepartmentTests.cs`/`CompanyProfileTests.cs`/`UserProfileTests.cs` already do.
- **Step-sequencing note for brand-new tables** (this domain's tables don't exist yet, unlike org-structure Tasks 2/3 which extended `companies`/`users`): each task writes the entity POCO(s) and `IEntityTypeConfiguration<T>` class(es) *before* the test file, because the test needs those types/DbSet properties to compile at all. The TDD "confirm fail" step is then: run the test *before* generating the migration — it compiles but fails at runtime with a Npgsql "relation does not exist" error, proving the table isn't there yet. Generating and applying the migration is the "implement" step that turns that failure into a pass.
- Every task ends: full solution build+test (`dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx`) confirming 0 warnings and all tests (existing ~54 + new) passing → commit/push/PR/merge to `main` → `git checkout main && git pull`.

---

### Task 1: Report entity + reports table

**Files:**
- Create: `src/ClimateProject.Domain/Entities/Report.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/ReportConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — add `DbSet<Report> Reports`
- Create: `src/ClimateProject.Infrastructure/Migrations/*` (generated)
- Test: `tests/ClimateProject.IntegrationTests/Persistence/ReportTests.cs`

**Interfaces:**
- Consumes: `Company` (`CompanyId` FK), `User` (`CreatedBy` FK) — both already exist.
- Produces: `Report { Id (Guid), Title (string), Description (string?), Type (string), CompanyId (Guid), CreatedBy (Guid), TemplateId (string?), Filters (string? jsonb), Config (string? jsonb), Status (string, default "generating"), Format (string), FilePath (string?), FileSize (long?), GenerationStartedAt/CompletedAt (DateTimeOffset?), GenerationError (string?), ScheduledFor (DateTimeOffset?), IsRecurring (bool, default false), RecurrencePattern (string?), NextGeneration (DateTimeOffset?), SharedWith (List<string>, default []), DownloadCount (int, default 0), ExpiresAt (DateTimeOffset?), ReportOutput (string? jsonb), CreatedAt/UpdatedAt (DateTimeOffset) }`. No later task in this plan depends on `Report`.

- [ ] **Step 1: Create a feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/reports
```

- [ ] **Step 2: Write the Report entity**

`src/ClimateProject.Domain/Entities/Report.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class Report
{
    public Guid Id { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public required string Type { get; set; }
    public Guid CompanyId { get; set; }
    public Guid CreatedBy { get; set; }
    public string? TemplateId { get; set; }
    public string? Filters { get; set; }
    public string? Config { get; set; }
    public string Status { get; set; } = "generating";
    public required string Format { get; set; }
    public string? FilePath { get; set; }
    public long? FileSize { get; set; }
    public DateTimeOffset? GenerationStartedAt { get; set; }
    public DateTimeOffset? GenerationCompletedAt { get; set; }
    public string? GenerationError { get; set; }
    public DateTimeOffset? ScheduledFor { get; set; }
    public bool IsRecurring { get; set; }
    public string? RecurrencePattern { get; set; }
    public DateTimeOffset? NextGeneration { get; set; }
    public List<string> SharedWith { get; set; } = [];
    public int DownloadCount { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public string? ReportOutput { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
```

- [ ] **Step 3: Write ReportConfiguration**

`src/ClimateProject.Infrastructure/Persistence/Configurations/ReportConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ReportConfiguration : IEntityTypeConfiguration<Report>
{
    public void Configure(EntityTypeBuilder<Report> builder)
    {
        builder.ToTable("reports");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Title).HasColumnName("title").HasMaxLength(200).IsRequired();
        builder.Property(r => r.Description).HasColumnName("description").HasMaxLength(1000);
        builder.Property(r => r.Type).HasColumnName("type").HasMaxLength(30).IsRequired();
        builder.Property(r => r.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(r => r.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(r => r.TemplateId).HasColumnName("template_id").HasMaxLength(100);
        builder.Property(r => r.Filters).HasColumnName("filters").HasColumnType("jsonb");
        builder.Property(r => r.Config).HasColumnName("config").HasColumnType("jsonb");
        builder.Property(r => r.Status).HasColumnName("status").HasMaxLength(20).IsRequired().HasDefaultValue("generating");
        builder.Property(r => r.Format).HasColumnName("format").HasMaxLength(10).IsRequired();
        builder.Property(r => r.FilePath).HasColumnName("file_path").HasMaxLength(500);
        builder.Property(r => r.FileSize).HasColumnName("file_size");
        builder.Property(r => r.GenerationStartedAt).HasColumnName("generation_started_at");
        builder.Property(r => r.GenerationCompletedAt).HasColumnName("generation_completed_at");
        builder.Property(r => r.GenerationError).HasColumnName("generation_error").HasColumnType("text");
        builder.Property(r => r.ScheduledFor).HasColumnName("scheduled_for");
        builder.Property(r => r.IsRecurring).HasColumnName("is_recurring").IsRequired().HasDefaultValue(false);
        builder.Property(r => r.RecurrencePattern).HasColumnName("recurrence_pattern").HasMaxLength(100);
        builder.Property(r => r.NextGeneration).HasColumnName("next_generation");
        builder.Property(r => r.SharedWith).HasColumnName("shared_with").HasColumnType("text[]").IsRequired().HasDefaultValueSql("ARRAY[]::text[]");
        builder.Property(r => r.DownloadCount).HasColumnName("download_count").IsRequired().HasDefaultValue(0);
        builder.Property(r => r.ExpiresAt).HasColumnName("expires_at");
        builder.Property(r => r.ReportOutput).HasColumnName("report_output").HasColumnType("jsonb");
        builder.Property(r => r.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(r => r.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(r => new { r.CompanyId, r.Status });
        builder.HasIndex(r => r.CreatedBy);
        builder.HasIndex(r => r.Type);
        builder.HasIndex(r => r.ScheduledFor);
        builder.HasIndex(r => r.ExpiresAt);

        builder.HasOne<Company>().WithMany().HasForeignKey(r => r.CompanyId);
        builder.HasOne<User>().WithMany().HasForeignKey(r => r.CreatedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
```

- [ ] **Step 4: Register the DbSet**

Modify `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — full new content:

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
    public DbSet<Report> Reports => Set<Report>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
```

- [ ] **Step 5: Write the test file**

`tests/ClimateProject.IntegrationTests/Persistence/ReportTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ReportTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user)> SeedCompanyAndUserAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "admin@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (company, user);
    }

    [Fact]
    public async Task Report_round_trips_with_jsonb_filters_config_output_and_shared_with_array()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db);

        var report = new Report
        {
            Id = Guid.NewGuid(),
            Title = "Q3 Survey Analysis",
            Description = "Quarterly survey analysis report",
            Type = "survey_analysis",
            CompanyId = company.Id,
            CreatedBy = user.Id,
            Filters = """{"time_filter": {"start_date": "2026-01-01", "end_date": "2026-03-31"}}""",
            Config = """{"include_charts": true, "include_raw_data": false}""",
            Status = "completed",
            Format = "pdf",
            FilePath = "/reports/q3.pdf",
            FileSize = 204800,
            GenerationStartedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
            GenerationCompletedAt = DateTimeOffset.UtcNow,
            SharedWith = [user.Id.ToString(), Guid.NewGuid().ToString()],
            DownloadCount = 3,
            ReportOutput = """{"metrics": {"engagementScore": 82}}""",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Reports.Add(report);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.Reports.SingleAsync(r => r.Id == report.Id);
        Assert.Equal("completed", loaded.Status);
        Assert.Equal("pdf", loaded.Format);
        Assert.Equal(204800, loaded.FileSize);
        Assert.Equal(2, loaded.SharedWith.Count);
        Assert.Contains(user.Id.ToString(), loaded.SharedWith);
        Assert.Contains("engagementScore", loaded.ReportOutput);
        Assert.Contains("time_filter", loaded.Filters);
    }

    [Fact]
    public async Task Minimal_report_row_inserted_via_raw_SQL_still_loads_with_DB_level_defaults()
    {
        // Proves the NOT NULL columns with non-CLR-default intended values (status="generating",
        // is_recurring=false, shared_with=empty array, download_count=0) are enforced at the
        // Postgres column-default level, not just via the C# object-initializer default -- a row
        // inserted directly via SQL (bypassing EF entirely) must still read back with the correct
        // domain defaults.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db);

        var minimalReportId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO reports ("Id", title, type, company_id, created_by, format, created_at, updated_at)
             VALUES ({minimalReportId}, {"Minimal Report"}, {"custom"}, {company.Id}, {user.Id}, {"json"}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.Reports.SingleAsync(r => r.Id == minimalReportId);
        Assert.Equal("generating", loaded.Status);
        Assert.False(loaded.IsRecurring);
        Assert.Empty(loaded.SharedWith);
        Assert.Equal(0, loaded.DownloadCount);
        Assert.Null(loaded.Filters);
        Assert.Null(loaded.Config);
        Assert.Null(loaded.ReportOutput);
    }
}
```

- [ ] **Step 6: Run the tests to verify they fail (no migration yet)**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter ReportTests`
Expected: FAIL — both tests throw `Npgsql.PostgresException: relation "reports" does not exist` inside `MigrateAsync`/`SaveChangesAsync` (the migration hasn't been generated yet).

- [ ] **Step 7: Generate the migration**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
dotnet ef migrations add AddReportsTable \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

Expected: succeeds, creates a new `*_AddReportsTable.cs` migration that creates the `reports` table with both FK constraints and all `defaultValue`/`defaultValueSql` entries for `status`, `is_recurring`, `shared_with`, `download_count`. Inspect the generated file and confirm `shared_with`'s `AddColumn`/`CreateTable` call includes `defaultValueSql: "ARRAY[]::text[]"` (not just a CLR-side default) — if it doesn't, the `.HasDefaultValueSql(...)` call in Step 3 was not applied correctly; fix the config and regenerate before proceeding.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter ReportTests`
Expected: PASS (2/2). Requires Docker running.

- [ ] **Step 9: Run the full solution build and test suite**

Run: `dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx`
Expected: builds clean (0 warnings), all existing + 2 new tests pass.

- [ ] **Step 10: Commit, push, open a PR, merge**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git add src/ClimateProject.Domain/Entities/Report.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/ReportConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
  src/ClimateProject.Infrastructure/Migrations/ \
  tests/ClimateProject.IntegrationTests/Persistence/ReportTests.cs
git commit -m "feat: add Report entity + reports table"
git push -u origin schema/reports
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: Report entity + reports table" \
  --body "First piece of #54's Reports & Analytics schema slice (part of #49). Adds the reports table -- filters/config/report_output stay as jsonb (opaque, varies by report type / small fixed-shape flags / generated-content kitchen-sink respectively, matching the legacy Report.ts Mongoose model). shared_with is a NOT NULL text[] defaulting to an empty Postgres array via HasDefaultValueSql, proven with a raw-SQL-insert-then-EF-read test per the org-structure Task 2 lesson."
gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch
git checkout main && git pull
```

---

### Task 2: Benchmark + BenchmarkMetric entities

**Files:**
- Create: `src/ClimateProject.Domain/Entities/Benchmark.cs`
- Create: `src/ClimateProject.Domain/Entities/BenchmarkMetric.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/BenchmarkConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/BenchmarkMetricConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — add `DbSet<Benchmark> Benchmarks`, `DbSet<BenchmarkMetric> BenchmarkMetrics`
- Create: `src/ClimateProject.Infrastructure/Migrations/*` (generated)
- Test: `tests/ClimateProject.IntegrationTests/Persistence/BenchmarkTests.cs`

**Interfaces:**
- Consumes: `Company` (`CompanyId` nullable FK), `User` (`CreatedBy` FK) — both already exist.
- Produces: `Benchmark { Id, Name (string), Description (string), Type (string), Category (string), Source (string), Industry (string?), CompanySize (string?), Region (string?), CreatedBy (Guid), CompanyId (Guid?), IsActive (bool, default true), ValidationStatus (string, default "pending"), QualityScore (double, default 0), Metadata (string? jsonb), PriorPeriodBenchmarkId (Guid?, self-referencing FK), CreatedAt/UpdatedAt }` and `BenchmarkMetric { Id, BenchmarkId (Guid FK), MetricName (string), Value (double), Unit (string), Percentile (double?), SampleSize (int?), ConfidenceIntervalLower (double?), ConfidenceIntervalUpper (double?) }`. No later task in this plan depends on either.

- [ ] **Step 1: Create a feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/benchmarks
```

- [ ] **Step 2: Write the Benchmark entity**

`src/ClimateProject.Domain/Entities/Benchmark.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class Benchmark
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string Description { get; set; }
    public required string Type { get; set; }
    public required string Category { get; set; }
    public required string Source { get; set; }
    public string? Industry { get; set; }
    public string? CompanySize { get; set; }
    public string? Region { get; set; }
    public Guid CreatedBy { get; set; }
    public Guid? CompanyId { get; set; }
    public bool IsActive { get; set; } = true;
    public string ValidationStatus { get; set; } = "pending";
    public double QualityScore { get; set; }
    public string? Metadata { get; set; }
    public Guid? PriorPeriodBenchmarkId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
```

- [ ] **Step 3: Write the BenchmarkMetric entity**

`src/ClimateProject.Domain/Entities/BenchmarkMetric.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class BenchmarkMetric
{
    public Guid Id { get; set; }
    public Guid BenchmarkId { get; set; }
    public required string MetricName { get; set; }
    public double Value { get; set; }
    public required string Unit { get; set; }
    public double? Percentile { get; set; }
    public int? SampleSize { get; set; }
    public double? ConfidenceIntervalLower { get; set; }
    public double? ConfidenceIntervalUpper { get; set; }
}
```

- [ ] **Step 4: Write BenchmarkConfiguration and BenchmarkMetricConfiguration**

`src/ClimateProject.Infrastructure/Persistence/Configurations/BenchmarkConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class BenchmarkConfiguration : IEntityTypeConfiguration<Benchmark>
{
    public void Configure(EntityTypeBuilder<Benchmark> builder)
    {
        builder.ToTable("benchmarks");
        builder.HasKey(b => b.Id);
        builder.Property(b => b.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(b => b.Description).HasColumnName("description").HasMaxLength(2000).IsRequired();
        builder.Property(b => b.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(b => b.Category).HasColumnName("category").HasMaxLength(100).IsRequired();
        builder.Property(b => b.Source).HasColumnName("source").HasMaxLength(200).IsRequired();
        builder.Property(b => b.Industry).HasColumnName("industry").HasMaxLength(100);
        builder.Property(b => b.CompanySize).HasColumnName("company_size").HasMaxLength(50);
        builder.Property(b => b.Region).HasColumnName("region").HasMaxLength(100);
        builder.Property(b => b.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(b => b.CompanyId).HasColumnName("company_id");
        builder.Property(b => b.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(b => b.ValidationStatus).HasColumnName("validation_status").HasMaxLength(20).IsRequired().HasDefaultValue("pending");
        builder.Property(b => b.QualityScore).HasColumnName("quality_score").IsRequired().HasDefaultValue(0d);
        builder.Property(b => b.Metadata).HasColumnName("metadata").HasColumnType("jsonb");
        builder.Property(b => b.PriorPeriodBenchmarkId).HasColumnName("prior_period_benchmark_id");
        builder.Property(b => b.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(b => b.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(b => new { b.Type, b.Category });
        builder.HasIndex(b => new { b.CompanyId, b.IsActive });
        builder.HasIndex(b => new { b.Industry, b.CompanySize });
        builder.HasIndex(b => b.ValidationStatus);

        builder.HasOne<User>().WithMany().HasForeignKey(b => b.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Company>().WithMany().HasForeignKey(b => b.CompanyId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<Benchmark>().WithMany().HasForeignKey(b => b.PriorPeriodBenchmarkId).OnDelete(DeleteBehavior.Restrict);
    }
}
```

`src/ClimateProject.Infrastructure/Persistence/Configurations/BenchmarkMetricConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class BenchmarkMetricConfiguration : IEntityTypeConfiguration<BenchmarkMetric>
{
    public void Configure(EntityTypeBuilder<BenchmarkMetric> builder)
    {
        builder.ToTable("benchmark_metrics");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.BenchmarkId).HasColumnName("benchmark_id").IsRequired();
        builder.Property(m => m.MetricName).HasColumnName("metric_name").HasMaxLength(200).IsRequired();
        builder.Property(m => m.Value).HasColumnName("value").IsRequired();
        builder.Property(m => m.Unit).HasColumnName("unit").HasMaxLength(50).IsRequired();
        builder.Property(m => m.Percentile).HasColumnName("percentile");
        builder.Property(m => m.SampleSize).HasColumnName("sample_size");
        builder.Property(m => m.ConfidenceIntervalLower).HasColumnName("confidence_interval_lower");
        builder.Property(m => m.ConfidenceIntervalUpper).HasColumnName("confidence_interval_upper");

        builder.HasIndex(m => m.BenchmarkId);

        builder.HasOne<Benchmark>().WithMany().HasForeignKey(m => m.BenchmarkId);
    }
}
```

- [ ] **Step 5: Register the DbSets**

Modify `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — full new content:

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
    public DbSet<Report> Reports => Set<Report>();
    public DbSet<Benchmark> Benchmarks => Set<Benchmark>();
    public DbSet<BenchmarkMetric> BenchmarkMetrics => Set<BenchmarkMetric>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
```

- [ ] **Step 6: Write the test file**

`tests/ClimateProject.IntegrationTests/Persistence/BenchmarkTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class BenchmarkTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user)> SeedCompanyAndUserAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "admin@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (company, user);
    }

    [Fact]
    public async Task Benchmark_round_trips_with_metrics_and_prior_period_link()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db);

        var priorPeriod = new Benchmark
        {
            Id = Guid.NewGuid(),
            Name = "2025 Engagement Benchmark",
            Description = "Prior period industry benchmark",
            Type = "industry",
            Category = "engagement",
            Source = "external-survey-2025",
            CreatedBy = user.Id,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Benchmarks.Add(priorPeriod);
        await db.SaveChangesAsync();

        var current = new Benchmark
        {
            Id = Guid.NewGuid(),
            Name = "2026 Engagement Benchmark",
            Description = "Current period industry benchmark",
            Type = "industry",
            Category = "engagement",
            Source = "external-survey-2026",
            Industry = "Software",
            CompanySize = "medium",
            Region = "LatAm",
            CreatedBy = user.Id,
            CompanyId = company.Id,
            ValidationStatus = "validated",
            QualityScore = 0.87,
            Metadata = """{"sample_size": 5000}""",
            PriorPeriodBenchmarkId = priorPeriod.Id,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Benchmarks.Add(current);
        await db.SaveChangesAsync();

        var metric = new BenchmarkMetric
        {
            Id = Guid.NewGuid(),
            BenchmarkId = current.Id,
            MetricName = "engagement_score",
            Value = 78.5,
            Unit = "percentage",
            Percentile = 65,
            SampleSize = 5000,
            ConfidenceIntervalLower = 76.2,
            ConfidenceIntervalUpper = 80.8,
        };
        db.BenchmarkMetrics.Add(metric);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedBenchmark = await readDb.Benchmarks.SingleAsync(b => b.Id == current.Id);
        Assert.Equal(priorPeriod.Id, loadedBenchmark.PriorPeriodBenchmarkId);
        Assert.Equal("validated", loadedBenchmark.ValidationStatus);
        Assert.Equal(0.87, loadedBenchmark.QualityScore);

        var loadedMetric = await readDb.BenchmarkMetrics.SingleAsync(m => m.Id == metric.Id);
        Assert.Equal(current.Id, loadedMetric.BenchmarkId);
        Assert.Equal(78.5, loadedMetric.Value);
        Assert.Equal(76.2, loadedMetric.ConfidenceIntervalLower);
    }

    [Fact]
    public async Task Minimal_benchmark_row_inserted_via_raw_SQL_still_loads_with_DB_level_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (_, user) = await SeedCompanyAndUserAsync(db);

        var minimalBenchmarkId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO benchmarks ("Id", name, description, type, category, source, created_by, created_at, updated_at)
             VALUES ({minimalBenchmarkId}, {"Minimal"}, {"Minimal desc"}, {"internal"}, {"engagement"}, {"survey"}, {user.Id}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.Benchmarks.SingleAsync(b => b.Id == minimalBenchmarkId);
        Assert.True(loaded.IsActive);
        Assert.Equal("pending", loaded.ValidationStatus);
        Assert.Equal(0, loaded.QualityScore);
        Assert.Null(loaded.CompanyId);
        Assert.Null(loaded.PriorPeriodBenchmarkId);
        Assert.Null(loaded.Metadata);
    }
}
```

- [ ] **Step 7: Run the tests to verify they fail (no migration yet)**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter BenchmarkTests`
Expected: FAIL — `relation "benchmarks" does not exist`.

- [ ] **Step 8: Generate the migration**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
dotnet ef migrations add AddBenchmarksTables \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

Expected: succeeds, creates `benchmarks` and `benchmark_metrics` with all FKs (including the self-referencing `prior_period_benchmark_id` → `Restrict`) and `defaultValue` entries for `is_active`/`validation_status`/`quality_score`.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter BenchmarkTests`
Expected: PASS (2/2).

- [ ] **Step 10: Run the full solution build and test suite**

Run: `dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx`
Expected: builds clean, all existing + 2 new tests pass.

- [ ] **Step 11: Commit, push, open a PR, merge**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git add src/ClimateProject.Domain/Entities/Benchmark.cs \
  src/ClimateProject.Domain/Entities/BenchmarkMetric.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/BenchmarkConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/BenchmarkMetricConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
  src/ClimateProject.Infrastructure/Migrations/ \
  tests/ClimateProject.IntegrationTests/Persistence/BenchmarkTests.cs
git commit -m "feat: add Benchmark entity + benchmark_metrics table"
git push -u origin schema/benchmarks
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: Benchmark entity + benchmark_metrics table" \
  --body "Second piece of #54's Reports & Analytics schema slice. Adds benchmarks (self-referencing prior_period_benchmark_id closes the climate-tracking #20 gap where resultado_anio_anterior_pct was an unlinked null) and benchmark_metrics as an independently-queried junction table."
gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch
git checkout main && git pull
```

---

### Task 3: AnalyticsInsight (+ metric data / time series) and AIInsight entities

**Files:**
- Create: `src/ClimateProject.Domain/Entities/AnalyticsInsight.cs`
- Create: `src/ClimateProject.Domain/Entities/AnalyticsMetricData.cs`
- Create: `src/ClimateProject.Domain/Entities/AnalyticsTimeSeries.cs`
- Create: `src/ClimateProject.Domain/Entities/AIInsight.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/AnalyticsInsightConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/AnalyticsMetricDataConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/AnalyticsTimeSeriesConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/AIInsightConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — add 4 new `DbSet`s
- Create: `src/ClimateProject.Infrastructure/Migrations/*` (generated)
- Test: `tests/ClimateProject.IntegrationTests/Persistence/AnalyticsInsightTests.cs`
- Test: `tests/ClimateProject.IntegrationTests/Persistence/AIInsightTests.cs`

**Interfaces:**
- Consumes: `Company` (`CompanyId` FK), `Department` (`DepartmentId` nullable FK), `User` (`AIInsight.AcknowledgedBy` nullable FK). `SurveyId` fields are plain unlinked `Guid?`/`Guid` columns (no `Survey` entity exists yet — see Global Constraints).
- Produces: `AnalyticsInsight { Id, SurveyId (Guid?), CompanyId (Guid), DepartmentId (Guid?), AggregationType (string), MetricType (string), MetricName (string), MetricDescription (string?), TotalResponses (int), CalculationDate (DateTimeOffset), IsCurrent (bool, default true), CreatedAt/UpdatedAt }`, `AnalyticsMetricData { Id, InsightId (Guid FK), Label (string), Value (double), Count (int?), Percentage (double?) }`, `AnalyticsTimeSeries { Id, InsightId (Guid FK), Date (DateTimeOffset), Value (double), Count (int) }`, `AIInsight { Id, SurveyId (Guid?), CompanyId (Guid), DepartmentId (Guid?), Type (string), Category (string), Title (string), Description (string), ConfidenceScore (int, 0-100), Priority (string), AffectedSegments (List<string>, default []), RecommendedActions (List<string>, default []), SupportingData (string? jsonb), IsAcknowledged (bool, default false), AcknowledgedBy (Guid?), AcknowledgedAt (DateTimeOffset?), ExpiresAt (DateTimeOffset?), CreatedAt/UpdatedAt }`. No later task in this plan depends on any of these.

- [ ] **Step 1: Create a feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/analytics-ai-insights
```

- [ ] **Step 2: Write the AnalyticsInsight, AnalyticsMetricData, AnalyticsTimeSeries entities**

`src/ClimateProject.Domain/Entities/AnalyticsInsight.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class AnalyticsInsight
{
    public Guid Id { get; set; }
    public Guid? SurveyId { get; set; }
    public Guid CompanyId { get; set; }
    public Guid? DepartmentId { get; set; }
    public required string AggregationType { get; set; }
    public required string MetricType { get; set; }
    public required string MetricName { get; set; }
    public string? MetricDescription { get; set; }
    public int TotalResponses { get; set; }
    public DateTimeOffset CalculationDate { get; set; }
    public bool IsCurrent { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
```

`src/ClimateProject.Domain/Entities/AnalyticsMetricData.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class AnalyticsMetricData
{
    public Guid Id { get; set; }
    public Guid InsightId { get; set; }
    public required string Label { get; set; }
    public double Value { get; set; }
    public int? Count { get; set; }
    public double? Percentage { get; set; }
}
```

`src/ClimateProject.Domain/Entities/AnalyticsTimeSeries.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class AnalyticsTimeSeries
{
    public Guid Id { get; set; }
    public Guid InsightId { get; set; }
    public DateTimeOffset Date { get; set; }
    public double Value { get; set; }
    public int Count { get; set; }
}
```

- [ ] **Step 3: Write the AIInsight entity**

`src/ClimateProject.Domain/Entities/AIInsight.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class AIInsight
{
    public Guid Id { get; set; }
    public Guid? SurveyId { get; set; }
    public Guid CompanyId { get; set; }
    public Guid? DepartmentId { get; set; }
    public required string Type { get; set; }
    public required string Category { get; set; }
    public required string Title { get; set; }
    public required string Description { get; set; }
    public int ConfidenceScore { get; set; }
    public required string Priority { get; set; }
    public List<string> AffectedSegments { get; set; } = [];
    public List<string> RecommendedActions { get; set; } = [];
    public string? SupportingData { get; set; }
    public bool IsAcknowledged { get; set; }
    public Guid? AcknowledgedBy { get; set; }
    public DateTimeOffset? AcknowledgedAt { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
```

- [ ] **Step 4: Write the four Configuration classes**

`src/ClimateProject.Infrastructure/Persistence/Configurations/AnalyticsInsightConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class AnalyticsInsightConfiguration : IEntityTypeConfiguration<AnalyticsInsight>
{
    public void Configure(EntityTypeBuilder<AnalyticsInsight> builder)
    {
        builder.ToTable("analytics_insights");
        builder.HasKey(a => a.Id);
        // survey_id is a plain column, not an EF FK: no Survey entity/table exists yet in this
        // repo. Wire the FK constraint in a follow-up migration once the Survey domain ships.
        builder.Property(a => a.SurveyId).HasColumnName("survey_id");
        builder.Property(a => a.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(a => a.DepartmentId).HasColumnName("department_id");
        builder.Property(a => a.AggregationType).HasColumnName("aggregation_type").HasMaxLength(20).IsRequired();
        builder.Property(a => a.MetricType).HasColumnName("metric_type").HasMaxLength(20).IsRequired();
        builder.Property(a => a.MetricName).HasColumnName("metric_name").HasMaxLength(200).IsRequired();
        builder.Property(a => a.MetricDescription).HasColumnName("metric_description").HasMaxLength(1000);
        builder.Property(a => a.TotalResponses).HasColumnName("total_responses").IsRequired();
        builder.Property(a => a.CalculationDate).HasColumnName("calculation_date").IsRequired();
        builder.Property(a => a.IsCurrent).HasColumnName("is_current").IsRequired().HasDefaultValue(true);
        builder.Property(a => a.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(a => a.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(a => new { a.CompanyId, a.IsCurrent });
        builder.HasIndex(a => a.SurveyId);
        builder.HasIndex(a => a.DepartmentId);
        builder.HasIndex(a => new { a.AggregationType, a.MetricType });
        builder.HasIndex(a => a.CalculationDate);

        builder.HasOne<Company>().WithMany().HasForeignKey(a => a.CompanyId);
        builder.HasOne<Department>().WithMany().HasForeignKey(a => a.DepartmentId).OnDelete(DeleteBehavior.SetNull);
    }
}
```

`src/ClimateProject.Infrastructure/Persistence/Configurations/AnalyticsMetricDataConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class AnalyticsMetricDataConfiguration : IEntityTypeConfiguration<AnalyticsMetricData>
{
    public void Configure(EntityTypeBuilder<AnalyticsMetricData> builder)
    {
        builder.ToTable("analytics_metric_data");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.InsightId).HasColumnName("insight_id").IsRequired();
        builder.Property(m => m.Label).HasColumnName("label").HasMaxLength(200).IsRequired();
        builder.Property(m => m.Value).HasColumnName("value").IsRequired();
        builder.Property(m => m.Count).HasColumnName("count");
        builder.Property(m => m.Percentage).HasColumnName("percentage");

        builder.HasIndex(m => m.InsightId);

        builder.HasOne<AnalyticsInsight>().WithMany().HasForeignKey(m => m.InsightId);
    }
}
```

`src/ClimateProject.Infrastructure/Persistence/Configurations/AnalyticsTimeSeriesConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class AnalyticsTimeSeriesConfiguration : IEntityTypeConfiguration<AnalyticsTimeSeries>
{
    public void Configure(EntityTypeBuilder<AnalyticsTimeSeries> builder)
    {
        builder.ToTable("analytics_time_series");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.InsightId).HasColumnName("insight_id").IsRequired();
        builder.Property(t => t.Date).HasColumnName("date").IsRequired();
        builder.Property(t => t.Value).HasColumnName("value").IsRequired();
        builder.Property(t => t.Count).HasColumnName("count").IsRequired();

        builder.HasIndex(t => t.InsightId);

        builder.HasOne<AnalyticsInsight>().WithMany().HasForeignKey(t => t.InsightId);
    }
}
```

`src/ClimateProject.Infrastructure/Persistence/Configurations/AIInsightConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class AIInsightConfiguration : IEntityTypeConfiguration<AIInsight>
{
    public void Configure(EntityTypeBuilder<AIInsight> builder)
    {
        builder.ToTable("ai_insights");
        builder.HasKey(a => a.Id);
        // survey_id is a plain column, not an EF FK -- see AnalyticsInsightConfiguration's comment.
        builder.Property(a => a.SurveyId).HasColumnName("survey_id");
        builder.Property(a => a.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(a => a.DepartmentId).HasColumnName("department_id");
        builder.Property(a => a.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(a => a.Category).HasColumnName("category").HasMaxLength(100).IsRequired();
        builder.Property(a => a.Title).HasColumnName("title").HasMaxLength(200).IsRequired();
        builder.Property(a => a.Description).HasColumnName("description").HasMaxLength(1000).IsRequired();
        builder.Property(a => a.ConfidenceScore).HasColumnName("confidence_score").IsRequired();
        builder.Property(a => a.Priority).HasColumnName("priority").HasMaxLength(20).IsRequired();
        builder.Property(a => a.AffectedSegments).HasColumnName("affected_segments").HasColumnType("text[]").IsRequired().HasDefaultValueSql("ARRAY[]::text[]");
        builder.Property(a => a.RecommendedActions).HasColumnName("recommended_actions").HasColumnType("text[]").IsRequired().HasDefaultValueSql("ARRAY[]::text[]");
        builder.Property(a => a.SupportingData).HasColumnName("supporting_data").HasColumnType("jsonb");
        builder.Property(a => a.IsAcknowledged).HasColumnName("is_acknowledged").IsRequired().HasDefaultValue(false);
        builder.Property(a => a.AcknowledgedBy).HasColumnName("acknowledged_by");
        builder.Property(a => a.AcknowledgedAt).HasColumnName("acknowledged_at");
        builder.Property(a => a.ExpiresAt).HasColumnName("expires_at");
        builder.Property(a => a.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(a => a.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(a => new { a.CompanyId, a.IsAcknowledged });
        builder.HasIndex(a => a.SurveyId);
        builder.HasIndex(a => a.DepartmentId);
        builder.HasIndex(a => new { a.Type, a.Priority });
        builder.HasIndex(a => a.ExpiresAt);
        builder.HasIndex(a => a.CreatedAt);

        builder.HasOne<Company>().WithMany().HasForeignKey(a => a.CompanyId);
        builder.HasOne<Department>().WithMany().HasForeignKey(a => a.DepartmentId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<User>().WithMany().HasForeignKey(a => a.AcknowledgedBy).OnDelete(DeleteBehavior.SetNull);
    }
}
```

- [ ] **Step 5: Register the DbSets**

Modify `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — full new content:

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
    public DbSet<Report> Reports => Set<Report>();
    public DbSet<Benchmark> Benchmarks => Set<Benchmark>();
    public DbSet<BenchmarkMetric> BenchmarkMetrics => Set<BenchmarkMetric>();
    public DbSet<AnalyticsInsight> AnalyticsInsights => Set<AnalyticsInsight>();
    public DbSet<AnalyticsMetricData> AnalyticsMetricData => Set<AnalyticsMetricData>();
    public DbSet<AnalyticsTimeSeries> AnalyticsTimeSeries => Set<AnalyticsTimeSeries>();
    public DbSet<AIInsight> AIInsights => Set<AIInsight>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
```

- [ ] **Step 6: Write the AnalyticsInsight test file**

`tests/ClimateProject.IntegrationTests/Persistence/AnalyticsInsightTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class AnalyticsInsightTests(PostgresContainerFixture postgres)
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

    [Fact]
    public async Task AnalyticsInsight_round_trips_with_metric_data_and_time_series()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        var insight = new AnalyticsInsight
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            AggregationType = "company",
            MetricType = "distribution",
            MetricName = "engagement_by_department",
            MetricDescription = "Engagement score distribution across departments",
            TotalResponses = 240,
            CalculationDate = DateTimeOffset.UtcNow,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.AnalyticsInsights.Add(insight);
        await db.SaveChangesAsync();

        var metricData = new AnalyticsMetricData
        {
            Id = Guid.NewGuid(),
            InsightId = insight.Id,
            Label = "Engineering",
            Value = 82.3,
            Count = 40,
            Percentage = 33.3,
        };
        var timeSeries = new AnalyticsTimeSeries
        {
            Id = Guid.NewGuid(),
            InsightId = insight.Id,
            Date = DateTimeOffset.UtcNow.AddDays(-30),
            Value = 79.1,
            Count = 200,
        };
        db.AnalyticsMetricData.Add(metricData);
        db.AnalyticsTimeSeries.Add(timeSeries);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedInsight = await readDb.AnalyticsInsights.SingleAsync(i => i.Id == insight.Id);
        Assert.True(loadedInsight.IsCurrent);
        Assert.Equal(240, loadedInsight.TotalResponses);

        var loadedMetric = await readDb.AnalyticsMetricData.SingleAsync(m => m.Id == metricData.Id);
        Assert.Equal(insight.Id, loadedMetric.InsightId);
        Assert.Equal("Engineering", loadedMetric.Label);

        var loadedSeries = await readDb.AnalyticsTimeSeries.SingleAsync(t => t.Id == timeSeries.Id);
        Assert.Equal(insight.Id, loadedSeries.InsightId);
        Assert.Equal(200, loadedSeries.Count);
    }

    [Fact]
    public async Task Minimal_analytics_insight_row_inserted_via_raw_SQL_still_loads_with_DB_level_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        var minimalInsightId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO analytics_insights ("Id", company_id, aggregation_type, metric_type, metric_name, total_responses, calculation_date, created_at, updated_at)
             VALUES ({minimalInsightId}, {company.Id}, {"survey"}, {"average"}, {"avg_score"}, {100}, {now}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.AnalyticsInsights.SingleAsync(i => i.Id == minimalInsightId);
        Assert.True(loaded.IsCurrent);
        Assert.Null(loaded.SurveyId);
        Assert.Null(loaded.DepartmentId);
    }
}
```

- [ ] **Step 7: Write the AIInsight test file**

`tests/ClimateProject.IntegrationTests/Persistence/AIInsightTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class AIInsightTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user)> SeedCompanyAndUserAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "admin@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (company, user);
    }

    [Fact]
    public async Task AIInsight_round_trips_with_int_confidence_score_and_array_columns()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db);

        var insight = new AIInsight
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Type = "risk",
            Category = "attrition",
            Title = "Elevated attrition risk in Engineering",
            Description = "Engagement scores trending down over the last 3 cycles",
            ConfidenceScore = 87,
            Priority = "high",
            AffectedSegments = ["Engineering", "QA"],
            RecommendedActions = ["Schedule 1:1s", "Review workload distribution"],
            SupportingData = """{"trend": [80, 75, 68]}""",
            IsAcknowledged = true,
            AcknowledgedBy = user.Id,
            AcknowledgedAt = DateTimeOffset.UtcNow,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.AIInsights.Add(insight);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.AIInsights.SingleAsync(i => i.Id == insight.Id);
        Assert.Equal(87, loaded.ConfidenceScore);
        Assert.Equal(2, loaded.AffectedSegments.Count);
        Assert.Contains("Engineering", loaded.AffectedSegments);
        Assert.Equal(2, loaded.RecommendedActions.Count);
        Assert.True(loaded.IsAcknowledged);
        Assert.Equal(user.Id, loaded.AcknowledgedBy);
        Assert.Contains("trend", loaded.SupportingData);
    }

    [Fact]
    public async Task Minimal_ai_insight_row_inserted_via_raw_SQL_still_loads_with_DB_level_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, _) = await SeedCompanyAndUserAsync(db);

        var minimalInsightId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO ai_insights ("Id", company_id, type, category, title, description, confidence_score, priority, created_at, updated_at)
             VALUES ({minimalInsightId}, {company.Id}, {"pattern"}, {"engagement"}, {"Title"}, {"Description"}, {50}, {"medium"}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.AIInsights.SingleAsync(i => i.Id == minimalInsightId);
        Assert.False(loaded.IsAcknowledged);
        Assert.Empty(loaded.AffectedSegments);
        Assert.Empty(loaded.RecommendedActions);
        Assert.Null(loaded.AcknowledgedBy);
        Assert.Null(loaded.SupportingData);
    }
}
```

- [ ] **Step 8: Run the tests to verify they fail (no migration yet)**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter "AnalyticsInsightTests|AIInsightTests"`
Expected: FAIL — `relation "analytics_insights" does not exist` / `relation "ai_insights" does not exist`.

- [ ] **Step 9: Generate the migration**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
dotnet ef migrations add AddAnalyticsAndAiInsightsTables \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

Expected: succeeds, creates `analytics_insights`, `analytics_metric_data`, `analytics_time_series`, `ai_insights` with all FKs and defaults. Confirm `affected_segments`/`recommended_actions` use `defaultValueSql: "ARRAY[]::text[]"` in the generated migration.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter "AnalyticsInsightTests|AIInsightTests"`
Expected: PASS (4/4).

- [ ] **Step 11: Run the full solution build and test suite**

Run: `dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx`
Expected: builds clean, all existing + 4 new tests pass.

- [ ] **Step 12: Commit, push, open a PR, merge**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git add src/ClimateProject.Domain/Entities/AnalyticsInsight.cs \
  src/ClimateProject.Domain/Entities/AnalyticsMetricData.cs \
  src/ClimateProject.Domain/Entities/AnalyticsTimeSeries.cs \
  src/ClimateProject.Domain/Entities/AIInsight.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/AnalyticsInsightConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/AnalyticsMetricDataConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/AnalyticsTimeSeriesConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/AIInsightConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
  src/ClimateProject.Infrastructure/Migrations/ \
  tests/ClimateProject.IntegrationTests/Persistence/AnalyticsInsightTests.cs \
  tests/ClimateProject.IntegrationTests/Persistence/AIInsightTests.cs
git commit -m "feat: add AnalyticsInsight and AIInsight entities"
git push -u origin schema/analytics-ai-insights
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: AnalyticsInsight + AIInsight entities" \
  --body "Third piece of #54's Reports & Analytics schema slice. Adds analytics_insights (+ analytics_metric_data / analytics_time_series junctions) and a single consolidated ai_insights table. ai_insights resolves the legacy Analytics.ts/AIInsight.ts mongoose model collision by using Analytics.ts's full field shape with AIInsight.ts's confidence_score scale (int 0-100). survey_id columns are intentionally left without an FK constraint -- no Survey entity exists yet in this repo."
gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch
git checkout main && git pull
```

---

### Task 4: DemographicField + DemographicSnapshot (+ entries / changes) entities

**Files:**
- Create: `src/ClimateProject.Domain/Entities/DemographicField.cs`
- Create: `src/ClimateProject.Domain/Entities/DemographicSnapshot.cs`
- Create: `src/ClimateProject.Domain/Entities/DemographicSnapshotEntry.cs`
- Create: `src/ClimateProject.Domain/Entities/DemographicSnapshotChange.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/DemographicFieldConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/DemographicSnapshotConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/DemographicSnapshotEntryConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/DemographicSnapshotChangeConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — add 4 new `DbSet`s
- Create: `src/ClimateProject.Infrastructure/Migrations/*` (generated)
- Test: `tests/ClimateProject.IntegrationTests/Persistence/DemographicFieldTests.cs`
- Test: `tests/ClimateProject.IntegrationTests/Persistence/DemographicSnapshotTests.cs`

**Interfaces:**
- Consumes: `Company` (`CompanyId` FK), `User` (`CreatedBy`/`UserId`/`ChangedBy` FKs). `SurveyId` on `DemographicSnapshot` is a plain unlinked `Guid` column (no `Survey` entity yet, same as Task 3).
- Produces: `DemographicField { Id, CompanyId (Guid), Field (string), Label (string), Type (string), Options (List<string>?), Required (bool, default false), Order (int, default 0), IsActive (bool, default true), CreatedAt/UpdatedAt }`, `DemographicSnapshot { Id, SurveyId (Guid), CompanyId (Guid), Version (int), Timestamp (DateTimeOffset), CreatedBy (Guid), Reason (string), IsActive (bool, default true), Metadata (DemographicSnapshotMetadata, owned: TotalUsers (int, default 0), DepartmentsCount (int, default 0), RolesDistribution (string? jsonb), TenureDistribution (string? jsonb)), CreatedAt/UpdatedAt }`, `DemographicSnapshotEntry { Id, SnapshotId (Guid FK), UserId (Guid FK), Department (string), Role (string), Tenure (string), Location/Team/Level (string?), CustomAttributes (string? jsonb) }`, `DemographicSnapshotChange { Id, SnapshotId (Guid FK), Field (string), OldValue/NewValue (string? jsonb), ChangedBy (Guid FK), Timestamp (DateTimeOffset), Reason (string?) }`. This is the plan's terminal task.

- [ ] **Step 1: Create a feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main
git pull
git checkout -b schema/demographics
```

- [ ] **Step 2: Write the DemographicField entity**

`src/ClimateProject.Domain/Entities/DemographicField.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class DemographicField
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public required string Field { get; set; }
    public required string Label { get; set; }
    public required string Type { get; set; }
    public List<string>? Options { get; set; }
    public bool Required { get; set; }
    public int Order { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
```

- [ ] **Step 3: Write the DemographicSnapshot entity (with owned DemographicSnapshotMetadata)**

`src/ClimateProject.Domain/Entities/DemographicSnapshot.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class DemographicSnapshot
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
    public Guid CompanyId { get; set; }
    public int Version { get; set; }
    public DateTimeOffset Timestamp { get; set; }
    public Guid CreatedBy { get; set; }
    public required string Reason { get; set; }
    public bool IsActive { get; set; } = true;
    public DemographicSnapshotMetadata Metadata { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class DemographicSnapshotMetadata
{
    public int TotalUsers { get; set; }
    public int DepartmentsCount { get; set; }
    public string? RolesDistribution { get; set; }
    public string? TenureDistribution { get; set; }
}
```

- [ ] **Step 4: Write the DemographicSnapshotEntry and DemographicSnapshotChange entities**

`src/ClimateProject.Domain/Entities/DemographicSnapshotEntry.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class DemographicSnapshotEntry
{
    public Guid Id { get; set; }
    public Guid SnapshotId { get; set; }
    public Guid UserId { get; set; }
    public required string Department { get; set; }
    public required string Role { get; set; }
    public required string Tenure { get; set; }
    public string? Location { get; set; }
    public string? Team { get; set; }
    public string? Level { get; set; }
    public string? CustomAttributes { get; set; }
}
```

`src/ClimateProject.Domain/Entities/DemographicSnapshotChange.cs`:

```csharp
namespace ClimateProject.Domain.Entities;

public class DemographicSnapshotChange
{
    public Guid Id { get; set; }
    public Guid SnapshotId { get; set; }
    public required string Field { get; set; }
    public string? OldValue { get; set; }
    public string? NewValue { get; set; }
    public Guid ChangedBy { get; set; }
    public DateTimeOffset Timestamp { get; set; }
    public string? Reason { get; set; }
}
```

- [ ] **Step 5: Write the four Configuration classes**

`src/ClimateProject.Infrastructure/Persistence/Configurations/DemographicFieldConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class DemographicFieldConfiguration : IEntityTypeConfiguration<DemographicField>
{
    public void Configure(EntityTypeBuilder<DemographicField> builder)
    {
        builder.ToTable("demographic_fields");
        builder.HasKey(f => f.Id);
        builder.Property(f => f.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(f => f.Field).HasColumnName("field").HasMaxLength(100).IsRequired();
        builder.Property(f => f.Label).HasColumnName("label").HasMaxLength(200).IsRequired();
        builder.Property(f => f.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(f => f.Options).HasColumnName("options").HasColumnType("text[]");
        builder.Property(f => f.Required).HasColumnName("required").IsRequired().HasDefaultValue(false);
        builder.Property(f => f.Order).HasColumnName("order").IsRequired().HasDefaultValue(0);
        builder.Property(f => f.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(f => f.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(f => f.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(f => new { f.CompanyId, f.Field }).IsUnique();
        builder.HasIndex(f => new { f.CompanyId, f.Order });

        builder.HasOne<Company>().WithMany().HasForeignKey(f => f.CompanyId);
    }
}
```

`src/ClimateProject.Infrastructure/Persistence/Configurations/DemographicSnapshotConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class DemographicSnapshotConfiguration : IEntityTypeConfiguration<DemographicSnapshot>
{
    public void Configure(EntityTypeBuilder<DemographicSnapshot> builder)
    {
        builder.ToTable("demographic_snapshots");
        builder.HasKey(s => s.Id);
        // survey_id is a plain column, not an EF FK -- see AnalyticsInsightConfiguration's comment
        // (Task 3): no Survey entity/table exists yet in this repo.
        builder.Property(s => s.SurveyId).HasColumnName("survey_id").IsRequired();
        builder.Property(s => s.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(s => s.Version).HasColumnName("version").IsRequired();
        builder.Property(s => s.Timestamp).HasColumnName("timestamp").IsRequired();
        builder.Property(s => s.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(s => s.Reason).HasColumnName("reason").HasMaxLength(500).IsRequired();
        builder.Property(s => s.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(s => s.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(s => s.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.OwnsOne(s => s.Metadata, metadata =>
        {
            metadata.Property(m => m.TotalUsers).HasColumnName("metadata_total_users").IsRequired().HasDefaultValue(0);
            metadata.Property(m => m.DepartmentsCount).HasColumnName("metadata_departments_count").IsRequired().HasDefaultValue(0);
            metadata.Property(m => m.RolesDistribution).HasColumnName("metadata_roles_distribution").HasColumnType("jsonb");
            metadata.Property(m => m.TenureDistribution).HasColumnName("metadata_tenure_distribution").HasColumnType("jsonb");
        });

        builder.HasIndex(s => new { s.SurveyId, s.Version }).IsUnique();
        builder.HasIndex(s => new { s.CompanyId, s.Timestamp });
        builder.HasIndex(s => new { s.SurveyId, s.IsActive });
        builder.HasIndex(s => s.CreatedBy);

        builder.HasOne<Company>().WithMany().HasForeignKey(s => s.CompanyId);
        builder.HasOne<User>().WithMany().HasForeignKey(s => s.CreatedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
```

`src/ClimateProject.Infrastructure/Persistence/Configurations/DemographicSnapshotEntryConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class DemographicSnapshotEntryConfiguration : IEntityTypeConfiguration<DemographicSnapshotEntry>
{
    public void Configure(EntityTypeBuilder<DemographicSnapshotEntry> builder)
    {
        builder.ToTable("demographic_snapshot_entries");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.SnapshotId).HasColumnName("snapshot_id").IsRequired();
        builder.Property(e => e.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(e => e.Department).HasColumnName("department").HasMaxLength(200).IsRequired();
        builder.Property(e => e.Role).HasColumnName("role").HasMaxLength(100).IsRequired();
        builder.Property(e => e.Tenure).HasColumnName("tenure").HasMaxLength(100).IsRequired();
        builder.Property(e => e.Location).HasColumnName("location").HasMaxLength(200);
        builder.Property(e => e.Team).HasColumnName("team").HasMaxLength(200);
        builder.Property(e => e.Level).HasColumnName("level").HasMaxLength(100);
        builder.Property(e => e.CustomAttributes).HasColumnName("custom_attributes").HasColumnType("jsonb");

        builder.HasIndex(e => e.SnapshotId);
        builder.HasIndex(e => e.UserId);
        builder.HasIndex(e => e.Department);
        builder.HasIndex(e => e.Role);

        builder.HasOne<DemographicSnapshot>().WithMany().HasForeignKey(e => e.SnapshotId);
        builder.HasOne<User>().WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}
```

`src/ClimateProject.Infrastructure/Persistence/Configurations/DemographicSnapshotChangeConfiguration.cs`:

```csharp
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class DemographicSnapshotChangeConfiguration : IEntityTypeConfiguration<DemographicSnapshotChange>
{
    public void Configure(EntityTypeBuilder<DemographicSnapshotChange> builder)
    {
        builder.ToTable("demographic_snapshot_changes");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.SnapshotId).HasColumnName("snapshot_id").IsRequired();
        builder.Property(c => c.Field).HasColumnName("field").HasMaxLength(200).IsRequired();
        builder.Property(c => c.OldValue).HasColumnName("old_value").HasColumnType("jsonb");
        builder.Property(c => c.NewValue).HasColumnName("new_value").HasColumnType("jsonb");
        builder.Property(c => c.ChangedBy).HasColumnName("changed_by").IsRequired();
        builder.Property(c => c.Timestamp).HasColumnName("timestamp").IsRequired();
        builder.Property(c => c.Reason).HasColumnName("reason").HasMaxLength(500);

        builder.HasIndex(c => c.SnapshotId);

        builder.HasOne<DemographicSnapshot>().WithMany().HasForeignKey(c => c.SnapshotId);
        builder.HasOne<User>().WithMany().HasForeignKey(c => c.ChangedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
```

- [ ] **Step 6: Register the DbSets**

Modify `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs` — full new content:

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
    public DbSet<Report> Reports => Set<Report>();
    public DbSet<Benchmark> Benchmarks => Set<Benchmark>();
    public DbSet<BenchmarkMetric> BenchmarkMetrics => Set<BenchmarkMetric>();
    public DbSet<AnalyticsInsight> AnalyticsInsights => Set<AnalyticsInsight>();
    public DbSet<AnalyticsMetricData> AnalyticsMetricData => Set<AnalyticsMetricData>();
    public DbSet<AnalyticsTimeSeries> AnalyticsTimeSeries => Set<AnalyticsTimeSeries>();
    public DbSet<AIInsight> AIInsights => Set<AIInsight>();
    public DbSet<DemographicField> DemographicFields => Set<DemographicField>();
    public DbSet<DemographicSnapshot> DemographicSnapshots => Set<DemographicSnapshot>();
    public DbSet<DemographicSnapshotEntry> DemographicSnapshotEntries => Set<DemographicSnapshotEntry>();
    public DbSet<DemographicSnapshotChange> DemographicSnapshotChanges => Set<DemographicSnapshotChange>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
```

- [ ] **Step 7: Write the DemographicField test file**

`tests/ClimateProject.IntegrationTests/Persistence/DemographicFieldTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class DemographicFieldTests(PostgresContainerFixture postgres)
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

    [Fact]
    public async Task DemographicField_round_trips_with_options_array()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        var field = new DemographicField
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Field = "gender",
            Label = "Gender",
            Type = "select",
            Options = ["Male", "Female", "Non-binary", "Prefer not to say"],
            Required = true,
            Order = 1,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.DemographicFields.Add(field);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.DemographicFields.SingleAsync(f => f.Id == field.Id);
        Assert.Equal("select", loaded.Type);
        Assert.NotNull(loaded.Options);
        Assert.Equal(4, loaded.Options!.Count);
        Assert.True(loaded.Required);
    }

    [Fact]
    public async Task Company_field_combination_is_unique()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        db.DemographicFields.Add(new DemographicField
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Field = "tenure", Label = "Tenure", Type = "text",
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();

        db.DemographicFields.Add(new DemographicField
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Field = "tenure", Label = "Tenure Duplicate", Type = "text",
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Minimal_demographic_field_row_inserted_via_raw_SQL_still_loads_with_DB_level_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        var minimalFieldId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO demographic_fields ("Id", company_id, field, label, type, created_at, updated_at)
             VALUES ({minimalFieldId}, {company.Id}, {"location"}, {"Location"}, {"text"}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.DemographicFields.SingleAsync(f => f.Id == minimalFieldId);
        Assert.False(loaded.Required);
        Assert.Equal(0, loaded.Order);
        Assert.True(loaded.IsActive);
        Assert.Null(loaded.Options);
    }
}
```

- [ ] **Step 8: Write the DemographicSnapshot test file**

`tests/ClimateProject.IntegrationTests/Persistence/DemographicSnapshotTests.cs`:

```csharp
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class DemographicSnapshotTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user)> SeedCompanyAndUserAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "admin@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (company, user);
    }

    [Fact]
    public async Task DemographicSnapshot_round_trips_with_entries_changes_and_owned_metadata()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, admin) = await SeedCompanyAndUserAsync(db);

        var member = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "member@acme.test", Name = "Member",
            Role = "employee", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(member);
        await db.SaveChangesAsync();

        var surveyId = Guid.NewGuid();
        var snapshot = new DemographicSnapshot
        {
            Id = Guid.NewGuid(),
            SurveyId = surveyId,
            CompanyId = company.Id,
            Version = 1,
            Timestamp = DateTimeOffset.UtcNow,
            CreatedBy = admin.Id,
            Reason = "Initial snapshot at survey launch",
            Metadata = new DemographicSnapshotMetadata
            {
                TotalUsers = 1,
                DepartmentsCount = 1,
                RolesDistribution = """{"employee": 1}""",
                TenureDistribution = """{"1-2 years": 1}""",
            },
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.DemographicSnapshots.Add(snapshot);
        await db.SaveChangesAsync();

        var entry = new DemographicSnapshotEntry
        {
            Id = Guid.NewGuid(),
            SnapshotId = snapshot.Id,
            UserId = member.Id,
            Department = "Engineering",
            Role = "employee",
            Tenure = "1-2 years",
            CustomAttributes = """{"remote": true}""",
        };
        db.DemographicSnapshotEntries.Add(entry);

        var change = new DemographicSnapshotChange
        {
            Id = Guid.NewGuid(),
            SnapshotId = snapshot.Id,
            Field = $"{member.Id}.department",
            OldValue = "\"Sales\"",
            NewValue = "\"Engineering\"",
            ChangedBy = admin.Id,
            Timestamp = DateTimeOffset.UtcNow,
            Reason = "Department reassignment",
        };
        db.DemographicSnapshotChanges.Add(change);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedSnapshot = await readDb.DemographicSnapshots.SingleAsync(s => s.Id == snapshot.Id);
        Assert.True(loadedSnapshot.IsActive);
        Assert.Equal(1, loadedSnapshot.Metadata.TotalUsers);
        Assert.Contains("employee", loadedSnapshot.Metadata.RolesDistribution);

        var loadedEntry = await readDb.DemographicSnapshotEntries.SingleAsync(e => e.Id == entry.Id);
        Assert.Equal(snapshot.Id, loadedEntry.SnapshotId);
        Assert.Equal("Engineering", loadedEntry.Department);

        var loadedChange = await readDb.DemographicSnapshotChanges.SingleAsync(c => c.Id == change.Id);
        Assert.Equal(snapshot.Id, loadedChange.SnapshotId);
        Assert.Equal("\"Engineering\"", loadedChange.NewValue);
    }

    [Fact]
    public async Task Minimal_demographic_snapshot_row_inserted_via_raw_SQL_still_loads_with_DB_level_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, admin) = await SeedCompanyAndUserAsync(db);

        var minimalSnapshotId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO demographic_snapshots ("Id", survey_id, company_id, version, "timestamp", created_by, reason, created_at, updated_at)
             VALUES ({minimalSnapshotId}, {Guid.NewGuid()}, {company.Id}, {1}, {now}, {admin.Id}, {"Minimal"}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.DemographicSnapshots.SingleAsync(s => s.Id == minimalSnapshotId);
        Assert.True(loaded.IsActive);
        Assert.Equal(0, loaded.Metadata.TotalUsers);
        Assert.Equal(0, loaded.Metadata.DepartmentsCount);
        Assert.Null(loaded.Metadata.RolesDistribution);
        Assert.Null(loaded.Metadata.TenureDistribution);
    }
}
```

- [ ] **Step 9: Run the tests to verify they fail (no migration yet)**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter "DemographicFieldTests|DemographicSnapshotTests"`
Expected: FAIL — `relation "demographic_fields" does not exist` / `relation "demographic_snapshots" does not exist`.

- [ ] **Step 10: Generate the migration**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
dotnet ef migrations add AddDemographicFieldsAndSnapshotsTables \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

Expected: succeeds, creates `demographic_fields`, `demographic_snapshots` (with `metadata_*` owned columns), `demographic_snapshot_entries`, `demographic_snapshot_changes`, all FKs, and the `(company_id, field)` unique index / `(survey_id, version)` unique index.

- [ ] **Step 11: Run the tests to verify they pass**

Run: `dotnet test tests/ClimateProject.IntegrationTests --filter "DemographicFieldTests|DemographicSnapshotTests"`
Expected: PASS (5/5).

- [ ] **Step 12: Run the full solution build and test suite**

Run: `dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx`
Expected: builds clean, all existing + 5 new tests pass.

- [ ] **Step 13: Commit, push, open a PR, merge**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git add src/ClimateProject.Domain/Entities/DemographicField.cs \
  src/ClimateProject.Domain/Entities/DemographicSnapshot.cs \
  src/ClimateProject.Domain/Entities/DemographicSnapshotEntry.cs \
  src/ClimateProject.Domain/Entities/DemographicSnapshotChange.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/DemographicFieldConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/DemographicSnapshotConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/DemographicSnapshotEntryConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/Configurations/DemographicSnapshotChangeConfiguration.cs \
  src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
  src/ClimateProject.Infrastructure/Migrations/ \
  tests/ClimateProject.IntegrationTests/Persistence/DemographicFieldTests.cs \
  tests/ClimateProject.IntegrationTests/Persistence/DemographicSnapshotTests.cs
git commit -m "feat: add DemographicField and DemographicSnapshot entities"
git push -u origin schema/demographics
gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: DemographicField + DemographicSnapshot entities" \
  --body "Fourth and final piece of #54's Reports & Analytics schema slice. Adds demographic_fields (company-configurable form schema) and demographic_snapshots (+ entries / changes junctions, + owned DemographicSnapshotMetadata). survey_id is intentionally left without an FK constraint -- no Survey entity exists yet in this repo, same reasoning as Task 3's AnalyticsInsight/AIInsight. Completes #54's schema."
gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch
git checkout main && git pull
```

---

## Self-Review Notes

- **Spec coverage**: every table in the #54 domain-specific schema block has a task and every listed field is present on the matching entity — `reports` (Task 1), `benchmarks`/`benchmark_metrics` (Task 2), `analytics_insights`/`analytics_metric_data`/`analytics_time_series`/`ai_insights` (Task 3), `demographic_fields`/`demographic_snapshots`/`demographic_snapshot_entries`/`demographic_snapshot_changes`/`demographic_snapshot_metadata` (Task 4). The `prior_period_benchmark_id` self-referencing FK explicitly called out in the spec is in Task 2. The `ai_insights` single-consolidated-table resolution (Analytics.ts shape + AIInsight.ts confidence_score scale) is implemented exactly as specified, not re-litigated.
- **No placeholders**: every task has complete, compilable entity/configuration/test code — no `TBD`, no "add validation here", no elided methods.
- **Type/name consistency across tasks**: `Company`/`User`/`Department` FK types (`Guid`, `Guid?`) match their source entities exactly in every task. `jsonb` columns are uniformly `string?` + `.HasColumnType("jsonb")` with no `HasDefaultValue` (nullable). `text[]` "always empty by default" columns uniformly use `List<string>` + `.HasColumnType("text[]")` + `.HasDefaultValueSql("ARRAY[]::text[]")` in both Task 1 (`SharedWith`) and Task 3 (`AffectedSegments`/`RecommendedActions`) — same pattern, same reasoning, stated once in Global Constraints and referenced (not re-derived) in Task 3. The `SurveyId`-has-no-FK decision is stated once in Global Constraints and referenced by comment (not re-derived) in both Task 3 and Task 4.
- **CRITICAL LESSON compliance**: every `NOT NULL` column with a non-CLR-default value has both a `.HasDefaultValue(...)`/`.HasDefaultValueSql(...)` in its Configuration class AND a dedicated raw-SQL-insert-then-EF-read test: `Report` (Task 1: `status`, `is_recurring`, `shared_with`, `download_count`), `Benchmark` (Task 2: `is_active`, `validation_status`, `quality_score`), `AnalyticsInsight`/`AIInsight` (Task 3: `is_current`; `affected_segments`, `recommended_actions`, `is_acknowledged`), `DemographicField`/`DemographicSnapshot` (Task 4: `required`, `order`, `is_active`; `is_active`, owned `metadata_total_users`/`metadata_departments_count`).
- **Grounding**: FK targets were verified against the live repo state (`Company.cs`, `User.cs`, `Department.cs`, `CompanyConfiguration.cs`, `UserConfiguration.cs`, `DepartmentConfiguration.cs`, `ClimateProjectDbContext.cs` all read in full before writing this plan). The task brief's assumption that `UserInvitation`/`AuditLog` are already merged was checked and found incorrect (they're unexecuted Tasks 4/5 of the org-structure plan) — this plan does not depend on either. The assumption that a `Survey` entity exists was checked and found incorrect — `SurveyId` fields are deliberately left as unlinked plain columns, called out explicitly rather than silently guessed at.
- **Ordering**: all four tasks are independent of each other (each only depends on the already-merged `Company`/`User`/`Department`), so they can be executed in any order; this plan lists them in the domain spec's own order (reports → benchmarks → analytics/AI insights → demographics) for readability.
