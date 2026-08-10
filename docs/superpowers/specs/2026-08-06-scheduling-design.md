# Scheduled reminders, digests and reports (#101)

Supersedes the "`ClimateProject.Workers` stays an empty skeleton — no new background job in
this pass" line in `2026-08-01-notifications-design.md`. That was #97's scope boundary, and
this is the pass that crosses it.

## What was actually at risk

`vercel.json` runs `/api/cron/send-reminders` every 15 minutes in production **today**. There
was no equivalent anywhere in the new stack. A cutover without this stops survey reminders
with no error, no alert and no failed request — the regression surfaces weeks later as a
decline in response rates that nobody attributes to a deploy.

Two adjacent things were in the same state: `NotificationPreferences.DigestFrequency` has been
stored, validated and exposed on the self-service API since #192/#97 with **nothing behind
it**, and `Report.IsRecurring` / `NextGeneration` have existed since the schema landed with
nothing reading them.

## Execution model — decided

A `BackgroundService` per job in `ClimateProject.Workers`. **Every instance runs every job.**
Nothing is pinned to one instance: App Runner cannot express that, and pinning would make the
scheduler a single point of failure with no failover.

Correctness under 25 instances comes from three independent layers, not from instance count:

| Layer | Mechanism | Covers |
| --- | --- | --- |
| Mutual exclusion | `pg_try_advisory_xact_lock`, key = SHA-1 of the job name | Two instances doing the same work at the same time |
| Identity | `uuidv5(namespace, key)` as the notification's primary key | A duplicate that got past the lease — it becomes a PK violation |
| Send state | `reminder_count` / `last_reminder_sent` / `notifications.status`, written in the lease's transaction | A second tick redoing the first tick's work |

Any one would usually be enough. All three are present because "usually" is the word that
produces the incident.

### Why a transaction-scoped advisory lock

- **vs. a leases table**: no migration, no expiry to tune, no story for a holder that dies
  without releasing. The lock is released by commit, by rollback, by the connection dropping
  and by the container being killed.
- **vs. `pg_try_advisory_lock` (session-scoped)**: a session lock leaked by a code path that
  forgot to unlock is inherited by whatever runs next on that pooled connection, and Supavisor
  transaction pooling (#220 — production is currently pointed at it) does not preserve session
  state at all.
- **vs. the blocking form**: 24 instances queueing behind the 25th would each hold a pooled
  connection and then run the job themselves the moment it released — one run becomes 25
  sequential runs, which is the double-send the lease exists to prevent.

## The jobs

> **Scheduled ≠ running.** Every interval in this table describes what the workers host *would*
> do. As of #272 that host runs nowhere: `deploy-prod.yml` builds only the root `Dockerfile`
> (the API), nothing builds `Dockerfile.workers`, `ClimateProject.Api` has no project reference
> to `ClimateProject.Workers`, and `infra/aws/` defines one service. **None of these jobs has
> ever executed in production.** #275 owns fixing that; until it lands, read this table as a
> specification, not as a description of production.

| Job | Interval | Replaces |
| --- | --- | --- |
| `notification-dispatch` | 1 min | `api/cron/process-reminders` |
| `invitation-reminders` | 15 min | `api/cron/send-reminders` (matches the legacy cadence exactly) |
| `digests` | 15 min | nothing — `DigestFrequency` had no job behind it |
| `scheduled-reports` | 5 min | `api/cron/scheduled-reports` |
| `survey-draft-retention` | 1 hour | nothing — `DELETE /surveys/drafts/expired` had no caller (#272) |

**Why an hour for draft retention.** It is the one interval nothing observable depends on.
Drafts expire after 30 days and every draft read filters on `expires_at > now`, so an expired
draft is already invisible; the sweep only returns the disk. Hourly keeps each tick's delete
small — and each run is capped at `Scheduling:SurveyDraftRetentionBatchSize` rows so the first
sweep over a backlog is not one enormous transaction under the lease. A missed tick costs
nothing: the sweep is idempotent and deletes strictly by `expires_at`.

The capped run is **unordered**. An earlier version took the oldest expiry first; nothing can
observe that order, because every row in the set is already hidden by the read filters, so the
sort produced a difference with no consumer. (It also cost a full scan plus a top-N sort at the
time, because `expires_at` was then unindexed; that half of the argument no longer holds — see
below — but the "no consumer" half is the reason it stays out.) Progress stays monotone without
it: the rows a tick takes are deleted, so no row can be handed back to the next tick and none
can be starved.

**The retention predicate is indexed (#278, closed).** `survey_drafts` was indexed on
`company_id` and `user_id` only, so `WHERE expires_at <= now` was a sequential scan — hourly,
forever, on a table whose whole premise is unbounded growth (the wizard autosaves a draft row
per authoring session since #266). `20260810180421_AddSurveyDraftExpiresAtIndex` adds
`IX_survey_drafts_expires_at`, a plain btree. Measured on 20,000 live drafts, freshly
`ANALYZE`d: the harvest goes from a seq scan reading 364 shared buffers to an index scan
reading 2, and the uncapped `DELETE` behind `DELETE /surveys/drafts/expired` moves the same
way. `SurveyDraftExpiryIndexTests` asserts this on the plan of the statements the job actually
sends, not on the presence of a row in `pg_indexes`.

The index does **not** help the read path, despite `expires_at > now` appearing in every draft
read. Those queries filter `user_id = @me` as well, and the expiry half matches nearly every
row, so the planner uses `IX_survey_drafts_user_id` and applies expiry as a filter — measured,
not assumed. What the index does cost is writes: every autosave re-stamps `expires_at`, so
those `UPDATE`s are no longer HOT-eligible and maintain an index entry apiece.

Dispatch calls `NotificationDelivery.ProcessDueAsync` — **the same method
`POST /notifications/process` calls.** That logic was extracted out of `NotificationEndpoints`
for this reason: a scheduler with its own copy of the consent rules would be a second,
quietly divergent answer to "may we email this person", which is the one question where two
answers is worse than one wrong one.

Reminders and digests **raise `pending` rows and stop.** They never talk to a sender. Consent
is evaluated at delivery time by design, so a recipient who opts out between a reminder being
raised and being sent is still honoured.

## Time zones

`DigestSchedule` computes every period boundary in the **recipient's** `UserPreferences.Timezone`.
A "daily digest" is meaningless otherwise. Recurring reports use the **company's**
`Settings.Timezone` instead — a report is an organisational artefact, so "the monthly report"
means the tenant's month, whereas a digest is personal.

Consequences that are tested rather than assumed: an unrecognised zone falls back to UTC
rather than dropping the recipient; a local midnight that does not exist on a spring-forward
day moves forward instead of throwing; an ambiguous local time resolves consistently; half-hour
offset zones (Kathmandu, UTC+05:45) are served at their own 08:00.

## Deliberate non-behaviours

- **`never` means never.** One gate, consulted before anything is constructed, no bypass. An
  unrecognised frequency fails closed rather than defaulting to weekly.
- **No digest backfill.** A worker down for three weeks sends this week's digest and forgets
  the two it missed. Mailing three stale summaries makes the volume of mail a function of how
  long an outage lasted, which turns a recovery into a second incident.
- **No empty digests.** Zero notifications in the period produces nothing.
- **No report backfill.** A schedule dormant for four months fires once and resumes; it does
  not generate 120 reports over a dataset that has since moved on, and it does not leave the
  schedule in the past firing on every tick forever.
- **Reminders are capped** at three per invitation. The cadence alone bounds nothing: a survey
  open for a quarter at a 3-day cadence would mail a non-responder thirty times.

## Seams left open

- `IScheduledReportRunner` — #91 replaces `LoggingScheduledReportRunner` with real generation
  and delivery. This is why report scheduling and report generation do not fight over a
  scheduler.
- `INotificationSender` — unchanged; #100 still owns real delivery.
- `Dockerfile.workers` exists but nothing builds it, so the scheduler runs nowhere — see the
  note above the job table. **#275** chooses between deploying it as its own service and
  calling `AddClimateProjectScheduling` from the API host. Both are correct; the lease makes it
  an operational choice, not a correctness one. Deliberately not made by any issue that merely
  adds a job to the host, #272 included: co-hosting in the API is a real architectural change
  with a real cost, and it should be decided once, on purpose.

## Observability

Every job logs a structured heartbeat on **every** tick, including ticks that found nothing to
do and ticks that lost the lease. #158 alarms on the *absence* of that line — the only thing
that catches a process which is gone, since a dead process cannot log an error about itself.

Separately, `WorkerHeartbeatMonitor` reports at Error when one job's last success is older than
3× its own interval. That catches the case the external alarm is worst at: one job wedged while
the other three keep the log busy.

Losing the lease counts as an attempt, never as a success. On a 25-instance cluster 24
instances lose it every tick; if that counted as healthy, all 24 would look fine while the one
instance actually doing the work was wedged.
