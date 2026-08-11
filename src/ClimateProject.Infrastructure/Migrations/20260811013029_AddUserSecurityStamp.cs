using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// <c>users.security_stamp</c> — the per-user marker that ends every session a user has
    /// open when it is rotated (#284).
    /// </summary>
    /// <remarks>
    /// Three steps rather than the one <c>dotnet ef</c> scaffolds, and the difference matters
    /// on both counts.
    ///
    /// The scaffolded form was <c>AddColumn(nullable: false, defaultValue: Guid.Empty)</c>,
    /// which gives every pre-existing row the SAME stamp. Nothing is *broken* by that —
    /// rotation only ever compares a user against their own past value — but a column whose
    /// job is to identify one account's sessions should not ship with every account sharing
    /// one value, and <c>gen_random_uuid()</c> is volatile, so a single UPDATE gives each row
    /// its own. (Built into PostgreSQL core since 13; this project runs 16.)
    ///
    /// It also leaves no <c>DEFAULT</c> behind on the column. The scaffolded form emits one
    /// into the DDL that the model snapshot does not record — <c>UserConfiguration</c>
    /// deliberately declares no <c>HasDefaultValueSql</c>, because <c>User.SecurityStamp</c>
    /// initialises itself and the application always sends a value — so the next scaffolded
    /// migration would see a difference that is not a model change.
    /// </remarks>
    public partial class AddUserSecurityStamp : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "security_stamp",
                table: "users",
                type: "uuid",
                nullable: true);

            migrationBuilder.Sql("UPDATE users SET security_stamp = gen_random_uuid();");

            migrationBuilder.AlterColumn<Guid>(
                name: "security_stamp",
                table: "users",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Reverting drops the column, which means reverting also signs nobody out: tokens
            // minted while it existed carry a securityStamp claim, and SecurityStampValidation
            // is gone with the code that reads it, so they validate on signature and lifetime
            // alone again. That is the pre-#284 behaviour this restores, not a new hole.
            migrationBuilder.DropColumn(
                name: "security_stamp",
                table: "users");
        }
    }
}
