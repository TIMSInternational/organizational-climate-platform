using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddContentI18n : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Content i18n for respondent-facing content (#195).
            //
            // The Up/Down bodies are hand-written. `dotnet ef migrations add` pairs a
            // dropped column with an added one positionally, and on this diff it inferred
            // renames such as settings_invitation_custom_subject -> title_es and
            // scale_label_max -> scale_label_min_en. Each of those silently relocates real
            // authored content into the wrong column, so every rename below is explicit
            // and 1:1. The CreateTable/CreateIndex calls are EF's own, unmodified, so the
            // model snapshot stays authoritative.
            //
            // Order is load-bearing: rename each existing column to <field>_en FIRST so
            // its rows keep their values under the correct name, add the empty <field>_es
            // beside it, build the option tables out of the arrays, and only then drop the
            // arrays.

            // ---- 1. Rename each existing column to its _en half ----------------------
            migrationBuilder.RenameColumn(name: "text", table: "questions", newName: "text_en");
            migrationBuilder.RenameColumn(name: "scale_label_min", table: "questions", newName: "scale_label_min_en");
            migrationBuilder.RenameColumn(name: "scale_label_max", table: "questions", newName: "scale_label_max_en");
            migrationBuilder.RenameColumn(name: "binary_comment_config", table: "questions", newName: "binary_comment_config_en");
            migrationBuilder.RenameColumn(name: "text", table: "template_questions", newName: "text_en");
            migrationBuilder.RenameColumn(name: "scale_label_min", table: "template_questions", newName: "scale_label_min_en");
            migrationBuilder.RenameColumn(name: "scale_label_max", table: "template_questions", newName: "scale_label_max_en");
            migrationBuilder.RenameColumn(name: "binary_comment_config", table: "template_questions", newName: "binary_comment_config_en");
            migrationBuilder.RenameColumn(name: "label", table: "question_emoji_options", newName: "label_en");
            migrationBuilder.RenameColumn(name: "title", table: "surveys", newName: "title_en");
            migrationBuilder.RenameColumn(name: "description", table: "surveys", newName: "description_en");
            migrationBuilder.RenameColumn(name: "settings_invitation_custom_message", table: "surveys", newName: "settings_invitation_custom_message_en");
            migrationBuilder.RenameColumn(name: "settings_invitation_custom_subject", table: "surveys", newName: "settings_invitation_custom_subject_en");
            migrationBuilder.RenameColumn(name: "title", table: "survey_versions", newName: "title_en");
            migrationBuilder.RenameColumn(name: "description", table: "survey_versions", newName: "description_en");
            migrationBuilder.RenameColumn(name: "title", table: "microclimates", newName: "title_en");
            migrationBuilder.RenameColumn(name: "description", table: "microclimates", newName: "description_en");
            migrationBuilder.RenameColumn(name: "text", table: "microclimate_questions", newName: "text_en");
            migrationBuilder.RenameColumn(name: "text", table: "microclimate_template_questions", newName: "text_en");
            migrationBuilder.RenameColumn(name: "label", table: "demographic_fields", newName: "label_en");
            migrationBuilder.RenameColumn(name: "maintenance_message", table: "system_settings", newName: "maintenance_message_en");
            migrationBuilder.RenameColumn(name: "subject", table: "notification_templates", newName: "subject_en");
            migrationBuilder.RenameColumn(name: "title", table: "notification_templates", newName: "title_en");
            migrationBuilder.RenameColumn(name: "content", table: "notification_templates", newName: "content_en");
            migrationBuilder.RenameColumn(name: "html_content", table: "notification_templates", newName: "html_content_en");
            migrationBuilder.RenameColumn(name: "comment_prompt", table: "questions", newName: "comment_prompt_en");
            migrationBuilder.RenameColumn(name: "comment_prompt", table: "template_questions", newName: "comment_prompt_en");

            // ---- 2. Every _en half becomes nullable ----------------------------------
            // A survey authored only in Spanish has no English title, and NOT NULL on the
            // English half would force an empty string or a placeholder into it -- which is
            // exactly the "untranslated string" the requirement forbids. Required-ness
            // moves to the publish gate, which knows which languages a given survey
            // actually promised.
            migrationBuilder.Sql("ALTER TABLE questions ALTER COLUMN text_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE template_questions ALTER COLUMN text_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE question_emoji_options ALTER COLUMN label_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE surveys ALTER COLUMN title_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE survey_versions ALTER COLUMN title_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE microclimates ALTER COLUMN title_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE microclimate_questions ALTER COLUMN text_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE microclimate_template_questions ALTER COLUMN text_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE demographic_fields ALTER COLUMN label_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE notification_templates ALTER COLUMN title_en DROP NOT NULL;");
            migrationBuilder.Sql("ALTER TABLE notification_templates ALTER COLUMN content_en DROP NOT NULL;");

            // ---- 3. Add the _es half -------------------------------------------------
            migrationBuilder.Sql("ALTER TABLE questions ADD COLUMN text_es varchar(500);");
            migrationBuilder.Sql("ALTER TABLE questions ADD COLUMN scale_label_min_es varchar(200);");
            migrationBuilder.Sql("ALTER TABLE questions ADD COLUMN scale_label_max_es varchar(200);");
            migrationBuilder.Sql("ALTER TABLE questions ADD COLUMN binary_comment_config_es jsonb;");
            migrationBuilder.Sql("ALTER TABLE template_questions ADD COLUMN text_es varchar(500);");
            migrationBuilder.Sql("ALTER TABLE template_questions ADD COLUMN scale_label_min_es varchar(200);");
            migrationBuilder.Sql("ALTER TABLE template_questions ADD COLUMN scale_label_max_es varchar(200);");
            migrationBuilder.Sql("ALTER TABLE template_questions ADD COLUMN binary_comment_config_es jsonb;");
            migrationBuilder.Sql("ALTER TABLE question_emoji_options ADD COLUMN label_es varchar(100);");
            migrationBuilder.Sql("ALTER TABLE surveys ADD COLUMN title_es varchar(200);");
            migrationBuilder.Sql("ALTER TABLE surveys ADD COLUMN description_es varchar(1000);");
            migrationBuilder.Sql("ALTER TABLE surveys ADD COLUMN settings_invitation_custom_message_es varchar(1000);");
            migrationBuilder.Sql("ALTER TABLE surveys ADD COLUMN settings_invitation_custom_subject_es varchar(200);");
            migrationBuilder.Sql("ALTER TABLE survey_versions ADD COLUMN title_es varchar(200);");
            migrationBuilder.Sql("ALTER TABLE survey_versions ADD COLUMN description_es varchar(1000);");
            migrationBuilder.Sql("ALTER TABLE microclimates ADD COLUMN title_es varchar(150);");
            migrationBuilder.Sql("ALTER TABLE microclimates ADD COLUMN description_es varchar(500);");
            migrationBuilder.Sql("ALTER TABLE microclimate_questions ADD COLUMN text_es varchar(300);");
            migrationBuilder.Sql("ALTER TABLE microclimate_template_questions ADD COLUMN text_es varchar(300);");
            migrationBuilder.Sql("ALTER TABLE demographic_fields ADD COLUMN label_es varchar(200);");
            migrationBuilder.Sql("ALTER TABLE system_settings ADD COLUMN maintenance_message_es varchar(500);");
            migrationBuilder.Sql("ALTER TABLE notification_templates ADD COLUMN subject_es varchar(500);");
            migrationBuilder.Sql("ALTER TABLE notification_templates ADD COLUMN title_es varchar(500);");
            migrationBuilder.Sql("ALTER TABLE notification_templates ADD COLUMN content_es text;");
            migrationBuilder.Sql("ALTER TABLE notification_templates ADD COLUMN html_content_es text;");

            // comment_prompt is the one pair with DDL defaults on both halves. The single
            // column it replaces shipped "Please explain your answer:" as a DATABASE
            // default, so a Spanish-only survey was served an English prompt straight out
            // of the DDL -- #195's one live defect rather than a gap. Both halves now
            // default in their own language, and the defaults live in the DDL rather than
            // only in the CLR initialiser because a row inserted outside EF would
            // otherwise backfill with the raw CLR default.
            migrationBuilder.Sql("ALTER TABLE questions ADD COLUMN comment_prompt_es varchar(500) NOT NULL DEFAULT 'Por favor explica tu respuesta:';");
            migrationBuilder.Sql("ALTER TABLE template_questions ADD COLUMN comment_prompt_es varchar(500) NOT NULL DEFAULT 'Por favor explica tu respuesta:';");

            // ---- 4. Language columns -------------------------------------------------
            // surveys/microclimates: 'es' | 'en' | 'both', the field the publish gate
            // reads. responses.language is different in kind -- it records the locale a
            // respondent was SERVED. It is captured, never authored, and without it the
            // live word cloud counts "trabajo" and "work" as unrelated entries with
            // nothing anywhere recording which language anyone answered in.
            migrationBuilder.Sql("ALTER TABLE surveys ADD COLUMN language varchar(10) NOT NULL DEFAULT 'en';");
            migrationBuilder.Sql("ALTER TABLE microclimates ADD COLUMN language varchar(10) NOT NULL DEFAULT 'en';");
            migrationBuilder.Sql("ALTER TABLE responses ADD COLUMN language varchar(10) NOT NULL DEFAULT 'en';");

            // ---- 5. Options become rows with a stable, locale-independent value ------
            // Answers are validated and stored by the option's own text today, so with
            // per-language option text two respondents choosing the same option in
            // different languages would store two unrelated strings -- splitting every
            // distribution, chart, benchmark and export, with no error and with row counts
            // that reconcile exactly. `value` is the key that survives translation; the
            // labels are display only.

            migrationBuilder.CreateTable(
                name: "demographic_field_options",
                columns: table => new
                {
                    demographic_field_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order = table.Column<int>(type: "integer", nullable: false),
                    value = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    label_en = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    label_es = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_demographic_field_options", x => new { x.demographic_field_id, x.order });
                    table.ForeignKey(
                        name: "FK_demographic_field_options_demographic_fields_demographic_fi~",
                        column: x => x.demographic_field_id,
                        principalTable: "demographic_fields",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "microclimate_question_options",
                columns: table => new
                {
                    microclimate_question_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order = table.Column<int>(type: "integer", nullable: false),
                    value = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    label_en = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    label_es = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_microclimate_question_options", x => new { x.microclimate_question_id, x.order });
                    table.ForeignKey(
                        name: "FK_microclimate_question_options_microclimate_questions_microc~",
                        column: x => x.microclimate_question_id,
                        principalTable: "microclimate_questions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "microclimate_template_question_options",
                columns: table => new
                {
                    microclimate_template_question_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order = table.Column<int>(type: "integer", nullable: false),
                    value = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    label_en = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    label_es = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_microclimate_template_question_options", x => new { x.microclimate_template_question_id, x.order });
                    table.ForeignKey(
                        name: "FK_microclimate_template_question_options_microclimate_templat~",
                        column: x => x.microclimate_template_question_id,
                        principalTable: "microclimate_template_questions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "question_options",
                columns: table => new
                {
                    question_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order = table.Column<int>(type: "integer", nullable: false),
                    value = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    label_en = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    label_es = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_question_options", x => new { x.question_id, x.order });
                    table.ForeignKey(
                        name: "FK_question_options_questions_question_id",
                        column: x => x.question_id,
                        principalTable: "questions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "template_question_options",
                columns: table => new
                {
                    template_question_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order = table.Column<int>(type: "integer", nullable: false),
                    value = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    label_en = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    label_es = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_template_question_options", x => new { x.template_question_id, x.order });
                    table.ForeignKey(
                        name: "FK_template_question_options_template_questions_template_quest~",
                        column: x => x.template_question_id,
                        principalTable: "template_questions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_demographic_field_options_demographic_field_id_value",
                table: "demographic_field_options",
                columns: new[] { "demographic_field_id", "value" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_microclimate_question_options_microclimate_question_id_value",
                table: "microclimate_question_options",
                columns: new[] { "microclimate_question_id", "value" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_microclimate_template_question_options_microclimate_templat~",
                table: "microclimate_template_question_options",
                columns: new[] { "microclimate_template_question_id", "value" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_question_options_question_id_value",
                table: "question_options",
                columns: new[] { "question_id", "value" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_template_question_options_template_question_id_value",
                table: "template_question_options",
                columns: new[] { "template_question_id", "value" },
                unique: true);

            // Backfill: `value` is the existing option text VERBATIM. That is what makes
            // this safe without also rewriting question_responses -- every response_value
            // written so far was matched against exactly this string, so it still matches.
            // The equality is only available because no bilingual option exists yet; the
            // window closes the moment bilingual authoring ships, which is why #195 is
            // sequenced ahead of #154's response load.
            //
            // Blank entries are dropped and duplicates within one parent collapse to their
            // first occurrence: the unique (parent, value) index is the point of the table,
            // and a duplicate would make a stored answer ambiguous in exactly the way this
            // exists to prevent.
            migrationBuilder.Sql(@"
                INSERT INTO question_options (question_id, ""order"", value, label_en)
                SELECT parent_id,
                       (row_number() OVER (PARTITION BY parent_id ORDER BY ord)) - 1,
                       val,
                       val
                FROM (
                    SELECT DISTINCT ON (p.""Id"", o.val) p.""Id"" AS parent_id, o.val AS val, o.ord AS ord
                    FROM questions p, LATERAL unnest(p.options) WITH ORDINALITY AS o(val, ord)
                    WHERE p.options IS NOT NULL AND o.val IS NOT NULL AND btrim(o.val) <> ''
                    ORDER BY p.""Id"", o.val, o.ord
                ) d;
            ");
            migrationBuilder.Sql(@"
                INSERT INTO template_question_options (template_question_id, ""order"", value, label_en)
                SELECT parent_id,
                       (row_number() OVER (PARTITION BY parent_id ORDER BY ord)) - 1,
                       val,
                       val
                FROM (
                    SELECT DISTINCT ON (p.""Id"", o.val) p.""Id"" AS parent_id, o.val AS val, o.ord AS ord
                    FROM template_questions p, LATERAL unnest(p.options) WITH ORDINALITY AS o(val, ord)
                    WHERE p.options IS NOT NULL AND o.val IS NOT NULL AND btrim(o.val) <> ''
                    ORDER BY p.""Id"", o.val, o.ord
                ) d;
            ");
            migrationBuilder.Sql(@"
                INSERT INTO microclimate_question_options (microclimate_question_id, ""order"", value, label_en)
                SELECT parent_id,
                       (row_number() OVER (PARTITION BY parent_id ORDER BY ord)) - 1,
                       val,
                       val
                FROM (
                    SELECT DISTINCT ON (p.""Id"", o.val) p.""Id"" AS parent_id, o.val AS val, o.ord AS ord
                    FROM microclimate_questions p, LATERAL unnest(p.options) WITH ORDINALITY AS o(val, ord)
                    WHERE p.options IS NOT NULL AND o.val IS NOT NULL AND btrim(o.val) <> ''
                    ORDER BY p.""Id"", o.val, o.ord
                ) d;
            ");
            migrationBuilder.Sql(@"
                INSERT INTO microclimate_template_question_options (microclimate_template_question_id, ""order"", value, label_en)
                SELECT parent_id,
                       (row_number() OVER (PARTITION BY parent_id ORDER BY ord)) - 1,
                       val,
                       val
                FROM (
                    SELECT DISTINCT ON (p.""Id"", o.val) p.""Id"" AS parent_id, o.val AS val, o.ord AS ord
                    FROM microclimate_template_questions p, LATERAL unnest(p.options) WITH ORDINALITY AS o(val, ord)
                    WHERE p.options IS NOT NULL AND o.val IS NOT NULL AND btrim(o.val) <> ''
                    ORDER BY p.""Id"", o.val, o.ord
                ) d;
            ");
            migrationBuilder.Sql(@"
                INSERT INTO demographic_field_options (demographic_field_id, ""order"", value, label_en)
                SELECT parent_id,
                       (row_number() OVER (PARTITION BY parent_id ORDER BY ord)) - 1,
                       val,
                       val
                FROM (
                    SELECT DISTINCT ON (p.""Id"", o.val) p.""Id"" AS parent_id, o.val AS val, o.ord AS ord
                    FROM demographic_fields p, LATERAL unnest(p.options) WITH ORDINALITY AS o(val, ord)
                    WHERE p.options IS NOT NULL AND o.val IS NOT NULL AND btrim(o.val) <> ''
                    ORDER BY p.""Id"", o.val, o.ord
                ) d;
            ");

            migrationBuilder.DropColumn(name: "options", table: "questions");
            migrationBuilder.DropColumn(name: "options", table: "template_questions");
            migrationBuilder.DropColumn(name: "options", table: "microclimate_questions");
            migrationBuilder.DropColumn(name: "options", table: "microclimate_template_questions");
            migrationBuilder.DropColumn(name: "options", table: "demographic_fields");

            // ---- 6. Language attribution ---------------------------------------------
            // Existing content carries ONE string and no language tag, so the only signal
            // available is the owning company's language -- the same rule #154's ETL has to
            // apply, written here so the two agree by construction rather than by comment.
            // Rows belonging to a Spanish company move from the _en half to the _es half
            // and get language = 'es'; everything else stays English, which is what the
            // DDL default already says.
            //
            // Rows with no reachable company (global templates, notification templates)
            // are deliberately left English: there is no signal to attribute them by, and a
            // guess would be worse than a fallback that self-reports.
            migrationBuilder.Sql(@"
                UPDATE surveys s
                   SET language = 'es',
                       title_es = s.title_en, title_en = NULL,
                       description_es = s.description_en, description_en = NULL,
                       settings_invitation_custom_message_es = s.settings_invitation_custom_message_en, settings_invitation_custom_message_en = NULL,
                       settings_invitation_custom_subject_es = s.settings_invitation_custom_subject_en, settings_invitation_custom_subject_en = NULL
                FROM companies c
                 WHERE c.""Id"" = s.company_id AND c.settings_language = 'es';
            ");
            migrationBuilder.Sql(@"
                UPDATE survey_versions v
                   SET title_es = v.title_en, title_en = NULL,
                       description_es = v.description_en, description_en = NULL
                FROM surveys s JOIN companies c ON c.""Id"" = s.company_id
                 WHERE s.""Id"" = v.survey_id AND c.settings_language = 'es';
            ");
            migrationBuilder.Sql(@"
                UPDATE questions q
                   SET text_es = q.text_en, text_en = NULL,
                       scale_label_min_es = q.scale_label_min_en, scale_label_min_en = NULL,
                       scale_label_max_es = q.scale_label_max_en, scale_label_max_en = NULL,
                       binary_comment_config_es = q.binary_comment_config_en, binary_comment_config_en = NULL
                FROM surveys s JOIN companies c ON c.""Id"" = s.company_id
                 WHERE s.""Id"" = q.survey_id AND c.settings_language = 'es';
            ");
            migrationBuilder.Sql(@"
                UPDATE question_emoji_options e
                   SET label_es = e.label_en, label_en = NULL
                FROM questions q JOIN surveys s ON s.""Id"" = q.survey_id JOIN companies c ON c.""Id"" = s.company_id
                 WHERE q.""Id"" = e.question_id AND c.settings_language = 'es';
            ");
            migrationBuilder.Sql(@"
                UPDATE question_options o
                   SET label_es = o.label_en, label_en = NULL
                FROM questions q JOIN surveys s ON s.""Id"" = q.survey_id JOIN companies c ON c.""Id"" = s.company_id
                 WHERE q.""Id"" = o.question_id AND c.settings_language = 'es';
            ");
            migrationBuilder.Sql(@"
                UPDATE microclimates m
                   SET language = 'es',
                       title_es = m.title_en, title_en = NULL,
                       description_es = m.description_en, description_en = NULL
                FROM companies c
                 WHERE c.""Id"" = m.company_id AND c.settings_language = 'es';
            ");
            migrationBuilder.Sql(@"
                UPDATE microclimate_questions q
                   SET text_es = q.text_en, text_en = NULL
                FROM microclimates m JOIN companies c ON c.""Id"" = m.company_id
                 WHERE m.""Id"" = q.microclimate_id AND c.settings_language = 'es';
            ");
            migrationBuilder.Sql(@"
                UPDATE microclimate_question_options o
                   SET label_es = o.label_en, label_en = NULL
                FROM microclimate_questions q JOIN microclimates m ON m.""Id"" = q.microclimate_id JOIN companies c ON c.""Id"" = m.company_id
                 WHERE q.""Id"" = o.microclimate_question_id AND c.settings_language = 'es';
            ");
            migrationBuilder.Sql(@"
                UPDATE demographic_fields f
                   SET label_es = f.label_en, label_en = NULL
                FROM companies c
                 WHERE c.""Id"" = f.company_id AND c.settings_language = 'es';
            ");
            migrationBuilder.Sql(@"
                UPDATE demographic_field_options o
                   SET label_es = o.label_en, label_en = NULL
                FROM demographic_fields f JOIN companies c ON c.""Id"" = f.company_id
                 WHERE f.""Id"" = o.demographic_field_id AND c.settings_language = 'es';
            ");

            // A comment prompt still holding the old English DDL default is left alone --
            // relocating it would file English text in the Spanish column, and
            // comment_prompt_es already defaults to its Spanish equivalent. Only a prompt
            // an author actually customised moves.
            migrationBuilder.Sql(@"
                UPDATE questions q
                   SET comment_prompt_es = q.comment_prompt_en,
                       comment_prompt_en = 'Please explain your answer:'
                FROM surveys s JOIN companies c ON c.""Id"" = s.company_id
                 WHERE s.""Id"" = q.survey_id
                   AND c.settings_language = 'es'
                   AND q.comment_prompt_en <> 'Please explain your answer:';
            ");

            // A response already recorded carries no locale of its own; the company
            // language is the only signal, exactly as for authored content.
            migrationBuilder.Sql(@"
                UPDATE responses r
                   SET language = c.settings_language
                FROM companies c
                 WHERE c.""Id"" = r.company_id AND c.settings_language IN ('en', 'es');
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Down collapses each pair back to one column with COALESCE(_en, _es), so a
            // survey that was attributed to Spanish on the way up keeps its text on the way
            // back down rather than reverting to an empty English column. It is lossy by
            // construction -- a genuinely bilingual row loses one language, because the
            // single column it returns to cannot hold two.

            // Rebuild the option arrays before the child tables go.
            migrationBuilder.Sql("ALTER TABLE questions ADD COLUMN options text[];");
            migrationBuilder.Sql(@"
                UPDATE questions p
                   SET options = agg.vals
                FROM (
                    SELECT question_id AS parent_id, array_agg(value ORDER BY ""order"") AS vals
                    FROM question_options
                    GROUP BY question_id
                ) agg
                 WHERE agg.parent_id = p.""Id"";
            ");
            migrationBuilder.Sql("ALTER TABLE template_questions ADD COLUMN options text[];");
            migrationBuilder.Sql(@"
                UPDATE template_questions p
                   SET options = agg.vals
                FROM (
                    SELECT template_question_id AS parent_id, array_agg(value ORDER BY ""order"") AS vals
                    FROM template_question_options
                    GROUP BY template_question_id
                ) agg
                 WHERE agg.parent_id = p.""Id"";
            ");
            migrationBuilder.Sql("ALTER TABLE microclimate_questions ADD COLUMN options text[];");
            migrationBuilder.Sql(@"
                UPDATE microclimate_questions p
                   SET options = agg.vals
                FROM (
                    SELECT microclimate_question_id AS parent_id, array_agg(value ORDER BY ""order"") AS vals
                    FROM microclimate_question_options
                    GROUP BY microclimate_question_id
                ) agg
                 WHERE agg.parent_id = p.""Id"";
            ");
            migrationBuilder.Sql("ALTER TABLE microclimate_template_questions ADD COLUMN options text[];");
            migrationBuilder.Sql(@"
                UPDATE microclimate_template_questions p
                   SET options = agg.vals
                FROM (
                    SELECT microclimate_template_question_id AS parent_id, array_agg(value ORDER BY ""order"") AS vals
                    FROM microclimate_template_question_options
                    GROUP BY microclimate_template_question_id
                ) agg
                 WHERE agg.parent_id = p.""Id"";
            ");
            migrationBuilder.Sql("ALTER TABLE demographic_fields ADD COLUMN options text[];");
            migrationBuilder.Sql(@"
                UPDATE demographic_fields p
                   SET options = agg.vals
                FROM (
                    SELECT demographic_field_id AS parent_id, array_agg(value ORDER BY ""order"") AS vals
                    FROM demographic_field_options
                    GROUP BY demographic_field_id
                ) agg
                 WHERE agg.parent_id = p.""Id"";
            ");

            migrationBuilder.DropTable(name: "question_options");
            migrationBuilder.DropTable(name: "template_question_options");
            migrationBuilder.DropTable(name: "microclimate_question_options");
            migrationBuilder.DropTable(name: "microclimate_template_question_options");
            migrationBuilder.DropTable(name: "demographic_field_options");

            migrationBuilder.Sql("ALTER TABLE surveys DROP COLUMN language;");
            migrationBuilder.Sql("ALTER TABLE microclimates DROP COLUMN language;");
            migrationBuilder.Sql("ALTER TABLE responses DROP COLUMN language;");

            // Both comment_prompt halves are NOT NULL and defaulted, so a plain
            // COALESCE would always pick the English default and discard a prompt an
            // author had customised in Spanish. Restore the Spanish one only when the
            // English half is still untouched.
            migrationBuilder.Sql(@"
                UPDATE questions
                   SET comment_prompt_en = comment_prompt_es
                 WHERE comment_prompt_en = 'Please explain your answer:'
                   AND comment_prompt_es <> 'Por favor explica tu respuesta:';
            ");
            migrationBuilder.Sql(@"
                UPDATE template_questions
                   SET comment_prompt_en = comment_prompt_es
                 WHERE comment_prompt_en = 'Please explain your answer:'
                   AND comment_prompt_es <> 'Por favor explica tu respuesta:';
            ");
            migrationBuilder.Sql("ALTER TABLE questions DROP COLUMN comment_prompt_es;");
            migrationBuilder.Sql("ALTER TABLE template_questions DROP COLUMN comment_prompt_es;");
            migrationBuilder.RenameColumn(name: "comment_prompt_en", table: "questions", newName: "comment_prompt");
            migrationBuilder.RenameColumn(name: "comment_prompt_en", table: "template_questions", newName: "comment_prompt");

            migrationBuilder.Sql("UPDATE questions SET text_en = COALESCE(text_en, text_es);");
            migrationBuilder.Sql("ALTER TABLE questions DROP COLUMN text_es;");
            migrationBuilder.RenameColumn(name: "text_en", table: "questions", newName: "text");
            migrationBuilder.Sql("UPDATE questions SET text = '' WHERE text IS NULL;");
            migrationBuilder.Sql("ALTER TABLE questions ALTER COLUMN text SET NOT NULL;");
            migrationBuilder.Sql("UPDATE questions SET scale_label_min_en = COALESCE(scale_label_min_en, scale_label_min_es);");
            migrationBuilder.Sql("ALTER TABLE questions DROP COLUMN scale_label_min_es;");
            migrationBuilder.RenameColumn(name: "scale_label_min_en", table: "questions", newName: "scale_label_min");
            migrationBuilder.Sql("UPDATE questions SET scale_label_max_en = COALESCE(scale_label_max_en, scale_label_max_es);");
            migrationBuilder.Sql("ALTER TABLE questions DROP COLUMN scale_label_max_es;");
            migrationBuilder.RenameColumn(name: "scale_label_max_en", table: "questions", newName: "scale_label_max");
            migrationBuilder.Sql("UPDATE questions SET binary_comment_config_en = COALESCE(binary_comment_config_en, binary_comment_config_es);");
            migrationBuilder.Sql("ALTER TABLE questions DROP COLUMN binary_comment_config_es;");
            migrationBuilder.RenameColumn(name: "binary_comment_config_en", table: "questions", newName: "binary_comment_config");
            migrationBuilder.Sql("UPDATE template_questions SET text_en = COALESCE(text_en, text_es);");
            migrationBuilder.Sql("ALTER TABLE template_questions DROP COLUMN text_es;");
            migrationBuilder.RenameColumn(name: "text_en", table: "template_questions", newName: "text");
            migrationBuilder.Sql("UPDATE template_questions SET text = '' WHERE text IS NULL;");
            migrationBuilder.Sql("ALTER TABLE template_questions ALTER COLUMN text SET NOT NULL;");
            migrationBuilder.Sql("UPDATE template_questions SET scale_label_min_en = COALESCE(scale_label_min_en, scale_label_min_es);");
            migrationBuilder.Sql("ALTER TABLE template_questions DROP COLUMN scale_label_min_es;");
            migrationBuilder.RenameColumn(name: "scale_label_min_en", table: "template_questions", newName: "scale_label_min");
            migrationBuilder.Sql("UPDATE template_questions SET scale_label_max_en = COALESCE(scale_label_max_en, scale_label_max_es);");
            migrationBuilder.Sql("ALTER TABLE template_questions DROP COLUMN scale_label_max_es;");
            migrationBuilder.RenameColumn(name: "scale_label_max_en", table: "template_questions", newName: "scale_label_max");
            migrationBuilder.Sql("UPDATE template_questions SET binary_comment_config_en = COALESCE(binary_comment_config_en, binary_comment_config_es);");
            migrationBuilder.Sql("ALTER TABLE template_questions DROP COLUMN binary_comment_config_es;");
            migrationBuilder.RenameColumn(name: "binary_comment_config_en", table: "template_questions", newName: "binary_comment_config");
            migrationBuilder.Sql("UPDATE question_emoji_options SET label_en = COALESCE(label_en, label_es);");
            migrationBuilder.Sql("ALTER TABLE question_emoji_options DROP COLUMN label_es;");
            migrationBuilder.RenameColumn(name: "label_en", table: "question_emoji_options", newName: "label");
            migrationBuilder.Sql("UPDATE question_emoji_options SET label = '' WHERE label IS NULL;");
            migrationBuilder.Sql("ALTER TABLE question_emoji_options ALTER COLUMN label SET NOT NULL;");
            migrationBuilder.Sql("UPDATE surveys SET title_en = COALESCE(title_en, title_es);");
            migrationBuilder.Sql("ALTER TABLE surveys DROP COLUMN title_es;");
            migrationBuilder.RenameColumn(name: "title_en", table: "surveys", newName: "title");
            migrationBuilder.Sql("UPDATE surveys SET title = '' WHERE title IS NULL;");
            migrationBuilder.Sql("ALTER TABLE surveys ALTER COLUMN title SET NOT NULL;");
            migrationBuilder.Sql("UPDATE surveys SET description_en = COALESCE(description_en, description_es);");
            migrationBuilder.Sql("ALTER TABLE surveys DROP COLUMN description_es;");
            migrationBuilder.RenameColumn(name: "description_en", table: "surveys", newName: "description");
            migrationBuilder.Sql("UPDATE surveys SET settings_invitation_custom_message_en = COALESCE(settings_invitation_custom_message_en, settings_invitation_custom_message_es);");
            migrationBuilder.Sql("ALTER TABLE surveys DROP COLUMN settings_invitation_custom_message_es;");
            migrationBuilder.RenameColumn(name: "settings_invitation_custom_message_en", table: "surveys", newName: "settings_invitation_custom_message");
            migrationBuilder.Sql("UPDATE surveys SET settings_invitation_custom_subject_en = COALESCE(settings_invitation_custom_subject_en, settings_invitation_custom_subject_es);");
            migrationBuilder.Sql("ALTER TABLE surveys DROP COLUMN settings_invitation_custom_subject_es;");
            migrationBuilder.RenameColumn(name: "settings_invitation_custom_subject_en", table: "surveys", newName: "settings_invitation_custom_subject");
            migrationBuilder.Sql("UPDATE survey_versions SET title_en = COALESCE(title_en, title_es);");
            migrationBuilder.Sql("ALTER TABLE survey_versions DROP COLUMN title_es;");
            migrationBuilder.RenameColumn(name: "title_en", table: "survey_versions", newName: "title");
            migrationBuilder.Sql("UPDATE survey_versions SET title = '' WHERE title IS NULL;");
            migrationBuilder.Sql("ALTER TABLE survey_versions ALTER COLUMN title SET NOT NULL;");
            migrationBuilder.Sql("UPDATE survey_versions SET description_en = COALESCE(description_en, description_es);");
            migrationBuilder.Sql("ALTER TABLE survey_versions DROP COLUMN description_es;");
            migrationBuilder.RenameColumn(name: "description_en", table: "survey_versions", newName: "description");
            migrationBuilder.Sql("UPDATE microclimates SET title_en = COALESCE(title_en, title_es);");
            migrationBuilder.Sql("ALTER TABLE microclimates DROP COLUMN title_es;");
            migrationBuilder.RenameColumn(name: "title_en", table: "microclimates", newName: "title");
            migrationBuilder.Sql("UPDATE microclimates SET title = '' WHERE title IS NULL;");
            migrationBuilder.Sql("ALTER TABLE microclimates ALTER COLUMN title SET NOT NULL;");
            migrationBuilder.Sql("UPDATE microclimates SET description_en = COALESCE(description_en, description_es);");
            migrationBuilder.Sql("ALTER TABLE microclimates DROP COLUMN description_es;");
            migrationBuilder.RenameColumn(name: "description_en", table: "microclimates", newName: "description");
            migrationBuilder.Sql("UPDATE microclimate_questions SET text_en = COALESCE(text_en, text_es);");
            migrationBuilder.Sql("ALTER TABLE microclimate_questions DROP COLUMN text_es;");
            migrationBuilder.RenameColumn(name: "text_en", table: "microclimate_questions", newName: "text");
            migrationBuilder.Sql("UPDATE microclimate_questions SET text = '' WHERE text IS NULL;");
            migrationBuilder.Sql("ALTER TABLE microclimate_questions ALTER COLUMN text SET NOT NULL;");
            migrationBuilder.Sql("UPDATE microclimate_template_questions SET text_en = COALESCE(text_en, text_es);");
            migrationBuilder.Sql("ALTER TABLE microclimate_template_questions DROP COLUMN text_es;");
            migrationBuilder.RenameColumn(name: "text_en", table: "microclimate_template_questions", newName: "text");
            migrationBuilder.Sql("UPDATE microclimate_template_questions SET text = '' WHERE text IS NULL;");
            migrationBuilder.Sql("ALTER TABLE microclimate_template_questions ALTER COLUMN text SET NOT NULL;");
            migrationBuilder.Sql("UPDATE demographic_fields SET label_en = COALESCE(label_en, label_es);");
            migrationBuilder.Sql("ALTER TABLE demographic_fields DROP COLUMN label_es;");
            migrationBuilder.RenameColumn(name: "label_en", table: "demographic_fields", newName: "label");
            migrationBuilder.Sql("UPDATE demographic_fields SET label = '' WHERE label IS NULL;");
            migrationBuilder.Sql("ALTER TABLE demographic_fields ALTER COLUMN label SET NOT NULL;");
            migrationBuilder.Sql("UPDATE system_settings SET maintenance_message_en = COALESCE(maintenance_message_en, maintenance_message_es);");
            migrationBuilder.Sql("ALTER TABLE system_settings DROP COLUMN maintenance_message_es;");
            migrationBuilder.RenameColumn(name: "maintenance_message_en", table: "system_settings", newName: "maintenance_message");
            migrationBuilder.Sql("UPDATE notification_templates SET subject_en = COALESCE(subject_en, subject_es);");
            migrationBuilder.Sql("ALTER TABLE notification_templates DROP COLUMN subject_es;");
            migrationBuilder.RenameColumn(name: "subject_en", table: "notification_templates", newName: "subject");
            migrationBuilder.Sql("UPDATE notification_templates SET title_en = COALESCE(title_en, title_es);");
            migrationBuilder.Sql("ALTER TABLE notification_templates DROP COLUMN title_es;");
            migrationBuilder.RenameColumn(name: "title_en", table: "notification_templates", newName: "title");
            migrationBuilder.Sql("UPDATE notification_templates SET title = '' WHERE title IS NULL;");
            migrationBuilder.Sql("ALTER TABLE notification_templates ALTER COLUMN title SET NOT NULL;");
            migrationBuilder.Sql("UPDATE notification_templates SET content_en = COALESCE(content_en, content_es);");
            migrationBuilder.Sql("ALTER TABLE notification_templates DROP COLUMN content_es;");
            migrationBuilder.RenameColumn(name: "content_en", table: "notification_templates", newName: "content");
            migrationBuilder.Sql("UPDATE notification_templates SET content = '' WHERE content IS NULL;");
            migrationBuilder.Sql("ALTER TABLE notification_templates ALTER COLUMN content SET NOT NULL;");
            migrationBuilder.Sql("UPDATE notification_templates SET html_content_en = COALESCE(html_content_en, html_content_es);");
            migrationBuilder.Sql("ALTER TABLE notification_templates DROP COLUMN html_content_es;");
            migrationBuilder.RenameColumn(name: "html_content_en", table: "notification_templates", newName: "html_content");
        }
    }
}
