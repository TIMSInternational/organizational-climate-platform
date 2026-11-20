using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class EditableRespondentContent : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "notes_conclusions_en",
                table: "reports",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "notes_conclusions_es",
                table: "reports",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "notes_intro_en",
                table: "reports",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "notes_intro_es",
                table: "reports",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "notes_recommendations_en",
                table: "reports",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "notes_recommendations_es",
                table: "reports",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "respondent_content_overrides",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    company_id = table.Column<Guid>(type: "uuid", nullable: false),
                    survey_id = table.Column<Guid>(type: "uuid", nullable: true),
                    key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    locale = table.Column<string>(type: "character varying(5)", maxLength: 5, nullable: false),
                    value = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    updated_by = table.Column<Guid>(type: "uuid", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_respondent_content_overrides", x => x.id);
                    table.ForeignKey(
                        name: "FK_respondent_content_overrides_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_respondent_content_overrides_surveys_survey_id",
                        column: x => x.survey_id,
                        principalTable: "surveys",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_respondent_content_overrides_users_updated_by",
                        column: x => x.updated_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "survey_authorized_people",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    survey_id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    display_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    added_by = table.Column<Guid>(type: "uuid", nullable: true),
                    added_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_survey_authorized_people", x => x.id);
                    table.ForeignKey(
                        name: "FK_survey_authorized_people_surveys_survey_id",
                        column: x => x.survey_id,
                        principalTable: "surveys",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_survey_authorized_people_users_added_by",
                        column: x => x.added_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_respondent_content_overrides_survey_id",
                table: "respondent_content_overrides",
                column: "survey_id");

            migrationBuilder.CreateIndex(
                name: "IX_respondent_content_overrides_updated_by",
                table: "respondent_content_overrides",
                column: "updated_by");

            migrationBuilder.CreateIndex(
                name: "ux_respondent_content_overrides_company_key_locale",
                table: "respondent_content_overrides",
                columns: new[] { "company_id", "key", "locale" },
                unique: true,
                filter: "survey_id IS NULL");

            migrationBuilder.CreateIndex(
                name: "ux_respondent_content_overrides_survey_key_locale",
                table: "respondent_content_overrides",
                columns: new[] { "company_id", "survey_id", "key", "locale" },
                unique: true,
                filter: "survey_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_survey_authorized_people_added_by",
                table: "survey_authorized_people",
                column: "added_by");

            migrationBuilder.CreateIndex(
                name: "IX_survey_authorized_people_survey_id_email",
                table: "survey_authorized_people",
                columns: new[] { "survey_id", "email" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "respondent_content_overrides");

            migrationBuilder.DropTable(
                name: "survey_authorized_people");

            migrationBuilder.DropColumn(
                name: "notes_conclusions_en",
                table: "reports");

            migrationBuilder.DropColumn(
                name: "notes_conclusions_es",
                table: "reports");

            migrationBuilder.DropColumn(
                name: "notes_intro_en",
                table: "reports");

            migrationBuilder.DropColumn(
                name: "notes_intro_es",
                table: "reports");

            migrationBuilder.DropColumn(
                name: "notes_recommendations_en",
                table: "reports");

            migrationBuilder.DropColumn(
                name: "notes_recommendations_es",
                table: "reports");
        }
    }
}
