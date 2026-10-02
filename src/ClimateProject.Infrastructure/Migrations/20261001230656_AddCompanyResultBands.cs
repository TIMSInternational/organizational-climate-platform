using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCompanyResultBands : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "settings_band_critical_name",
                table: "companies",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "settings_band_opportunity_min",
                table: "companies",
                type: "numeric(3,2)",
                precision: 3,
                scale: 2,
                nullable: false,
                defaultValue: 3.00m);

            migrationBuilder.AddColumn<string>(
                name: "settings_band_opportunity_name",
                table: "companies",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "settings_band_strength_min",
                table: "companies",
                type: "numeric(3,2)",
                precision: 3,
                scale: 2,
                nullable: false,
                defaultValue: 4.00m);

            migrationBuilder.AddColumn<string>(
                name: "settings_band_strength_name",
                table: "companies",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "settings_band_critical_name",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "settings_band_opportunity_min",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "settings_band_opportunity_name",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "settings_band_strength_min",
                table: "companies");

            migrationBuilder.DropColumn(
                name: "settings_band_strength_name",
                table: "companies");
        }
    }
}
