using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSurveyTemplates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "survey_templates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    category = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    industry = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    company_size = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    is_public = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    company_id = table.Column<Guid>(type: "uuid", nullable: true),
                    usage_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    rating = table.Column<double>(type: "double precision", nullable: false, defaultValue: 0.0),
                    tags = table.Column<string[]>(type: "text[]", nullable: false, defaultValueSql: "ARRAY[]::text[]"),
                    source_survey_id = table.Column<Guid>(type: "uuid", nullable: true),
                    last_used = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_survey_templates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_survey_templates_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_survey_templates_surveys_source_survey_id",
                        column: x => x.source_survey_id,
                        principalTable: "surveys",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_survey_templates_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "template_questions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    text = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    options = table.Column<string[]>(type: "text[]", nullable: true),
                    scale_min = table.Column<int>(type: "integer", nullable: true),
                    scale_max = table.Column<int>(type: "integer", nullable: true),
                    scale_label_min = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    scale_label_max = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    comment_required = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    comment_prompt = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false, defaultValue: "Please explain your answer:"),
                    binary_comment_config = table.Column<string>(type: "jsonb", nullable: true),
                    required = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    order = table.Column<int>(type: "integer", nullable: false),
                    category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_template_questions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_template_questions_survey_templates_template_id",
                        column: x => x.template_id,
                        principalTable: "survey_templates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_survey_templates_company_id",
                table: "survey_templates",
                column: "company_id");

            migrationBuilder.CreateIndex(
                name: "IX_survey_templates_created_by",
                table: "survey_templates",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_survey_templates_source_survey_id",
                table: "survey_templates",
                column: "source_survey_id");

            migrationBuilder.CreateIndex(
                name: "IX_template_questions_template_id",
                table: "template_questions",
                column: "template_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "template_questions");

            migrationBuilder.DropTable(
                name: "survey_templates");
        }
    }
}
