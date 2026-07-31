using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAnalyticsAndAiInsightsTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ai_insights",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    survey_id = table.Column<Guid>(type: "uuid", nullable: true),
                    company_id = table.Column<Guid>(type: "uuid", nullable: false),
                    department_id = table.Column<Guid>(type: "uuid", nullable: true),
                    type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    confidence_score = table.Column<int>(type: "integer", nullable: false),
                    priority = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    affected_segments = table.Column<List<string>>(type: "text[]", nullable: false, defaultValueSql: "ARRAY[]::text[]"),
                    recommended_actions = table.Column<List<string>>(type: "text[]", nullable: false, defaultValueSql: "ARRAY[]::text[]"),
                    supporting_data = table.Column<string>(type: "jsonb", nullable: true),
                    is_acknowledged = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    acknowledged_by = table.Column<Guid>(type: "uuid", nullable: true),
                    acknowledged_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ai_insights", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ai_insights_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ai_insights_departments_department_id",
                        column: x => x.department_id,
                        principalTable: "departments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_ai_insights_users_acknowledged_by",
                        column: x => x.acknowledged_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "analytics_insights",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    survey_id = table.Column<Guid>(type: "uuid", nullable: true),
                    company_id = table.Column<Guid>(type: "uuid", nullable: false),
                    department_id = table.Column<Guid>(type: "uuid", nullable: true),
                    aggregation_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    metric_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    metric_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    metric_description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    total_responses = table.Column<int>(type: "integer", nullable: false),
                    calculation_date = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    is_current = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_analytics_insights", x => x.Id);
                    table.ForeignKey(
                        name: "FK_analytics_insights_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_analytics_insights_departments_department_id",
                        column: x => x.department_id,
                        principalTable: "departments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "analytics_metric_data",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    insight_id = table.Column<Guid>(type: "uuid", nullable: false),
                    label = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    value = table.Column<double>(type: "double precision", nullable: false),
                    count = table.Column<int>(type: "integer", nullable: true),
                    percentage = table.Column<double>(type: "double precision", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_analytics_metric_data", x => x.Id);
                    table.ForeignKey(
                        name: "FK_analytics_metric_data_analytics_insights_insight_id",
                        column: x => x.insight_id,
                        principalTable: "analytics_insights",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "analytics_time_series",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    insight_id = table.Column<Guid>(type: "uuid", nullable: false),
                    date = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    value = table.Column<double>(type: "double precision", nullable: false),
                    count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_analytics_time_series", x => x.Id);
                    table.ForeignKey(
                        name: "FK_analytics_time_series_analytics_insights_insight_id",
                        column: x => x.insight_id,
                        principalTable: "analytics_insights",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ai_insights_acknowledged_by",
                table: "ai_insights",
                column: "acknowledged_by");

            migrationBuilder.CreateIndex(
                name: "IX_ai_insights_company_id_is_acknowledged",
                table: "ai_insights",
                columns: new[] { "company_id", "is_acknowledged" });

            migrationBuilder.CreateIndex(
                name: "IX_ai_insights_created_at",
                table: "ai_insights",
                column: "created_at");

            migrationBuilder.CreateIndex(
                name: "IX_ai_insights_department_id",
                table: "ai_insights",
                column: "department_id");

            migrationBuilder.CreateIndex(
                name: "IX_ai_insights_expires_at",
                table: "ai_insights",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "IX_ai_insights_survey_id",
                table: "ai_insights",
                column: "survey_id");

            migrationBuilder.CreateIndex(
                name: "IX_ai_insights_type_priority",
                table: "ai_insights",
                columns: new[] { "type", "priority" });

            migrationBuilder.CreateIndex(
                name: "IX_analytics_insights_aggregation_type_metric_type",
                table: "analytics_insights",
                columns: new[] { "aggregation_type", "metric_type" });

            migrationBuilder.CreateIndex(
                name: "IX_analytics_insights_calculation_date",
                table: "analytics_insights",
                column: "calculation_date");

            migrationBuilder.CreateIndex(
                name: "IX_analytics_insights_company_id_is_current",
                table: "analytics_insights",
                columns: new[] { "company_id", "is_current" });

            migrationBuilder.CreateIndex(
                name: "IX_analytics_insights_department_id",
                table: "analytics_insights",
                column: "department_id");

            migrationBuilder.CreateIndex(
                name: "IX_analytics_insights_survey_id",
                table: "analytics_insights",
                column: "survey_id");

            migrationBuilder.CreateIndex(
                name: "IX_analytics_metric_data_insight_id",
                table: "analytics_metric_data",
                column: "insight_id");

            migrationBuilder.CreateIndex(
                name: "IX_analytics_time_series_insight_id",
                table: "analytics_time_series",
                column: "insight_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ai_insights");

            migrationBuilder.DropTable(
                name: "analytics_metric_data");

            migrationBuilder.DropTable(
                name: "analytics_time_series");

            migrationBuilder.DropTable(
                name: "analytics_insights");
        }
    }
}
