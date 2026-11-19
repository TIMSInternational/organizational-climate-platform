using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// «Duplicar» → «Solo las preguntas» (ruled 2026-11-18): <c>surveys.audience_not_chosen</c>,
    /// true on a copy whose audience nobody has chosen yet, which the audience rule then reads as
    /// NOBODY instead of the whole company. NOT NULL with a false default, so every existing survey
    /// keeps exactly the audience it has. One new column and nothing else, so Down is a drop.
    /// </summary>
    public partial class SurveyAudienceNotChosen : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "audience_not_chosen",
                table: "surveys",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "audience_not_chosen",
                table: "surveys");
        }
    }
}
