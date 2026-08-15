using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// Gives departments.legacy_external_id the filtered unique index users.persona_external_id
    /// has carried since AddPersonaExternalIdUniqueIndex (#155).
    ///
    /// The column feeds TrackingIdentifiers.ExternalNodoId (`LegacyExternalId ?? Id`), the
    /// nodo_id climate-tracking caches and scopes on, and it was constrained by nothing at all.
    /// See DepartmentConfiguration for what a duplicate does to each consumer and for why the
    /// index is global rather than per-company.
    ///
    /// This has to land BEFORE the ETL backfill (#154) populates the column, because after it
    /// there is no safe answer: an index cannot be built over duplicates, and picking a winner
    /// among them is the identity corruption the constraint exists to prevent.
    ///
    /// The UPDATE below is deliberate and runs before the index, on the same reasoning as
    /// ConstrainDepartmentManagerId: CREATE UNIQUE INDEX against existing bad data fails at
    /// deploy time, not at test time, and a suite that starts from an empty container can never
    /// catch it. Nothing in src/ ever assigns LegacyExternalId -- only the not-yet-run ETL and
    /// raw SQL can -- so this is expected to null zero rows. It exists so that a database
    /// seeded from the legacy stack, or from a half-finished backfill, degrades instead of
    /// aborting the deploy.
    ///
    /// It nulls EVERY member of a duplicated group, not all-but-one. Keeping an arbitrary
    /// winner is precisely the silent mis-mapping #155 is about: nothing in the data says which
    /// department the shared legacy id really names, so the honest answer is that none of them
    /// has one. A null legacy id is not a degraded state -- ExternalNodoId falls back to the
    /// department's Guid, which is unique by construction and is what every department resolves
    /// to today. The ETL can then map them deliberately, and the index will reject a second
    /// attempt at the same id instead of absorbing it.
    ///
    /// Down drops the index but cannot restore ids the UPDATE cleared -- they were ambiguous,
    /// so there is nothing to restore them to.
    /// </summary>
    public partial class AddDepartmentLegacyExternalIdUniqueIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                UPDATE departments d
                SET legacy_external_id = NULL
                WHERE d.legacy_external_id IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM departments other
                      WHERE other.legacy_external_id = d.legacy_external_id
                        AND other."Id" <> d."Id");
                """);

            migrationBuilder.CreateIndex(
                name: "IX_departments_legacy_external_id",
                table: "departments",
                column: "legacy_external_id",
                unique: true,
                filter: "legacy_external_id IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_departments_legacy_external_id",
                table: "departments");
        }
    }
}
