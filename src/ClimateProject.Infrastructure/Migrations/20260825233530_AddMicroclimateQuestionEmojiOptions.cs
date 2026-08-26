using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// The storage that lets <c>emoji_rating</c> join the microclimate vocabulary (#198).
    /// </summary>
    /// <remarks>
    /// <b>Additive only.</b> <c>Up</c> creates one new table and its unique index and
    /// touches nothing that exists, so it cannot fail on, rewrite or lock existing data,
    /// and an older build keeps running against a database that has already taken it.
    /// </remarks>
    public partial class AddMicroclimateQuestionEmojiOptions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "microclimate_question_emoji_options",
                columns: table => new
                {
                    microclimate_question_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order = table.Column<int>(type: "integer", nullable: false),
                    emoji = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    label_en = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    label_es = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    value = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_microclimate_question_emoji_options", x => new { x.microclimate_question_id, x.order });
                    table.ForeignKey(
                        name: "FK_microclimate_question_emoji_options_microclimate_questions_~",
                        column: x => x.microclimate_question_id,
                        principalTable: "microclimate_questions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_microclimate_question_emoji_options_microclimate_question_i~",
                table: "microclimate_question_emoji_options",
                columns: new[] { "microclimate_question_id", "value" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "microclimate_question_emoji_options");
        }
    }
}
