using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class DropCommentPromptDefaults : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "comment_prompt_es",
                table: "template_questions",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(500)",
                oldMaxLength: 500,
                oldDefaultValue: "Por favor explica tu respuesta:");

            migrationBuilder.AlterColumn<string>(
                name: "comment_prompt_en",
                table: "template_questions",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(500)",
                oldMaxLength: 500,
                oldDefaultValue: "Please explain your answer:");

            migrationBuilder.AlterColumn<string>(
                name: "comment_prompt_es",
                table: "questions",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(500)",
                oldMaxLength: 500,
                oldDefaultValue: "Por favor explica tu respuesta:");

            migrationBuilder.AlterColumn<string>(
                name: "comment_prompt_en",
                table: "questions",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(500)",
                oldMaxLength: 500,
                oldDefaultValue: "Please explain your answer:");

            // Every row authored to date carries the DDL default, because the wizard
            // never sent a prompt at all -- so a value equal to the default literal is
            // the default, not authored content. Rows with any other text are kept.
            migrationBuilder.Sql(
                "UPDATE questions SET comment_prompt_en = NULL WHERE comment_prompt_en = 'Please explain your answer:';");
            migrationBuilder.Sql(
                "UPDATE questions SET comment_prompt_es = NULL WHERE comment_prompt_es = 'Por favor explica tu respuesta:';");
            migrationBuilder.Sql(
                "UPDATE template_questions SET comment_prompt_en = NULL WHERE comment_prompt_en = 'Please explain your answer:';");
            migrationBuilder.Sql(
                "UPDATE template_questions SET comment_prompt_es = NULL WHERE comment_prompt_es = 'Por favor explica tu respuesta:';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // NOT NULL cannot be restored over null rows; put the old defaults back first.
            migrationBuilder.Sql(
                "UPDATE questions SET comment_prompt_en = 'Please explain your answer:' WHERE comment_prompt_en IS NULL;");
            migrationBuilder.Sql(
                "UPDATE questions SET comment_prompt_es = 'Por favor explica tu respuesta:' WHERE comment_prompt_es IS NULL;");
            migrationBuilder.Sql(
                "UPDATE template_questions SET comment_prompt_en = 'Please explain your answer:' WHERE comment_prompt_en IS NULL;");
            migrationBuilder.Sql(
                "UPDATE template_questions SET comment_prompt_es = 'Por favor explica tu respuesta:' WHERE comment_prompt_es IS NULL;");

            migrationBuilder.AlterColumn<string>(
                name: "comment_prompt_es",
                table: "template_questions",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "Por favor explica tu respuesta:",
                oldClrType: typeof(string),
                oldType: "character varying(500)",
                oldMaxLength: 500,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "comment_prompt_en",
                table: "template_questions",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "Please explain your answer:",
                oldClrType: typeof(string),
                oldType: "character varying(500)",
                oldMaxLength: 500,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "comment_prompt_es",
                table: "questions",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "Por favor explica tu respuesta:",
                oldClrType: typeof(string),
                oldType: "character varying(500)",
                oldMaxLength: 500,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "comment_prompt_en",
                table: "questions",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "Please explain your answer:",
                oldClrType: typeof(string),
                oldType: "character varying(500)",
                oldMaxLength: 500,
                oldNullable: true);
        }
    }
}
