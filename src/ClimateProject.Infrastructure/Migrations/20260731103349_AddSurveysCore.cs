using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSurveysCore : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "surveys",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    company_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    type = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    start_date = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    end_date = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "draft"),
                    response_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    target_audience_count = table.Column<int>(type: "integer", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    settings_anonymous = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    settings_allow_partial_responses = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    settings_randomize_questions = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    settings_show_progress = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    settings_auto_save = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    settings_time_limit_minutes = table.Column<int>(type: "integer", nullable: true),
                    settings_response_limit = table.Column<int>(type: "integer", nullable: true),
                    settings_notification_send_invitations = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    settings_notification_send_reminders = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    settings_notification_reminder_frequency_days = table.Column<int>(type: "integer", nullable: false, defaultValue: 3),
                    settings_invitation_custom_message = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    settings_invitation_include_credentials = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    settings_invitation_send_immediately = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    settings_invitation_custom_subject = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    settings_invitation_branding_enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_surveys", x => x.Id);
                    table.ForeignKey(
                        name: "FK_surveys_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_surveys_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "questions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    survey_id = table.Column<Guid>(type: "uuid", nullable: false),
                    text = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    options = table.Column<string[]>(type: "text[]", nullable: true),
                    scale_min = table.Column<int>(type: "integer", nullable: true),
                    scale_max = table.Column<int>(type: "integer", nullable: true),
                    scale_label_min = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    scale_label_max = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    comment_required = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    comment_prompt = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false, defaultValue: "Please explain your answer:"),
                    binary_comment_config = table.Column<string>(type: "jsonb", nullable: true),
                    required = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    order = table.Column<int>(type: "integer", nullable: false),
                    category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_questions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_questions_surveys_survey_id",
                        column: x => x.survey_id,
                        principalTable: "surveys",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "survey_department_targets",
                columns: table => new
                {
                    survey_id = table.Column<Guid>(type: "uuid", nullable: false),
                    department_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_survey_department_targets", x => new { x.survey_id, x.department_id });
                    table.ForeignKey(
                        name: "FK_survey_department_targets_departments_department_id",
                        column: x => x.department_id,
                        principalTable: "departments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_survey_department_targets_surveys_survey_id",
                        column: x => x.survey_id,
                        principalTable: "surveys",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "question_conditional_logic",
                columns: table => new
                {
                    question_id = table.Column<Guid>(type: "uuid", nullable: false),
                    condition_question_id = table.Column<Guid>(type: "uuid", nullable: true),
                    condition_operator = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    condition_value = table.Column<string>(type: "jsonb", nullable: true),
                    action = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    target_question_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_question_conditional_logic", x => x.question_id);
                    table.ForeignKey(
                        name: "FK_question_conditional_logic_questions_condition_question_id",
                        column: x => x.condition_question_id,
                        principalTable: "questions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_question_conditional_logic_questions_question_id",
                        column: x => x.question_id,
                        principalTable: "questions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_question_conditional_logic_questions_target_question_id",
                        column: x => x.target_question_id,
                        principalTable: "questions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "question_emoji_options",
                columns: table => new
                {
                    question_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order = table.Column<int>(type: "integer", nullable: false),
                    emoji = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    label = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    value = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_question_emoji_options", x => new { x.question_id, x.order });
                    table.ForeignKey(
                        name: "FK_question_emoji_options_questions_question_id",
                        column: x => x.question_id,
                        principalTable: "questions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_question_conditional_logic_condition_question_id",
                table: "question_conditional_logic",
                column: "condition_question_id");

            migrationBuilder.CreateIndex(
                name: "IX_question_conditional_logic_target_question_id",
                table: "question_conditional_logic",
                column: "target_question_id");

            migrationBuilder.CreateIndex(
                name: "IX_questions_survey_id",
                table: "questions",
                column: "survey_id");

            migrationBuilder.CreateIndex(
                name: "IX_survey_department_targets_department_id",
                table: "survey_department_targets",
                column: "department_id");

            migrationBuilder.CreateIndex(
                name: "IX_surveys_company_id",
                table: "surveys",
                column: "company_id");

            migrationBuilder.CreateIndex(
                name: "IX_surveys_created_by",
                table: "surveys",
                column: "created_by");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "question_conditional_logic");

            migrationBuilder.DropTable(
                name: "question_emoji_options");

            migrationBuilder.DropTable(
                name: "survey_department_targets");

            migrationBuilder.DropTable(
                name: "questions");

            migrationBuilder.DropTable(
                name: "surveys");
        }
    }
}
