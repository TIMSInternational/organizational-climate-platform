using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class SurveyRespondentTexts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "settings_closing_message_en",
                table: "surveys",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "settings_closing_message_es",
                table: "surveys",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "settings_respondent_intro_en",
                table: "surveys",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "settings_respondent_intro_es",
                table: "surveys",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "settings_closing_message_en",
                table: "surveys");

            migrationBuilder.DropColumn(
                name: "settings_closing_message_es",
                table: "surveys");

            migrationBuilder.DropColumn(
                name: "settings_respondent_intro_en",
                table: "surveys");

            migrationBuilder.DropColumn(
                name: "settings_respondent_intro_es",
                table: "surveys");
        }
    }
}
