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

Four `BackgroundService` jobs in `ClimateProject.Workers`. **Every instance runs every job.**
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

| Job | Interval | Replaces |
| --- | --- | --- |
| `notification-dispatch` | 1 min | `api/cron/process-reminders` |
| `invitation-reminders` | 15 min | `api/cron/send-reminders` (matches the legacy cadence exactly) |
| `digests` | 15 min | nothing — `DigestFrequency` had no job behind it |
| `scheduled-reports` | 5 min | `api/cron/scheduled-reports` |

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
- `Dockerfile.workers` exists but nothing builds it. #164 chooses between deploying it as its
  own service and calling `AddClimateProjectScheduling` from the API host. Both are correct;
  the lease makes it an operational choice, not a correctness one.

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
