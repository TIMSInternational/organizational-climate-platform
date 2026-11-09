using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// The TIMS operations ruled 2026-11-08 (docs/decisions/operators-reopen-exclude-delete.md).
    /// <list type="bullet">
    /// <item><c>responses.excluded_at</c>: a response TIMS took out of the results. Nullable, no
    /// default, so every existing row counts exactly as before.</item>
    /// <item><c>audit_logs</c> loses its two foreign keys. company_id was RESTRICT, so no company
    /// with an audit row could ever be deleted without first deleting its history; user_id was
    /// SET NULL, so deleting a person made the database rewrite their audit rows. The indexes
    /// stay. Dropping a constraint touches no row.</item>
    /// </list>
    /// <c>Down</c> re-adds the keys NOT VALID, so it still runs after a company or a person has
    /// been deleted: the rows that outlived them are kept, not re-judged.
    /// </summary>
    public partial class OperatorRulings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_audit_logs_companies_company_id",
                table: "audit_logs");

            migrationBuilder.DropForeignKey(
                name: "FK_audit_logs_users_user_id",
                table: "audit_logs");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "excluded_at",
                table: "responses",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "excluded_at",
                table: "responses");

            // NOT VALID: enforced for every row written from here on, but the rows that already
            // outlived a deleted company or person are not re-judged. Validating them would make
            // this Down fail forever after the first deletion -- and it is exactly those rows the
            // drop was made to keep.
            migrationBuilder.Sql(
                "ALTER TABLE audit_logs ADD CONSTRAINT \"FK_audit_logs_companies_company_id\" "
                + "FOREIGN KEY (company_id) REFERENCES companies (\"Id\") ON DELETE RESTRICT NOT VALID;");
            migrationBuilder.Sql(
                "ALTER TABLE audit_logs ADD CONSTRAINT \"FK_audit_logs_users_user_id\" "
                + "FOREIGN KEY (user_id) REFERENCES users (\"Id\") ON DELETE SET NULL NOT VALID;");
        }
    }
}
