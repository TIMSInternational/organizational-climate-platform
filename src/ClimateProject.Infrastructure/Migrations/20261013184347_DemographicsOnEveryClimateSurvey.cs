using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class DemographicsOnEveryClimateSurvey : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<bool>(
                name: "settings_self_declared_demographics",
                table: "surveys",
                type: "boolean",
                nullable: false,
                defaultValue: true,
                oldClrType: typeof(bool),
                oldType: "boolean",
                oldDefaultValue: false);

            // The default alone only governs surveys created from here on. Ruled 2026-10-13: a
            // climate QR asks the area and the company's own fields, so the setting is on for
            // every survey that can still be answered.
            //
            // Two carve-outs, both deliberate and both taken from the ruling rather than
            // invented here:
            //
            //  - only draft, scheduled and active are updated. A closed or archived survey
            //    keeps the value it ran with, because its record must not claim it asked
            //    something it never asked.
            //  - TIMS's OWN survey 1d8b7e54 is left alone until it closes on 2026-10-24. It
            //    has been answered without demographics throughout, and switching it mid-flight
            //    would segment only its late respondents.
            //
            //    It is the only survey carved out, and that is the ruling, which exempted it by
            //    name and said "all other open surveys get them". Eagle in particular -- the
            //    other climate open as this shipped, closing 2026-10-20 -- is a DIFFERENT survey
            //    and is deliberately not excluded. It needs no carve-out: it was created by
            //    scripts/import-climate-workbook.mjs, which sets selfDeclaredDemographics true,
            //    so this UPDATE cannot change what it asks.
            //
            // Down() restores the column default but deliberately does NOT reverse this: once a
            // survey's flag is true there is no record of whether it was false before, so a
            // blanket revert would switch off surveys an admin had turned on by hand.
            migrationBuilder.Sql(
                """
                UPDATE surveys
                SET settings_self_declared_demographics = true
                WHERE status IN ('draft', 'scheduled', 'active')
                  AND "Id" <> '1d8b7e54-1be4-48d0-8745-c325bcd8d2be';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<bool>(
                name: "settings_self_declared_demographics",
                table: "surveys",
                type: "boolean",
                nullable: false,
                defaultValue: false,
                oldClrType: typeof(bool),
                oldType: "boolean",
                oldDefaultValue: true);
        }
    }
}
