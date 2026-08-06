using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// Carries the six legacy <c>notification_settings</c> preferences onto users (#192).
    ///
    /// Every column is NOT NULL with a DB-level default lifted verbatim from legacy
    /// <c>User.ts NotificationSettingsSchema</c>: the four email opt-outs default true,
    /// push defaults false, digest defaults 'weekly'. Matching legacy exactly is the whole
    /// point of this migration -- four of the six are opt-outs real users have already
    /// exercised, and a default that differs from legacy silently re-subscribes everyone
    /// who turned one off the moment the ETL (#154) imports them. This platform models
    /// consent explicitly via the consent_* columns, so quietly flipping an opt-out back on
    /// would contradict its own posture.
    ///
    /// The defaults live in the DDL rather than only on the CLR properties because a CLR
    /// initializer never reaches a row the ETL or any raw INSERT writes. That is what the
    /// UserProfileTests raw-SQL-insert-then-read pair proves, one of them reading the
    /// columns back over raw SQL specifically so the C# initializer cannot supply the value.
    ///
    /// notifications_push is stored but deliberately not exposed by #97's self-service
    /// preferences API until #82 settles whether the PWA ships: there is no push
    /// infrastructure and no device-token storage anywhere in this repo, so the API would
    /// otherwise advertise a channel with no delivery path. Dropping the column instead was
    /// rejected -- the legacy value would be lost on import, and re-adding it later would
    /// default every user to something they never chose.
    ///
    /// Down() is safe: it only drops columns this migration added.
    /// </summary>
    public partial class AddUserNotificationPreferences : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "notifications_digest_frequency",
                table: "users",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "weekly");

            migrationBuilder.AddColumn<bool>(
                name: "notifications_email_action_plans",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "notifications_email_microclimates",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "notifications_email_reminders",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "notifications_email_surveys",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "notifications_push",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "notifications_digest_frequency",
                table: "users");

            migrationBuilder.DropColumn(
                name: "notifications_email_action_plans",
                table: "users");

            migrationBuilder.DropColumn(
                name: "notifications_email_microclimates",
                table: "users");

            migrationBuilder.DropColumn(
                name: "notifications_email_reminders",
                table: "users");

            migrationBuilder.DropColumn(
                name: "notifications_email_surveys",
                table: "users");

            migrationBuilder.DropColumn(
                name: "notifications_push",
                table: "users");
        }
    }
}
