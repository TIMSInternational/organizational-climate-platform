using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddNotificationTemplates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "notification_templates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    channel = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    subject = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    content = table.Column<string>(type: "text", nullable: false),
                    html_content = table.Column<string>(type: "text", nullable: true),
                    company_id = table.Column<Guid>(type: "uuid", nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    is_default = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_notification_templates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_notification_templates_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_notification_templates_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "notification_personalization_rules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    notification_template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    condition = table.Column<string>(type: "text", nullable: false),
                    modifications = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_notification_personalization_rules", x => x.Id);
                    table.ForeignKey(
                        name: "FK_notification_personalization_rules_notification_templates_n~",
                        column: x => x.notification_template_id,
                        principalTable: "notification_templates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "notification_template_variables",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    notification_template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    required = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    default_value = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_notification_template_variables", x => x.Id);
                    table.ForeignKey(
                        name: "FK_notification_template_variables_notification_templates_noti~",
                        column: x => x.notification_template_id,
                        principalTable: "notification_templates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_notifications_template_id",
                table: "notifications",
                column: "template_id");

            migrationBuilder.CreateIndex(
                name: "IX_notification_personalization_rules_notification_template_id",
                table: "notification_personalization_rules",
                column: "notification_template_id");

            migrationBuilder.CreateIndex(
                name: "IX_notification_template_variables_notification_template_id",
                table: "notification_template_variables",
                column: "notification_template_id");

            migrationBuilder.CreateIndex(
                name: "IX_notification_templates_company_id_is_active",
                table: "notification_templates",
                columns: new[] { "company_id", "is_active" });

            migrationBuilder.CreateIndex(
                name: "IX_notification_templates_created_by",
                table: "notification_templates",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_notification_templates_is_default_is_active",
                table: "notification_templates",
                columns: new[] { "is_default", "is_active" });

            migrationBuilder.CreateIndex(
                name: "IX_notification_templates_type_channel",
                table: "notification_templates",
                columns: new[] { "type", "channel" });

            migrationBuilder.AddForeignKey(
                name: "FK_notifications_notification_templates_template_id",
                table: "notifications",
                column: "template_id",
                principalTable: "notification_templates",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_notifications_notification_templates_template_id",
                table: "notifications");

            migrationBuilder.DropTable(
                name: "notification_personalization_rules");

            migrationBuilder.DropTable(
                name: "notification_template_variables");

            migrationBuilder.DropTable(
                name: "notification_templates");

            migrationBuilder.DropIndex(
                name: "IX_notifications_template_id",
                table: "notifications");
        }
    }
}
