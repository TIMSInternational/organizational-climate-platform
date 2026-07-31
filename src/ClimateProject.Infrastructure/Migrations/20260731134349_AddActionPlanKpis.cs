using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddActionPlanKpis : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "action_plan_kpis",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    action_plan_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    target_value = table.Column<decimal>(type: "numeric", nullable: false),
                    current_value = table.Column<decimal>(type: "numeric", nullable: false, defaultValue: 0m),
                    unit = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    measurement_frequency = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_action_plan_kpis", x => x.Id);
                    table.ForeignKey(
                        name: "FK_action_plan_kpis_action_plans_action_plan_id",
                        column: x => x.action_plan_id,
                        principalTable: "action_plans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_action_plan_kpis_action_plan_id",
                table: "action_plan_kpis",
                column: "action_plan_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "action_plan_kpis");
        }
    }
}
