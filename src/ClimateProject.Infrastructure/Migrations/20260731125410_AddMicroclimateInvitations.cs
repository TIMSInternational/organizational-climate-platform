using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddMicroclimateInvitations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "microclimate_invitations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    microclimate_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    company_id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    invitation_token = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "pending"),
                    sent_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    opened_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    reminder_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    last_reminder_sent = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    metadata = table.Column<string>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_microclimate_invitations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_microclimate_invitations_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_microclimate_invitations_microclimates_microclimate_id",
                        column: x => x.microclimate_id,
                        principalTable: "microclimates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_microclimate_invitations_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_microclimate_invitations_company_id",
                table: "microclimate_invitations",
                column: "company_id");

            migrationBuilder.CreateIndex(
                name: "IX_microclimate_invitations_expires_at",
                table: "microclimate_invitations",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "IX_microclimate_invitations_invitation_token",
                table: "microclimate_invitations",
                column: "invitation_token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_microclimate_invitations_microclimate_id_user_id",
                table: "microclimate_invitations",
                columns: new[] { "microclimate_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_microclimate_invitations_status",
                table: "microclimate_invitations",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "IX_microclimate_invitations_user_id",
                table: "microclimate_invitations",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "microclimate_invitations");
        }
    }
}
