using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddActionPlanProgressUpdateItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "action_plan_kpi_updates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    progress_update_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kpi_id = table.Column<Guid>(type: "uuid", nullable: false),
                    new_value = table.Column<decimal>(type: "numeric", nullable: false),
                    notes = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_action_plan_kpi_updates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_action_plan_kpi_updates_action_plan_kpis_kpi_id",
                        column: x => x.kpi_id,
                        principalTable: "action_plan_kpis",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_action_plan_kpi_updates_action_plan_progress_updates_progre~",
                        column: x => x.progress_update_id,
                        principalTable: "action_plan_progress_updates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "action_plan_objective_updates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    progress_update_id = table.Column<Guid>(type: "uuid", nullable: false),
                    objective_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status_update = table.Column<string>(type: "text", nullable: false),
                    completion_percentage = table.Column<int>(type: "integer", nullable: true),
                    notes = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_action_plan_objective_updates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_action_plan_objective_updates_action_plan_objectives_object~",
                        column: x => x.objective_id,
                        principalTable: "action_plan_objectives",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_action_plan_objective_updates_action_plan_progress_updates_~",
                        column: x => x.progress_update_id,
                        principalTable: "action_plan_progress_updates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_action_plan_kpi_updates_kpi_id",
                table: "action_plan_kpi_updates",
                column: "kpi_id");

            migrationBuilder.CreateIndex(
                name: "IX_action_plan_kpi_updates_progress_update_id",
                table: "action_plan_kpi_updates",
                column: "progress_update_id");

            migrationBuilder.CreateIndex(
                name: "IX_action_plan_objective_updates_objective_id",
                table: "action_plan_objective_updates",
                column: "objective_id");

            migrationBuilder.CreateIndex(
                name: "IX_action_plan_objective_updates_progress_update_id",
                table: "action_plan_objective_updates",
                column: "progress_update_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "action_plan_kpi_updates");

            migrationBuilder.DropTable(
                name: "action_plan_objective_updates");
        }
    }
}
