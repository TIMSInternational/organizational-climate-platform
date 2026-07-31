using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddActionPlanTemplates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "action_plan_templates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    description = table.Column<string>(type: "text", nullable: false),
                    category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    company_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    ai_recommendation_templates = table.Column<string[]>(type: "text[]", nullable: false, defaultValue: new string[0]),
                    tags = table.Column<string[]>(type: "text[]", nullable: false, defaultValue: new string[0]),
                    usage_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_action_plan_templates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_action_plan_templates_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_action_plan_templates_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_action_plan_templates_company_id_category",
                table: "action_plan_templates",
                columns: new[] { "company_id", "category" });

            migrationBuilder.CreateIndex(
                name: "IX_action_plan_templates_created_by",
                table: "action_plan_templates",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_action_plan_templates_is_active",
                table: "action_plan_templates",
                column: "is_active");

            migrationBuilder.CreateIndex(
                name: "IX_action_plan_templates_usage_count",
                table: "action_plan_templates",
                column: "usage_count");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "action_plan_templates");
        }
    }
}
