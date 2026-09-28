# Decision: the production database has no restorable backup, and that is a choice nobody has made

**OPEN.** Owner: Federico. Raised 2026-09-28 against `5e95df7b`. This file exists because the
measurement below has been recorded four times since 3 September, in four different documents,
and has never been attached to a decision or an issue — so it has been a known risk and an
unowned one at the same time.

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

Not yet made. Until it is, the honest statement of the system's durability guarantee is: **there
is none**.
