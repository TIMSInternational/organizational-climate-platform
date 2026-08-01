# Surveys Domain (climate-project-api #51) EF Core Postgres Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the EF Core Postgres schema for the entire Surveys domain (GitHub issue #51, a slice of the #49 data-model epic) in `climate-project-api`: surveys, questions and their sub-shapes, survey templates, drafts, version history, distribution/QR/access-rules, invitations, audit logs, and responses — grounded in the current live repo state and the legacy Mongoose models, split into 5 right-sized tasks.

**Architecture:** Clean architecture, matching the already-merged org-structure domain (Company/User/Department, PRs #7/#15/#16/#17/#18). Plain POCO entities in `src/ClimateProject.Domain/Entities/`, `IEntityTypeConfiguration<T>` Fluent configs in `src/ClimateProject.Infrastructure/Persistence/Configurations/`, applied via `modelBuilder.ApplyConfigurationsFromAssembly`. Every table gets an additive EF Core migration on top of the current tip (`20260731100805_AddUserProfileFields`). No application/API layer work in this plan — schema only.

**Tech Stack:** .NET 10, EF Core 10.0.0, Npgsql.EntityFrameworkCore.PostgreSQL 10.0.0, PostgreSQL 16 (Testcontainers `postgres:16-alpine` in tests), xUnit, dotnet-ef 10.0.10 (already installed globally).

## Global Constraints

- Repo: `/Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api`, branch `main`. New feature branch per task, PR via `gh pr create --repo TIMSInternational/climate-project-api`, squash-merge via `gh pr merge --squash --delete-branch`.
- Clean architecture: entities in `src/ClimateProject.Domain/Entities/`, configs in `src/ClimateProject.Infrastructure/Persistence/Configurations/`, `DbSet<T>` + `ApplyConfigurationsFromAssembly` in `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`.
- snake_case table/column names via explicit `.ToTable(...)`/`.HasColumnName(...)`. EXCEPTION: an `Id` primary-key property named exactly `Id` stays PascalCase `"Id"` (no `.HasColumnName("id")` override). A PK property with any other name (e.g. `QuestionId` used as a shared 1:1 primary key) still gets normal snake_case (`question_id`) — the exception is about the literal property name `Id`, not about PK-ness.
- Enums are plain C# `string` properties with no `HasConversion<string>()` call (that call is only needed when the CLR property type isn't already `string`; every enum-ish property in this plan is already typed `string`/`string?`, so no `HasConversion` calls appear anywhere below — this avoids the vestigial no-op bug already present at `DepartmentConfiguration.cs:26` and explicitly must not be repeated).
- Owned 1:1 shapes that are **always present** (never null) use `.OwnsOne(...)` with inline snake_case columns prefixed by the property name (e.g. `Survey.Settings.Anonymous` → `settings_anonymous`).
- Owned 1:1 shapes that are **nullable / optional-per-row** (e.g. a question's conditional logic, which most questions won't have) are NOT modeled as EF owned types — owned types in this codebase are reserved for always-present shapes. Instead they get their own child table with the parent's key reused as both PK and FK (shared-primary-key 1:1). `question_conditional_logic` uses this pattern: PK/FK = `question_id`, row absence = "no conditional logic for this question".
- **CRITICAL LESSON** (real bug, previously shipped and had to be fixed in a follow-up PR): every NOT NULL property with an intended non-CLR-default value — whether on an owned type or a plain entity property — MUST get `.HasDefaultValue(...)` (or `.HasDefaultValueSql(...)` for arrays) in the Fluent config, matching the C# object-initializer default. Otherwise `dotnet ef migrations add` silently backfills pre-existing rows with EF's raw CLR defaults (empty string/false/0/empty array) instead of the intended domain default. Every task below includes a raw-SQL-insert-then-EF-read test that proves this at the DB level (not an in-memory insert-then-read, which would not catch the bug).
- jsonb columns are plain nullable (or `required`, if the domain genuinely requires content at insert time) `string` CLR properties mapped with `.HasColumnType("jsonb")`. No `JsonDocument`/`Dictionary<string,object>`, no speculative serialization helpers.
- Role values stay plain strings matching `ClimateProject.Application.Auth.Roles` constants (`super_admin`/`company_admin`/`leader`/`supervisor`/`employee`) — never a C# enum.
- Migrations are strictly additive, generated via `dotnet ef migrations add <Name> --project src/ClimateProject.Infrastructure --startup-project src/ClimateProject.Api --output-dir Migrations`, always on top of whatever is at the tip when the task starts. Never touch a migration a prior task already merged.
- `Directory.Build.props` sets `TreatWarningsAsErrors=true` — 0 warnings on every `dotnet build`.
- Integration tests reuse `tests/ClimateProject.IntegrationTests/Support/PostgresContainerFixture.cs` unchanged; each new test class builds its own `DbContextOptionsBuilder<ClimateProjectDbContext>().UseNpgsql(postgres.ConnectionString)` exactly like `DepartmentTests.cs`/`CompanyProfileTests.cs`/`UserProfileTests.cs`. Docker must be running.
- Every task: write failing test → run to confirm fail → implement (entities + config + migration) → run to confirm pass → `dotnet build ClimateProject.slnx && dotnet test ClimateProject.slnx` confirming 0 warnings, all tests (old + new) passing → commit/push/PR/merge/checkout main/pull.
- Before referencing any entity by FK, this plan already read the live current state of `Company.cs`, `User.cs`, `Department.cs` (there is no `UserInvitation.cs`/`AuditLog.cs` in the repo yet despite the org-structure description mentioning them — grounded on what's actually there, not what was expected) and `ClimateProjectDbContext.cs`. Current `DbSet`s: `Companies`, `Users`, `Departments`.
- **FK `OnDelete` decision rule used consistently across all 5 tasks** (extending the two examples already given — self-referencing hierarchy → Restrict, required parent-owns-child → Cascade — to the new cross-table shapes this domain introduces):
  - FK to `Company` (multi-tenant root), when required: default (no explicit `.OnDelete()` call → EF's default `Cascade`) — matches the existing `Department.CompanyId`/`User.CompanyId` precedent exactly.
  - FK that is the table's own **structural parent** in a parent-owns-child sense (the child row has no reason to exist without that parent, and is naturally deleted with it) — e.g. `Question.SurveyId`, `SurveyVersion.SurveyId`, `SurveyDistribution.SurveyId`, `SurveyAuditLog.SurveyId`, `Response.SurveyId`, `TemplateQuestion.TemplateId`, `SurveyDraft.UserId`: default (no explicit call → `Cascade`).
  - FK that is a required **cross-aggregate actor/creator reference** (the row belongs structurally to something else, and this FK just records who did it) — e.g. `Survey.CreatedBy`, `SurveyVersion.CreatedBy`, `SurveyInvitation.UserId`, `SurveyAuditLog.UserId`, `QuestionResponse.QuestionId`: `.OnDelete(DeleteBehavior.Restrict)`. This mirrors `User.ManagerId` (also a required cross-reference, also Restrict) and protects history/analytics rows from being silently destroyed by an unrelated deletion.
  - FK that is **nullable / optional**: `.OnDelete(DeleteBehavior.SetNull)` — matches `User.DepartmentId` exactly. Applies to `SurveyTemplate.CreatedBy`/`CompanyId`/`SourceSurveyId`, `QuestionConditionalLogic.ConditionQuestionId`/`TargetQuestionId`, `SurveyDistribution.LastRegeneratedBy`, `Response.UserId`/`DepartmentId`.
  - Pure many-to-many junction tables with no other purpose (`survey_department_targets`, and the `question_id` side of `question_emoji_options`): default (`Cascade`) on both FK columns — deleting either side should clean up the link row.
- **Scope decisions made explicit** (deliberately narrower than the raw Mongoose models, matching only the approved #49 spec field lists given for this task, not inventing extra columns):
  - `Survey` has no `template_id`, `department_ids` (replaced by the `survey_department_targets` junction), or `demographics`/`demographic_field_ids` columns — none of these appear in the approved field list.
  - `SurveyTemplate` has no `default_settings` column — not in the approved field list (unlike the Mongoose model). If a future task needs it, it is a new additive migration, not a retrofit here.
  - `TemplateQuestion` mirrors `Question`'s scalar columns only — it does **not** get its own `template_conditional_logic`/`template_emoji_options` sibling tables. The approved spec's one-line description doesn't call for this, and building it speculatively would be scope creep; noted as a known follow-up gap if template-driven emoji/conditional questions become a real product need.
  - Question repository tables (QuestionBank/QuestionLibrary/QuestionCategory/LibraryQuestion/QuestionPool) are excluded from this domain slice per the task brief — not designed, not implemented, not referenced.
- **Table naming**: every table name below is taken verbatim from the approved #49 spec's field list (`surveys`, `questions`, `survey_department_targets`, `question_conditional_logic`, `question_emoji_options`, `survey_templates`, `template_questions`, `survey_drafts`, `survey_versions`, `survey_distributions`, `survey_invitations`, `survey_audit_logs`, `responses`, `question_responses`, `response_demographics`). Tables whose spec field list does **not** start with `id` (`survey_department_targets`, `question_conditional_logic`, `question_emoji_options`, `question_responses`, `response_demographics`) get a composite/shared natural key instead of a surrogate `Id` — every other table gets a surrogate `Guid Id`.

---

## Task 1: Survey core + settings + questions

**Files:**
- Create: `src/ClimateProject.Domain/Entities/Survey.cs`
- Create: `src/ClimateProject.Domain/Entities/Question.cs`
- Create: `src/ClimateProject.Domain/Entities/QuestionConditionalLogic.cs`
- Create: `src/ClimateProject.Domain/Entities/QuestionEmojiOption.cs`
- Create: `src/ClimateProject.Domain/Entities/SurveyDepartmentTarget.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/QuestionConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/QuestionConditionalLogicConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/QuestionEmojiOptionConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyDepartmentTargetConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`
- Create: `src/ClimateProject.Infrastructure/Migrations/<timestamp>_AddSurveysCore.cs` (generated by `dotnet ef migrations add`)
- Test: `tests/ClimateProject.IntegrationTests/Persistence/SurveyCoreTests.cs`

**Interfaces:**
- Consumes: `Company` (`Id: Guid`), `User` (`Id: Guid`), `Department` (`Id: Guid`) from `ClimateProject.Domain.Entities` (already in repo).
- Produces: `Survey` (`Id: Guid`, `CompanyId: Guid`, `CreatedBy: Guid`, `Title: string`, `Type: string`, `Status: string`, `Settings: SurveySettings`), `Question` (`Id: Guid`, `SurveyId: Guid`, `Order: int`), `QuestionConditionalLogic` (`QuestionId: Guid` — PK/FK), `QuestionEmojiOption` (`QuestionId: Guid`, `Order: int` — composite PK), `SurveyDepartmentTarget` (`SurveyId: Guid`, `DepartmentId: Guid` — composite PK), and `DbSet<T>` properties `Surveys`, `Questions`, `QuestionConditionalLogics`, `QuestionEmojiOptions`, `SurveyDepartmentTargets` — all consumed by Tasks 2–5.

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main && git pull
git checkout -b schema/surveys-core
```

- [ ] **Step 2: Write the `Survey` and `SurveySettings` entities**

```csharp
// src/ClimateProject.Domain/Entities/Survey.cs
namespace ClimateProject.Domain.Entities;

public class Survey
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid CreatedBy { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public required string Type { get; set; }
    public DateTimeOffset StartDate { get; set; }
    public DateTimeOffset EndDate { get; set; }
    public string Status { get; set; } = "draft";
    public int ResponseCount { get; set; }
    public int? TargetAudienceCount { get; set; }
    public int Version { get; set; } = 1;
    public SurveySettings Settings { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class SurveySettings
{
    public bool Anonymous { get; set; }
    public bool AllowPartialResponses { get; set; } = true;
    public bool RandomizeQuestions { get; set; }
    public bool ShowProgress { get; set; } = true;
    public bool AutoSave { get; set; } = true;
    public int? TimeLimitMinutes { get; set; }
    public int? ResponseLimit { get; set; }
    public bool NotificationSendInvitations { get; set; } = true;
    public bool NotificationSendReminders { get; set; } = true;
    public int NotificationReminderFrequencyDays { get; set; } = 3;
    public string? InvitationCustomMessage { get; set; }
    public bool InvitationIncludeCredentials { get; set; }
    public bool InvitationSendImmediately { get; set; }
    public string? InvitationCustomSubject { get; set; }
    public bool InvitationBrandingEnabled { get; set; }
}
```

- [ ] **Step 3: Write the `Question`, `QuestionConditionalLogic`, `QuestionEmojiOption`, `SurveyDepartmentTarget` entities**

```csharp
// src/ClimateProject.Domain/Entities/Question.cs
namespace ClimateProject.Domain.Entities;

public class Question
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
    public required string Text { get; set; }
    public required string Type { get; set; }
    public string[]? Options { get; set; }
    public int? ScaleMin { get; set; }
    public int? ScaleMax { get; set; }
    public string? ScaleLabelMin { get; set; }
    public string? ScaleLabelMax { get; set; }
    public bool CommentRequired { get; set; } = true;
    public string CommentPrompt { get; set; } = "Please explain your answer:";
    public string? BinaryCommentConfig { get; set; }
    public bool Required { get; set; }
    public int Order { get; set; }
    public string? Category { get; set; }
}
```

```csharp
// src/ClimateProject.Domain/Entities/QuestionConditionalLogic.cs
namespace ClimateProject.Domain.Entities;

// 1:1-per-question, nullable shape: absence of a row means "no conditional logic".
// Not an EF owned type — owned types in this codebase are reserved for always-present
// shapes, and this one also needs its own FK relationships to other Question rows.
public class QuestionConditionalLogic
{
    public Guid QuestionId { get; set; }
    public Guid? ConditionQuestionId { get; set; }
    public string? ConditionOperator { get; set; }
    public string? ConditionValue { get; set; }
    public string? Action { get; set; }
    public Guid? TargetQuestionId { get; set; }
}
```

```csharp
// src/ClimateProject.Domain/Entities/QuestionEmojiOption.cs
namespace ClimateProject.Domain.Entities;

public class QuestionEmojiOption
{
    public Guid QuestionId { get; set; }
    public int Order { get; set; }
    public required string Emoji { get; set; }
    public required string Label { get; set; }
    public int Value { get; set; }
}
```

```csharp
// src/ClimateProject.Domain/Entities/SurveyDepartmentTarget.cs
namespace ClimateProject.Domain.Entities;

public class SurveyDepartmentTarget
{
    public Guid SurveyId { get; set; }
    public Guid DepartmentId { get; set; }
}
```

- [ ] **Step 4: Write the Fluent configurations**

```csharp
// src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyConfiguration.cs
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyConfiguration : IEntityTypeConfiguration<Survey>
{
    public void Configure(EntityTypeBuilder<Survey> builder)
    {
        builder.ToTable("surveys");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(s => s.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(s => s.Title).HasColumnName("title").HasMaxLength(200).IsRequired();
        builder.Property(s => s.Description).HasColumnName("description").HasMaxLength(1000);
        builder.Property(s => s.Type).HasColumnName("type").HasMaxLength(30).IsRequired();
        builder.Property(s => s.StartDate).HasColumnName("start_date").IsRequired();
        builder.Property(s => s.EndDate).HasColumnName("end_date").IsRequired();
        builder.Property(s => s.Status).HasColumnName("status").HasMaxLength(20).IsRequired().HasDefaultValue("draft");
        builder.Property(s => s.ResponseCount).HasColumnName("response_count").IsRequired().HasDefaultValue(0);
        builder.Property(s => s.TargetAudienceCount).HasColumnName("target_audience_count");
        builder.Property(s => s.Version).HasColumnName("version").IsRequired().HasDefaultValue(1);
        builder.Property(s => s.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(s => s.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasOne<Company>().WithMany().HasForeignKey(s => s.CompanyId);
        builder.HasOne<User>().WithMany().HasForeignKey(s => s.CreatedBy).OnDelete(DeleteBehavior.Restrict);

        builder.OwnsOne(s => s.Settings, settings =>
        {
            settings.Property(x => x.Anonymous).HasColumnName("settings_anonymous").IsRequired().HasDefaultValue(false);
            settings.Property(x => x.AllowPartialResponses).HasColumnName("settings_allow_partial_responses").IsRequired().HasDefaultValue(true);
            settings.Property(x => x.RandomizeQuestions).HasColumnName("settings_randomize_questions").IsRequired().HasDefaultValue(false);
            settings.Property(x => x.ShowProgress).HasColumnName("settings_show_progress").IsRequired().HasDefaultValue(true);
            settings.Property(x => x.AutoSave).HasColumnName("settings_auto_save").IsRequired().HasDefaultValue(true);
            settings.Property(x => x.TimeLimitMinutes).HasColumnName("settings_time_limit_minutes");
            settings.Property(x => x.ResponseLimit).HasColumnName("settings_response_limit");
            settings.Property(x => x.NotificationSendInvitations).HasColumnName("settings_notification_send_invitations").IsRequired().HasDefaultValue(true);
            settings.Property(x => x.NotificationSendReminders).HasColumnName("settings_notification_send_reminders").IsRequired().HasDefaultValue(true);
            settings.Property(x => x.NotificationReminderFrequencyDays).HasColumnName("settings_notification_reminder_frequency_days").IsRequired().HasDefaultValue(3);
            settings.Property(x => x.InvitationCustomMessage).HasColumnName("settings_invitation_custom_message").HasMaxLength(1000);
            settings.Property(x => x.InvitationIncludeCredentials).HasColumnName("settings_invitation_include_credentials").IsRequired().HasDefaultValue(false);
            settings.Property(x => x.InvitationSendImmediately).HasColumnName("settings_invitation_send_immediately").IsRequired().HasDefaultValue(false);
            settings.Property(x => x.InvitationCustomSubject).HasColumnName("settings_invitation_custom_subject").HasMaxLength(200);
            settings.Property(x => x.InvitationBrandingEnabled).HasColumnName("settings_invitation_branding_enabled").IsRequired().HasDefaultValue(false);
        });
    }
}
```

```csharp
// src/ClimateProject.Infrastructure/Persistence/Configurations/QuestionConfiguration.cs
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class QuestionConfiguration : IEntityTypeConfiguration<Question>
{
    public void Configure(EntityTypeBuilder<Question> builder)
    {
        builder.ToTable("questions");
        builder.HasKey(q => q.Id);
        builder.Property(q => q.SurveyId).HasColumnName("survey_id").IsRequired();
        builder.Property(q => q.Text).HasColumnName("text").HasMaxLength(500).IsRequired();
        builder.Property(q => q.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(q => q.Options).HasColumnName("options").HasColumnType("text[]");
        builder.Property(q => q.ScaleMin).HasColumnName("scale_min");
        builder.Property(q => q.ScaleMax).HasColumnName("scale_max");
        builder.Property(q => q.ScaleLabelMin).HasColumnName("scale_label_min").HasMaxLength(200);
        builder.Property(q => q.ScaleLabelMax).HasColumnName("scale_label_max").HasMaxLength(200);
        builder.Property(q => q.CommentRequired).HasColumnName("comment_required").IsRequired().HasDefaultValue(true);
        builder.Property(q => q.CommentPrompt).HasColumnName("comment_prompt").HasMaxLength(500).IsRequired().HasDefaultValue("Please explain your answer:");
        builder.Property(q => q.BinaryCommentConfig).HasColumnName("binary_comment_config").HasColumnType("jsonb");
        builder.Property(q => q.Required).HasColumnName("required").IsRequired().HasDefaultValue(false);
        builder.Property(q => q.Order).HasColumnName("order").IsRequired();
        builder.Property(q => q.Category).HasColumnName("category").HasMaxLength(100);

        builder.HasOne<Survey>().WithMany().HasForeignKey(q => q.SurveyId);
    }
}
```

```csharp
// src/ClimateProject.Infrastructure/Persistence/Configurations/QuestionConditionalLogicConfiguration.cs
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class QuestionConditionalLogicConfiguration : IEntityTypeConfiguration<QuestionConditionalLogic>
{
    public void Configure(EntityTypeBuilder<QuestionConditionalLogic> builder)
    {
        builder.ToTable("question_conditional_logic");
        builder.HasKey(c => c.QuestionId);
        builder.Property(c => c.QuestionId).HasColumnName("question_id");
        builder.Property(c => c.ConditionQuestionId).HasColumnName("condition_question_id");
        builder.Property(c => c.ConditionOperator).HasColumnName("condition_operator").HasMaxLength(20);
        builder.Property(c => c.ConditionValue).HasColumnName("condition_value").HasColumnType("jsonb");
        builder.Property(c => c.Action).HasColumnName("action").HasMaxLength(20);
        builder.Property(c => c.TargetQuestionId).HasColumnName("target_question_id");

        builder.HasOne<Question>().WithOne().HasForeignKey<QuestionConditionalLogic>(c => c.QuestionId);
        builder.HasOne<Question>().WithMany().HasForeignKey(c => c.ConditionQuestionId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<Question>().WithMany().HasForeignKey(c => c.TargetQuestionId).OnDelete(DeleteBehavior.SetNull);
    }
}
```

```csharp
// src/ClimateProject.Infrastructure/Persistence/Configurations/QuestionEmojiOptionConfiguration.cs
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class QuestionEmojiOptionConfiguration : IEntityTypeConfiguration<QuestionEmojiOption>
{
    public void Configure(EntityTypeBuilder<QuestionEmojiOption> builder)
    {
        builder.ToTable("question_emoji_options");
        builder.HasKey(e => new { e.QuestionId, e.Order });
        builder.Property(e => e.QuestionId).HasColumnName("question_id");
        builder.Property(e => e.Order).HasColumnName("order");
        builder.Property(e => e.Emoji).HasColumnName("emoji").HasMaxLength(10).IsRequired();
        builder.Property(e => e.Label).HasColumnName("label").HasMaxLength(100).IsRequired();
        builder.Property(e => e.Value).HasColumnName("value").IsRequired();

        builder.HasOne<Question>().WithMany().HasForeignKey(e => e.QuestionId);
    }
}
```

```csharp
// src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyDepartmentTargetConfiguration.cs
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyDepartmentTargetConfiguration : IEntityTypeConfiguration<SurveyDepartmentTarget>
{
    public void Configure(EntityTypeBuilder<SurveyDepartmentTarget> builder)
    {
        builder.ToTable("survey_department_targets");
        builder.HasKey(t => new { t.SurveyId, t.DepartmentId });
        builder.Property(t => t.SurveyId).HasColumnName("survey_id");
        builder.Property(t => t.DepartmentId).HasColumnName("department_id");

        builder.HasOne<Survey>().WithMany().HasForeignKey(t => t.SurveyId);
        builder.HasOne<Department>().WithMany().HasForeignKey(t => t.DepartmentId);
    }
}
```

- [ ] **Step 5: Register the new `DbSet`s**

```csharp
// src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Persistence;

public class ClimateProjectDbContext(DbContextOptions<ClimateProjectDbContext> options)
    : DbContext(options)
{
    public DbSet<Company> Companies => Set<Company>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<Survey> Surveys => Set<Survey>();
    public DbSet<Question> Questions => Set<Question>();
    public DbSet<QuestionConditionalLogic> QuestionConditionalLogics => Set<QuestionConditionalLogic>();
    public DbSet<QuestionEmojiOption> QuestionEmojiOptions => Set<QuestionEmojiOption>();
    public DbSet<SurveyDepartmentTarget> SurveyDepartmentTargets => Set<SurveyDepartmentTarget>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
```

- [ ] **Step 6: Write the failing integration test**

```csharp
// tests/ClimateProject.IntegrationTests/Persistence/SurveyCoreTests.cs
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class SurveyCoreTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user, Department department)> SeedTenantAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        var department = new Department { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Eng", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "admin@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Departments.Add(department);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (company, user, department);
    }

    [Fact]
    public async Task Survey_round_trips_with_owned_settings_and_department_targets()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user, department) = await SeedTenantAsync(db);

        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            CreatedBy = user.Id,
            Title = "Q3 Climate Survey",
            Type = "general_climate",
            StartDate = DateTimeOffset.UtcNow,
            EndDate = DateTimeOffset.UtcNow.AddDays(14),
            Settings = new SurveySettings { Anonymous = true, TimeLimitMinutes = 20 },
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Surveys.Add(survey);
        db.SurveyDepartmentTargets.Add(new SurveyDepartmentTarget { SurveyId = survey.Id, DepartmentId = department.Id });
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.Surveys.SingleAsync(s => s.Id == survey.Id);
        Assert.Equal("draft", loaded.Status);
        Assert.Equal(1, loaded.Version);
        Assert.True(loaded.Settings.Anonymous);
        Assert.Equal(20, loaded.Settings.TimeLimitMinutes);
        Assert.True(loaded.Settings.AllowPartialResponses);

        var targets = await readDb.SurveyDepartmentTargets.Where(t => t.SurveyId == survey.Id).ToListAsync();
        Assert.Single(targets);
        Assert.Equal(department.Id, targets[0].DepartmentId);
    }

    [Fact]
    public async Task Question_with_conditional_logic_and_emoji_options_round_trips()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user, _) = await SeedTenantAsync(db);

        var survey = new Survey
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, CreatedBy = user.Id, Title = "Pulse", Type = "custom",
            StartDate = DateTimeOffset.UtcNow, EndDate = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        var trigger = new Question { Id = Guid.NewGuid(), SurveyId = survey.Id, Text = "Are you satisfied?", Type = "yes_no", Order = 0 };
        var target = new Question { Id = Guid.NewGuid(), SurveyId = survey.Id, Text = "Why not?", Type = "open_ended", Order = 1 };
        var emojiQuestion = new Question { Id = Guid.NewGuid(), SurveyId = survey.Id, Text = "How do you feel?", Type = "emoji_scale", Order = 2 };
        db.Questions.AddRange(trigger, target, emojiQuestion);
        await db.SaveChangesAsync();

        db.QuestionConditionalLogics.Add(new QuestionConditionalLogic
        {
            QuestionId = target.Id,
            ConditionQuestionId = trigger.Id,
            ConditionOperator = "equals",
            ConditionValue = "\"no\"",
            Action = "show",
            TargetQuestionId = target.Id,
        });
        db.QuestionEmojiOptions.AddRange(
            new QuestionEmojiOption { QuestionId = emojiQuestion.Id, Order = 0, Emoji = "😀", Label = "Great", Value = 5 },
            new QuestionEmojiOption { QuestionId = emojiQuestion.Id, Order = 1, Emoji = "😢", Label = "Bad", Value = 1 });
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var logic = await readDb.QuestionConditionalLogics.SingleAsync(c => c.QuestionId == target.Id);
        Assert.Equal(trigger.Id, logic.ConditionQuestionId);
        Assert.Equal("equals", logic.ConditionOperator);
        Assert.Equal("show", logic.Action);

        var options = await readDb.QuestionEmojiOptions
            .Where(e => e.QuestionId == emojiQuestion.Id)
            .OrderBy(e => e.Order)
            .ToListAsync();
        Assert.Equal(2, options.Count);
        Assert.Equal(5, options[0].Value);
    }

    [Fact]
    public async Task Existing_survey_and_question_rows_without_new_owned_defaults_still_load_with_intended_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user, _) = await SeedTenantAsync(db);

        var minimalSurveyId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO surveys ("Id", company_id, created_by, title, type, start_date, end_date, created_at, updated_at)
             VALUES ({minimalSurveyId}, {company.Id}, {user.Id}, {"Minimal Survey"}, {"custom"}, {now}, {now.AddDays(7)}, {now}, {now})
             """);

        var minimalQuestionId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO questions ("Id", survey_id, text, type, "order")
             VALUES ({minimalQuestionId}, {minimalSurveyId}, {"Minimal question?"}, {"open_ended"}, {0})
             """);

        await using var readDb = CreateContext();
        var loadedSurvey = await readDb.Surveys.SingleAsync(s => s.Id == minimalSurveyId);
        Assert.Equal("draft", loadedSurvey.Status);
        Assert.Equal(0, loadedSurvey.ResponseCount);
        Assert.Equal(1, loadedSurvey.Version);
        Assert.False(loadedSurvey.Settings.Anonymous);
        Assert.True(loadedSurvey.Settings.AllowPartialResponses);
        Assert.False(loadedSurvey.Settings.RandomizeQuestions);
        Assert.True(loadedSurvey.Settings.ShowProgress);
        Assert.True(loadedSurvey.Settings.AutoSave);
        Assert.True(loadedSurvey.Settings.NotificationSendInvitations);
        Assert.True(loadedSurvey.Settings.NotificationSendReminders);
        Assert.Equal(3, loadedSurvey.Settings.NotificationReminderFrequencyDays);
        Assert.False(loadedSurvey.Settings.InvitationIncludeCredentials);
        Assert.False(loadedSurvey.Settings.InvitationSendImmediately);
        Assert.False(loadedSurvey.Settings.InvitationBrandingEnabled);

        var loadedQuestion = await readDb.Questions.SingleAsync(q => q.Id == minimalQuestionId);
        Assert.True(loadedQuestion.CommentRequired);
        Assert.Equal("Please explain your answer:", loadedQuestion.CommentPrompt);
        Assert.False(loadedQuestion.Required);
    }
}
```

- [ ] **Step 7: Run the tests to confirm they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~SurveyCoreTests"`
Expected: FAIL — `Npgsql.PostgresException: 42P01: relation "surveys" does not exist` (the entities/config compile, but no migration has created the tables yet).

- [ ] **Step 8: Generate the migration**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
dotnet ef migrations add AddSurveysCore \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

- [ ] **Step 9: Verify DB-level defaults in the generated migration**

Open the newly generated `src/ClimateProject.Infrastructure/Migrations/<timestamp>_AddSurveysCore.cs` and confirm every one of these `AddColumn`/`CreateTable` column definitions carries a `defaultValue:` matching the intended domain default (not just a C# object-initializer default that a raw-SQL-inserted row would never see):
- `surveys.status` → `defaultValue: "draft"`
- `surveys.response_count` → `defaultValue: 0`
- `surveys.version` → `defaultValue: 1`
- `surveys.settings_allow_partial_responses` → `defaultValue: true`
- `surveys.settings_show_progress` → `defaultValue: true`
- `surveys.settings_auto_save` → `defaultValue: true`
- `surveys.settings_notification_send_invitations` → `defaultValue: true`
- `surveys.settings_notification_send_reminders` → `defaultValue: true`
- `surveys.settings_notification_reminder_frequency_days` → `defaultValue: 3`
- `surveys.settings_anonymous`, `settings_randomize_questions`, `settings_invitation_include_credentials`, `settings_invitation_send_immediately`, `settings_invitation_branding_enabled` → `defaultValue: false`
- `questions.comment_required` → `defaultValue: true`
- `questions.comment_prompt` → `defaultValue: "Please explain your answer:"`
- `questions.required` → `defaultValue: false`

If any is missing, add the matching `.HasDefaultValue(...)` call to the Fluent config (Step 4), delete the generated migration folder contents (`dotnet ef migrations remove --project src/ClimateProject.Infrastructure --startup-project src/ClimateProject.Api`), and regenerate.

- [ ] **Step 10: Run the tests to confirm they pass**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~SurveyCoreTests"`
Expected: PASS (all 3 tests).

- [ ] **Step 11: Full solution build and test**

```bash
dotnet build ClimateProject.slnx
dotnet test ClimateProject.slnx
```
Expected: 0 warnings, all tests (existing org-structure tests + the 3 new `SurveyCoreTests`) passing.

- [ ] **Step 12: Commit, push, PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/Survey.cs \
        src/ClimateProject.Domain/Entities/Question.cs \
        src/ClimateProject.Domain/Entities/QuestionConditionalLogic.cs \
        src/ClimateProject.Domain/Entities/QuestionEmojiOption.cs \
        src/ClimateProject.Domain/Entities/SurveyDepartmentTarget.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/QuestionConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/QuestionConditionalLogicConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/QuestionEmojiOptionConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyDepartmentTargetConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
        src/ClimateProject.Infrastructure/Migrations/ \
        tests/ClimateProject.IntegrationTests/Persistence/SurveyCoreTests.cs
git commit -m "$(cat <<'EOF'
feat: add Survey/Question core schema with settings, conditional logic, emoji options

Part of #51 (Surveys domain), sliced from #49.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push -u origin schema/surveys-core

gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: Survey core entity + settings + questions schema" \
  --body "$(cat <<'EOF'
## Summary
- Adds `surveys` (with owned `SurveySettings`), `questions`, `question_conditional_logic` (nullable 1:1 child table), `question_emoji_options`, and `survey_department_targets` junction.
- Part of #51 (Surveys domain), sliced from #49.

## Test plan
- [x] Round-trip test for Survey + owned Settings + department targets
- [x] Round-trip test for Question + conditional logic + emoji options
- [x] Raw-SQL-insert-then-EF-read test proving DB-level defaults on all NOT NULL owned/plain columns
- [x] `dotnet build ClimateProject.slnx` — 0 warnings
- [x] `dotnet test ClimateProject.slnx` — all passing

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch

git checkout main
git pull
```

---

## Task 2: Survey templates

**Files:**
- Create: `src/ClimateProject.Domain/Entities/SurveyTemplate.cs`
- Create: `src/ClimateProject.Domain/Entities/TemplateQuestion.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyTemplateConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/TemplateQuestionConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`
- Create: `src/ClimateProject.Infrastructure/Migrations/<timestamp>_AddSurveyTemplates.cs`
- Test: `tests/ClimateProject.IntegrationTests/Persistence/SurveyTemplateTests.cs`

**Interfaces:**
- Consumes: `Company`, `User` (org-structure), `Survey` (`Id: Guid`, Task 1) for `SourceSurveyId`.
- Produces: `SurveyTemplate` (`Id: Guid`, `Tags: string[]`, `UsageCount: int`, `Rating: double`), `TemplateQuestion` (`Id: Guid`, `TemplateId: Guid` — same scalar shape as `Question`), `DbSet<T>` properties `SurveyTemplates`, `TemplateQuestions`.

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main && git pull
git checkout -b schema/survey-templates
```

- [ ] **Step 2: Write the `SurveyTemplate` and `TemplateQuestion` entities**

```csharp
// src/ClimateProject.Domain/Entities/SurveyTemplate.cs
namespace ClimateProject.Domain.Entities;

public class SurveyTemplate
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string Description { get; set; }
    public required string Category { get; set; }
    public string? Industry { get; set; }
    public string? CompanySize { get; set; }
    public bool IsPublic { get; set; }
    public Guid? CreatedBy { get; set; }
    public Guid? CompanyId { get; set; }
    public int UsageCount { get; set; }
    public double Rating { get; set; }
    public string[] Tags { get; set; } = [];
    public Guid? SourceSurveyId { get; set; }
    public DateTimeOffset? LastUsed { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
```

```csharp
// src/ClimateProject.Domain/Entities/TemplateQuestion.cs
namespace ClimateProject.Domain.Entities;

// Same scalar shape as Question, but owned by a SurveyTemplate instead of a Survey,
// so a template's questions are real, editable, queryable rows — not jsonb.
public class TemplateQuestion
{
    public Guid Id { get; set; }
    public Guid TemplateId { get; set; }
    public required string Text { get; set; }
    public required string Type { get; set; }
    public string[]? Options { get; set; }
    public int? ScaleMin { get; set; }
    public int? ScaleMax { get; set; }
    public string? ScaleLabelMin { get; set; }
    public string? ScaleLabelMax { get; set; }
    public bool CommentRequired { get; set; } = true;
    public string CommentPrompt { get; set; } = "Please explain your answer:";
    public string? BinaryCommentConfig { get; set; }
    public bool Required { get; set; }
    public int Order { get; set; }
    public string? Category { get; set; }
}
```

- [ ] **Step 3: Write the Fluent configurations**

```csharp
// src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyTemplateConfiguration.cs
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyTemplateConfiguration : IEntityTypeConfiguration<SurveyTemplate>
{
    public void Configure(EntityTypeBuilder<SurveyTemplate> builder)
    {
        builder.ToTable("survey_templates");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(t => t.Description).HasColumnName("description").HasMaxLength(1000).IsRequired();
        builder.Property(t => t.Category).HasColumnName("category").HasMaxLength(20).IsRequired();
        builder.Property(t => t.Industry).HasColumnName("industry").HasMaxLength(100);
        builder.Property(t => t.CompanySize).HasColumnName("company_size").HasMaxLength(20);
        builder.Property(t => t.IsPublic).HasColumnName("is_public").IsRequired().HasDefaultValue(false);
        builder.Property(t => t.CreatedBy).HasColumnName("created_by");
        builder.Property(t => t.CompanyId).HasColumnName("company_id");
        builder.Property(t => t.UsageCount).HasColumnName("usage_count").IsRequired().HasDefaultValue(0);
        builder.Property(t => t.Rating).HasColumnName("rating").IsRequired().HasDefaultValue(0d);
        builder.Property(t => t.Tags).HasColumnName("tags").HasColumnType("text[]").IsRequired().HasDefaultValueSql("ARRAY[]::text[]");
        builder.Property(t => t.SourceSurveyId).HasColumnName("source_survey_id");
        builder.Property(t => t.LastUsed).HasColumnName("last_used");
        builder.Property(t => t.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(t => t.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasOne<User>().WithMany().HasForeignKey(t => t.CreatedBy).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<Company>().WithMany().HasForeignKey(t => t.CompanyId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<Survey>().WithMany().HasForeignKey(t => t.SourceSurveyId).OnDelete(DeleteBehavior.SetNull);
    }
}
```

```csharp
// src/ClimateProject.Infrastructure/Persistence/Configurations/TemplateQuestionConfiguration.cs
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class TemplateQuestionConfiguration : IEntityTypeConfiguration<TemplateQuestion>
{
    public void Configure(EntityTypeBuilder<TemplateQuestion> builder)
    {
        builder.ToTable("template_questions");
        builder.HasKey(q => q.Id);
        builder.Property(q => q.TemplateId).HasColumnName("template_id").IsRequired();
        builder.Property(q => q.Text).HasColumnName("text").HasMaxLength(500).IsRequired();
        builder.Property(q => q.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(q => q.Options).HasColumnName("options").HasColumnType("text[]");
        builder.Property(q => q.ScaleMin).HasColumnName("scale_min");
        builder.Property(q => q.ScaleMax).HasColumnName("scale_max");
        builder.Property(q => q.ScaleLabelMin).HasColumnName("scale_label_min").HasMaxLength(200);
        builder.Property(q => q.ScaleLabelMax).HasColumnName("scale_label_max").HasMaxLength(200);
        builder.Property(q => q.CommentRequired).HasColumnName("comment_required").IsRequired().HasDefaultValue(true);
        builder.Property(q => q.CommentPrompt).HasColumnName("comment_prompt").HasMaxLength(500).IsRequired().HasDefaultValue("Please explain your answer:");
        builder.Property(q => q.BinaryCommentConfig).HasColumnName("binary_comment_config").HasColumnType("jsonb");
        builder.Property(q => q.Required).HasColumnName("required").IsRequired().HasDefaultValue(false);
        builder.Property(q => q.Order).HasColumnName("order").IsRequired();
        builder.Property(q => q.Category).HasColumnName("category").HasMaxLength(100);

        builder.HasOne<SurveyTemplate>().WithMany().HasForeignKey(q => q.TemplateId);
    }
}
```

- [ ] **Step 4: Register the new `DbSet`s**

Add to `ClimateProjectDbContext`, immediately below the Task 1 `DbSet`s:

```csharp
    public DbSet<SurveyTemplate> SurveyTemplates => Set<SurveyTemplate>();
    public DbSet<TemplateQuestion> TemplateQuestions => Set<TemplateQuestion>();
```

- [ ] **Step 5: Write the failing integration test**

```csharp
// tests/ClimateProject.IntegrationTests/Persistence/SurveyTemplateTests.cs
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class SurveyTemplateTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    [Fact]
    public async Task Public_template_with_questions_round_trips()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var template = new SurveyTemplate
        {
            Id = Guid.NewGuid(),
            Name = "Standard Climate Survey",
            Description = "A general climate survey template",
            Category = "climate",
            IsPublic = true,
            Tags = ["climate", "annual"],
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.SurveyTemplates.Add(template);
        await db.SaveChangesAsync();

        db.TemplateQuestions.Add(new TemplateQuestion
        {
            Id = Guid.NewGuid(), TemplateId = template.Id, Text = "How satisfied are you?", Type = "likert",
            ScaleMin = 1, ScaleMax = 5, Order = 0,
        });
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyTemplates.SingleAsync(t => t.Id == template.Id);
        Assert.True(loaded.IsPublic);
        Assert.Equal(["climate", "annual"], loaded.Tags);
        Assert.Equal(0, loaded.UsageCount);
        Assert.Equal(0d, loaded.Rating);

        var question = await readDb.TemplateQuestions.SingleAsync(q => q.TemplateId == template.Id);
        Assert.Equal("likert", question.Type);
        Assert.True(question.CommentRequired);
    }

    [Fact]
    public async Task Company_scoped_template_setnulls_creator_when_user_is_deleted()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "admin@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var template = new SurveyTemplate
        {
            Id = Guid.NewGuid(), Name = "Custom", Description = "Custom template", Category = "custom",
            CreatedBy = user.Id, CompanyId = company.Id,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.SurveyTemplates.Add(template);
        await db.SaveChangesAsync();

        db.Users.Remove(user);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyTemplates.SingleAsync(t => t.Id == template.Id);
        Assert.Null(loaded.CreatedBy);
        Assert.Equal(company.Id, loaded.CompanyId);
    }

    [Fact]
    public async Task Existing_template_and_template_question_rows_without_new_defaults_still_load_with_intended_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var minimalTemplateId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO survey_templates ("Id", name, description, category, created_at, updated_at)
             VALUES ({minimalTemplateId}, {"Minimal"}, {"Minimal desc"}, {"custom"}, {now}, {now})
             """);

        var minimalQuestionId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO template_questions ("Id", template_id, text, type, "order")
             VALUES ({minimalQuestionId}, {minimalTemplateId}, {"Q?"}, {"open_ended"}, {0})
             """);

        await using var readDb = CreateContext();
        var loadedTemplate = await readDb.SurveyTemplates.SingleAsync(t => t.Id == minimalTemplateId);
        Assert.False(loadedTemplate.IsPublic);
        Assert.Equal(0, loadedTemplate.UsageCount);
        Assert.Equal(0d, loadedTemplate.Rating);
        Assert.Empty(loadedTemplate.Tags);
        Assert.Null(loadedTemplate.Industry);
        Assert.Null(loadedTemplate.SourceSurveyId);

        var loadedQuestion = await readDb.TemplateQuestions.SingleAsync(q => q.Id == minimalQuestionId);
        Assert.True(loadedQuestion.CommentRequired);
        Assert.Equal("Please explain your answer:", loadedQuestion.CommentPrompt);
        Assert.False(loadedQuestion.Required);
    }
}
```

- [ ] **Step 6: Run the tests to confirm they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~SurveyTemplateTests"`
Expected: FAIL — `relation "survey_templates" does not exist`.

- [ ] **Step 7: Generate the migration**

```bash
dotnet ef migrations add AddSurveyTemplates \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

- [ ] **Step 8: Verify DB-level defaults**

Confirm the generated migration sets:
- `survey_templates.is_public` → `defaultValue: false`
- `survey_templates.usage_count` → `defaultValue: 0`
- `survey_templates.rating` → `defaultValue: 0d` (or `0.0`)
- `survey_templates.tags` → `defaultValueSql: "ARRAY[]::text[]"`
- `template_questions.comment_required` → `defaultValue: true`
- `template_questions.comment_prompt` → `defaultValue: "Please explain your answer:"`
- `template_questions.required` → `defaultValue: false`

If any default is missing, fix the Fluent config and regenerate (remove + re-add) before proceeding.

- [ ] **Step 9: Run the tests to confirm they pass**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~SurveyTemplateTests"`
Expected: PASS (all 3 tests).

- [ ] **Step 10: Full solution build and test**

```bash
dotnet build ClimateProject.slnx
dotnet test ClimateProject.slnx
```
Expected: 0 warnings, all tests passing.

- [ ] **Step 11: Commit, push, PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/SurveyTemplate.cs \
        src/ClimateProject.Domain/Entities/TemplateQuestion.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyTemplateConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/TemplateQuestionConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
        src/ClimateProject.Infrastructure/Migrations/ \
        tests/ClimateProject.IntegrationTests/Persistence/SurveyTemplateTests.cs
git commit -m "$(cat <<'EOF'
feat: add SurveyTemplate + TemplateQuestion schema

Part of #51 (Surveys domain), sliced from #49.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push -u origin schema/survey-templates

gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: Survey templates schema" \
  --body "$(cat <<'EOF'
## Summary
- Adds `survey_templates` and `template_questions` (real, editable rows mirroring Question's scalar shape — not jsonb).
- Part of #51 (Surveys domain), sliced from #49.

## Test plan
- [x] Round-trip test for public template + template questions
- [x] SetNull-on-delete test for optional creator FK
- [x] Raw-SQL-insert-then-EF-read defaults test
- [x] `dotnet build ClimateProject.slnx` — 0 warnings
- [x] `dotnet test ClimateProject.slnx` — all passing

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch

git checkout main
git pull
```

---

## Task 3: Survey drafts + version history

**Files:**
- Create: `src/ClimateProject.Domain/Entities/SurveyDraft.cs`
- Create: `src/ClimateProject.Domain/Entities/SurveyVersion.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyDraftConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyVersionConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`
- Create: `src/ClimateProject.Infrastructure/Migrations/<timestamp>_AddSurveyDraftsAndVersions.cs`
- Test: `tests/ClimateProject.IntegrationTests/Persistence/SurveyDraftAndVersionTests.cs`

**Interfaces:**
- Consumes: `Company`, `User` (org-structure), `Survey` (`Id: Guid`, Task 1).
- Produces: `SurveyDraft` (`Id: Guid`), `SurveyVersion` (`Id: Guid`, `SurveyId: Guid`, `VersionNumber: int`), `DbSet<T>` properties `SurveyDrafts`, `SurveyVersions`.

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main && git pull
git checkout -b schema/survey-drafts-versions
```

- [ ] **Step 2: Write the `SurveyDraft` and `SurveyVersion` entities**

```csharp
// src/ClimateProject.Domain/Entities/SurveyDraft.cs
namespace ClimateProject.Domain.Entities;

public class SurveyDraft
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid CompanyId { get; set; }
    public required string SessionId { get; set; }
    public int CurrentStep { get; set; } = 1;
    public string? LastEditedField { get; set; }
    public int AutoSaveCount { get; set; }
    public int Version { get; set; } = 1;
    public DateTimeOffset? LastAutosaveAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public bool IsRecovered { get; set; }
    public string? DraftData { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
```

```csharp
// src/ClimateProject.Domain/Entities/SurveyVersion.cs
namespace ClimateProject.Domain.Entities;

public class SurveyVersion
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
    public int VersionNumber { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public string[] Changes { get; set; } = [];
    public required string Reason { get; set; }
    public Guid CreatedBy { get; set; }
    public string? QuestionsSnapshot { get; set; }
    public string? DemographicsSnapshot { get; set; }
    public string? SettingsSnapshot { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
```

- [ ] **Step 3: Write the Fluent configurations**

```csharp
// src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyDraftConfiguration.cs
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyDraftConfiguration : IEntityTypeConfiguration<SurveyDraft>
{
    public void Configure(EntityTypeBuilder<SurveyDraft> builder)
    {
        builder.ToTable("survey_drafts");
        builder.HasKey(d => d.Id);
        builder.Property(d => d.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(d => d.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(d => d.SessionId).HasColumnName("session_id").HasMaxLength(200).IsRequired();
        builder.Property(d => d.CurrentStep).HasColumnName("current_step").IsRequired().HasDefaultValue(1);
        builder.Property(d => d.LastEditedField).HasColumnName("last_edited_field").HasMaxLength(200);
        builder.Property(d => d.AutoSaveCount).HasColumnName("auto_save_count").IsRequired().HasDefaultValue(0);
        builder.Property(d => d.Version).HasColumnName("version").IsRequired().HasDefaultValue(1);
        builder.Property(d => d.LastAutosaveAt).HasColumnName("last_autosave_at");
        builder.Property(d => d.ExpiresAt).HasColumnName("expires_at").IsRequired();
        builder.Property(d => d.IsRecovered).HasColumnName("is_recovered").IsRequired().HasDefaultValue(false);
        builder.Property(d => d.DraftData).HasColumnName("draft_data").HasColumnType("jsonb");
        builder.Property(d => d.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(d => d.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasOne<User>().WithMany().HasForeignKey(d => d.UserId);
        builder.HasOne<Company>().WithMany().HasForeignKey(d => d.CompanyId);
    }
}
```

```csharp
// src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyVersionConfiguration.cs
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyVersionConfiguration : IEntityTypeConfiguration<SurveyVersion>
{
    public void Configure(EntityTypeBuilder<SurveyVersion> builder)
    {
        builder.ToTable("survey_versions");
        builder.HasKey(v => v.Id);
        builder.Property(v => v.SurveyId).HasColumnName("survey_id").IsRequired();
        builder.Property(v => v.VersionNumber).HasColumnName("version_number").IsRequired();
        builder.Property(v => v.Title).HasColumnName("title").HasMaxLength(200).IsRequired();
        builder.Property(v => v.Description).HasColumnName("description").HasMaxLength(1000);
        builder.Property(v => v.Changes).HasColumnName("changes").HasColumnType("text[]").IsRequired().HasDefaultValueSql("ARRAY[]::text[]");
        builder.Property(v => v.Reason).HasColumnName("reason").HasMaxLength(500).IsRequired();
        builder.Property(v => v.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(v => v.QuestionsSnapshot).HasColumnName("questions_snapshot").HasColumnType("jsonb");
        builder.Property(v => v.DemographicsSnapshot).HasColumnName("demographics_snapshot").HasColumnType("jsonb");
        builder.Property(v => v.SettingsSnapshot).HasColumnName("settings_snapshot").HasColumnType("jsonb");
        builder.Property(v => v.CreatedAt).HasColumnName("created_at").IsRequired();

        builder.HasIndex(v => new { v.SurveyId, v.VersionNumber }).IsUnique();

        builder.HasOne<Survey>().WithMany().HasForeignKey(v => v.SurveyId);
        builder.HasOne<User>().WithMany().HasForeignKey(v => v.CreatedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
```

- [ ] **Step 4: Register the new `DbSet`s**

```csharp
    public DbSet<SurveyDraft> SurveyDrafts => Set<SurveyDraft>();
    public DbSet<SurveyVersion> SurveyVersions => Set<SurveyVersion>();
```

- [ ] **Step 5: Write the failing integration test**

```csharp
// tests/ClimateProject.IntegrationTests/Persistence/SurveyDraftAndVersionTests.cs
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class SurveyDraftAndVersionTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user, Survey survey)> SeedSurveyAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "admin@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var survey = new Survey
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, CreatedBy = user.Id, Title = "Survey", Type = "custom",
            StartDate = DateTimeOffset.UtcNow, EndDate = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();
        return (company, user, survey);
    }

    [Fact]
    public async Task Draft_round_trips_with_jsonb_scratchpad()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user, _) = await SeedSurveyAsync(db);

        var draft = new SurveyDraft
        {
            Id = Guid.NewGuid(), UserId = user.Id, CompanyId = company.Id, SessionId = "session-123",
            CurrentStep = 2, AutoSaveCount = 4, Version = 3,
            DraftData = """{"step1_data":{"title":"Draft Title"}}""",
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.SurveyDrafts.Add(draft);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyDrafts.SingleAsync(d => d.Id == draft.Id);
        Assert.Equal(2, loaded.CurrentStep);
        Assert.Equal(3, loaded.Version);
        Assert.Contains("Draft Title", loaded.DraftData);
        Assert.False(loaded.IsRecovered);
    }

    [Fact]
    public async Task Version_history_round_trips_with_snapshots_and_enforces_unique_version_number()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (_, user, survey) = await SeedSurveyAsync(db);

        var version = new SurveyVersion
        {
            Id = Guid.NewGuid(), SurveyId = survey.Id, VersionNumber = 1, Title = survey.Title,
            Changes = ["Initial version"], Reason = "Created", CreatedBy = user.Id,
            QuestionsSnapshot = "[]", SettingsSnapshot = "{}",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.SurveyVersions.Add(version);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyVersions.SingleAsync(v => v.Id == version.Id);
        Assert.Equal(["Initial version"], loaded.Changes);
        Assert.Equal("[]", loaded.QuestionsSnapshot);
        Assert.Null(loaded.DemographicsSnapshot);

        db.SurveyVersions.Add(new SurveyVersion
        {
            Id = Guid.NewGuid(), SurveyId = survey.Id, VersionNumber = 1, Title = survey.Title,
            Reason = "Duplicate version number", CreatedBy = user.Id,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Existing_draft_row_without_new_defaults_still_loads_with_intended_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user, _) = await SeedSurveyAsync(db);

        var minimalDraftId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO survey_drafts ("Id", user_id, company_id, session_id, expires_at, created_at, updated_at)
             VALUES ({minimalDraftId}, {user.Id}, {company.Id}, {"sess-1"}, {now.AddDays(7)}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyDrafts.SingleAsync(d => d.Id == minimalDraftId);
        Assert.Equal(1, loaded.CurrentStep);
        Assert.Equal(0, loaded.AutoSaveCount);
        Assert.Equal(1, loaded.Version);
        Assert.False(loaded.IsRecovered);
        Assert.Null(loaded.DraftData);
    }
}
```

- [ ] **Step 6: Run the tests to confirm they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~SurveyDraftAndVersionTests"`
Expected: FAIL — `relation "survey_drafts" does not exist`.

- [ ] **Step 7: Generate the migration**

```bash
dotnet ef migrations add AddSurveyDraftsAndVersions \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

- [ ] **Step 8: Verify DB-level defaults**

Confirm the generated migration sets:
- `survey_drafts.current_step` → `defaultValue: 1`
- `survey_drafts.auto_save_count` → `defaultValue: 0`
- `survey_drafts.version` → `defaultValue: 1`
- `survey_drafts.is_recovered` → `defaultValue: false`
- `survey_versions.changes` → `defaultValueSql: "ARRAY[]::text[]"`
- A unique index `IX_survey_versions_survey_id_version_number` exists.

If any is missing, fix the Fluent config and regenerate before proceeding.

- [ ] **Step 9: Run the tests to confirm they pass**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~SurveyDraftAndVersionTests"`
Expected: PASS (all 3 tests).

- [ ] **Step 10: Full solution build and test**

```bash
dotnet build ClimateProject.slnx
dotnet test ClimateProject.slnx
```
Expected: 0 warnings, all tests passing.

- [ ] **Step 11: Commit, push, PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/SurveyDraft.cs \
        src/ClimateProject.Domain/Entities/SurveyVersion.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyDraftConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyVersionConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
        src/ClimateProject.Infrastructure/Migrations/ \
        tests/ClimateProject.IntegrationTests/Persistence/SurveyDraftAndVersionTests.cs
git commit -m "$(cat <<'EOF'
feat: add SurveyDraft (autosave wizard state) and SurveyVersion (history) schema

Part of #51 (Surveys domain), sliced from #49.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push -u origin schema/survey-drafts-versions

gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: Survey drafts + version history schema" \
  --body "$(cat <<'EOF'
## Summary
- Adds `survey_drafts` (TTL-expiring wizard scratch-pad, `draft_data` jsonb column only — no scheduled deletion job, out of scope) and `survey_versions` (jsonb snapshot columns for historical shape).
- Part of #51 (Surveys domain), sliced from #49.

## Test plan
- [x] Draft round-trip with jsonb scratchpad
- [x] Version history round-trip with snapshots + unique (survey_id, version_number) constraint
- [x] Raw-SQL-insert-then-EF-read defaults test
- [x] `dotnet build ClimateProject.slnx` — 0 warnings
- [x] `dotnet test ClimateProject.slnx` — all passing

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch

git checkout main
git pull
```

---

## Task 4: Survey distribution + invitations

**Files:**
- Create: `src/ClimateProject.Domain/Entities/SurveyDistribution.cs`
- Create: `src/ClimateProject.Domain/Entities/SurveyInvitation.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyDistributionConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyInvitationConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`
- Create: `src/ClimateProject.Infrastructure/Migrations/<timestamp>_AddSurveyDistributionAndInvitations.cs`
- Test: `tests/ClimateProject.IntegrationTests/Persistence/SurveyDistributionAndInvitationTests.cs`

**Interfaces:**
- Consumes: `Company`, `User` (org-structure), `Survey` (`Id: Guid`, Task 1).
- Produces: `SurveyDistribution` (`Id: Guid`, `SurveyId: Guid` unique, `AccessRules: AccessRules`, `QrCustomization: QrCustomization`), `SurveyInvitation` (`Id: Guid`), `DbSet<T>` properties `SurveyDistributions`, `SurveyInvitations`.

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main && git pull
git checkout -b schema/survey-distribution-invitations
```

- [ ] **Step 2: Write the `SurveyDistribution` (+ owned `AccessRules`/`QrCustomization`) and `SurveyInvitation` entities**

```csharp
// src/ClimateProject.Domain/Entities/SurveyDistribution.cs
namespace ClimateProject.Domain.Entities;

public class SurveyDistribution
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
    public string AccessType { get; set; } = "tokenized";
    public string? PublicUrl { get; set; }
    public required string QrCodeUrl { get; set; }
    public string? QrCodeSvgUrl { get; set; }
    public string? QrCodePngUrl { get; set; }
    public string? QrCodePdfUrl { get; set; }
    public int TokenizedLinksGenerated { get; set; }
    public int RegeneratedCount { get; set; }
    public DateTimeOffset? LastRegeneratedAt { get; set; }
    public Guid? LastRegeneratedBy { get; set; }
    public int TotalAccesses { get; set; }
    public int UniqueVisitors { get; set; }
    public DateTimeOffset? LastAccessedAt { get; set; }
    public AccessRules AccessRules { get; set; } = new();
    public QrCustomization QrCustomization { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class AccessRules
{
    public bool RequireLogin { get; set; } = true;
    public bool AllowAnonymous { get; set; }
    public bool SingleResponse { get; set; } = true;
    public bool ActiveOutsideSchedule { get; set; }
    public string[]? AllowedDomains { get; set; }
    public string[]? BlockedIps { get; set; }
    public int? MaxResponses { get; set; }
}

public class QrCustomization
{
    public string ForegroundColor { get; set; } = "#000000";
    public string BackgroundColor { get; set; } = "#FFFFFF";
    public string? LogoUrl { get; set; }
    public int Size { get; set; } = 300;
}
```

```csharp
// src/ClimateProject.Domain/Entities/SurveyInvitation.cs
namespace ClimateProject.Domain.Entities;

public class SurveyInvitation
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
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

- [ ] **Step 3: Write the Fluent configurations**

```csharp
// src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyDistributionConfiguration.cs
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyDistributionConfiguration : IEntityTypeConfiguration<SurveyDistribution>
{
    public void Configure(EntityTypeBuilder<SurveyDistribution> builder)
    {
        builder.ToTable("survey_distributions");
        builder.HasKey(d => d.Id);
        builder.Property(d => d.SurveyId).HasColumnName("survey_id").IsRequired();
        builder.Property(d => d.AccessType).HasColumnName("access_type").HasMaxLength(20).IsRequired().HasDefaultValue("tokenized");
        builder.Property(d => d.PublicUrl).HasColumnName("public_url").HasMaxLength(500);
        builder.Property(d => d.QrCodeUrl).HasColumnName("qr_code_url").HasMaxLength(500).IsRequired();
        builder.Property(d => d.QrCodeSvgUrl).HasColumnName("qr_code_svg_url").HasMaxLength(500);
        builder.Property(d => d.QrCodePngUrl).HasColumnName("qr_code_png_url").HasMaxLength(500);
        builder.Property(d => d.QrCodePdfUrl).HasColumnName("qr_code_pdf_url").HasMaxLength(500);
        builder.Property(d => d.TokenizedLinksGenerated).HasColumnName("tokenized_links_generated").IsRequired().HasDefaultValue(0);
        builder.Property(d => d.RegeneratedCount).HasColumnName("regenerated_count").IsRequired().HasDefaultValue(0);
        builder.Property(d => d.LastRegeneratedAt).HasColumnName("last_regenerated_at");
        builder.Property(d => d.LastRegeneratedBy).HasColumnName("last_regenerated_by");
        builder.Property(d => d.TotalAccesses).HasColumnName("total_accesses").IsRequired().HasDefaultValue(0);
        builder.Property(d => d.UniqueVisitors).HasColumnName("unique_visitors").IsRequired().HasDefaultValue(0);
        builder.Property(d => d.LastAccessedAt).HasColumnName("last_accessed_at");
        builder.Property(d => d.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(d => d.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(d => d.SurveyId).IsUnique();
        builder.HasIndex(d => d.PublicUrl).IsUnique().HasFilter("public_url IS NOT NULL");

        builder.HasOne<Survey>().WithOne().HasForeignKey<SurveyDistribution>(d => d.SurveyId);
        builder.HasOne<User>().WithMany().HasForeignKey(d => d.LastRegeneratedBy).OnDelete(DeleteBehavior.SetNull);

        builder.OwnsOne(d => d.AccessRules, ar =>
        {
            ar.Property(x => x.RequireLogin).HasColumnName("access_rules_require_login").IsRequired().HasDefaultValue(true);
            ar.Property(x => x.AllowAnonymous).HasColumnName("access_rules_allow_anonymous").IsRequired().HasDefaultValue(false);
            ar.Property(x => x.SingleResponse).HasColumnName("access_rules_single_response").IsRequired().HasDefaultValue(true);
            ar.Property(x => x.ActiveOutsideSchedule).HasColumnName("access_rules_active_outside_schedule").IsRequired().HasDefaultValue(false);
            ar.Property(x => x.AllowedDomains).HasColumnName("access_rules_allowed_domains").HasColumnType("text[]");
            ar.Property(x => x.BlockedIps).HasColumnName("access_rules_blocked_ips").HasColumnType("text[]");
            ar.Property(x => x.MaxResponses).HasColumnName("access_rules_max_responses");
        });

        builder.OwnsOne(d => d.QrCustomization, qr =>
        {
            qr.Property(x => x.ForegroundColor).HasColumnName("qr_customization_foreground_color").HasMaxLength(20).IsRequired().HasDefaultValue("#000000");
            qr.Property(x => x.BackgroundColor).HasColumnName("qr_customization_background_color").HasMaxLength(20).IsRequired().HasDefaultValue("#FFFFFF");
            qr.Property(x => x.LogoUrl).HasColumnName("qr_customization_logo_url").HasMaxLength(500);
            qr.Property(x => x.Size).HasColumnName("qr_customization_size").IsRequired().HasDefaultValue(300);
        });
    }
}
```

```csharp
// src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyInvitationConfiguration.cs
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyInvitationConfiguration : IEntityTypeConfiguration<SurveyInvitation>
{
    public void Configure(EntityTypeBuilder<SurveyInvitation> builder)
    {
        builder.ToTable("survey_invitations");
        builder.HasKey(i => i.Id);
        builder.Property(i => i.SurveyId).HasColumnName("survey_id").IsRequired();
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
        builder.HasIndex(i => new { i.SurveyId, i.UserId }).IsUnique();

        builder.HasOne<Survey>().WithMany().HasForeignKey(i => i.SurveyId);
        builder.HasOne<User>().WithMany().HasForeignKey(i => i.UserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Company>().WithMany().HasForeignKey(i => i.CompanyId);
    }
}
```

- [ ] **Step 4: Register the new `DbSet`s**

```csharp
    public DbSet<SurveyDistribution> SurveyDistributions => Set<SurveyDistribution>();
    public DbSet<SurveyInvitation> SurveyInvitations => Set<SurveyInvitation>();
```

- [ ] **Step 5: Write the failing integration test**

```csharp
// tests/ClimateProject.IntegrationTests/Persistence/SurveyDistributionAndInvitationTests.cs
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class SurveyDistributionAndInvitationTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user, Survey survey)> SeedSurveyAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "admin@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var survey = new Survey
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, CreatedBy = user.Id, Title = "Survey", Type = "custom",
            StartDate = DateTimeOffset.UtcNow, EndDate = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();
        return (company, user, survey);
    }

    [Fact]
    public async Task Distribution_round_trips_with_owned_access_rules_and_qr_customization()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (_, user, survey) = await SeedSurveyAsync(db);

        var distribution = new SurveyDistribution
        {
            Id = Guid.NewGuid(), SurveyId = survey.Id, QrCodeUrl = "https://example.test/qr/abc",
            AccessRules = new AccessRules { AllowAnonymous = true, AllowedDomains = ["acme.test"] },
            QrCustomization = new QrCustomization { ForegroundColor = "#123456" },
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.SurveyDistributions.Add(distribution);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyDistributions.SingleAsync(d => d.SurveyId == survey.Id);
        Assert.Equal("tokenized", loaded.AccessType);
        Assert.True(loaded.AccessRules.AllowAnonymous);
        Assert.True(loaded.AccessRules.RequireLogin);
        Assert.Equal(["acme.test"], loaded.AccessRules.AllowedDomains);
        Assert.Equal("#123456", loaded.QrCustomization.ForegroundColor);
        Assert.Equal("#FFFFFF", loaded.QrCustomization.BackgroundColor);
        Assert.Equal(300, loaded.QrCustomization.Size);
    }

    [Fact]
    public async Task Invitation_round_trips_and_enforces_unique_token_and_unique_survey_user_pair()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user, survey) = await SeedSurveyAsync(db);

        var invitation = new SurveyInvitation
        {
            Id = Guid.NewGuid(), SurveyId = survey.Id, UserId = user.Id, CompanyId = company.Id,
            Email = user.Email, InvitationToken = "tok-abc-123",
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(14),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.SurveyInvitations.Add(invitation);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyInvitations.SingleAsync(i => i.Id == invitation.Id);
        Assert.Equal("pending", loaded.Status);
        Assert.Equal(0, loaded.ReminderCount);

        db.SurveyInvitations.Add(new SurveyInvitation
        {
            Id = Guid.NewGuid(), SurveyId = survey.Id, UserId = user.Id, CompanyId = company.Id,
            Email = user.Email, InvitationToken = "tok-different",
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(14),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Existing_distribution_row_without_new_owned_defaults_still_loads_with_intended_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (_, _, survey) = await SeedSurveyAsync(db);

        var minimalDistributionId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO survey_distributions ("Id", survey_id, qr_code_url, created_at, updated_at)
             VALUES ({minimalDistributionId}, {survey.Id}, {"https://example.test/qr/minimal"}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyDistributions.SingleAsync(d => d.Id == minimalDistributionId);
        Assert.Equal("tokenized", loaded.AccessType);
        Assert.True(loaded.AccessRules.RequireLogin);
        Assert.False(loaded.AccessRules.AllowAnonymous);
        Assert.True(loaded.AccessRules.SingleResponse);
        Assert.False(loaded.AccessRules.ActiveOutsideSchedule);
        Assert.Equal("#000000", loaded.QrCustomization.ForegroundColor);
        Assert.Equal("#FFFFFF", loaded.QrCustomization.BackgroundColor);
        Assert.Equal(300, loaded.QrCustomization.Size);
        Assert.Equal(0, loaded.TokenizedLinksGenerated);
        Assert.Equal(0, loaded.TotalAccesses);
    }
}
```

- [ ] **Step 6: Run the tests to confirm they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~SurveyDistributionAndInvitationTests"`
Expected: FAIL — `relation "survey_distributions" does not exist`.

- [ ] **Step 7: Generate the migration**

```bash
dotnet ef migrations add AddSurveyDistributionAndInvitations \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

- [ ] **Step 8: Verify DB-level defaults**

Confirm the generated migration sets:
- `survey_distributions.access_type` → `defaultValue: "tokenized"`
- `survey_distributions.access_rules_require_login` → `defaultValue: true`
- `survey_distributions.access_rules_allow_anonymous` → `defaultValue: false`
- `survey_distributions.access_rules_single_response` → `defaultValue: true`
- `survey_distributions.access_rules_active_outside_schedule` → `defaultValue: false`
- `survey_distributions.qr_customization_foreground_color` → `defaultValue: "#000000"`
- `survey_distributions.qr_customization_background_color` → `defaultValue: "#FFFFFF"`
- `survey_distributions.qr_customization_size` → `defaultValue: 300`
- `survey_distributions.tokenized_links_generated`, `regenerated_count`, `total_accesses`, `unique_visitors` → `defaultValue: 0`
- `survey_invitations.status` → `defaultValue: "pending"`
- `survey_invitations.reminder_count` → `defaultValue: 0`
- Unique indexes on `survey_distributions.survey_id`, `survey_invitations.invitation_token`, and `(survey_invitations.survey_id, survey_invitations.user_id)`.

If any is missing, fix the Fluent config and regenerate before proceeding.

- [ ] **Step 9: Run the tests to confirm they pass**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~SurveyDistributionAndInvitationTests"`
Expected: PASS (all 3 tests).

- [ ] **Step 10: Full solution build and test**

```bash
dotnet build ClimateProject.slnx
dotnet test ClimateProject.slnx
```
Expected: 0 warnings, all tests passing.

- [ ] **Step 11: Commit, push, PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/SurveyDistribution.cs \
        src/ClimateProject.Domain/Entities/SurveyInvitation.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyDistributionConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyInvitationConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
        src/ClimateProject.Infrastructure/Migrations/ \
        tests/ClimateProject.IntegrationTests/Persistence/SurveyDistributionAndInvitationTests.cs
git commit -m "$(cat <<'EOF'
feat: add SurveyDistribution (QR/access rules) and SurveyInvitation schema

Part of #51 (Surveys domain), sliced from #49.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push -u origin schema/survey-distribution-invitations

gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: Survey distribution + invitations schema" \
  --body "$(cat <<'EOF'
## Summary
- Adds `survey_distributions` (1:1 with `surveys`, owned `AccessRules` + `QrCustomization`) and `survey_invitations`.
- Part of #51 (Surveys domain), sliced from #49.

## Test plan
- [x] Distribution round-trip with owned AccessRules + QrCustomization
- [x] Invitation round-trip + unique token + unique (survey_id, user_id) constraint tests
- [x] Raw-SQL-insert-then-EF-read defaults test
- [x] `dotnet build ClimateProject.slnx` — 0 warnings
- [x] `dotnet test ClimateProject.slnx` — all passing

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch

git checkout main
git pull
```

---

## Task 5: Survey audit logs + responses

**Files:**
- Create: `src/ClimateProject.Domain/Entities/SurveyAuditLog.cs`
- Create: `src/ClimateProject.Domain/Entities/Response.cs`
- Create: `src/ClimateProject.Domain/Entities/QuestionResponse.cs`
- Create: `src/ClimateProject.Domain/Entities/ResponseDemographic.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyAuditLogConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/ResponseConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/QuestionResponseConfiguration.cs`
- Create: `src/ClimateProject.Infrastructure/Persistence/Configurations/ResponseDemographicConfiguration.cs`
- Modify: `src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs`
- Create: `src/ClimateProject.Infrastructure/Migrations/<timestamp>_AddSurveyAuditLogsAndResponses.cs`
- Test: `tests/ClimateProject.IntegrationTests/Persistence/SurveyAuditLogAndResponseTests.cs`

**Interfaces:**
- Consumes: `Company`, `User`, `Department` (org-structure), `Survey`, `Question` (`Id: Guid`, Task 1).
- Produces: `SurveyAuditLog` (`Id: Guid`), `Response` (`Id: Guid`), `QuestionResponse` (`ResponseId: Guid`, `QuestionId: Guid` — composite PK), `ResponseDemographic` (`ResponseId: Guid`, `Field: string` — composite PK), `DbSet<T>` properties `SurveyAuditLogs`, `Responses`, `QuestionResponses`, `ResponseDemographics`.

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api
git checkout main && git pull
git checkout -b schema/survey-audit-responses
```

- [ ] **Step 2: Write the `SurveyAuditLog`, `Response`, `QuestionResponse`, `ResponseDemographic` entities**

```csharp
// src/ClimateProject.Domain/Entities/SurveyAuditLog.cs
namespace ClimateProject.Domain.Entities;

public class SurveyAuditLog
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
    public required string Action { get; set; }
    public required string EntityType { get; set; }
    public string? EntityId { get; set; }
    public string? Changes { get; set; }
    public Guid UserId { get; set; }
    public required string UserName { get; set; }
    public required string UserEmail { get; set; }
    public required string UserRole { get; set; }
    public DateTimeOffset Timestamp { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public string? SessionId { get; set; }
    public string? Metadata { get; set; }
}
```

```csharp
// src/ClimateProject.Domain/Entities/Response.cs
namespace ClimateProject.Domain.Entities;

public class Response
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
    public Guid? UserId { get; set; }
    public required string SessionId { get; set; }
    public Guid CompanyId { get; set; }
    public Guid? DepartmentId { get; set; }
    public bool IsComplete { get; set; }
    public bool IsAnonymous { get; set; }
    public DateTimeOffset StartTime { get; set; }
    public DateTimeOffset? CompletionTime { get; set; }
    public int? TotalTimeSeconds { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
```

```csharp
// src/ClimateProject.Domain/Entities/QuestionResponse.cs
namespace ClimateProject.Domain.Entities;

public class QuestionResponse
{
    public Guid ResponseId { get; set; }
    public Guid QuestionId { get; set; }
    public required string ResponseValue { get; set; }
    public string? ResponseText { get; set; }
    public int? TimeSpentSeconds { get; set; }
}
```

```csharp
// src/ClimateProject.Domain/Entities/ResponseDemographic.cs
namespace ClimateProject.Domain.Entities;

public class ResponseDemographic
{
    public Guid ResponseId { get; set; }
    public required string Field { get; set; }
    public required string Value { get; set; }
}
```

- [ ] **Step 3: Write the Fluent configurations**

```csharp
// src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyAuditLogConfiguration.cs
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyAuditLogConfiguration : IEntityTypeConfiguration<SurveyAuditLog>
{
    public void Configure(EntityTypeBuilder<SurveyAuditLog> builder)
    {
        builder.ToTable("survey_audit_logs");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.SurveyId).HasColumnName("survey_id").IsRequired();
        builder.Property(a => a.Action).HasColumnName("action").HasMaxLength(30).IsRequired();
        builder.Property(a => a.EntityType).HasColumnName("entity_type").HasMaxLength(20).IsRequired();
        builder.Property(a => a.EntityId).HasColumnName("entity_id").HasMaxLength(100);
        builder.Property(a => a.Changes).HasColumnName("changes").HasColumnType("jsonb");
        builder.Property(a => a.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(a => a.UserName).HasColumnName("user_name").HasMaxLength(200).IsRequired();
        builder.Property(a => a.UserEmail).HasColumnName("user_email").HasMaxLength(255).IsRequired();
        builder.Property(a => a.UserRole).HasColumnName("user_role").HasMaxLength(32).IsRequired();
        builder.Property(a => a.Timestamp).HasColumnName("timestamp").IsRequired();
        builder.Property(a => a.IpAddress).HasColumnName("ip_address").HasMaxLength(64);
        builder.Property(a => a.UserAgent).HasColumnName("user_agent").HasMaxLength(500);
        builder.Property(a => a.SessionId).HasColumnName("session_id").HasMaxLength(200);
        builder.Property(a => a.Metadata).HasColumnName("metadata").HasColumnType("jsonb");

        builder.HasIndex(a => new { a.SurveyId, a.Timestamp });

        builder.HasOne<Survey>().WithMany().HasForeignKey(a => a.SurveyId);
        builder.HasOne<User>().WithMany().HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}
```

```csharp
// src/ClimateProject.Infrastructure/Persistence/Configurations/ResponseConfiguration.cs
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ResponseConfiguration : IEntityTypeConfiguration<Response>
{
    public void Configure(EntityTypeBuilder<Response> builder)
    {
        builder.ToTable("responses");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.SurveyId).HasColumnName("survey_id").IsRequired();
        builder.Property(r => r.UserId).HasColumnName("user_id");
        builder.Property(r => r.SessionId).HasColumnName("session_id").HasMaxLength(200).IsRequired();
        builder.Property(r => r.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(r => r.DepartmentId).HasColumnName("department_id");
        builder.Property(r => r.IsComplete).HasColumnName("is_complete").IsRequired().HasDefaultValue(false);
        builder.Property(r => r.IsAnonymous).HasColumnName("is_anonymous").IsRequired().HasDefaultValue(false);
        builder.Property(r => r.StartTime).HasColumnName("start_time").IsRequired();
        builder.Property(r => r.CompletionTime).HasColumnName("completion_time");
        builder.Property(r => r.TotalTimeSeconds).HasColumnName("total_time_seconds");
        builder.Property(r => r.IpAddress).HasColumnName("ip_address").HasMaxLength(64);
        builder.Property(r => r.UserAgent).HasColumnName("user_agent").HasMaxLength(500);
        builder.Property(r => r.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(r => r.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasOne<Survey>().WithMany().HasForeignKey(r => r.SurveyId);
        builder.HasOne<User>().WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<Company>().WithMany().HasForeignKey(r => r.CompanyId);
        builder.HasOne<Department>().WithMany().HasForeignKey(r => r.DepartmentId).OnDelete(DeleteBehavior.SetNull);
    }
}
```

```csharp
// src/ClimateProject.Infrastructure/Persistence/Configurations/QuestionResponseConfiguration.cs
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class QuestionResponseConfiguration : IEntityTypeConfiguration<QuestionResponse>
{
    public void Configure(EntityTypeBuilder<QuestionResponse> builder)
    {
        builder.ToTable("question_responses");
        builder.HasKey(qr => new { qr.ResponseId, qr.QuestionId });
        builder.Property(qr => qr.ResponseId).HasColumnName("response_id");
        builder.Property(qr => qr.QuestionId).HasColumnName("question_id");
        builder.Property(qr => qr.ResponseValue).HasColumnName("response_value").HasColumnType("jsonb").IsRequired();
        builder.Property(qr => qr.ResponseText).HasColumnName("response_text").HasColumnType("text");
        builder.Property(qr => qr.TimeSpentSeconds).HasColumnName("time_spent_seconds");

        builder.HasOne<Response>().WithMany().HasForeignKey(qr => qr.ResponseId);
        builder.HasOne<Question>().WithMany().HasForeignKey(qr => qr.QuestionId).OnDelete(DeleteBehavior.Restrict);
    }
}
```

```csharp
// src/ClimateProject.Infrastructure/Persistence/Configurations/ResponseDemographicConfiguration.cs
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ResponseDemographicConfiguration : IEntityTypeConfiguration<ResponseDemographic>
{
    public void Configure(EntityTypeBuilder<ResponseDemographic> builder)
    {
        builder.ToTable("response_demographics");
        builder.HasKey(rd => new { rd.ResponseId, rd.Field });
        builder.Property(rd => rd.ResponseId).HasColumnName("response_id");
        builder.Property(rd => rd.Field).HasColumnName("field").HasMaxLength(100);
        builder.Property(rd => rd.Value).HasColumnName("value").HasColumnType("jsonb").IsRequired();

        builder.HasOne<Response>().WithMany().HasForeignKey(rd => rd.ResponseId);
    }
}
```

- [ ] **Step 4: Register the new `DbSet`s**

```csharp
    public DbSet<SurveyAuditLog> SurveyAuditLogs => Set<SurveyAuditLog>();
    public DbSet<Response> Responses => Set<Response>();
    public DbSet<QuestionResponse> QuestionResponses => Set<QuestionResponse>();
    public DbSet<ResponseDemographic> ResponseDemographics => Set<ResponseDemographic>();
```

- [ ] **Step 5: Write the failing integration test**

```csharp
// tests/ClimateProject.IntegrationTests/Persistence/SurveyAuditLogAndResponseTests.cs
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class SurveyAuditLogAndResponseTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user, Survey survey, Question question)> SeedSurveyWithQuestionAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "admin@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var survey = new Survey
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, CreatedBy = user.Id, Title = "Survey", Type = "custom",
            StartDate = DateTimeOffset.UtcNow, EndDate = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        var question = new Question { Id = Guid.NewGuid(), SurveyId = survey.Id, Text = "Q1?", Type = "open_ended", Order = 0 };
        db.Questions.Add(question);
        await db.SaveChangesAsync();

        return (company, user, survey, question);
    }

    [Fact]
    public async Task Audit_log_round_trips_with_jsonb_changes()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (_, user, survey, _) = await SeedSurveyWithQuestionAsync(db);

        var entry = new SurveyAuditLog
        {
            Id = Guid.NewGuid(), SurveyId = survey.Id, Action = "published", EntityType = "survey",
            Changes = """{"before":{"status":"draft"},"after":{"status":"active"}}""",
            UserId = user.Id, UserName = user.Name, UserEmail = user.Email, UserRole = user.Role,
            Timestamp = DateTimeOffset.UtcNow,
        };
        db.SurveyAuditLogs.Add(entry);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyAuditLogs.SingleAsync(a => a.Id == entry.Id);
        Assert.Equal("published", loaded.Action);
        Assert.Contains("active", loaded.Changes);
    }

    [Fact]
    public async Task Response_with_question_responses_and_demographics_round_trips()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user, survey, question) = await SeedSurveyWithQuestionAsync(db);

        var response = new Response
        {
            Id = Guid.NewGuid(), SurveyId = survey.Id, UserId = user.Id, SessionId = "sess-xyz",
            CompanyId = company.Id, StartTime = DateTimeOffset.UtcNow,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Responses.Add(response);
        await db.SaveChangesAsync();

        db.QuestionResponses.Add(new QuestionResponse
        {
            ResponseId = response.Id, QuestionId = question.Id, ResponseValue = "\"Great experience\"",
        });
        db.ResponseDemographics.Add(new ResponseDemographic
        {
            ResponseId = response.Id, Field = "tenure_months", Value = "18",
        });
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedResponse = await readDb.Responses.SingleAsync(r => r.Id == response.Id);
        Assert.False(loadedResponse.IsComplete);
        Assert.False(loadedResponse.IsAnonymous);

        var loadedAnswer = await readDb.QuestionResponses.SingleAsync(qr => qr.ResponseId == response.Id);
        Assert.Equal("\"Great experience\"", loadedAnswer.ResponseValue);

        var loadedDemographic = await readDb.ResponseDemographics.SingleAsync(rd => rd.ResponseId == response.Id);
        Assert.Equal("18", loadedDemographic.Value);
    }

    [Fact]
    public async Task Existing_response_row_without_new_defaults_still_loads_with_intended_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user, survey, _) = await SeedSurveyWithQuestionAsync(db);

        var minimalResponseId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO responses ("Id", survey_id, session_id, company_id, start_time, created_at, updated_at)
             VALUES ({minimalResponseId}, {survey.Id}, {"sess-minimal"}, {company.Id}, {now}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.Responses.SingleAsync(r => r.Id == minimalResponseId);
        Assert.False(loaded.IsComplete);
        Assert.False(loaded.IsAnonymous);
        Assert.Null(loaded.UserId);
        Assert.Null(loaded.DepartmentId);
    }
}
```

- [ ] **Step 6: Run the tests to confirm they fail**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~SurveyAuditLogAndResponseTests"`
Expected: FAIL — `relation "survey_audit_logs" does not exist`.

- [ ] **Step 7: Generate the migration**

```bash
dotnet ef migrations add AddSurveyAuditLogsAndResponses \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --output-dir Migrations
```

- [ ] **Step 8: Verify DB-level defaults**

Confirm the generated migration sets:
- `responses.is_complete` → `defaultValue: false`
- `responses.is_anonymous` → `defaultValue: false`
- FK `question_responses.question_id` → `Question` uses `onDelete: ReferentialAction.Restrict`.
- FK `survey_audit_logs.user_id` → `User` uses `onDelete: ReferentialAction.Restrict`.
- FK `responses.user_id` and `responses.department_id` use `onDelete: ReferentialAction.SetNull`.

If any is missing, fix the Fluent config and regenerate before proceeding.

- [ ] **Step 9: Run the tests to confirm they pass**

Run: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~SurveyAuditLogAndResponseTests"`
Expected: PASS (all 3 tests).

- [ ] **Step 10: Full solution build and test**

```bash
dotnet build ClimateProject.slnx
dotnet test ClimateProject.slnx
```
Expected: 0 warnings, all tests (every prior task's tests + these 3) passing. This is the final task in the Surveys domain slice, so this is also the point to confirm the whole domain's schema compiles and round-trips together.

- [ ] **Step 11: Commit, push, PR, merge**

```bash
git add src/ClimateProject.Domain/Entities/SurveyAuditLog.cs \
        src/ClimateProject.Domain/Entities/Response.cs \
        src/ClimateProject.Domain/Entities/QuestionResponse.cs \
        src/ClimateProject.Domain/Entities/ResponseDemographic.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/SurveyAuditLogConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/ResponseConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/QuestionResponseConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/Configurations/ResponseDemographicConfiguration.cs \
        src/ClimateProject.Infrastructure/Persistence/ClimateProjectDbContext.cs \
        src/ClimateProject.Infrastructure/Migrations/ \
        tests/ClimateProject.IntegrationTests/Persistence/SurveyAuditLogAndResponseTests.cs
git commit -m "$(cat <<'EOF'
feat: add SurveyAuditLog and Response/QuestionResponse/ResponseDemographic schema

Completes the #51 Surveys domain schema slice of the #49 data-model epic.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push -u origin schema/survey-audit-responses

gh pr create --repo TIMSInternational/climate-project-api \
  --title "feat: Survey audit logs + responses schema" \
  --body "$(cat <<'EOF'
## Summary
- Adds `survey_audit_logs` (append-only, high write volume) and `responses` / `question_responses` (polymorphic jsonb `response_value`) / `response_demographics`.
- Completes #51 (Surveys domain), sliced from #49.

## Test plan
- [x] Audit log round-trip with jsonb changes
- [x] Response + question_responses + response_demographics round-trip
- [x] Raw-SQL-insert-then-EF-read defaults test
- [x] `dotnet build ClimateProject.slnx` — 0 warnings
- [x] `dotnet test ClimateProject.slnx` — all passing

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

gh pr merge --repo TIMSInternational/climate-project-api --squash --delete-branch

git checkout main
git pull
```

---

## Spec coverage checklist (self-review)

| Spec item (#49 Surveys) | Task | Covered by |
|---|---|---|
| `surveys` + `survey_settings` (owned, flattened) | 1 | `Survey`, `SurveySettings`, `SurveyConfiguration` |
| `survey_department_targets` junction | 1 | `SurveyDepartmentTarget` |
| `questions` | 1 | `Question`, `QuestionConfiguration` |
| `question_conditional_logic` (nullable 1:1) | 1 | `QuestionConditionalLogic` (shared-PK child table, not owned type) |
| `question_emoji_options` (ordered junction) | 1 | `QuestionEmojiOption` (composite PK incl. `Order`) |
| `survey_templates` | 2 | `SurveyTemplate` |
| `template_questions` (real rows, not jsonb) | 2 | `TemplateQuestion` |
| `survey_drafts` (+ `draft_data` jsonb, no TTL job) | 3 | `SurveyDraft` |
| `survey_versions` (+ 3 jsonb snapshot columns) | 3 | `SurveyVersion` |
| `survey_distributions` + `access_rules` (owned) + `qr_customization` (owned) | 4 | `SurveyDistribution`, `AccessRules`, `QrCustomization` |
| `survey_invitations` | 4 | `SurveyInvitation` |
| `survey_audit_logs` (append-only) | 5 | `SurveyAuditLog` |
| `responses` / `question_responses` / `response_demographics` | 5 | `Response`, `QuestionResponse`, `ResponseDemographic` |
| Question repository tables (QuestionBank/Library/Category/LibraryQuestion/Pool) | — | Explicitly excluded per task brief |
