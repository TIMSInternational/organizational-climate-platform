# Decision: the production database has no restorable backup, and that is a choice nobody has made

**DECIDED 2026-10-12: option B, a nightly logical dump to S3. Owner: Federico.**
**Status: BUILT, NOT YET PROVEN IN PRODUCTION.** No production dump exists yet and none has
been restored. This file is not "done" until the two outputs under
[Remaining](#remaining--not-done-until-pasted) are pasted into it.

Raised OPEN 2026-09-28 against `5e95df7b`. The sections from "The measurement" to "What is not in
question" are the record that led to the decision and are kept unedited; the decision and what
was built follow them.

## The measurement

Re-measured 2026-09-28, not quoted from the earlier audits:

```
$ supabase backups list --project-ref uleeeziiceduvmiftgby -o json
{
  "backups": [],
  "physical_backup_data": {},
  "pitr_enabled": false,
  "region": "us-east-1",
  "walg_enabled": true
}
```

Identical to `docs/audits/2026-09-03-functional-gaps.md:193`, `2026-09-05-gap-closures.md:143`
and `2026-09-24-remaining-work.md:83`. Nothing has changed in 25 days.

`walg_enabled: true` is the one thing that reads as reassuring and is not. It means the physical
backup *engine* is switched on at the platform level. It does not put a restorable artefact
anywhere you can reach: `backups` is empty and PITR is off, so there is no self-serve restore
point and no stated RPO. Treat the restorable state as **nothing**.

## Why it matters more here than the average empty backup list

The application deletes production rows on a timer, by design, with `ExecuteDeleteAsync` — which
bypasses the change tracker and leaves nothing for the audit interceptor to see:

| job | file | what it removes |
|---|---|---|
| retention cleanup | `src/ClimateProject.Infrastructure/Scheduling/RetentionCleanupJob.cs:224,239` | rows past their retention window |
| survey draft retention | `src/ClimateProject.Infrastructure/Scheduling/SurveyDraftRetentionJob.cs:124` | expired survey drafts |
| GDPR subject erasure | `src/ClimateProject.Infrastructure/Gdpr/SubjectErasure.cs:203,399` | a data subject's rows, on request |

The first two run unattended. A wrong retention constant, a clock problem, or a migration that
widens what "expired" matches deletes real client responses on a schedule, and there is currently
no state of the world in which those come back. The third is *supposed* to delete and must not be
undone by a restore — which is its own reason to decide this deliberately rather than by default.

The client is a Costa Rican public institution and go-live is 16 Nov 2026. "We cannot restore
your employees' survey responses" is not a sentence this project can afford to be able to say.

## The options, with what is actually known about each

Prices are **not** recorded here as fact. Supabase's PITR is a paid add-on whose price depends on
the plan and the retention window, and this project has three Supabase projects on one account —
so the number has to be read off the billing page for *this* project, `uleeeziiceduvmiftgby`, and
written into this file when it is. What follows is the shape of each option, which does not
change with the price.

**A. Turn on PITR for the production project.** Continuous, platform-managed, restore to a chosen
second within the retention window. No code, no new failure mode, one switch. Costs money every
month, and the restore is all-or-nothing at the project level. This is the option that actually
removes the risk rather than reducing it.

**B. A scheduled logical dump to S3.** `pg_dump` on a timer from a workflow or the worker, written
to a bucket with a lifecycle policy and encryption. No new vendor spend beyond storage, and the
dump is portable — it restores into any Postgres, including a local one, which is worth something
independent of Supabase. Costs engineering: a job, its credentials, an alarm for when it stops
(a backup job that silently stopped is worse than none, and this repo has already learned that
shape from the alerting subscription), and a **restore rehearsal**, because an untested dump is a
belief, not a backup.

**C. Accept it, in writing, with a stated RPO of "everything since the project was created".**
A legitimate answer for a system with no real data in it yet. It stops being legitimate the moment
UAT (#161) puts real responses in, and it must then be revisited — which is the part that gets
forgotten unless it is written down with a date.

## What is not in question

Whichever is chosen, two things follow and neither is optional:

1. **A restore has to be rehearsed before cutover**, into a scratch database, with the result
   recorded. #159 already establishes that principle for the application rollback; a database you
   have never restored is in exactly the position the rollback workflow was in before this week —
   written, believed, never run.
2. **The chosen mechanism needs an alarm.** The observability stack now has 24 armed alarms and a
   delivery path; a backup that stops is precisely the class of silent failure it exists to catch.

## Decision

**B — a nightly `pg_dump` to S3 in the climate production AWS account** (795965600143,
us-east-2). Decided by Federico, 2026-10-12, for #512.

| | |
|---|---|
| **RPO** | **24 hours.** One dump a day at 07:00 UTC (01:00 Costa Rica); anything written since the last successful dump is lost on a restore. |
| **Retention** | **35 days** of daily dumps (S3 lifecycle), plus 7 days for a version that was overwritten or deleted. |
| **Where** | `s3://climate-project-db-backups-795965600143-us-east-2/climate/YYYY/MM/DD/climate-<UTC timestamp>.dump` — a different vendor and region from the database (Supabase, us-east-1). |
| **What** | `pg_dump --format=custom --schema=public --no-owner --no-privileges` — every EF Core table, `__EFMigrationsHistory` included. Not Supabase's own schemas (`auth`, `storage`, `realtime`, …), which this application does not use (see `docs/runbooks/backup-restore-verification.md`). |
| **Alarm** | `climate-project-db-backup-stopped` on the **critical** topic: 26 consecutive hours without a `ClimateProject/Backup` `DumpSucceeded` datapoint. Missing data is breaching, so a job that never runs pages exactly like one that fails. |

Why not A (PITR): not rejected on merit — it is still the option that removes the risk rather than
reducing it, and its price was never read off the billing page. B was chosen because it can be
built and proven today with no new vendor spend, and its dump restores into any Postgres.

## What was built

| File | What it is |
|---|---|
| `infra/aws/climate-project-db-backup.yml` | Stack `climate-project-db-backup-prod`: the bucket (all public access blocked, versioning, SSE-S3, TLS-only, lifecycle 35 d / noncurrent 7 d, `DeletionPolicy: Retain`); role `climate-project-github-db-backup-prod`, trusted only for this repository's `production` environment through the existing OIDC provider, allowed `s3:PutObject` under `climate/`, a size-only listing of that prefix, and `cloudwatch:PutMetricData` in `ClimateProject/Backup` — it can neither read nor delete a backup; the alarm, wired to the observability stack's `critical-topic` export. |
| `.github/workflows/db-backup.yml` | Daily 07:00 UTC + manual dispatch. Converts `MIGRATION_DATABASE_CONNECTION_STRING` (session pooler, 5432) to libpq variables without echoing the password, installs the PGDG PostgreSQL 17 client, dumps, **refuses a dump whose table of contents lacks TABLE DATA for the key tables** (a schema-only dump is 229 KB locally, so a size floor alone cannot catch one), uploads, reads the object's size back from S3, and only then publishes the metric. |
| `scripts/db-restore-rehearsal.sh` | Restores a dump into a NEW local scratch database and prints row counts and the last migration. Refuses an existing database, `climate_project`, and any non-local `PGHOST`. |
| `scripts/backup-setup/1-deploy-stack.sh`, `2-set-github-vars.sh`, `3-first-run.sh` | Federico's one-time setup. Each refuses unless profile `tims-new` is account 795965600143. |

Measured before commit: `cfn-lint infra/aws/*.yml` clean; `aws cloudformation validate-template`
against the account succeeded (requires `CAPABILITY_NAMED_IAM`); `actionlint` clean over every
workflow; `shellcheck` clean over the four scripts.

Two things the template cannot do, stated so nobody believes otherwise:

- **The trust policy cannot name the workflow file.** IAM reads GitHub's `aud` and `sub`; the
  workflow path is in `job_workflow_ref`, which it does not. The role trusts any job in the
  `production` environment, whose branch policy admits `main` only (measured 2026-10-12 with
  `gh api repos/TIMSInternational/organizational-climate-platform/environments/production`). Such
  a job already holds the database credential; the role adds only the right to write a backup.
- **The client major is 17 by inference.** The production server version is recorded nowhere in
  this repository; the 2026-09-04 manual dump records `pg_dump 17.6`, which the Supabase CLI
  matches to the server. If the project is upgraded past 17, `pg_dump` refuses, no metric is
  published, and the alarm fires — raise `PG_MAJOR` in the workflow.

## Restore procedure

Never executed against production. The rehearsal below is the data path, run locally.

1. **Stop writes.** Pause the App Runner service (`climate-project-api-prod`, us-east-2) so
   nothing lands in a database that is about to be replaced.
2. **Capture the erasure log first** — see [the next section](#gdpr-erasure-a-restore-resurrects-erased-subjects).
   This must happen *before* step 5, while the current database can still be read.
3. **Fetch the dump** with an admin profile (the backup role cannot read): `aws s3 ls
   s3://climate-project-db-backups-795965600143-us-east-2/climate/ --recursive --profile tims-new`,
   then `aws s3 cp` the chosen key. Earlier versions of an object: `aws s3api list-object-versions`.
4. **Rehearse it first**: `scripts/db-restore-rehearsal.sh <file>.dump climate_restore_check`.
   Read the counts and the last migration. `dropdb` it afterwards — it is personal data.
5. **Restore** into the target over the session pooler (port 5432, never 6543):
   `pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction -d "<libpq URI>" <file>.dump`
   (PostgreSQL 17 client). Into a new Supabase project instead, omit `--clean --if-exists`;
   `public`'s `CREATE SCHEMA` collides there exactly as it does locally — use the TOC filter the
   rehearsal script uses.
6. **Re-apply erasures** captured in step 2.
7. **Resume the service**, check `/ready`, and expect the retention jobs to re-delete, on their
   next run, any rows they had already deleted after the dump was taken — that is correct.

## GDPR erasure: a restore resurrects erased subjects

A dump taken before an erasure contains the subject's rows. Restoring it undoes the erasure, which
the law does not allow, so every erasure performed after the dump must be re-applied.

**What is true about the log, measured in source:**

- There **is** an erasure log, and it is in the database: before erasing, `POST /gdpr/erasure`
  writes an `audit_logs` row with `action = 'gdpr.erasure'`, `resource = 'gdpr'`,
  `resource_id = <subject user id>`, `timestamp`, saved in its own write ahead of the erasure
  transaction (`src/ClimateProject.Api/Endpoints/GdprEndpoints.cs:209-219`, `:67`, `:73`, `:337-349`).
- **It lives in the same database the restore replaces.** A restore from a dump taken at T also
  loses every audit row written after T. So the list must be read from the *current* database
  before restoring (step 2):
  `select resource_id, "timestamp" from audit_logs where action = 'gdpr.erasure' and "timestamp" > '<dump UTC time>' order by 1;`
  — and saved outside it. **If the current database is unreadable, no other record of those
  erasures exists in the system**; the gap cannot be closed from data this repository owns.
- **An erasure can run with no audit row at all**: when neither the caller nor the subject has a
  company, the endpoint logs a warning and skips the row (`GdprEndpoints.cs:327-335`). Today that
  is only a super admin erasing a global-scope account.
- Re-applying: for each `resource_id`, `POST /gdpr/erasure` with `{"userId": "<id>", "confirm": true}`
  as a super admin (`src/ClimateProject.Application/Gdpr/GdprDtos.cs:157`). Running it against a
  subject already erased pseudonymises an already-pseudonymised row, which is harmless.

## LOCAL rehearsal — 2026-10-12

**Dev database `climate_project` on this laptop, NOT production.** It proves the pipeline's
commands (the workflow's exact `pg_dump` flags, its table-of-contents check, and the restore
script) end to end. It says nothing about production's data.

```
$ pg_dump --format=custom --compress=6 --schema=public --no-owner --no-privileges \
    --no-publications --no-subscriptions --file=climate-local-20261012T230514Z.dump   # PGDATABASE=climate_project, client 17.10
$ pg_restore --list … | grep -c ' TABLE DATA public '      →  70, every key table present
  (control: a --schema-only dump of the same database, 228,887 bytes, is REJECTED by the same check)

$ scripts/db-restore-rehearsal.sh climate-local-20261012T230514Z.dump climate_restore_rehearsal_local
pg_restore: pg_restore (PostgreSQL) 17.10 (Homebrew)
server:     17.10 (Homebrew)
dump:       <scratchpad>/climate-local-20261012T230514Z.dump (566485 bytes)
;     Dumped from database version: 17.10 (Homebrew)
;     Dumped by pg_dump version: 17.10 (Homebrew)
created:    climate_restore_rehearsal_local
pg_restore: exit 0 in 1s, 0 error(s)

row counts in climate_restore_rehearsal_local:
companies	9
users	266
surveys	35
survey_invitations	15
responses	503
question_responses	3392
public tables	70
__EFMigrationsHistory rows	62

last migration:
20261010190354_AddActionPlanOwner	10.0.0

When done:  dropdb climate_restore_rehearsal_local
```

Source `climate_project` at the same moment: companies 9, users 266, surveys 35,
survey_invitations 15, responses 503, question_responses 3392 — identical. The scratch
database was dropped afterwards.

## Remaining — not done until pasted

These close #512's second and third acceptance criteria. Neither has happened.

- [ ] **The first production dump.** Federico runs `scripts/backup-setup/1-deploy-stack.sh`,
  `2-set-github-vars.sh`, then `3-first-run.sh` — **after** this change is merged to `main`
  (`workflow_dispatch` only finds a workflow that exists on the default branch). Paste the run
  URL, the `aws s3 ls` line and the alarm state here.
- [ ] **A production-dump restore rehearsal** into a scratch database:
  `scripts/db-restore-rehearsal.sh <that dump> climate_restore_prod_rehearsal`. Paste the
  output here, compare the counts against production's own, then `dropdb` it.
- [ ] Check the alarm went `OK` after the first successful run, and confirm it reaches the
  critical topic's subscriber.

Until both outputs are here, the honest durability guarantee is: **a mechanism exists that has
never produced a production backup.**
