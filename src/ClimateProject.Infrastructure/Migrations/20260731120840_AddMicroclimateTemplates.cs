using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddMicroclimateTemplates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "microclimate_templates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    category = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    company_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    is_system_template = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    usage_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    tags = table.Column<string[]>(type: "text[]", nullable: false, defaultValue: new string[0]),
                    settings_default_duration_minutes = table.Column<int>(type: "integer", nullable: false, defaultValue: 30),
                    settings_suggested_frequency = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "weekly"),
                    settings_max_participants = table.Column<int>(type: "integer", nullable: true),
                    settings_anonymous_by_default = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    settings_auto_close = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    settings_show_live_results = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_microclimate_templates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_microclimate_templates_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_microclimate_templates_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "microclimate_template_questions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    text = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    options = table.Column<string[]>(type: "text[]", nullable: true),
                    required = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    question_order = table.Column<int>(type: "integer", nullable: false),
                    category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_microclimate_template_questions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_microclimate_template_questions_microclimate_templates_temp~",
                        column: x => x.template_id,
                        principalTable: "microclimate_templates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_microclimate_template_questions_template_id",
                table: "microclimate_template_questions",
                column: "template_id");

            migrationBuilder.CreateIndex(
                name: "IX_microclimate_templates_category_is_active",
                table: "microclimate_templates",
                columns: new[] { "category", "is_active" });

            migrationBuilder.CreateIndex(
                name: "IX_microclimate_templates_company_id_is_active",
                table: "microclimate_templates",
                columns: new[] { "company_id", "is_active" });

            migrationBuilder.CreateIndex(
                name: "IX_microclimate_templates_created_by",
                table: "microclimate_templates",
                column: "created_by");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "microclimate_template_questions");

            migrationBuilder.DropTable(
                name: "microclimate_templates");
        }
    }
}
