# The backup, and the restore that proved it

**Status: TAKEN and PROVEN RESTORABLE. 2026-09-04.**

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
