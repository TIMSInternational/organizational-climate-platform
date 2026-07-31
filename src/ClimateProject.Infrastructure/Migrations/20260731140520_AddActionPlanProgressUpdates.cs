using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddActionPlanProgressUpdates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "action_plan_progress_updates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    action_plan_id = table.Column<Guid>(type: "uuid", nullable: false),
                    update_date = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    overall_notes = table.Column<string>(type: "text", nullable: false, defaultValue: ""),
                    updated_by = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_action_plan_progress_updates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_action_plan_progress_updates_action_plans_action_plan_id",
                        column: x => x.action_plan_id,
                        principalTable: "action_plans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_action_plan_progress_updates_users_updated_by",
                        column: x => x.updated_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_action_plan_progress_updates_action_plan_id",
                table: "action_plan_progress_updates",
                column: "action_plan_id");

            migrationBuilder.CreateIndex(
                name: "IX_action_plan_progress_updates_updated_by",
                table: "action_plan_progress_updates",
                column: "updated_by");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "action_plan_progress_updates");
        }
    }
}
