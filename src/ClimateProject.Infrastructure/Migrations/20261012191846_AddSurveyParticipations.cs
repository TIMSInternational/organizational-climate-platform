using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSurveyParticipations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "settings_collect_participant_identity",
                table: "surveys",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "survey_participations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    survey_id = table.Column<Guid>(type: "uuid", nullable: false),
                    company_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: true),
                    participated_on = table.Column<DateOnly>(type: "date", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_survey_participations", x => x.id);
                    table.ForeignKey(
                        name: "FK_survey_participations_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_survey_participations_surveys_survey_id",
                        column: x => x.survey_id,
                        principalTable: "surveys",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_survey_participations_company_id",
                table: "survey_participations",
                column: "company_id");

            migrationBuilder.CreateIndex(
                name: "IX_survey_participations_survey_id_email",
                table: "survey_participations",
                columns: new[] { "survey_id", "email" },
                unique: true,
                filter: "email IS NOT NULL");

            // Names and emails: personal data. LockDownPostgrestRoles revoked the PostgREST
            // roles' default privileges, which covers this table, and asks every later table
            // holding personal data to enable RLS as the second layer, because RLS does not
            // extend to tables created after it. The application connects as the owner with
            // rolbypassrls, so this changes nothing for it.
            migrationBuilder.Sql("ALTER TABLE survey_participations ENABLE ROW LEVEL SECURITY;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "survey_participations");

            migrationBuilder.DropColumn(
                name: "settings_collect_participant_identity",
                table: "surveys");
        }
    }
}
