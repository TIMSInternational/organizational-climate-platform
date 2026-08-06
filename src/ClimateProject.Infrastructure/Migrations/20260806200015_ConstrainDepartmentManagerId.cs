using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// Gives departments.manager_id a real foreign key to users (#150).
    ///
    /// The column has always held a user id but was never constrained, so a department could
    /// name a manager who did not exist or had been deleted. Nothing prevented it and nothing
    /// detected it. See DepartmentConfiguration for why the delete behaviour is SET NULL and
    /// not Restrict or Cascade.
    ///
    /// The UPDATE below is deliberate and runs before the constraint. Adding an FK against
    /// existing bad data fails at deploy time, not at test time, and an integration suite that
    /// starts from an empty container can never catch it. Production is empty today, so this
    /// is expected to null zero rows -- it exists so that a database seeded from the legacy
    /// stack, or from an ETL run (#154) that predates the constraint, degrades to "manager
    /// unknown" instead of aborting the deploy. A dangling pointer already meant "manager
    /// unknown"; this only makes the storage honest about it.
    ///
    /// Down drops the constraint and its index but cannot restore ids the UPDATE cleared --
    /// they referenced users that did not exist, so there is nothing to restore them to.
    /// </summary>
    public partial class ConstrainDepartmentManagerId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                UPDATE departments d
                SET manager_id = NULL
                WHERE d.manager_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM users u WHERE u."Id" = d.manager_id);
                """);

            migrationBuilder.CreateIndex(
                name: "IX_departments_manager_id",
                table: "departments",
                column: "manager_id");

            migrationBuilder.AddForeignKey(
                name: "FK_departments_users_manager_id",
                table: "departments",
                column: "manager_id",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_departments_users_manager_id",
                table: "departments");

            migrationBuilder.DropIndex(
                name: "IX_departments_manager_id",
                table: "departments");
        }
    }
}
