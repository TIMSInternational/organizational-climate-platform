using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// «Mantener al final» (ruled 2026-11-18, PROCOMER): <c>questions.keep_at_end</c>, asked after
    /// every other question whether or not the survey is randomised. NOT NULL with a false default,
    /// so every existing question keeps the order it has always been asked in. One new column and
    /// nothing else, so Down is a drop.
    /// </summary>
    public partial class QuestionKeepAtEnd : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "keep_at_end",
                table: "questions",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "keep_at_end",
                table: "questions");
        }
    }
}
