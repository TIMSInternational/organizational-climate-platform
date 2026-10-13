using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InvitationCompletionDayOnly : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "completed_on",
                table: "survey_invitations",
                type: "date",
                nullable: true);

            // Backfill the DAY from the instant we are about to discard, in the time zone of
            // the survey's company -- the same rule CompanyLocalDay applies on every new write.
            // A blank or unknown zone name would make AT TIME ZONE throw and abort the deploy,
            // so the name is matched against pg_timezone_names first and anything that does
            // not match falls back to UTC (SchedulingTimeZone.Resolve's fallback too).
            migrationBuilder.Sql(
                """
                UPDATE survey_invitations AS i
                SET completed_on = (i.completed_at AT TIME ZONE COALESCE(tz.name, 'UTC'))::date
                FROM surveys AS s
                JOIN companies AS c ON c."Id" = s.company_id
                LEFT JOIN pg_timezone_names AS tz ON tz.name = c.settings_timezone
                WHERE s."Id" = i.survey_id
                  AND i.completed_at IS NOT NULL;
                """);

            // Then discard every start and completion instant (ruled 2026-10-12). The columns
            // stay for one release so an API instance still serving during the deploy does not
            // select a dropped column; a follow-up migration drops them.
            migrationBuilder.Sql(
                """
                UPDATE survey_invitations
                SET started_at = NULL, completed_at = NULL
                WHERE started_at IS NOT NULL OR completed_at IS NOT NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Only the new column is removed. The instants Up nulled are not recoverable -- a
            // day cannot be turned back into a time, and that loss is the point of the ruling.
            migrationBuilder.DropColumn(
                name: "completed_on",
                table: "survey_invitations");
        }
    }
}
