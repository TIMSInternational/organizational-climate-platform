using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// Drops users.nodo_id (#151).
    ///
    /// EF flags this as possible data loss. It is not: no code path in this repo -- or in the
    /// legacy stack this one replaces -- ever wrote the column, and the ETL (#154) does not
    /// populate it either. It was read in exactly one place, to mint the nodoId JWT claim,
    /// which is why that claim was always the empty string. A user's node is DepartmentId, and
    /// the tracking-facing nodo_id is derived from it by TrackingIdentifiers.
    ///
    /// Down re-creates the column nullable and empty, which is a faithful restore precisely
    /// because there was never anything in it.
    /// </summary>
    public partial class DropDeadUserNodoIdColumn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "nodo_id",
                table: "users");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "nodo_id",
                table: "users",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);
        }
    }
}
