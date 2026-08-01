using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSystemSettingsSingletonGuard : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Defensive cleanup in case the read-then-insert race this migration closes
            // already produced duplicate rows before this migration ran (e.g. against a
            // long-lived environment): keep only the earliest-created row so the unique
            // index below can actually be created. No-op when there are 0 or 1 rows.
            migrationBuilder.Sql(@"
                DELETE FROM system_settings
                WHERE ""Id"" NOT IN (
                    SELECT ""Id"" FROM system_settings ORDER BY created_at ASC LIMIT 1
                );
            ");

            migrationBuilder.AddColumn<bool>(
                name: "singleton_guard",
                table: "system_settings",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.CreateIndex(
                name: "IX_system_settings_singleton_guard",
                table: "system_settings",
                column: "singleton_guard",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_system_settings_singleton_guard",
                table: "system_settings");

            migrationBuilder.DropColumn(
                name: "singleton_guard",
                table: "system_settings");
        }
    }
}
