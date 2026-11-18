#!/usr/bin/env bash
# Restore a custom-format dump into a NEW scratch database and print what came back. The
# rehearsal #512 requires: an untested dump is a belief, not a backup.
#
#   usage:  scripts/db-restore-rehearsal.sh [--container] [--delete-dump] <file.dump> <scratch_db_name>
#
#   (default)      restore into the LOCAL Postgres server. PG_BIN picks the client, e.g.
#                  PG_BIN=/opt/homebrew/opt/postgresql@17/bin; otherwise the newest Homebrew
#                  postgresql@NN, otherwise PATH.
#   --container    restore into a throwaway Docker container instead (POSTGRES_IMAGE, default
#                  postgres:17.11-bookworm), started with --network none and no published port.
#                  Every client tool runs INSIDE it, so no local server or client is needed. The
#                  container is removed when this script exits -- success, failure or Ctrl-C.
#   --delete-dump  delete <file.dump> when this script exits, however it exits. Arguments are
#                  validated first, so a typo in them never costs you the file.
#   MIGRATIONS_REF the commit whose Migrations/ folder the restored history is compared with.
#                  Default HEAD; set it to the commit production serves (GET /version) when the
#                  checkout is not that commit.
#
# What it prints, and what fails it:
#   - pg_restore's own errors                                            -> exit 1 if any
#   - the six key-table counts every earlier rehearsal recorded, then EVERY public table's
#     exact row count
#   - restored public base tables vs the dump's TABLE DATA entries        -> exit 3 if they differ
#   - the newest __EFMigrationsHistory id vs the newest migration in Migrations/ at
#     MIGRATIONS_REF, and the two id SETS compared both ways             -> exit 3 if they differ
#
# Refuses (exit 2): a database that already exists (it never restores over anything), the dev
# database climate_project, any non-local PGHOST -- this script must not be pointed at Supabase --
# and, with --container, a container name that is already taken (it never removes a container it
# did not create). A restored production dump is personal data on a laptop: --container removes
# it on exit; on the local server, dropdb the scratch database when done.
set -euo pipefail

use_container=0
delete_dump=0
while [ $# -gt 0 ]; do
  case "$1" in
    --container) use_container=1; shift ;;
    --delete-dump) delete_dump=1; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    --*) echo "unknown option: $1" >&2; exit 2 ;;
    *) break ;;
  esac
done

dump="${1:-}"
db="${2:-}"
if [ -z "$dump" ] || [ -z "$db" ] || [ $# -gt 2 ]; then
  echo "usage: $0 [--container] [--delete-dump] <file.dump> <scratch_db_name>" >&2
  exit 2
fi
[ -f "$dump" ] || { echo "no such file: $dump" >&2; exit 2; }
[[ "$db" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "scratch name must be a plain lowercase identifier" >&2; exit 2; }
[ "$db" != "climate_project" ] || { echo "refusing: climate_project is the dev database" >&2; exit 2; }

case "${PGHOST:-}" in
  ""|localhost|127.0.0.1|::1|/*) ;;
  *) echo "refusing: PGHOST=$PGHOST is not local. This script restores to a local scratch database only." >&2; exit 2 ;;
esac

# What the restored history must equal, resolved before anything is created so a bad ref costs
# nothing. EF's history table holds one row per migration class; the class files are
# <14-digit timestamp>_<Name>.cs, and <same>.Designer.cs is their snapshot, not a migration.
repo="$(cd "$(dirname "$0")/.." && pwd)"
migrations_ref="${MIGRATIONS_REF:-HEAD}"
migrations_dir="src/ClimateProject.Infrastructure/Migrations"
ref_sha="$(git -C "$repo" rev-parse --verify --quiet "${migrations_ref}^{commit}" || true)"
[ -n "$ref_sha" ] || { echo "MIGRATIONS_REF=$migrations_ref is not a commit in $repo" >&2; exit 2; }
code_ids="$(git -C "$repo" ls-tree -r --name-only "$ref_sha" -- "$migrations_dir/" \
  | { grep -E '/[0-9]{14}_[^/]*\.cs$' || true; } | { grep -v '\.Designer\.cs$' || true; } \
  | sed -E 's#.*/##; s#\.cs$##' | LC_ALL=C sort)"
[ -n "$code_ids" ] || { echo "no migrations under $migrations_dir at $migrations_ref ($ref_sha)" >&2; exit 2; }

# ---------------------------------------------------------------------------------------------
# Cleanup. Installed only now, after every argument has been validated.
# ---------------------------------------------------------------------------------------------
container=""
scratch_files=()
cleanup() {
  local rc=$?
  set +e
  if [ -n "$container" ]; then
    docker rm -f -v "$container" >/dev/null 2>&1
    if docker container inspect "$container" >/dev/null 2>&1; then
      echo "WARNING: container $container still exists. Remove it: docker rm -f -v $container" >&2
      [ "$rc" -ne 0 ] || rc=1
    else
      echo "removed:    container $container (and its anonymous volume)"
    fi
  fi
  if [ "$delete_dump" -eq 1 ] && [ -e "$dump" ]; then
    if rm -f "$dump" && [ ! -e "$dump" ]; then
      echo "removed:    $dump"
    else
      echo "WARNING: could not delete $dump" >&2
      [ "$rc" -ne 0 ] || rc=1
    fi
  fi
  if [ "${#scratch_files[@]}" -gt 0 ]; then rm -f "${scratch_files[@]}"; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# pgx: run a PostgreSQL client tool on the host, or inside the rehearsal container as the
# postgres OS user (the image's initdb trusts local socket connections, so no password is used).
pgx() {
  if [ -n "$container" ]; then
    docker exec -i -u postgres "$container" "$@"
  else
    "$@"
  fi
}

if [ "$use_container" -eq 1 ]; then
  command -v docker >/dev/null 2>&1 || { echo "--container needs docker on PATH" >&2; exit 2; }
  image="${POSTGRES_IMAGE:-postgres:17.11-bookworm}"
  name="climate-restore-${db}"
  if docker container inspect "$name" >/dev/null 2>&1; then
    echo "refusing: a container named $name already exists, and this script removes only what it creates." >&2
    echo "          Remove it yourself (docker rm -f -v $name) or pick another scratch name." >&2
    exit 2
  fi
  # Claimed before `docker run`: the name was free a line ago, so whatever holds it from here on
  # is this script's, including a container that was created and then failed to start.
  container="$name"
  # The image refuses to start without a password. It is random, never printed, and unusable:
  # --network none gives the container no interface but loopback, and no port is published.
  password="$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')"
  docker run -d --name "$container" --network none \
    --label org.climate-platform.purpose=restore-rehearsal \
    -e POSTGRES_PASSWORD="$password" "$image" >/dev/null
  unset password
  # Ready means the FINAL server: the image's init phase runs a temporary server that does not
  # listen on TCP, so a TCP pg_isready inside the container cannot pass early.
  ready=0
  for _ in $(seq 1 90); do
    if docker exec "$container" pg_isready -q -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
  done
  if [ "$ready" -ne 1 ]; then
    echo "the container's Postgres was not ready after 90s; its last log lines:" >&2
    docker logs --tail 20 "$container" >&2 || true
    exit 1
  fi
  echo "container:  $container ($image, --network none, no published port)"
  rdump="/tmp/rehearsal.dump"
  docker cp "$dump" "$container:$rdump" >/dev/null
  docker exec -u 0 "$container" chown postgres:postgres "$rdump"
else
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
  rdump="$dump"
fi

echo "pg_restore: $(pgx pg_restore --version)"
echo "server:     $(pgx psql -XAtqd postgres -c 'show server_version')"
echo "dump:       $dump ($(wc -c < "$dump" | tr -d ' ') bytes)"
# Here-strings, never `pg_restore --list | grep -q`: under pipefail grep -q exits at its first
# match and the writer dies of SIGPIPE once the TOC passes the 64 KB pipe buffer -- the defect
# db-backup.yml hit on its first production run (2026-10-13).
toc="$(pgx pg_restore --list "$rdump")"
grep -E '^;     (Dumped from|Dumped by|Archive created)' <<<"$toc" || true
toc_tables="$(grep -c ' TABLE DATA public ' <<<"$toc" || true)"

if [ "$(pgx psql -XAtqd postgres -c "select 1 from pg_database where datname = '$db'")" = "1" ]; then
  echo "refusing: database $db already exists. Pick a new name or dropdb it first." >&2
  exit 2
fi

pgx createdb "$db"
echo "created:    $db"

log="$(mktemp)"; scratch_files+=("$log")
list="$(mktemp)"; scratch_files+=("$list")
# A --schema=public dump carries `CREATE SCHEMA public`, which collides with the public schema
# every new database already has. Restore from the archive's own TOC minus that one entry, so
# a clean restore reports zero errors and any error left is a real one.
grep -vE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' <<<"$toc" > "$list" || true
if [ -n "$container" ]; then
  rlist="/tmp/rehearsal.list"
  docker cp "$list" "$container:$rlist" >/dev/null
  docker exec -u 0 "$container" chown postgres:postgres "$rlist"
else
  rlist="$list"
fi
start=$(date +%s)
# No --exit-on-error: a production dump restored into a plain Postgres can name Supabase-only
# objects (roles in RLS policies, for instance) that do not exist here. Those are printed
# below rather than aborting half-way, so every error is visible at once; the script still
# exits non-zero after the counts if pg_restore reported any.
set +e
pgx pg_restore --no-owner --no-privileges --use-list="$rlist" --dbname="$db" "$rdump" 2>"$log"
rc=$?
set -e
echo "pg_restore: exit $rc in $(( $(date +%s) - start ))s, $(grep -c '^pg_restore: error' "$log" || true) error(s)"
if [ -s "$log" ]; then sed 's/^/  | /' "$log" | head -40; fi

echo
echo "row counts in $db (the six every earlier rehearsal recorded):"
pgx psql -XAtqd "$db" -F $'\t' <<'SQL'
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
echo "row counts in $db, every public table (exact count(*), by name):"
pgx psql -XAtqd "$db" -F $'\t' <<'SQL'
select format('select %L, count(*) from public.%I', table_name, table_name)
  from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE'
 order by table_name
\gexec
SQL

restored_tables="$(pgx psql -XAtqd "$db" -c "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")"
dump_ids="$(pgx psql -XAtqd "$db" -c 'select "MigrationId" from public."__EFMigrationsHistory"' | LC_ALL=C sort || true)"
dump_newest="$(tail -n 1 <<<"$dump_ids")"
code_newest="$(tail -n 1 <<<"$code_ids")"
only_in_dump="$(LC_ALL=C comm -23 <(printf '%s\n' "$dump_ids") <(printf '%s\n' "$code_ids") | sed '/^$/d')"
only_in_code="$(LC_ALL=C comm -13 <(printf '%s\n' "$dump_ids") <(printf '%s\n' "$code_ids") | sed '/^$/d')"
count_lines() { if [ -z "$1" ]; then echo 0; else wc -l <<<"$1" | tr -d ' '; fi; }

verdict=0
echo
echo "== comparison =="
if [ "$restored_tables" = "$toc_tables" ]; then tables_result="MATCH"; else tables_result="DIFFERS"; verdict=3; fi
echo "tables:     $restored_tables public base tables restored / $toc_tables TABLE DATA entries in the dump  -> $tables_result"
echo "migrations: newest in the dump   ${dump_newest:-<none>} ($(count_lines "$dump_ids") rows)"
echo "            newest in the code   $code_newest ($(count_lines "$code_ids") files at $migrations_ref = $(git -C "$repo" rev-parse --short=8 "$ref_sha"))"
if [ -z "$only_in_dump" ] && [ -z "$only_in_code" ] && [ "$dump_newest" = "$code_newest" ]; then
  echo "            -> MATCH: the restored history is exactly the code's migration set"
else
  verdict=3
  echo "            -> DIFFERS"
  if [ -n "$only_in_dump" ]; then echo "            applied in the dump, absent from the code:"; while IFS= read -r m; do echo "              $m"; done <<<"$only_in_dump"; fi
  if [ -n "$only_in_code" ]; then echo "            in the code, not applied in the dump:"; while IFS= read -r m; do echo "              $m"; done <<<"$only_in_code"; fi
  echo "            Either the dump predates a migration (a deploy ran after it), or MIGRATIONS_REF is"
  echo "            not the commit production served when the dump was taken. Read both before deciding."
fi

echo
if [ -n "$container" ]; then
  echo "The container, the scratch database and the copy of the dump inside it are removed on exit."
else
  echo "When done:  dropdb $db"
fi
if [ "$rc" -ne 0 ]; then
  echo "pg_restore reported errors (exit $rc); read them above before calling this rehearsal good." >&2
  exit 1
fi
if [ "$verdict" -ne 0 ]; then
  echo "The comparison above DIFFERS; this rehearsal is not a match until it is explained." >&2
  exit "$verdict"
fi
echo "REHEARSAL MATCHES: pg_restore clean, every TABLE DATA entry restored, migration history = code."
