using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// Data-only migration for #196. No schema change -- the model snapshot is
    /// unchanged, which is why the generated body was empty.
    ///
    /// "open_text" was a target-only invention. Legacy Survey, Microclimate,
    /// QuestionBank and QuestionLibrary all name this type "open_ended", so the target
    /// was the odd one out, and a legacy microclimate question would have failed type
    /// validation on import (#154). Renaming the stored value is what makes the
    /// canonical vocabulary in QuestionTypes true of existing rows and not only of new
    /// ones.
    /// </summary>
    public partial class RenameOpenTextQuestionTypeToOpenEnded : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Idempotent by nature of the WHERE clause: re-running affects zero rows.
            migrationBuilder.Sql(@"
                UPDATE microclimate_questions
                SET type = 'open_ended'
                WHERE type = 'open_text';
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Deliberately lossy in one direction: rows *authored* as 'open_ended' after
            // this migration are indistinguishable from rows it renamed, so a rollback
            // maps all of them back. That is the right call for a revert -- 'open_ended'
            // is not a value the pre-migration code accepts, so leaving any behind would
            // break validation against the old vocabulary.
            migrationBuilder.Sql(@"
                UPDATE microclimate_questions
                SET type = 'open_text'
                WHERE type = 'open_ended';
            ");
        }
    }
}
