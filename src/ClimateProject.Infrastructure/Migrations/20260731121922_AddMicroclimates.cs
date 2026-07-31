using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddMicroclimates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "microclimates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    company_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    template_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "draft"),
                    response_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    target_participant_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    participation_rate = table.Column<double>(type: "double precision", nullable: false, defaultValue: 0.0),
                    targeting_role_filters = table.Column<string[]>(type: "text[]", nullable: true),
                    targeting_tenure_filters = table.Column<string[]>(type: "text[]", nullable: true),
                    targeting_custom_filters = table.Column<string>(type: "jsonb", nullable: true),
                    targeting_include_managers = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    targeting_max_participants = table.Column<int>(type: "integer", nullable: true),
                    scheduling_start_time = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    scheduling_end_time = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    scheduling_timezone = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false, defaultValue: "UTC"),
                    scheduling_reminder_schedule = table.Column<string>(type: "jsonb", nullable: true),
                    realtime_settings_show_live_results = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    realtime_settings_anonymous_responses = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    realtime_settings_allow_comments = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    realtime_settings_word_cloud_enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    realtime_settings_sentiment_analysis_enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    realtime_settings_participation_threshold = table.Column<int>(type: "integer", nullable: false, defaultValue: 3),
                    live_results_sentiment_score = table.Column<double>(type: "double precision", nullable: false, defaultValue: 0.0),
                    live_results_engagement_level = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false, defaultValue: "medium"),
                    live_results_top_themes = table.Column<string[]>(type: "text[]", nullable: false, defaultValue: new string[0]),
                    live_results_word_cloud_data = table.Column<string>(type: "jsonb", nullable: true),
                    live_results_response_distribution = table.Column<string>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_microclimates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_microclimates_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_microclimates_microclimate_templates_template_id",
                        column: x => x.template_id,
                        principalTable: "microclimate_templates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_microclimates_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "microclimate_department_targets",
                columns: table => new
                {
                    microclimate_id = table.Column<Guid>(type: "uuid", nullable: false),
                    department_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_microclimate_department_targets", x => new { x.microclimate_id, x.department_id });
                    table.ForeignKey(
                        name: "FK_microclimate_department_targets_departments_department_id",
                        column: x => x.department_id,
                        principalTable: "departments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_microclimate_department_targets_microclimates_microclimate_~",
                        column: x => x.microclimate_id,
                        principalTable: "microclimates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_microclimate_department_targets_department_id",
                table: "microclimate_department_targets",
                column: "department_id");

            migrationBuilder.CreateIndex(
                name: "IX_microclimates_company_id_status",
                table: "microclimates",
                columns: new[] { "company_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_microclimates_created_by",
                table: "microclimates",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_microclimates_template_id",
                table: "microclimates",
                column: "template_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "microclimate_department_targets");

            migrationBuilder.DropTable(
                name: "microclimates");
        }
    }
}
