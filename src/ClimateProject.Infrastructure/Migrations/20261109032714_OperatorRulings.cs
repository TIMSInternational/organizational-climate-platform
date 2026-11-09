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
    /// <c>Down</c> re-adds the keys; once a company or a person has been deleted it fails on the
    /// rows that outlived them, which is the point of dropping them.
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

            migrationBuilder.AddForeignKey(
                name: "FK_audit_logs_companies_company_id",
                table: "audit_logs",
                column: "company_id",
                principalTable: "companies",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_audit_logs_users_user_id",
                table: "audit_logs",
                column: "user_id",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }
    }
}
