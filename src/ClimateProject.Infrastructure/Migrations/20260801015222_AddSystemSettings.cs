using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSystemSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "system_settings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    login_enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    maintenance_mode = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    maintenance_message = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    max_login_attempts = table.Column<int>(type: "integer", nullable: false, defaultValue: 5),
                    session_timeout_minutes = table.Column<int>(type: "integer", nullable: false, defaultValue: 60),
                    password_min_length = table.Column<int>(type: "integer", nullable: false, defaultValue: 8),
                    password_require_uppercase = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    password_require_lowercase = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    password_require_numbers = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    password_require_special_chars = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    email_smtp_enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    email_from_email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    email_smtp_host = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    email_smtp_port = table.Column<int>(type: "integer", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_system_settings", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "system_settings");
        }
    }
}
