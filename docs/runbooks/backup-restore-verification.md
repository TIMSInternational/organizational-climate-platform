# The backup, and the restore that proved it

**Status: TAKEN and PROVEN RESTORABLE. 2026-09-04.**

[AMENDED 2026-11-18. This page records the one manual dump of 2026-09-04. Since 2026-10-12 the
backup is scheduled — `.github/workflows/db-backup.yml` writes a `pg_dump` to
`s3://climate-project-db-backups-795965600143-us-east-2/climate/` every 6 hours, in the account
production moved to on 2026-10-12 (`docs/decisions/database-backups.md`). The procedure for
restoring the newest of those dumps into a throwaway container is at the end:
[Restore drill in a throwaway container](#restore-drill-in-a-throwaway-container--procedure-2026-11-18).]

For a week every document in this repository said production had no restorable backup. It now
has one, and — more importantly — the restore has been executed rather than assumed.

## What was taken

```
~/climate-backups/prod-20260904T223812Z-schema.sql   115K
~/climate-backups/prod-20260904T223812Z-data.sql     294K   98 COPY blocks
```

Two runs, because **`supabase db dump` is schema-only by default** — verified from `--help`,
which has no `--schema-only` flag precisely because schema is the default and `--data-only` is
the opt-in. A single-command "backup" produces a structure with no rows.

```bash
supabase link --project-ref uleeeziiceduvmiftgby
D=~/climate-backups/prod-$(date -u +%Y%m%dT%H%M%SZ)
supabase db dump --linked -f "$D-schema.sql"
supabase db dump --linked --data-only --use-copy -f "$D-data.sql"
```

## The pg_dump warning, and why it is a false alarm

`pg_dump` warns seven times about circular foreign keys — `users`, `departments`, `benchmarks`,
`question_bank_items`, `question_categories`, `question_library_items`, and the
users↔departments pair — and says the dump "might not be restorable without
`--disable-triggers`".

**It is restorable.** The data file's FIRST LINE is:

```sql
SET session_replication_role = replica;
```

which is exactly the mitigation pg_dump is asking for. The Supabase CLI prepends it and pg_dump
does not know that. The statement needs superuser/replication privilege on the restore target,
which you have on Supabase and on a local Postgres.

## The restore, executed

Into a throwaway database, so nothing live was touched:

```bash
createdb climate_restore_test
psql -d climate_restore_test -f ~/climate-backups/prod-20260904T223812Z-schema.sql
psql -d climate_restore_test -f ~/climate-backups/prod-20260904T223812Z-data.sql
```

Result:

| Check | Value |
|---|---|
| `__EFMigrationsHistory` | **56** — matches production and local exactly |
| Tables in `public` | 69 |
| `users` | 37 |
| `responses` | 58 |
| `surveys` | 2 |

**Every `COPY` into `public` succeeded.**

## The errors, and why none of them is a defect

The restore prints a lot of red. All of it is one category: **Supabase platform objects that a
plain Postgres does not have and this application does not use.**

| Error | What it is |
|---|---|
| `schema "auth" does not exist` | Supabase Auth. This app has its own `User.PasswordHash` and its own JWT issuance; it does not use Supabase Auth |
| `schema "storage" does not exist` | Supabase Storage. Unused |
| `schema "extensions" does not exist`, `extension "supabase_vault" is not available` | Supabase's extension layer |
| `publication "supabase_realtime" does not exist` | Supabase Realtime. Unused |
| `role "service_role" does not exist` (×70) | A Supabase-created role |
| `invalid command \restrict` / `\unrestrict` | A psql **version** mismatch, not a data problem — pg_dump 17.6 emits these directives and an older psql minor does not understand them. Cosmetic |

This repository already knew: `20260804200923_LockDownPostgrestRoles.cs:42` says outright that
*"service_role are created by Supabase and do not exist in a plain Postgres image."*

**Consequence for a real recovery:** restoring into a **new Supabase project** will reproduce
everything, because those schemas and roles exist there. Restoring into a plain Postgres gives
you the whole application — every table, every row, the correct migration history — and none of
the Supabase platform layer, which the application never touches.

## What this does and does not close

- **Closes:** "production has no restorable backup". It has one, and it restores.
- **Closes:** the hardest half of a rollback rehearsal — the data path.
- **Does NOT close #159.** A rollback rehearsal is the *application* rollback too: re-pointing
  App Runner at a previous image and confirming the service comes back. `rollback-prod.yml` and
  `rollback-rehearsal-staging.yml` still have **0 lifetime runs**.
- **Does NOT make the backup a schedule.** This is one manual dump. Daily backups are what the
  Supabase Pro plan buys; this file is a point-in-time copy taken by hand and it will go stale.

## One thing to decide

`climate_restore_test` now holds a copy of production on a laptop, and so does
`~/climate-backups/`. For a government client's employee-survey data that is a data-protection
question, not a housekeeping one. Drop the test database when you are done with it:

```bash
dropdb climate_restore_test
```

The dump files are the backup and should be kept — but decide deliberately where they live.

[AMENDED 2026-11-18. Still undecided, measured: the laptop's local Postgres still holds
`climate_restore_test` — 13 MB, 56 `__EFMigrationsHistory` rows, newest
`20260902191612_SchemaReviewDeleteBehaviourFixes`, i.e. this page's 2026-09-04 production copy
(`psql -d climate_restore_test -c 'select count(*), max("MigrationId") from "__EFMigrationsHistory"'`).
Dropping it is the user's call; the command is the one above.]

---

## Restore drill in a throwaway container — procedure, 2026-11-18

**Written 2026-11-18. Not executed.** It downloads production personal data to a laptop for a
few minutes, so **the user runs it, not an agent**. Nothing below was run against a production
dump; the script's own behaviour was exercised on 2026-11-18 against local dev data only (end of
this section).

### Where the drill stands

- **What exists, measured.** Bucket `climate-project-db-backups-795965600143-us-east-2` (repository
  variable `DB_BACKUP_BUCKET`, `gh variable list`; region us-east-2,
  `aws s3api get-bucket-location`), keys `climate/YYYY/MM/DD/climate-<UTC>.dump`
  (`db-backup.yml:175`). Newest at writing: `climate/2026/11/18/climate-20261118T013417Z.dump`,
  3,255,303 bytes (`aws s3 ls`, names and sizes only; nothing was downloaded).
- **The last restore of a production dump** was 2026-10-13 (`docs/decisions/database-backups.md`,
  "Proven in production"), by `~/climate-restore-test.sh` — a file outside this repository — into
  the laptop's Homebrew Postgres, comparing six key tables and the newest migration.
- **What this drill adds**, all in `scripts/db-restore-rehearsal.sh` (adapted, not a second
  script): `--container` restores into a throwaway `postgres:17.11-bookworm` container started with
  `--network none` and no published port, with every client tool running inside it, and removes it
  when the script exits however it exits; `--delete-dump` deletes the downloaded file the same way;
  every public table is counted; restored tables are compared with the dump's TABLE DATA entries;
  and the restored `__EFMigrationsHistory` is compared with the code's `Migrations/` at
  `MIGRATIONS_REF` — newest id **and** the two sets both ways.
- **Why sets and not counts, measured**: on 2026-11-18 the local dev database had 78 history rows
  and HEAD had 78 migration files, yet two of each were different migrations
  (`20261012225648_DemographicsFirstOnEverySurvey` and `20261012230907_InvitationProgressKeepsOnlyTheDay`
  applied locally from an unmerged branch; `20261116023651_CompanyPrivacyNotice` and
  `20261116025141_TwoFactorSignIn` not applied). A count comparison calls that a match.
- **What production should show**: it serves `074930f4` (`GET /version`), whose newest migration is
  `20261116025141_TwoFactorSignIn`, of 78 migration files.

### Preconditions

| # | Check | Must be |
|---|---|---|
| R1 | `docker info --format '{{.ServerVersion}}'` | a version, not an error |
| R2 | `aws sts get-caller-identity --query Account --output text` | `795965600143`; otherwise `export AWS_PROFILE=<a profile in it>`. The backup role cannot read a dump (no `s3:GetObject`, `infra/aws/climate-project-db-backup.yml`) |
| R3 | A checkout of this repository that contains the commit production serves (step 1 checks) | — |
| R4 | No other restore drill container: `docker ps -a --filter label=org.climate-platform.purpose=restore-rehearsal --format '{{.Names}}'` | prints nothing |

### The commands — bash or zsh, from the repository root

```bash
# 1. The commit production serves, and the proof this checkout has it.
PROD_SHA="$(curl -sS https://api.climate.timsint.com/version | jq -r .commit)"; echo "$PROD_SHA"
git fetch -q origin && git cat-file -e "${PROD_SHA}^{commit}" && echo "have $PROD_SHA"

# 2. The newest dump's key. Lists names and sizes; downloads nothing.
BUCKET=climate-project-db-backups-795965600143-us-east-2
KEY="$(aws s3api list-objects-v2 --region us-east-2 --bucket "$BUCKET" --prefix climate/ \
  --query 'sort_by(Contents,&LastModified)[-1].Key' --output text)"
echo "$KEY"                     # climate/YYYY/MM/DD/climate-<UTC>.dump

# 3. Download it into a private directory of its own.
DRILL_DIR="$(mktemp -d)"; chmod 700 "$DRILL_DIR"
aws s3 cp --region us-east-2 --only-show-errors "s3://$BUCKET/$KEY" "$DRILL_DIR/"
DUMP="$DRILL_DIR/$(basename "$KEY")"; ls -l "$DUMP"

# 4. Restore, count, compare, clean up -- one command. The container is removed and the dump
#    deleted when it exits, whatever the outcome. The log holds counts and migration ids only.
LOG="$HOME/climate-restore-drill-$(date -u +%Y%m%dT%H%MZ).log"
MIGRATIONS_REF="$PROD_SHA" scripts/db-restore-rehearsal.sh --container --delete-dump \
  "$DUMP" climate_restore_drill > "$LOG" 2>&1; echo "exit $?"; cat "$LOG"

# 5. Prove the cleanup. Each line must print nothing (the last removes the empty directory).
docker ps -a --filter label=org.climate-platform.purpose=restore-rehearsal --format '{{.Names}}'
ls -A "$DRILL_DIR"
rmdir "$DRILL_DIR"
```

### Reading the result

| Exit | Meaning | What to do |
|---|---|---|
| `0` | `REHEARSAL MATCHES`: pg_restore reported 0 errors, every TABLE DATA entry came back as a table, and the restored history is exactly the code's migration set at `$PROD_SHA` | Record it below |
| `3`, tables `DIFFERS` | Fewer (or more) public tables than the dump's TABLE DATA entries | Read the `pg_restore` lines above it; a missing table is a failed drill |
| `3`, migrations `DIFFERS`, "in the code, not applied in the dump" | A migration reached production after the dump was taken, or `MIGRATIONS_REF` is not what production served at the dump's UTC time (in its key) | Compare the dump's timestamp with the last `deploy-prod` run (`gh run list --workflow deploy-prod.yml --limit 3`); re-run with the right ref |
| `3`, migrations `DIFFERS`, "applied in the dump, absent from the code" | Production holds a migration this checkout does not | Never expected for production. Stop and find out where it came from |
| `1` | pg_restore reported errors, or the drill could not run (Docker, the image) | Read the errors. The 2026-10-13 production restore had 0 |
| `2` | A refusal: a drill container already exists, a bad argument, a non-local `PGHOST` | Read the message; nothing was restored |

The per-table counts are the record the next drill compares against: a table that held rows here
and holds none next time, outside the retention jobs' reach (`docs/decisions/database-backups.md`,
"Why it matters"), is a finding. `diff` the `<table><TAB><count>` lines of two logs.

### Record

| | Drill 1 |
|---|---|
| Date (UTC) / who | `____` |
| Dump key, bytes | `____` |
| `Dumped from` / `Dumped by` (from the log) | `____` |
| pg_restore exit, errors, seconds | `____` |
| Tables restored / TABLE DATA entries | `____` |
| Newest migration: dump / code at `PROD_SHA` | `____` |
| companies, users, surveys, survey_invitations, responses, question_responses | `____` |
| Exit code | `____` |
| Step 5 printed nothing (container gone, file gone) | `____` |

### How the script was exercised — 2026-11-18, local dev data only

`scripts/db-restore-rehearsal.test.mjs` (12 tests, stubbed Docker and Postgres; part of CI's
`node --test 'scripts/*.test.mjs'`) pins removal on success, on a comparison failure and on a
pg_restore failure; that a container this script did not create is never removed; that an
argument error never deletes the dump; and that a history which agrees in count but not in
content `DIFFERS`. Then, against real Docker and the laptop's dev database (never production):

| Case | Result |
|---|---|
| A — dump of the dev database `climate_project` (workflow's `pg_dump` flags), `--container --delete-dump`, `MIGRATIONS_REF=HEAD` | exit `3`: 76 tables restored / 76 TABLE DATA entries `MATCH`; migrations `DIFFERS` with exactly the two-and-two set above |
| B — synthetic dump whose history is HEAD's 78 migrations, `--container --delete-dump` | exit `0`, `REHEARSAL MATCHES`, 8 / 8 tables |
| C — the same dump truncated to 2,000 bytes, `--container --delete-dump` | exit `1` (`pg_restore: error: could not read from input file: end of file`); container and file removed |
| D — case B's dump, host mode (local server) | exit `0`; scratch database dropped by hand afterwards |

Afterwards: `docker ps -a --filter label=org.climate-platform.purpose=restore-rehearsal` printed
nothing, no `climate_restore_selftest%` database remained, and the scratch directory was empty.
