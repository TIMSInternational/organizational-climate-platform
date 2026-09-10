using Microsoft.EntityFrameworkCore.Migrations;
using NpgsqlTypes;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAuthorContentI18n : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Author-facing content i18n (#210) -- Tier 2 of #195, the same mechanism as
            // AddContentI18n: each existing column becomes its _en half, keeps its rows, loses
            // its NOT NULL (a Spanish-only template has no English name, and an empty string
            // there is exactly the "untranslated string" the requirement forbids), and gains an
            // _es half beside it. Up/Down are hand-written for the reason that migration gives:
            // the scaffold paired every dropped column with an added one positionally, which
            // empties every table below on the way through.
            //
            // The one thing this migration does that AddContentI18n did not: after the rename
            // it moves the text of rows owned by a company whose language is 'es' into the _es
            // half. AddContentI18n ran against an empty production database; this one runs
            // against a populated one, and "attribute a bare string to the content's own
            // language" is the rule the write side applies to every row created from now on.
            // Rows owned by an 'en' or 'both' company, and global rows, stay in _en -- which is
            // what the write side would do for them today.

            // ---- 0. The generated search vectors go first --------------------------------
            // They are STORED columns computed over `title`/`description`. A rename would carry
            // them along, but they would then index only the _en half; they are rebuilt over
            // both halves at the end, and dropped here so no step below has to reason about
            // a dependency.
            migrationBuilder.DropIndex(name: "IX_action_plans_search_vector", table: "action_plans");
            migrationBuilder.DropColumn(name: "search_vector", table: "action_plans");
            migrationBuilder.DropIndex(name: "IX_reports_search_vector", table: "reports");
            migrationBuilder.DropColumn(name: "search_vector", table: "reports");

            // ---- 1. Rename each existing column to its _en half ---------------------------
            migrationBuilder.RenameColumn(name: "name", table: "survey_templates", newName: "name_en");
            migrationBuilder.RenameColumn(name: "description", table: "survey_templates", newName: "description_en");
            migrationBuilder.RenameColumn(name: "name", table: "microclimate_templates", newName: "name_en");
            migrationBuilder.RenameColumn(name: "description", table: "microclimate_templates", newName: "description_en");
            migrationBuilder.RenameColumn(name: "name", table: "action_plan_templates", newName: "name_en");
            migrationBuilder.RenameColumn(name: "description", table: "action_plan_templates", newName: "description_en");
            migrationBuilder.RenameColumn(name: "title", table: "action_plans", newName: "title_en");
            migrationBuilder.RenameColumn(name: "description", table: "action_plans", newName: "description_en");
            migrationBuilder.RenameColumn(name: "description", table: "action_plan_objectives", newName: "description_en");
            migrationBuilder.RenameColumn(name: "success_criteria", table: "action_plan_objectives", newName: "success_criteria_en");
            migrationBuilder.RenameColumn(name: "description", table: "action_plan_template_objectives", newName: "description_en");
            migrationBuilder.RenameColumn(name: "success_criteria", table: "action_plan_template_objectives", newName: "success_criteria_en");
            migrationBuilder.RenameColumn(name: "name", table: "action_plan_kpis", newName: "name_en");
            migrationBuilder.RenameColumn(name: "unit", table: "action_plan_kpis", newName: "unit_en");
            migrationBuilder.RenameColumn(name: "name", table: "action_plan_template_kpis", newName: "name_en");
            migrationBuilder.RenameColumn(name: "unit", table: "action_plan_template_kpis", newName: "unit_en");
            migrationBuilder.RenameColumn(name: "name", table: "benchmarks", newName: "name_en");
            migrationBuilder.RenameColumn(name: "description", table: "benchmarks", newName: "description_en");
            migrationBuilder.RenameColumn(name: "title", table: "reports", newName: "title_en");
            migrationBuilder.RenameColumn(name: "description", table: "reports", newName: "description_en");
            migrationBuilder.RenameColumn(name: "description", table: "notification_template_variables", newName: "description_en");

            // ---- 2. Every _en half becomes nullable ---------------------------------------
            migrationBuilder.Sql("ALTER TABLE survey_templates ALTER COLUMN name_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE survey_templates ALTER COLUMN description_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE microclimate_templates ALTER COLUMN name_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE microclimate_templates ALTER COLUMN description_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_templates ALTER COLUMN name_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_templates ALTER COLUMN description_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plans ALTER COLUMN title_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plans ALTER COLUMN description_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_objectives ALTER COLUMN description_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_objectives ALTER COLUMN success_criteria_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_template_objectives ALTER COLUMN description_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_template_objectives ALTER COLUMN success_criteria_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_kpis ALTER COLUMN name_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_kpis ALTER COLUMN unit_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_template_kpis ALTER COLUMN name_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_template_kpis ALTER COLUMN unit_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE benchmarks ALTER COLUMN name_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE benchmarks ALTER COLUMN description_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE reports ALTER COLUMN title_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE notification_template_variables ALTER COLUMN description_en DROP NOT NULL;");

            // ---- 3. Add the _es half ------------------------------------------------------
            migrationBuilder.Sql("ALTER TABLE survey_templates ADD COLUMN name_es varchar(200);");
            migrationBuilder.Sql("ALTER TABLE survey_templates ADD COLUMN description_es varchar(1000);");
            migrationBuilder.Sql("ALTER TABLE microclimate_templates ADD COLUMN name_es varchar(100);");
            migrationBuilder.Sql("ALTER TABLE microclimate_templates ADD COLUMN description_es varchar(500);");
            migrationBuilder.Sql("ALTER TABLE action_plan_templates ADD COLUMN name_es varchar(200);");
            migrationBuilder.Sql("ALTER TABLE action_plan_templates ADD COLUMN description_es text;");
            migrationBuilder.Sql("ALTER TABLE action_plans ADD COLUMN title_es varchar(300);");
            migrationBuilder.Sql("ALTER TABLE action_plans ADD COLUMN description_es text;");
            migrationBuilder.Sql("ALTER TABLE action_plan_objectives ADD COLUMN description_es text;");
            migrationBuilder.Sql("ALTER TABLE action_plan_objectives ADD COLUMN success_criteria_es text;");
            migrationBuilder.Sql("ALTER TABLE action_plan_template_objectives ADD COLUMN description_es text;");
            migrationBuilder.Sql("ALTER TABLE action_plan_template_objectives ADD COLUMN success_criteria_es text;");
            migrationBuilder.Sql("ALTER TABLE action_plan_kpis ADD COLUMN name_es varchar(200);");
            migrationBuilder.Sql("ALTER TABLE action_plan_kpis ADD COLUMN unit_es varchar(50);");
            migrationBuilder.Sql("ALTER TABLE action_plan_template_kpis ADD COLUMN name_es varchar(200);");
            migrationBuilder.Sql("ALTER TABLE action_plan_template_kpis ADD COLUMN unit_es varchar(50);");
            migrationBuilder.Sql("ALTER TABLE benchmarks ADD COLUMN name_es varchar(200);");
            migrationBuilder.Sql("ALTER TABLE benchmarks ADD COLUMN description_es varchar(2000);");
            migrationBuilder.Sql("ALTER TABLE reports ADD COLUMN title_es varchar(200);");
            migrationBuilder.Sql("ALTER TABLE reports ADD COLUMN description_es varchar(1000);");
            migrationBuilder.Sql("ALTER TABLE notification_template_variables ADD COLUMN description_es varchar(1000);");

            // ---- 4. Attribute existing rows of Spanish-language companies -----------------
            // All assignments in one SET read the row's OLD values, so `x_es = x.x_en, x_en = NULL`
            // moves the text rather than erasing it. The right-hand side is qualified with the
            // target alias because, after the rename, a child row's parent (action_plans under
            // action_plan_kpis) carries a column of the same name and Postgres refuses to guess.
            migrationBuilder.Sql("UPDATE survey_templates x SET name_es = x.name_en, name_en = NULL, description_es = x.description_en, description_en = NULL FROM companies c WHERE x.company_id = c.\"Id\" AND c.settings_language = 'es';");
            migrationBuilder.Sql("UPDATE microclimate_templates x SET name_es = x.name_en, name_en = NULL, description_es = x.description_en, description_en = NULL FROM companies c WHERE x.company_id = c.\"Id\" AND c.settings_language = 'es';");
            migrationBuilder.Sql("UPDATE action_plan_templates x SET name_es = x.name_en, name_en = NULL, description_es = x.description_en, description_en = NULL FROM companies c WHERE x.company_id = c.\"Id\" AND c.settings_language = 'es';");
            migrationBuilder.Sql("UPDATE action_plans x SET title_es = x.title_en, title_en = NULL, description_es = x.description_en, description_en = NULL FROM companies c WHERE x.company_id = c.\"Id\" AND c.settings_language = 'es';");
            migrationBuilder.Sql("UPDATE action_plan_objectives x SET description_es = x.description_en, description_en = NULL, success_criteria_es = x.success_criteria_en, success_criteria_en = NULL FROM action_plans p JOIN companies c ON p.company_id = c.\"Id\" WHERE x.action_plan_id = p.\"Id\" AND c.settings_language = 'es';");
            migrationBuilder.Sql("UPDATE action_plan_template_objectives x SET description_es = x.description_en, description_en = NULL, success_criteria_es = x.success_criteria_en, success_criteria_en = NULL FROM action_plan_templates p JOIN companies c ON p.company_id = c.\"Id\" WHERE x.template_id = p.\"Id\" AND c.settings_language = 'es';");
            migrationBuilder.Sql("UPDATE action_plan_kpis x SET name_es = x.name_en, name_en = NULL, unit_es = x.unit_en, unit_en = NULL FROM action_plans p JOIN companies c ON p.company_id = c.\"Id\" WHERE x.action_plan_id = p.\"Id\" AND c.settings_language = 'es';");
            migrationBuilder.Sql("UPDATE action_plan_template_kpis x SET name_es = x.name_en, name_en = NULL, unit_es = x.unit_en, unit_en = NULL FROM action_plan_templates p JOIN companies c ON p.company_id = c.\"Id\" WHERE x.template_id = p.\"Id\" AND c.settings_language = 'es';");
            migrationBuilder.Sql("UPDATE benchmarks x SET name_es = x.name_en, name_en = NULL, description_es = x.description_en, description_en = NULL FROM companies c WHERE x.company_id = c.\"Id\" AND c.settings_language = 'es';");
            migrationBuilder.Sql("UPDATE reports x SET title_es = x.title_en, title_en = NULL, description_es = x.description_en, description_en = NULL FROM companies c WHERE x.company_id = c.\"Id\" AND c.settings_language = 'es';");
            migrationBuilder.Sql("UPDATE notification_template_variables x SET description_es = x.description_en, description_en = NULL FROM notification_templates p JOIN companies c ON p.company_id = c.\"Id\" WHERE x.notification_template_id = p.\"Id\" AND c.settings_language = 'es';");

            // ---- 5. Rebuild the search vectors over both halves --------------------------
            migrationBuilder.AddColumn<NpgsqlTsVector>(
                name: "search_vector",
                table: "action_plans",
                type: "tsvector",
                nullable: true,
                computedColumnSql: "to_tsvector('simple', coalesce(title_en, '') || ' ' || coalesce(title_es, '') || ' ' || coalesce(description_en, '') || ' ' || coalesce(description_es, ''))",
                stored: true);
            migrationBuilder.CreateIndex(
                name: "IX_action_plans_search_vector",
                table: "action_plans",
                column: "search_vector")
                .Annotation("Npgsql:IndexMethod", "gin");
            migrationBuilder.AddColumn<NpgsqlTsVector>(
                name: "search_vector",
                table: "reports",
                type: "tsvector",
                nullable: true,
                computedColumnSql: "to_tsvector('simple', coalesce(title_en, '') || ' ' || coalesce(title_es, '') || ' ' || coalesce(description_en, '') || ' ' || coalesce(description_es, ''))",
                stored: true);
            migrationBuilder.CreateIndex(
                name: "IX_reports_search_vector",
                table: "reports",
                column: "search_vector")
                .Annotation("Npgsql:IndexMethod", "gin");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Reverse in reverse order. A row authored only in Spanish keeps its text -- it
            // moves back into the single column -- and a bilingual row keeps its English half;
            // the Spanish half of a bilingual row is the one thing Down cannot preserve, as
            // AddContentI18n's Down could not either.
            migrationBuilder.DropIndex(name: "IX_action_plans_search_vector", table: "action_plans");
            migrationBuilder.DropColumn(name: "search_vector", table: "action_plans");
            migrationBuilder.DropIndex(name: "IX_reports_search_vector", table: "reports");
            migrationBuilder.DropColumn(name: "search_vector", table: "reports");

            migrationBuilder.Sql("UPDATE survey_templates SET name_en = name_es WHERE name_en IS NULL AND name_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE survey_templates SET description_en = description_es WHERE description_en IS NULL AND description_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE microclimate_templates SET name_en = name_es WHERE name_en IS NULL AND name_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE microclimate_templates SET description_en = description_es WHERE description_en IS NULL AND description_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_templates SET name_en = name_es WHERE name_en IS NULL AND name_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_templates SET description_en = description_es WHERE description_en IS NULL AND description_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plans SET title_en = title_es WHERE title_en IS NULL AND title_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plans SET description_en = description_es WHERE description_en IS NULL AND description_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_objectives SET description_en = description_es WHERE description_en IS NULL AND description_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_objectives SET success_criteria_en = success_criteria_es WHERE success_criteria_en IS NULL AND success_criteria_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_template_objectives SET description_en = description_es WHERE description_en IS NULL AND description_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_template_objectives SET success_criteria_en = success_criteria_es WHERE success_criteria_en IS NULL AND success_criteria_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_kpis SET name_en = name_es WHERE name_en IS NULL AND name_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_kpis SET unit_en = unit_es WHERE unit_en IS NULL AND unit_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_template_kpis SET name_en = name_es WHERE name_en IS NULL AND name_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_template_kpis SET unit_en = unit_es WHERE unit_en IS NULL AND unit_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE benchmarks SET name_en = name_es WHERE name_en IS NULL AND name_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE benchmarks SET description_en = description_es WHERE description_en IS NULL AND description_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE reports SET title_en = title_es WHERE title_en IS NULL AND title_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE reports SET description_en = description_es WHERE description_en IS NULL AND description_es IS NOT NULL;");
            migrationBuilder.Sql("UPDATE notification_template_variables SET description_en = description_es WHERE description_en IS NULL AND description_es IS NOT NULL;");

            migrationBuilder.Sql("ALTER TABLE survey_templates DROP COLUMN name_es;");
            migrationBuilder.Sql("ALTER TABLE survey_templates DROP COLUMN description_es;");
            migrationBuilder.Sql("ALTER TABLE microclimate_templates DROP COLUMN name_es;");
            migrationBuilder.Sql("ALTER TABLE microclimate_templates DROP COLUMN description_es;");
            migrationBuilder.Sql("ALTER TABLE action_plan_templates DROP COLUMN name_es;");
            migrationBuilder.Sql("ALTER TABLE action_plan_templates DROP COLUMN description_es;");
            migrationBuilder.Sql("ALTER TABLE action_plans DROP COLUMN title_es;");
            migrationBuilder.Sql("ALTER TABLE action_plans DROP COLUMN description_es;");
            migrationBuilder.Sql("ALTER TABLE action_plan_objectives DROP COLUMN description_es;");
            migrationBuilder.Sql("ALTER TABLE action_plan_objectives DROP COLUMN success_criteria_es;");
            migrationBuilder.Sql("ALTER TABLE action_plan_template_objectives DROP COLUMN description_es;");
            migrationBuilder.Sql("ALTER TABLE action_plan_template_objectives DROP COLUMN success_criteria_es;");
            migrationBuilder.Sql("ALTER TABLE action_plan_kpis DROP COLUMN name_es;");
            migrationBuilder.Sql("ALTER TABLE action_plan_kpis DROP COLUMN unit_es;");
            migrationBuilder.Sql("ALTER TABLE action_plan_template_kpis DROP COLUMN name_es;");
            migrationBuilder.Sql("ALTER TABLE action_plan_template_kpis DROP COLUMN unit_es;");
            migrationBuilder.Sql("ALTER TABLE benchmarks DROP COLUMN name_es;");
            migrationBuilder.Sql("ALTER TABLE benchmarks DROP COLUMN description_es;");
            migrationBuilder.Sql("ALTER TABLE reports DROP COLUMN title_es;");
            migrationBuilder.Sql("ALTER TABLE reports DROP COLUMN description_es;");
            migrationBuilder.Sql("ALTER TABLE notification_template_variables DROP COLUMN description_es;");

            migrationBuilder.Sql("UPDATE survey_templates SET name_en = '' WHERE name_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE survey_templates ALTER COLUMN name_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE survey_templates SET description_en = '' WHERE description_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE survey_templates ALTER COLUMN description_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE microclimate_templates SET name_en = '' WHERE name_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE microclimate_templates ALTER COLUMN name_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE microclimate_templates SET description_en = '' WHERE description_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE microclimate_templates ALTER COLUMN description_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_templates SET name_en = '' WHERE name_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_templates ALTER COLUMN name_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_templates SET description_en = '' WHERE description_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_templates ALTER COLUMN description_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plans SET title_en = '' WHERE title_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plans ALTER COLUMN title_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plans SET description_en = '' WHERE description_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plans ALTER COLUMN description_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_objectives SET description_en = '' WHERE description_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_objectives ALTER COLUMN description_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_objectives SET success_criteria_en = '' WHERE success_criteria_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_objectives ALTER COLUMN success_criteria_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_template_objectives SET description_en = '' WHERE description_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_template_objectives ALTER COLUMN description_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_template_objectives SET success_criteria_en = '' WHERE success_criteria_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_template_objectives ALTER COLUMN success_criteria_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_kpis SET name_en = '' WHERE name_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_kpis ALTER COLUMN name_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_kpis SET unit_en = '' WHERE unit_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_kpis ALTER COLUMN unit_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_template_kpis SET name_en = '' WHERE name_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_template_kpis ALTER COLUMN name_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE action_plan_template_kpis SET unit_en = '' WHERE unit_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE action_plan_template_kpis ALTER COLUMN unit_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE benchmarks SET name_en = '' WHERE name_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE benchmarks ALTER COLUMN name_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE benchmarks SET description_en = '' WHERE description_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE benchmarks ALTER COLUMN description_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE reports SET title_en = '' WHERE title_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE reports ALTER COLUMN title_en SET NOT NULL;");
            migrationBuilder.Sql("UPDATE notification_template_variables SET description_en = '' WHERE description_en IS NULL;");
            migrationBuilder.Sql("ALTER TABLE notification_template_variables ALTER COLUMN description_en SET NOT NULL;");

            migrationBuilder.RenameColumn(name: "name_en", table: "survey_templates", newName: "name");
            migrationBuilder.RenameColumn(name: "description_en", table: "survey_templates", newName: "description");
            migrationBuilder.RenameColumn(name: "name_en", table: "microclimate_templates", newName: "name");
            migrationBuilder.RenameColumn(name: "description_en", table: "microclimate_templates", newName: "description");
            migrationBuilder.RenameColumn(name: "name_en", table: "action_plan_templates", newName: "name");
            migrationBuilder.RenameColumn(name: "description_en", table: "action_plan_templates", newName: "description");
            migrationBuilder.RenameColumn(name: "title_en", table: "action_plans", newName: "title");
            migrationBuilder.RenameColumn(name: "description_en", table: "action_plans", newName: "description");
            migrationBuilder.RenameColumn(name: "description_en", table: "action_plan_objectives", newName: "description");
            migrationBuilder.RenameColumn(name: "success_criteria_en", table: "action_plan_objectives", newName: "success_criteria");
            migrationBuilder.RenameColumn(name: "description_en", table: "action_plan_template_objectives", newName: "description");
            migrationBuilder.RenameColumn(name: "success_criteria_en", table: "action_plan_template_objectives", newName: "success_criteria");
            migrationBuilder.RenameColumn(name: "name_en", table: "action_plan_kpis", newName: "name");
            migrationBuilder.RenameColumn(name: "unit_en", table: "action_plan_kpis", newName: "unit");
            migrationBuilder.RenameColumn(name: "name_en", table: "action_plan_template_kpis", newName: "name");
            migrationBuilder.RenameColumn(name: "unit_en", table: "action_plan_template_kpis", newName: "unit");
            migrationBuilder.RenameColumn(name: "name_en", table: "benchmarks", newName: "name");
            migrationBuilder.RenameColumn(name: "description_en", table: "benchmarks", newName: "description");
            migrationBuilder.RenameColumn(name: "title_en", table: "reports", newName: "title");
            migrationBuilder.RenameColumn(name: "description_en", table: "reports", newName: "description");
            migrationBuilder.RenameColumn(name: "description_en", table: "notification_template_variables", newName: "description");

            migrationBuilder.AddColumn<NpgsqlTsVector>(
                name: "search_vector",
                table: "action_plans",
                type: "tsvector",
                nullable: true,
                computedColumnSql: "to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))",
                stored: true);
            migrationBuilder.CreateIndex(
                name: "IX_action_plans_search_vector",
                table: "action_plans",
                column: "search_vector")
                .Annotation("Npgsql:IndexMethod", "gin");
            migrationBuilder.AddColumn<NpgsqlTsVector>(
                name: "search_vector",
                table: "reports",
                type: "tsvector",
                nullable: true,
                computedColumnSql: "to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))",
                stored: true);
            migrationBuilder.CreateIndex(
                name: "IX_reports_search_vector",
                table: "reports",
                column: "search_vector")
                .Annotation("Npgsql:IndexMethod", "gin");
        }
    }
}
