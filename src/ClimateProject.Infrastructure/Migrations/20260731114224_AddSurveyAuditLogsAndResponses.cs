using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSurveyAuditLogsAndResponses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "responses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    survey_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    session_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    company_id = table.Column<Guid>(type: "uuid", nullable: false),
                    department_id = table.Column<Guid>(type: "uuid", nullable: true),
                    is_complete = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    is_anonymous = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    start_time = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    completion_time = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    total_time_seconds = table.Column<int>(type: "integer", nullable: true),
                    ip_address = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    user_agent = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_responses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_responses_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_responses_departments_department_id",
                        column: x => x.department_id,
                        principalTable: "departments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_responses_surveys_survey_id",
                        column: x => x.survey_id,
                        principalTable: "surveys",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_responses_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "survey_audit_logs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    survey_id = table.Column<Guid>(type: "uuid", nullable: false),
                    action = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    entity_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    entity_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    changes = table.Column<string>(type: "jsonb", nullable: true),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    user_email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    user_role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    timestamp = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ip_address = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    user_agent = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    session_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    metadata = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_survey_audit_logs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_survey_audit_logs_surveys_survey_id",
                        column: x => x.survey_id,
                        principalTable: "surveys",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_survey_audit_logs_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "question_responses",
                columns: table => new
                {
                    response_id = table.Column<Guid>(type: "uuid", nullable: false),
                    question_id = table.Column<Guid>(type: "uuid", nullable: false),
                    response_value = table.Column<string>(type: "jsonb", nullable: false),
                    response_text = table.Column<string>(type: "text", nullable: true),
                    time_spent_seconds = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_question_responses", x => new { x.response_id, x.question_id });
                    table.ForeignKey(
                        name: "FK_question_responses_questions_question_id",
                        column: x => x.question_id,
                        principalTable: "questions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_question_responses_responses_response_id",
                        column: x => x.response_id,
                        principalTable: "responses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "response_demographics",
                columns: table => new
                {
                    response_id = table.Column<Guid>(type: "uuid", nullable: false),
                    field = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    value = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_response_demographics", x => new { x.response_id, x.field });
                    table.ForeignKey(
                        name: "FK_response_demographics_responses_response_id",
                        column: x => x.response_id,
                        principalTable: "responses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_question_responses_question_id",
                table: "question_responses",
                column: "question_id");

            migrationBuilder.CreateIndex(
                name: "IX_responses_company_id",
                table: "responses",
                column: "company_id");

            migrationBuilder.CreateIndex(
                name: "IX_responses_department_id",
                table: "responses",
                column: "department_id");

            migrationBuilder.CreateIndex(
                name: "IX_responses_survey_id",
                table: "responses",
                column: "survey_id");

            migrationBuilder.CreateIndex(
                name: "IX_responses_user_id",
                table: "responses",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_survey_audit_logs_survey_id_timestamp",
                table: "survey_audit_logs",
                columns: new[] { "survey_id", "timestamp" });

            migrationBuilder.CreateIndex(
                name: "IX_survey_audit_logs_user_id",
                table: "survey_audit_logs",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "question_responses");

            migrationBuilder.DropTable(
                name: "response_demographics");

            migrationBuilder.DropTable(
                name: "survey_audit_logs");

            migrationBuilder.DropTable(
                name: "responses");
        }
    }
}
