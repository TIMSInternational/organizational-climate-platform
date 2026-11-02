using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class EmailDeliveryEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "email_delivery_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    event_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    bounce_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    bounce_sub_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    diagnostic = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ses_message_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    sns_message_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_email_delivery_events", x => x.id);
                    table.ForeignKey(
                        name: "FK_email_delivery_events_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_email_delivery_events_sns_message_id_email_event_type",
                table: "email_delivery_events",
                columns: new[] { "sns_message_id", "email", "event_type" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_email_delivery_events_user_id_occurred_at",
                table: "email_delivery_events",
                columns: new[] { "user_id", "occurred_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "email_delivery_events");
        }
    }
}
