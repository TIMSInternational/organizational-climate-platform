using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// Replaces the users.demographics and user_invitations.demographics jsonb blobs
    /// with the normalised user_demographics / user_invitation_demographics tables,
    /// each row keyed by the owning company's demographic_fields definition.
    ///
    /// Two representations of the same data coexisted before this: demographic_fields
    /// described what a company collects, while the actual answers sat in an opaque
    /// blob that nothing could validate against those definitions and nothing could
    /// filter, group or export per field -- which req.md 2.2 requires for every custom
    /// demographic. Both columns go, not just the user one: invitations are the entry
    /// point (rosters are pre-loaded from CSV/Excel with demographics attached), so
    /// leaving the invitation blob would keep unvalidatable values arriving through
    /// the front door.
    /// </summary>
    public partial class NormaliseDemographicsIntoTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "user_demographics",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    demographic_field_id = table.Column<Guid>(type: "uuid", nullable: false),
                    value = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_demographics", x => new { x.user_id, x.demographic_field_id });
                    table.ForeignKey(
                        name: "FK_user_demographics_demographic_fields_demographic_field_id",
                        column: x => x.demographic_field_id,
                        principalTable: "demographic_fields",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_user_demographics_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_invitation_demographics",
                columns: table => new
                {
                    invitation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    demographic_field_id = table.Column<Guid>(type: "uuid", nullable: false),
                    value = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_invitation_demographics", x => new { x.invitation_id, x.demographic_field_id });
                    table.ForeignKey(
                        name: "FK_user_invitation_demographics_demographic_fields_demographic~",
                        column: x => x.demographic_field_id,
                        principalTable: "demographic_fields",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_user_invitation_demographics_user_invitations_invitation_id",
                        column: x => x.invitation_id,
                        principalTable: "user_invitations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_user_demographics_demographic_field_id_value",
                table: "user_demographics",
                columns: new[] { "demographic_field_id", "value" });

            migrationBuilder.CreateIndex(
                name: "IX_user_invitation_demographics_demographic_field_id_value",
                table: "user_invitation_demographics",
                columns: new[] { "demographic_field_id", "value" });

            // Best-effort backfill BEFORE the jsonb columns are dropped -- the
            // scaffolded order put the DropColumn calls first, which would have thrown
            // any existing answers away. Each object key is matched to the owning
            // company's demographic_fields row; a key with no matching field
            // definition has no normalised home and is intentionally left behind
            // rather than invented (that unmappable-key case is precisely the defect
            // #193 closes).
            //
            // Only JSON scalars are carried over, and only where they fit the new
            // 500-char column: a nested object/array was never a valid answer for a
            // select/text/number/date field, and silently truncating an oversized
            // value would be worse than not migrating it.
            //
            // In practice this is expected to move zero rows: no code path in this
            // repository has ever written users.demographics or
            // user_invitations.demographics (the entity properties had no assignments
            // outside a persistence test). The statement is here so the migration is
            // still correct against a database that was populated by hand or by an
            // out-of-band import.
            migrationBuilder.Sql("""
                INSERT INTO user_demographics (user_id, demographic_field_id, value, created_at, updated_at)
                SELECT u."Id", f."Id", kv.value #>> '{}', now(), now()
                FROM users u
                -- jsonb_each() ERRORS on a non-object argument, and a WHERE clause cannot
                -- prevent the call, so the guard has to live inside the LATERAL.
                CROSS JOIN LATERAL jsonb_each(
                    CASE WHEN jsonb_typeof(u.demographics) = 'object'
                         THEN u.demographics ELSE '{}'::jsonb END) AS kv(key, value)
                JOIN demographic_fields f ON f.company_id = u.company_id AND f.field = kv.key
                WHERE jsonb_typeof(kv.value) IN ('string', 'number', 'boolean')
                  AND btrim(kv.value #>> '{}') <> ''
                  AND length(kv.value #>> '{}') <= 500
                ON CONFLICT DO NOTHING;
                """);

            migrationBuilder.Sql("""
                INSERT INTO user_invitation_demographics (invitation_id, demographic_field_id, value)
                SELECT i."Id", f."Id", kv.value #>> '{}'
                FROM user_invitations i
                -- jsonb_each() ERRORS on a non-object argument, and a WHERE clause cannot
                -- prevent the call, so the guard has to live inside the LATERAL.
                CROSS JOIN LATERAL jsonb_each(
                    CASE WHEN jsonb_typeof(i.demographics) = 'object'
                         THEN i.demographics ELSE '{}'::jsonb END) AS kv(key, value)
                JOIN demographic_fields f ON f.company_id = i.company_id AND f.field = kv.key
                WHERE jsonb_typeof(kv.value) IN ('string', 'number', 'boolean')
                  AND btrim(kv.value #>> '{}') <> ''
                  AND length(kv.value #>> '{}') <= 500
                ON CONFLICT DO NOTHING;
                """);

            migrationBuilder.DropColumn(
                name: "demographics",
                table: "users");

            migrationBuilder.DropColumn(
                name: "demographics",
                table: "user_invitations");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "user_demographics");

            migrationBuilder.DropTable(
                name: "user_invitation_demographics");

            migrationBuilder.AddColumn<string>(
                name: "demographics",
                table: "users",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "demographics",
                table: "user_invitations",
                type: "jsonb",
                nullable: true);

            // Deliberately not re-encoding the normalised rows back into the blob:
            // the whole point of Up() is that the blob cannot represent what the
            // tables now hold (field identity, validation, per-field indexing), so a
            // "faithful" reverse would be a fiction. Down() restores the columns as
            // NULL, which is exactly the state Up() found them in.
        }
    }
}
