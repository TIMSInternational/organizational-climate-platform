using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// Revokes the Supabase PostgREST-facing roles from the public schema.
    ///
    /// Supabase flagged this project CRITICAL on 2026-08-03 (rls_disabled_in_public,
    /// sensitive_columns_exposed). Measured state before this migration: RLS enabled on
    /// 0 of 52 tables, 0 policies, and `anon` plus `authenticated` each held
    /// SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on all 52 -- including
    /// users.password_hash, users.email, and three invitation_token columns. Anyone
    /// holding the project's anon key could have read, rewritten, or TRUNCATEd anything,
    /// including __EFMigrationsHistory, which would make a subsequent deploy re-run every
    /// migration. No data was exposed in practice because every application table was
    /// empty, and no anon key is referenced in this repository -- but "empty" is not a
    /// control, and the ETL in #154 will land real employee data and password hashes.
    ///
    /// Nothing in this system uses Supabase's REST API, Auth, Realtime or Storage. The
    /// application connects over the Postgres protocol as a role with rolbypassrls = true
    /// which also owns every table, so revoking these roles cannot affect it. That is why
    /// the fix is a revocation rather than a set of RLS policies: there is no legitimate
    /// PostgREST caller whose access needs preserving.
    ///
    /// WHY NOT Supabase's suggested remediation. Their advisor proposes
    /// `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` per table. That alone decays: default
    /// privileges in this schema granted `arwdDxtm` to anon/authenticated for every
    /// *future* table, so each new migration would silently re-open the hole, and a new
    /// table arrives with RLS disabled. Revoking the default privileges is what makes the
    /// fix durable -- verified empirically by creating a table inside a transaction and
    /// reading its ACL: it comes back with no anon or authenticated entries.
    ///
    /// RLS is still enabled below as a second layer, but the privilege revocation is the
    /// primary control. Note the two layers differ in how they age: revoked default
    /// privileges cover tables that do not exist yet, whereas RLS must be enabled per
    /// table and therefore does NOT cover future ones. A later migration that adds a table
    /// containing personal data should enable RLS on it explicitly.
    ///
    /// EVERY STATEMENT IS GUARDED ON ROLE EXISTENCE. The roles anon, authenticated and
    /// service_role are created by Supabase and do not exist in a plain Postgres image.
    /// Integration tests run against postgres:16-alpine (PostgresContainerFixture), which
    /// was probed and has none of them -- an unguarded REVOKE raises
    /// "role does not exist" and would fail every one of the 274 integration tests.
    /// </summary>
    public partial class LockDownPostgrestRoles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Idempotent throughout: REVOKE of an absent privilege, ALTER DEFAULT
            // PRIVILEGES REVOKE, and ENABLE ROW LEVEL SECURITY on an already-enabled
            // table are all no-ops rather than errors. Production was hardened by hand on
            // 2026-08-04 before this migration existed, so it must be safe to re-apply.
            migrationBuilder.Sql(@"
                DO $$
                DECLARE
                    target_roles text;
                    owner_role   text := current_user;
                    t            record;
                BEGIN
                    SELECT string_agg(quote_ident(rolname), ', ')
                      INTO target_roles
                      FROM pg_roles
                     WHERE rolname IN ('anon', 'authenticated');

                    IF target_roles IS NULL THEN
                        RAISE NOTICE 'Roles anon/authenticated absent (not a Supabase database); skipping revocation.';
                    ELSE
                        EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %s', target_roles);
                        EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %s', target_roles);
                        EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %s', target_roles);

                        -- The durable half: stop the grants being reissued on future objects.
                        -- Scoped to the role that creates them, which is the role running
                        -- migrations. supabase_admin keeps its own default privileges; they
                        -- are not alterable from here and only apply to objects it creates.
                        EXECUTE format(
                            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %s',
                            owner_role, target_roles);
                        EXECUTE format(
                            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %s',
                            owner_role, target_roles);
                        EXECUTE format(
                            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %s',
                            owner_role, target_roles);

                        -- Deliberately NOT revoking USAGE ON SCHEMA public: that privilege is
                        -- held by PUBLIC (=U in the schema ACL), so revoking it from these two
                        -- roles specifically has no effect, and revoking it from PUBLIC risks
                        -- Supabase-internal roles that are outside this project's control.
                        -- Without table privileges, schema USAGE grants no read or write.
                    END IF;

                    -- Second layer, applied whether or not the Supabase roles exist so that
                    -- development and CI databases match production's shape.
                    FOR t IN
                        SELECT c.relname
                          FROM pg_class c
                          JOIN pg_namespace n ON n.oid = c.relnamespace
                         WHERE n.nspname = 'public'
                           AND c.relkind = 'r'
                           AND NOT c.relrowsecurity
                    LOOP
                        -- ENABLE, never FORCE: FORCE would apply RLS to the table owner as
                        -- well, and the application connects as the owner.
                        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
                    END LOOP;
                END $$;
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Intentionally empty, and not an oversight.
            //
            // A faithful inverse would re-grant SELECT/INSERT/UPDATE/DELETE/TRUNCATE on
            // every table to anon and authenticated and disable RLS -- i.e. it would
            // reintroduce the exact CRITICAL vulnerability this migration closes, on a
            // database that by then may hold real employee data and password hashes. A
            // rollback of an unrelated later migration would silently take the exposure
            // with it.
            //
            // Nothing else depends on this being reversible: the migration changes no
            // schema, so a `Down` to an earlier version does not need these privileges
            // restored in order to succeed. If the grants are ever genuinely needed again
            // -- for instance if this project adopts PostgREST -- they should be granted
            // deliberately, per table, alongside RLS policies, in a new migration.
        }
    }
}
