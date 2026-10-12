#!/usr/bin/env bash
# Restore a custom-format dump into a NEW scratch database on the LOCAL Postgres and print
# what came back. The rehearsal #512 requires: an untested dump is a belief, not a backup.
#
#   usage:  scripts/db-restore-rehearsal.sh <file.dump> <scratch_db_name>
#           PG_BIN=/opt/homebrew/opt/postgresql@17/bin scripts/db-restore-rehearsal.sh ...
#
# Refuses: a database that already exists (it never restores over anything), the dev database
# climate_project, and any non-local PGHOST -- this script must not be pointed at Supabase.
# Drop the scratch database when done: a restored production dump is personal data on a laptop.
set -euo pipefail

dump="${1:-}"
db="${2:-}"
if [ -z "$dump" ] || [ -z "$db" ]; then
  echo "usage: $0 <file.dump> <scratch_db_name>" >&2
  exit 2
fi
[ -f "$dump" ] || { echo "no such file: $dump" >&2; exit 2; }
[[ "$db" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "scratch name must be a plain lowercase identifier" >&2; exit 2; }
[ "$db" != "climate_project" ] || { echo "refusing: climate_project is the dev database" >&2; exit 2; }

case "${PGHOST:-}" in
  ""|localhost|127.0.0.1|::1|/*) ;;
  *) echo "refusing: PGHOST=$PGHOST is not local. This script restores to a local scratch database only." >&2; exit 2 ;;
esac

# The client must be at least the dump's major. Prefer PG_BIN, else the newest Homebrew
# postgresql@NN, else PATH (which on this machine is 14 and too old for a 17 dump).
if [ -z "${PG_BIN:-}" ]; then
  best=0
  for d in /opt/homebrew/opt/postgresql@*/bin; do
    [ -d "$d" ] || continue
    v="${d#*postgresql@}"; v="${v%%/*}"
    if [ "$v" -gt "$best" ]; then best="$v"; PG_BIN="$d"; fi
  done
fi
if [ -n "${PG_BIN:-}" ]; then PATH="$PG_BIN:$PATH"; fi

echo "pg_restore: $(pg_restore --version)"
echo "server:     $(psql -XAtqd postgres -c 'show server_version')"
echo "dump:       $dump ($(wc -c < "$dump" | tr -d ' ') bytes)"
pg_restore --list "$dump" | grep -E '^;     (Dumped from|Dumped by|Archive created)' || true

if [ "$(psql -XAtqd postgres -c "select 1 from pg_database where datname = '$db'")" = "1" ]; then
  echo "refusing: database $db already exists. Pick a new name or dropdb it first." >&2
  exit 2
fi

createdb "$db"
echo "created:    $db"

log="$(mktemp)"
list="$(mktemp)"
# A --schema=public dump carries `CREATE SCHEMA public`, which collides with the public schema
# every new database already has. Restore from the archive's own TOC minus that one entry, so
# a clean restore reports zero errors and any error left is a real one.
pg_restore --list "$dump" | grep -vE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' > "$list"
start=$(date +%s)
# No --exit-on-error: a production dump restored into a plain Postgres can name Supabase-only
# objects (roles in RLS policies, for instance) that do not exist here. Those are printed
# below rather than aborting half-way, so every error is visible at once; the script still
# exits non-zero after the counts if pg_restore reported any.
set +e
pg_restore --no-owner --no-privileges --use-list="$list" --dbname="$db" "$dump" 2>"$log"
rc=$?
set -e
rm -f "$list"
echo "pg_restore: exit $rc in $(( $(date +%s) - start ))s, $(grep -c '^pg_restore: error' "$log" || true) error(s)"
if [ -s "$log" ]; then sed 's/^/  | /' "$log" | head -40; fi
rm -f "$log"

echo
echo "row counts in $db:"
psql -XAtqd "$db" -F $'\t' <<'SQL'
select 'companies',          count(*) from public.companies
union all select 'users',              count(*) from public.users
union all select 'surveys',            count(*) from public.surveys
union all select 'survey_invitations', count(*) from public.survey_invitations
union all select 'responses',          count(*) from public.responses
union all select 'question_responses', count(*) from public.question_responses
union all select 'public tables',      count(*) from information_schema.tables
                                         where table_schema = 'public' and table_type = 'BASE TABLE'
union all select '__EFMigrationsHistory rows', count(*) from public."__EFMigrationsHistory";
SQL
echo
echo "last migration:"
psql -XAtqd "$db" -F $'\t' -c 'select "MigrationId", "ProductVersion" from public."__EFMigrationsHistory" order by "MigrationId" desc limit 1'

echo
echo "When done:  dropdb $db"
if [ "$rc" -ne 0 ]; then
  echo "pg_restore reported errors (exit $rc); read them above before calling this rehearsal good." >&2
  exit 1
fi
