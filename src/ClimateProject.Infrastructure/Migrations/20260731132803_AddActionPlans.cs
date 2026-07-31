using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddActionPlans : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "action_plans",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    description = table.Column<string>(type: "text", nullable: false),
                    company_id = table.Column<Guid>(type: "uuid", nullable: false),
                    department_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    due_date = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "not_started"),
                    priority = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "medium"),
                    ai_recommendations = table.Column<string[]>(type: "text[]", nullable: false, defaultValue: new string[0]),
                    tags = table.Column<string[]>(type: "text[]", nullable: false, defaultValue: new string[0]),
                    template_id = table.Column<Guid>(type: "uuid", nullable: true),
                    source_survey_id = table.Column<Guid>(type: "uuid", nullable: true),
                    source_insight_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_action_plans", x => x.Id);
                    table.ForeignKey(
                        name: "FK_action_plans_action_plan_templates_template_id",
                        column: x => x.template_id,
                        principalTable: "action_plan_templates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_action_plans_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_action_plans_departments_department_id",
                        column: x => x.department_id,
                        principalTable: "departments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_action_plans_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_action_plans_company_id_status",
                table: "action_plans",
                columns: new[] { "company_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_action_plans_created_by",
                table: "action_plans",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_action_plans_department_id",
                table: "action_plans",
                column: "department_id");

            migrationBuilder.CreateIndex(
                name: "IX_action_plans_due_date",
                table: "action_plans",
                column: "due_date");

            migrationBuilder.CreateIndex(
                name: "IX_action_plans_template_id",
                table: "action_plans",
                column: "template_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "action_plans");
        }
    }
}
