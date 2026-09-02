using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class SchemaReviewDeleteBehaviourFixes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_microclimate_templates_companies_company_id",
                table: "microclimate_templates");

            migrationBuilder.DropForeignKey(
                name: "FK_notification_templates_users_created_by",
                table: "notification_templates");

            migrationBuilder.AddForeignKey(
                name: "FK_microclimate_templates_companies_company_id",
                table: "microclimate_templates",
                column: "company_id",
                principalTable: "companies",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_notification_templates_users_created_by",
                table: "notification_templates",
                column: "created_by",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_microclimate_templates_companies_company_id",
                table: "microclimate_templates");

            migrationBuilder.DropForeignKey(
                name: "FK_notification_templates_users_created_by",
                table: "notification_templates");

            migrationBuilder.AddForeignKey(
                name: "FK_microclimate_templates_companies_company_id",
                table: "microclimate_templates",
                column: "company_id",
                principalTable: "companies",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_notification_templates_users_created_by",
                table: "notification_templates",
                column: "created_by",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
