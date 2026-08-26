using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddQuestionBankProvenance : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "source_question_bank_item_id",
                table: "questions",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_questions_source_question_bank_item_id",
                table: "questions",
                column: "source_question_bank_item_id");

            migrationBuilder.AddForeignKey(
                name: "FK_questions_question_bank_items_source_question_bank_item_id",
                table: "questions",
                column: "source_question_bank_item_id",
                principalTable: "question_bank_items",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_questions_question_bank_items_source_question_bank_item_id",
                table: "questions");

            migrationBuilder.DropIndex(
                name: "IX_questions_source_question_bank_item_id",
                table: "questions");

            migrationBuilder.DropColumn(
                name: "source_question_bank_item_id",
                table: "questions");
        }
    }
}
