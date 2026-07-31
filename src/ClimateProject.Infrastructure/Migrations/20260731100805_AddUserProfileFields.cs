using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddUserProfileFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "consent_analytics",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "consent_demographics",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "consent_essential",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "consent_marketing",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "consent_personalization",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "consent_third_party",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "consent_updated_at",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "demographics",
                table: "users",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "department_id",
                table: "users",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "manager_id",
                table: "users",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "preferences_dashboard_layout",
                table: "users",
                type: "character varying(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "default");

            migrationBuilder.AddColumn<string>(
                name: "preferences_language",
                table: "users",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "en");

            migrationBuilder.AddColumn<string>(
                name: "preferences_theme",
                table: "users",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "light");

            migrationBuilder.AddColumn<string>(
                name: "preferences_timezone",
                table: "users",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "UTC");

            migrationBuilder.CreateIndex(
                name: "IX_users_department_id",
                table: "users",
                column: "department_id");

            migrationBuilder.CreateIndex(
                name: "IX_users_manager_id",
                table: "users",
                column: "manager_id");

            migrationBuilder.AddForeignKey(
                name: "FK_users_departments_department_id",
                table: "users",
                column: "department_id",
                principalTable: "departments",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_users_users_manager_id",
                table: "users",
                column: "manager_id",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_users_departments_department_id",
                table: "users");

            migrationBuilder.DropForeignKey(
                name: "FK_users_users_manager_id",
                table: "users");

            migrationBuilder.DropIndex(
                name: "IX_users_department_id",
                table: "users");

            migrationBuilder.DropIndex(
                name: "IX_users_manager_id",
                table: "users");

            migrationBuilder.DropColumn(
                name: "consent_analytics",
                table: "users");

            migrationBuilder.DropColumn(
                name: "consent_demographics",
                table: "users");

            migrationBuilder.DropColumn(
                name: "consent_essential",
                table: "users");

            migrationBuilder.DropColumn(
                name: "consent_marketing",
                table: "users");

            migrationBuilder.DropColumn(
                name: "consent_personalization",
                table: "users");

            migrationBuilder.DropColumn(
                name: "consent_third_party",
                table: "users");

            migrationBuilder.DropColumn(
                name: "consent_updated_at",
                table: "users");

            migrationBuilder.DropColumn(
                name: "demographics",
                table: "users");

            migrationBuilder.DropColumn(
                name: "department_id",
                table: "users");

            migrationBuilder.DropColumn(
                name: "manager_id",
                table: "users");

            migrationBuilder.DropColumn(
                name: "preferences_dashboard_layout",
                table: "users");

            migrationBuilder.DropColumn(
                name: "preferences_language",
                table: "users");

            migrationBuilder.DropColumn(
                name: "preferences_theme",
                table: "users");

            migrationBuilder.DropColumn(
                name: "preferences_timezone",
                table: "users");
        }
    }
}
