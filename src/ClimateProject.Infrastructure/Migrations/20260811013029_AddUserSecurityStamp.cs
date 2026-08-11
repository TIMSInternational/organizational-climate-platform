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
    /// <c>gen_random_uuid()</c> rather than the <c>defaultValue: Guid.Empty</c> that
    /// <c>dotnet ef</c> scaffolds for a non-nullable Guid, and the difference matters twice
    /// over.
    ///
    /// The scaffolded constant gives every pre-existing row the SAME stamp. Nothing is
    /// *broken* by that — rotation only ever compares a user against their own past value —
    /// but a column whose job is to identify one account's sessions should not ship with every
    /// account sharing one value. <c>gen_random_uuid()</c> is volatile, so Postgres cannot
    /// take the fast "one missing value for the whole table" path for it: it rewrites the
    /// table and evaluates the default once per row, which is what backfills each existing
    /// user with a distinct stamp in this single statement. (Built into PostgreSQL core since
    /// 13 — no pgcrypto extension needed; <c>docker-compose.yml</c> and the integration
    /// suite's container both pin <c>postgres:16-alpine</c>.)
    ///
    /// The <c>DEFAULT</c> also stays on the column afterwards, and that is deliberate: this
    /// repo's convention is that a new NOT NULL column on <c>users</c> carries a DB-level
    /// default so that a row written by something other than this EF model still gets one.
    /// <c>UserProfileTests.Existing_user_without_new_fields_still_loads_with_defaults</c> and
    /// <c>Notification_preference_defaults_come_from_the_database_not_the_clr_initialiser</c>
    /// pin exactly that with raw <c>INSERT INTO users (...)</c> statements that name none of
    /// the newer columns, and #154's ETL will insert the same way. <c>UserConfiguration</c>
    /// declares the matching <c>HasDefaultValueSql</c> so the model snapshot records this
    /// default and the next scaffolded migration sees no phantom difference.
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
                nullable: false,
                defaultValueSql: "gen_random_uuid()");
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
