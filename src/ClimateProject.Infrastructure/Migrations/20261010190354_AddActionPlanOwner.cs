using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddActionPlanOwner : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "owner_id",
                table: "action_plans",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_action_plans_owner_id",
                table: "action_plans",
                column: "owner_id");

            migrationBuilder.AddForeignKey(
                name: "FK_action_plans_users_owner_id",
                table: "action_plans",
                column: "owner_id",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_action_plans_users_owner_id",
                table: "action_plans");

            migrationBuilder.DropIndex(
                name: "IX_action_plans_owner_id",
                table: "action_plans");

            migrationBuilder.DropColumn(
                name: "owner_id",
                table: "action_plans");
        }
    }
}
