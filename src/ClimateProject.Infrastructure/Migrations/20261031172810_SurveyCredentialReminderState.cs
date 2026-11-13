using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// Gives a per-survey key a memory of having been reminded.
    /// </summary>
    /// <remarks>
    /// <para><b>Not destructive, and safe to run against a live survey.</b> Two ADD COLUMNs and
    /// nothing else: no data is read, rewritten, moved or dropped. `reminder_count` carries a
    /// constant DEFAULT, and PostgreSQL 11 and later record a non-volatile default in the
    /// catalogue instead of rewriting the table, so this is a metadata-only change that takes
    /// the same time on one row as on a million. `Down` drops exactly the two columns it added.
    /// The `confirm_destructive_migration` gate in deploy-prod.yml can stay at its default.</para>
    ///
    /// <para><b>It starts empty, deliberately.</b> ESPH's five reminders of 2026-10-30 predate
    /// these columns and will read as "never reminded" -- the information to backfill them lives
    /// only in `audit_logs.details`, and mining a long-retention compliance table to seed an
    /// operational column is the wrong trade for five rows. Those five people have all been
    /// written to once; the count is right from the next reminder onwards.</para>
    /// </remarks>
    public partial class SurveyCredentialReminderState : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "last_reminded_at",
                table: "survey_credentials",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "reminder_count",
                table: "survey_credentials",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "last_reminded_at",
                table: "survey_credentials");

            migrationBuilder.DropColumn(
                name: "reminder_count",
                table: "survey_credentials");
        }
    }
}
