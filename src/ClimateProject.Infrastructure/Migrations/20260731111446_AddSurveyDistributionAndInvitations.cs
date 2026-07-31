using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSurveyDistributionAndInvitations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "survey_distributions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    survey_id = table.Column<Guid>(type: "uuid", nullable: false),
                    access_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "tokenized"),
                    public_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    qr_code_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    qr_code_svg_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    qr_code_png_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    qr_code_pdf_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    tokenized_links_generated = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    regenerated_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    last_regenerated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_regenerated_by = table.Column<Guid>(type: "uuid", nullable: true),
                    total_accesses = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    unique_visitors = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    last_accessed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    access_rules_require_login = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    access_rules_allow_anonymous = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    access_rules_single_response = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    access_rules_active_outside_schedule = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    access_rules_allowed_domains = table.Column<string[]>(type: "text[]", nullable: true),
                    access_rules_blocked_ips = table.Column<string[]>(type: "text[]", nullable: true),
                    access_rules_max_responses = table.Column<int>(type: "integer", nullable: true),
                    qr_customization_foreground_color = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "#000000"),
                    qr_customization_background_color = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "#FFFFFF"),
                    qr_customization_logo_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    qr_customization_size = table.Column<int>(type: "integer", nullable: false, defaultValue: 300),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_survey_distributions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_survey_distributions_surveys_survey_id",
                        column: x => x.survey_id,
                        principalTable: "surveys",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_survey_distributions_users_last_regenerated_by",
                        column: x => x.last_regenerated_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "survey_invitations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    survey_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    company_id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    invitation_token = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "pending"),
                    sent_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    opened_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    reminder_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    last_reminder_sent = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    metadata = table.Column<string>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_survey_invitations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_survey_invitations_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_survey_invitations_surveys_survey_id",
                        column: x => x.survey_id,
                        principalTable: "surveys",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_survey_invitations_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_survey_distributions_last_regenerated_by",
                table: "survey_distributions",
                column: "last_regenerated_by");

            migrationBuilder.CreateIndex(
                name: "IX_survey_distributions_public_url",
                table: "survey_distributions",
                column: "public_url",
                unique: true,
                filter: "public_url IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_survey_distributions_survey_id",
                table: "survey_distributions",
                column: "survey_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_survey_invitations_company_id",
                table: "survey_invitations",
                column: "company_id");

            migrationBuilder.CreateIndex(
                name: "IX_survey_invitations_invitation_token",
                table: "survey_invitations",
                column: "invitation_token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_survey_invitations_survey_id_user_id",
                table: "survey_invitations",
                columns: new[] { "survey_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_survey_invitations_user_id",
                table: "survey_invitations",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "survey_distributions");

            migrationBuilder.DropTable(
                name: "survey_invitations");
        }
    }
}
