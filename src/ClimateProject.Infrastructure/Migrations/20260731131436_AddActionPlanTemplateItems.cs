using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddActionPlanTemplateItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "action_plan_template_kpis",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    target_value = table.Column<decimal>(type: "numeric", nullable: false),
                    unit = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    measurement_frequency = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_action_plan_template_kpis", x => x.Id);
                    table.ForeignKey(
                        name: "FK_action_plan_template_kpis_action_plan_templates_template_id",
                        column: x => x.template_id,
                        principalTable: "action_plan_templates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "action_plan_template_objectives",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    description = table.Column<string>(type: "text", nullable: false),
                    success_criteria = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_action_plan_template_objectives", x => x.Id);
                    table.ForeignKey(
                        name: "FK_action_plan_template_objectives_action_plan_templates_templ~",
                        column: x => x.template_id,
                        principalTable: "action_plan_templates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_action_plan_template_kpis_template_id",
                table: "action_plan_template_kpis",
                column: "template_id");

            migrationBuilder.CreateIndex(
                name: "IX_action_plan_template_objectives_template_id",
                table: "action_plan_template_objectives",
                column: "template_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "action_plan_template_kpis");

            migrationBuilder.DropTable(
                name: "action_plan_template_objectives");
        }
    }
}
