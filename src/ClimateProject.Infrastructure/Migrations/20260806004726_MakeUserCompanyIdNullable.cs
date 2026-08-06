using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// Drops NOT NULL from users.company_id so a super_admin can belong to no tenant (#191).
    /// NULL means global scope, the same convention benchmarks and the various *_templates
    /// tables already use for globally-visible rows. A sentinel "system company" was
    /// considered and rejected: it would need excluding by hand from every company list,
    /// user count, benchmark aggregate and tracking sync, and one missed exclusion silently
    /// corrupts cross-tenant analytics.
    ///
    /// The FK is deliberately untouched. Postgres already had ON DELETE CASCADE here, and
    /// UserConfiguration now pins DeleteBehavior.Cascade explicitly because EF's default
    /// flips from Cascade to ClientSetNull the moment an FK becomes optional -- without the
    /// pin this migration would have silently downgraded company deletion to a NO ACTION
    /// FK violation. Confirmed by the model snapshot diff: only IsRequired() came off.
    ///
    /// Down() is NOT safe to run once a company-less user exists. EF backfills NULLs with
    /// Guid.Empty, which is not a real companies.id, so the FK rejects it and the rollback
    /// fails. That is the honest failure: there is no correct company to move a global
    /// super_admin into -- that is the entire premise of this change. Delete or reassign
    /// company-less users first if a rollback is ever genuinely needed.
    /// </summary>
    public partial class MakeUserCompanyIdNullable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "company_id",
                table: "users",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "company_id",
                table: "users",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
