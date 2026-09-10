using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace ClimateProject.IntegrationTests.Persistence;

/// <summary>
/// The #210 migration (<c>AddAuthorContentI18n</c>), proven the way the house rule asks:
/// raw-SQL insert, then EF read. An EF-insert-then-read passes even when the columns are
/// wrong, because EF writes what it reads.
///
/// <para>
/// Two of these tests migrate the shared database DOWN to the migration before #210 and
/// back UP. That is safe inside the "Postgres" collection, which xUnit runs one class at a
/// time, and every test here leaves the schema at the latest migration on the way out --
/// the second half of the round trip is part of the assertion, not clean-up. One side
/// effect is accepted and named: rows other classes left behind cross the round trip too,
/// so a Spanish-only row owned by an English company comes back filed under <c>_en</c>.
/// Every class here seeds its own companies and reads only its own rows, so nothing
/// observes that; a class that ever shares rows across the collection would.
/// </para>
/// </summary>
[Collection("Postgres")]
public class AuthorContentI18nMigrationTests(PostgresContainerFixture postgres)
{
    private const string PreviousMigration = "20260902191612_SchemaReviewDeleteBehaviourFixes";

    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    [Fact]
    public async Task A_template_inserted_by_raw_SQL_in_Spanish_only_reads_back_with_a_null_English_half()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var id = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO survey_templates ("Id", name_es, description_es, category, created_at, updated_at)
             VALUES ({id}, {"Instrumento de clima"}, {"Línea base"}, {"general_climate"}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyTemplates.SingleAsync(t => t.Id == id);

        // The nullability is the point: a NOT NULL English half would have forced an empty
        // string into it, which is the "untranslated string" the requirement forbids.
        Assert.Null(loaded.NameEn);
        Assert.Equal("Instrumento de clima", loaded.NameEs);
        Assert.Null(loaded.DescriptionEn);
        Assert.Equal("Línea base", loaded.DescriptionEs);
    }

    [Fact]
    public async Task A_kpi_and_a_report_inserted_by_raw_SQL_carry_both_halves_independently()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var now = DateTimeOffset.UtcNow;
        var companyId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var planId = Guid.NewGuid();
        var kpiId = Guid.NewGuid();
        var reportId = Guid.NewGuid();

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""INSERT INTO companies ("Id", name, created_at) VALUES ({companyId}, {"Raw Co"}, {now})""");
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO users ("Id", company_id, email, name, role, is_active, created_at, updated_at)
             VALUES ({userId}, {companyId}, {$"raw-{Guid.NewGuid():N}@raw.test"}, {"Raw"}, {"company_admin"}, {true}, {now}, {now})
             """);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO action_plans ("Id", title_en, title_es, description_en, company_id, created_by, due_date, created_at, updated_at)
             VALUES ({planId}, {"Onboarding"}, {"Incorporación"}, {"Reduce ramp-up"}, {companyId}, {userId}, {now.AddDays(30)}, {now}, {now})
             """);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO action_plan_kpis ("Id", action_plan_id, name_en, unit_es, target_value, measurement_frequency)
             VALUES ({kpiId}, {planId}, {"Time to productivity"}, {"días"}, {30m}, {"weekly"})
             """);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO reports ("Id", title_es, type, company_id, created_by, format, created_at, updated_at)
             VALUES ({reportId}, {"Informe trimestral"}, {"climate_summary"}, {companyId}, {userId}, {"pdf"}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var plan = await readDb.ActionPlans.SingleAsync(p => p.Id == planId);
        var kpi = await readDb.ActionPlanKpis.SingleAsync(k => k.Id == kpiId);
        var report = await readDb.Reports.SingleAsync(r => r.Id == reportId);

        Assert.Equal(("Onboarding", "Incorporación", "Reduce ramp-up", null), (plan.TitleEn, plan.TitleEs, plan.DescriptionEn, plan.DescriptionEs));
        Assert.Equal(("Time to productivity", null, null, "días"), (kpi.NameEn, kpi.NameEs, kpi.UnitEn, kpi.UnitEs));
        Assert.Equal((null, "Informe trimestral"), (report.TitleEn, report.TitleEs));
    }

    [Fact]
    public async Task Migrating_up_files_a_Spanish_companys_rows_under_es_and_leaves_every_other_row_in_en()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var migrator = db.GetService<IMigrator>();

        // Back to the schema #210 found: one `name` column, NOT NULL.
        await migrator.MigrateAsync(PreviousMigration);

        var now = DateTimeOffset.UtcNow;
        var esCompany = Guid.NewGuid();
        var enCompany = Guid.NewGuid();
        var esTemplate = Guid.NewGuid();
        var enTemplate = Guid.NewGuid();
        var globalTemplate = Guid.NewGuid();
        var esUser = Guid.NewGuid();
        var esPlan = Guid.NewGuid();
        var esKpi = Guid.NewGuid();

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""INSERT INTO companies ("Id", name, settings_language, created_at) VALUES ({esCompany}, {"ES Co"}, {"es"}, {now})""");
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""INSERT INTO companies ("Id", name, settings_language, created_at) VALUES ({enCompany}, {"EN Co"}, {"en"}, {now})""");
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO survey_templates ("Id", name, description, category, company_id, created_at, updated_at)
             VALUES ({esTemplate}, {"Plantilla"}, {"Descripción"}, {"general_climate"}, {esCompany}, {now}, {now})
             """);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO survey_templates ("Id", name, description, category, company_id, created_at, updated_at)
             VALUES ({enTemplate}, {"Template"}, {"Description"}, {"general_climate"}, {enCompany}, {now}, {now})
             """);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO survey_templates ("Id", name, description, category, created_at, updated_at)
             VALUES ({globalTemplate}, {"Global"}, {"Everyone's"}, {"general_climate"}, {now}, {now})
             """);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO users ("Id", company_id, email, name, role, is_active, created_at, updated_at)
             VALUES ({esUser}, {esCompany}, {$"mig-{Guid.NewGuid():N}@es.test"}, {"Mig"}, {"company_admin"}, {true}, {now}, {now})
             """);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO action_plans ("Id", title, description, company_id, created_by, due_date, created_at, updated_at)
             VALUES ({esPlan}, {"Plan"}, {"Detalle"}, {esCompany}, {esUser}, {now.AddDays(30)}, {now}, {now})
             """);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO action_plan_kpis ("Id", action_plan_id, name, unit, target_value, measurement_frequency)
             VALUES ({esKpi}, {esPlan}, {"Indicador"}, {"días"}, {10m}, {"weekly"})
             """);

        // Forward again -- the migration under test, over rows that exist.
        await migrator.MigrateAsync();

        await using var readDb = CreateContext();
        var es = await readDb.SurveyTemplates.SingleAsync(t => t.Id == esTemplate);
        var en = await readDb.SurveyTemplates.SingleAsync(t => t.Id == enTemplate);
        var global = await readDb.SurveyTemplates.SingleAsync(t => t.Id == globalTemplate);
        var plan = await readDb.ActionPlans.SingleAsync(p => p.Id == esPlan);
        var kpi = await readDb.ActionPlanKpis.SingleAsync(k => k.Id == esKpi);

        // The Spanish company's rows moved -- including the ones that reach the company
        // only through their parent.
        Assert.Equal((null, "Plantilla", null, "Descripción"), (es.NameEn, es.NameEs, es.DescriptionEn, es.DescriptionEs));
        Assert.Equal((null, "Plan", null, "Detalle"), (plan.TitleEn, plan.TitleEs, plan.DescriptionEn, plan.DescriptionEs));
        Assert.Equal((null, "Indicador", null, "días"), (kpi.NameEn, kpi.NameEs, kpi.UnitEn, kpi.UnitEs));

        // An English company's rows and a global row stayed where the rename put them.
        Assert.Equal(("Template", null), (en.NameEn, en.NameEs));
        Assert.Equal(("Global", null), (global.NameEn, global.NameEs));
    }

    [Fact]
    public async Task Migrating_down_keeps_a_Spanish_only_rows_text_and_the_round_trip_is_lossless()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var migrator = db.GetService<IMigrator>();

        var now = DateTimeOffset.UtcNow;
        var esCompany = Guid.NewGuid();
        var esTemplate = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""INSERT INTO companies ("Id", name, settings_language, created_at) VALUES ({esCompany}, {"ES Co"}, {"es"}, {now})""");
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO survey_templates ("Id", name_es, description_es, category, company_id, created_at, updated_at)
             VALUES ({esTemplate}, {"Sólo en español"}, {"Descripción"}, {"general_climate"}, {esCompany}, {now}, {now})
             """);

        await migrator.MigrateAsync(PreviousMigration);

        // On the old schema the single column must hold the text, not an empty string.
        var single = await db.Database
            .SqlQuery<string>($"""SELECT name AS "Value" FROM survey_templates WHERE "Id" = {esTemplate}""")
            .SingleAsync();
        Assert.Equal("Sólo en español", single);

        await migrator.MigrateAsync();

        await using var readDb = CreateContext();
        var back = await readDb.SurveyTemplates.SingleAsync(t => t.Id == esTemplate);
        Assert.Equal((null, "Sólo en español"), (back.NameEn, back.NameEs));
    }
}
