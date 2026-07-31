using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddActionPlanObjectives : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "action_plan_objectives",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    action_plan_id = table.Column<Guid>(type: "uuid", nullable: false),
                    description = table.Column<string>(type: "text", nullable: false),
                    success_criteria = table.Column<string>(type: "text", nullable: false),
                    current_status = table.Column<string>(type: "text", nullable: false, defaultValue: ""),
                    completion_percentage = table.Column<int>(type: "integer", nullable: false, defaultValue: 0)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_action_plan_objectives", x => x.Id);
                    table.ForeignKey(
                        name: "FK_action_plan_objectives_action_plans_action_plan_id",
                        column: x => x.action_plan_id,
                        principalTable: "action_plans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_action_plan_objectives_action_plan_id",
                table: "action_plan_objectives",
                column: "action_plan_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "action_plan_objectives");
        }
    }
}
