using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCompanyProfileFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "branding_custom_css",
                table: "companies",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "branding_font_family",
                table: "companies",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "Inter");

            migrationBuilder.AddColumn<string>(
                name: "branding_logo_url",
                table: "companies",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "branding_primary_color",
                table: "companies",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "#3B82F6");

            migrationBuilder.AddColumn<string>(
                name: "branding_secondary_color",
                table: "companies",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "#1F2937");

            migrationBuilder.AddColumn<string>(
                name: "country",
                table: "companies",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "industry",
                table: "companies",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "settings_ai_insights_enabled",
                table: "companies",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "settings_anonymous_surveys",
                table: "companies",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "settings_data_retention_days",
                table: "companies",
                type: "integer",
                nullable: false,
                defaultValue: 2555);

            migrationBuilder.AddColumn<string>(
                name: "settings_language",
                table: "companies",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "en");

            migrationBuilder.AddColumn<bool>(
                name: "settings_microclimate_enabled",
                table: "companies",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "settings_survey_frequency",
                table: "companies",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "quarterly");

            migrationBuilder.AddColumn<string>(
                name: "settings_timezone",
                table: "companies",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "UTC");

            migrationBuilder.AddColumn<string>(
                name: "size",
                table: "companies",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "subscription_tier",
                table: "companies",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "branding_custom_css",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "branding_font_family",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "branding_logo_url",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "branding_primary_color",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "branding_secondary_color",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "country",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "industry",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "settings_ai_insights_enabled",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "settings_anonymous_surveys",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "settings_data_retention_days",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "settings_language",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "settings_microclimate_enabled",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "settings_survey_frequency",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "settings_timezone",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "size",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "subscription_tier",
                table: "companies");
        }
    }
}
