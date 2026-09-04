# Operational readiness — CLIO/PROCOMER go-live, 16 November 2026

Consolidates four overnight plans into one sequence: **#156** (staging with production
parity), **#158** (monitoring, logging, alerting), **#159** (tested cutover rollback) and
**#219** (a deploy path for `services/tracking-api`). Where the four disagreed, this
document decides and says why; it does not paste them side by side.

**Written 2026-08-25. Nothing in it has been executed against production.** Section 7 is
the register of every claim here that is a plan rather than an observation — read it
before quoting any number to the client.

The state, in one paragraph: the repo side of all four issues is largely built and four
branches carry it, two of them not yet pushed. The console side of all four is at zero.
Production is running a five-day-old API behind a current front end and is serving a
live 404 because of it; it has no alarms; there is no staging environment to rehearse
anything in; the tracking service that carries the client's own export has never been
built by CI, let alone deployed; production mail is unconfigured; and the production
database has no point-in-time recovery and no listed backups. None of that is new
breakage — it is the accumulated gap between a repo that is ready and infrastructure
that has not been told.

---

## 1. The ordered list

One sequence, dependency order. **[H]** marks the items only a human can do — a
decision, a credential, a console click, money, or naming a person. **[C]** marks repo
work anyone (or an agent) can do without touching a running system.

### Today, first — 45 minutes, nothing running is touched

| # | | Action | Why it is first |
|---|---|---|---|
| 1 | [C] | **Push the two unpushed branches.** `ops/158-monitoring-logging-alerting` (e2efa7e) and `feat/159-tested-cutover-rollback` (cea6dd4) exist only inside two local worktrees. Verified absent from `origin` today. Commands in §2.1. | Two nights of work is currently one `rm -rf` from gone. Pushing starts no workflow: neither branch adds a `push:` trigger and `ci.yml` fires only on PR-to-main and push-to-main. |
| 2 | [H] | **Run `aws sts get-caller-identity` and find out whether any human holds credentials in AWS account `747814092517`.** Ten seconds. | It gates items 14, 16, 20 and 25 — that is, all of #158, all of #219's infrastructure, and the break-glass half of #159. Every lane last night had credentials for the **DEV** account `795965600143` only. If the answer is "nobody", say it out loud: the entire recovery story then depends on GitHub Actions being reachable, and that is a different plan. |
| 3 | [C] | **Correct the Supabase project reference in `docs/runbooks/staging-provisioning.md`.** It names `lzhfnjfsdwdywwnlqgqq` as "the Supabase project". That ref is `tims-ats`, a different product. This platform is `uleeeziiceduvmiftgby`. See §6.1. | Decision box 2 of that runbook offers "a persistent branch on `lzhfnjfsdwdywwnlqgqq`" as an option. Following it branches another product's production database. Fix the document before anyone reads it at 09:00. |
| 4 | [H] | **Decide the live API/web split.** The deployed API is 23 commits behind a front end that ships on every merge, and `GET /admin/question-library` returns **404 on production right now** while the live bundle calls it. Either dispatch `deploy-prod.yml` (the single pending migration is additive — `confirm_destructive_migration=no`) or roll the web back to match. §6.2. | It is a live client-visible defect that every health check reads as green, and the same decision stops the 13:00 UTC drift run from failing from today onward. |
| 5 | [C] | **Correct two issue bodies.** #219 says `services/tracking-api` "is built and tested in CI" — it has never been in CI. #156's finding "file a tracking-api deployment issue" is already satisfied: that issue is #219 and its branch is pushed. | Two people acting on stale issue text is how the same work gets done twice or not at all. |

### Then — the decisions, before anyone opens a console

These are a meeting, not keyboard work. Every one of them blocks a multi-hour session
downstream, and each has been deferred at least once already.

| # | | Decision | Blocks |
|---|---|---|---|
| 6 | [H] | **Which AWS account hosts staging** — DEV `795965600143` (full isolation; needs the GitHub OIDC provider created, verified absent 2026-08-15) or prod `747814092517` (provider exists; shared blast radius). | #156 step 4, therefore #159's rehearsal |
| 7 | [H] | **May real employee responses be copied to staging?** Recommendation: no — synthetic only. Option B needs a free-text scrubber that does not exist and is not a small task. | #156 step 8.5 |
| 8 | [H] | **One budget owner for the whole recurring bill**, not per-issue. §6.4 totals it. | #156, #219 |
| 9 | [H] | **The three Supabase decisions together**: a staging project; a tracking project; and whether PITR is turned on for production. PITR is **off with zero listed backups** — measured, §6.1. | #156, #219, #159's dump step |
| 10 | [H] | **Name the incident decision owner and a backup, with the hours each covers.** | #159's six triggers, #158's rota. An alarm nobody is rostered for is not an alarm, and a threshold nobody agreed to will not be pulled at 03:00. |
| 11 | [H] | **The Teams webhook URL, and which flavour it is** (Power Automate Workflows vs a classic O365 connector — they take different payloads and the wrong one renders an empty card *and still returns 200*). Plus the SNS fallback distribution list, whose confirmation link **must be clicked** or the subscription is silently discarded. | #158 step 4 |
| 12 | [H] | **Log retention in days** — 90 is a proposal, not a derived number. Check it against the client's data-retention commitments; a government contract may specify. | #158 step 6 |

### Then — merge, and the work that does not need staging

| # | | Action | Depends on |
|---|---|---|---|
| 13 | [C] | **Review and merge the four branches** (§2). All four are additive — new files, new templates, new workflows, docs. No existing deploy workflow was edited by any lane, so no current dispatch behaves differently after the merge. | 1 |
| 14 | | **#158 step 1:** create the observability stack with `AlarmsEnabled=false`. Watch 48 h. | 2, 13 |
| 15 | | **#158 step 2 — verify the instrument before trusting it.** Confirm the heartbeat text really appears in CloudWatch; correct or **delete** the guessed `"Health check failed"` filter rather than leaving one that can never fire; send one real `aws sns publish` and **look at the Teams channel with your eyes**. A 200 from a webhook is not evidence. | 11, 14 |
| 16 | | **#158 step 3:** `AlarmsEnabled=true`, set log retention, set `TEAMS_WEBHOOK_URL`. | 12, 15 |
| 17 | [H] | **Arm production mail, or accept a standing red alarm.** The service template sets zero `Email__` variables, so every email notification is currently recorded as failed and `mail-not-configured` will fire immediately and correctly. §6.3 — this is bigger than an alarm. | 13 |
| 18 | [C] | **One `web/vercel.json` change covering both lanes' findings** (§6.5): the CSP `connect-src` hardcodes production's API host and is inherited by every Vercel project rooted at `web/`, staging included; and it will need the tracking origin later. Do **not** promote it from Report-Only to enforcing until both are settled. | web lane |

### Then — staging, the long pole

| # | | Action | Depends on |
|---|---|---|---|
| 19 | | **#156 steps 1–7** as written: GitHub `staging` environment → Supabase DB → three Secrets Manager entries → bootstrap stack (+ OIDC provider if DEV) → Vercel project → `gh workflow run deploy-staging.yml` → wire web to API. | 6, 7, 8, 9 |
| 20 | [H] | **Step 5a — turn Vercel Deployment Protection off, or decide to leave it on** and rewrite step 7's smoke test. On by default; 302s every request including `curl`, and reads as a broken deploy for an hour. | 19 |
| 21 | | **Step 8 — bootstrap the first user out-of-band.** Without this the environment is unreachable and #156 fails its own acceptance criteria. The exact three statements are in §3.2. Choose a **fresh** password and an admin email domain that does not exist in production. | 19 |
| 22 | | **Step 8.5 — seed synthetic data**, respecting the anonymity floor of 5 and the authenticated-respondent constraint. Re-derive both from source before seeding, not after. | 7, 21 |
| 23 | [H] | **Turn `staging` on in the drift/alarm story too**, or note deliberately that staging is unmonitored. | 16, 19 |

### Then — tracking, and the tested rollback

| # | | Action | Depends on |
|---|---|---|---|
| 24 | [C] | **#219 step 0 and step 1** — add the `tracking-build-and-test` CI job (run the suite green locally first), then the three source changes in `services/tracking-api`: `/ready` doing `SELECT 1`, `/version` reporting a 40-hex commit, and co-hosting `CacheSyncWorker` + `DailySemaforoWorker` in the API process. §5.2. | source lane |
| 25 | | **#219 steps 2–4** — bootstrap stack, secrets, first dispatch (`confirm_destructive_migration=yes`, **once, on the first deploy only**), then verify by measurement. | 2, 9, 24 |
| 26 | [H] | **#219 step 5 — the Vercel variable, LAST.** `VITE_TRACKING_API_BASE_URL` is a capability flag that swaps Action Plans out of the nav. Setting it early takes a working screen away from the client *and* offers a dead module. §5.4. | 25 |
| 27 | [H] | **Ratify or replace #159's six trigger thresholds** and record who ratified them. | 10, 16 |
| 28 | | **Two clean rehearsal runs** of `rollback-rehearsal-staging.yml`. The second catches the step that only worked because someone had a terminal open. Transcribe the measured timings into the runbook, replacing the guessed 3–7 minutes. Then #159 can be closed honestly. | 19, 27 |

### Before go-live

| # | | Action |
|---|---|---|
| 29 | | **Rehearse a database restore in staging**, once the PITR decision (item 9) is made. Staging is the right place; today there is nowhere. |
| 30 | [C] | **Stamp the web build with its commit** (one env var from `VERCEL_GIT_COMMIT_SHA`). Nothing can currently assert what commit the front end is at, which is why item 4's defect was invisible. |
| 31 | [C] | **Emit queue depth as a metric.** Depth, oldest-due-age and dead-letter count exist only inside a SuperAdmin-authenticated endpoint. The heartbeat alarms detect the dispatcher *stopping*, not *falling behind*. |
| 32 | [H] | **Decide the Vercel auto-deploy posture during an incident.** Merges to main silently roll the web forward again; a web rollback that the next merge undoes is not a rollback. |

---

## 2. The four branches

### 2.1 State, verified against `origin` on 2026-08-25

| Issue | Branch | Commit | On origin? |
|---|---|---|---|
| #156 | `docs/156-staging-readiness-gaps` | `c2cc21c` | **yes** |
| #158 | `ops/158-monitoring-logging-alerting` | `e2efa7e` | **NO** |
| #159 | `feat/159-tested-cutover-rollback` | `cea6dd4` | **NO** |
| #219 | `infra/219-tracking-api-deploy-path` | `176c531` | **yes** |

Both pushes were denied by the auto-mode permission classifier, not abandoned. The
commits are intact in their worktrees:

```bash
git -C .claude/worktrees/wf_52257b14-421-2 push -u origin ops/158-monitoring-logging-alerting
git -C .claude/worktrees/wf_52257b14-421-3 push -u origin feat/159-tested-cutover-rollback
```

No PR was opened on any of the four, per each lane's brief.

### 2.2 What each branch contains

| Branch | New | Modified |
|---|---|---|
| #156 | — | `docs/runbooks/staging-provisioning.md` (+288/−11) |
| #158 | `infra/aws/climate-project-observability.yml`, `.github/workflows/ops-synthetic-probe.yml`, `docs/runbooks/alerting.md` | none |
| #159 | `scripts/rollback-api-image.sh`, `scripts/rollback-probe.sh`, `.github/workflows/rollback-prod.yml`, `.github/workflows/rollback-rehearsal-staging.yml` | `docs/runbooks/rollback.md` (rewritten), `docs/runbooks/cutover.md` (9-line amendment) |
| #219 | `.github/workflows/deploy-tracking-prod.yml`, `infra/aws/climate-tracking-api-bootstrap.yml`, `infra/aws/climate-tracking-api-prod-service.yml`, `services/tracking-api/Dockerfile`, `services/tracking-api/.dockerignore`, `docs/runbooks/tracking-service-provisioning.md` | `docs/security/rotation-inventory.md`, `docs/security/rotation-runbook.md`, `infra/aws/README.md` |

**No lane edited `deploy-prod.yml`, `deploy-staging.yml`, `deploy-drift.yml` or `ci.yml`.**
Nothing about what an existing dispatch does has changed. Two workflows on #159's branch
*would* change production **when dispatched** — `rollback-prod.yml` is dispatch-only and
gated on typing a confirmation phrase, and has never been run.

Two of the new workflows are **inert until they are on `main`**: GitHub only offers
`workflow_dispatch` from the default branch, and `schedule` / `workflow_run` triggers
only fire there. That is item 13's whole point.

---

## 3. Staging — #156

### 3.1 What is already true

The repo-side scaffold is built and merged. Both CloudFormation templates are
environment-parameterised, `deploy-staging.yml` mirrors `deploy-prod.yml` step for step
including its canary, and `scripts/verify-prod-deploy-invariants.py` fails CI if the two
deploys ever drift — it passes 12/12, including five checks asserting that staging still
rehearses the same play as prod.

So the work is not "design staging". It is "execute the existing plan and find where it
breaks". Verified today: the `staging` GitHub environment **does not exist** (the repo
has `Preview` and `production` only) and `deploy-staging.yml` has **never run**.

### 3.2 The fatal gap: following the runbook end to end produces an environment nobody can log into

Four facts, each checked in source:

- **No migration seeds data.** No `InsertData` anywhere under
  `src/ClimateProject.Infrastructure/Migrations/`. A migrated staging DB is empty: zero
  companies, zero users.
- **No host-side bootstrap.** `Program.cs` seeds nothing.
- **`POST /api/auth/signup` cannot be the way in, and fails twice.** It resolves a
  company by email domain first (`AuthEndpoints.cs:134`) and 404s when there is none,
  which on an empty DB is always; and even on success it always mints
  `Role = Roles.Employee`. It can never produce an administrator.
- **Creating a company requires an authenticated administrator** — the thing you do not
  have.

The runbook's old step 7.3 said "seed it now via the app/API as admin". That fails two of
#156's own acceptance criteria, and a human would have discovered it at the end of a
multi-hour provisioning session, after paying for the infrastructure.

**The fix, now step 8.** Three moves that deliberately avoid hand-writing a bcrypt hash —
let the app hash the password on its own signup path, then correct only the role:

```sql
INSERT INTO companies ("Id","Name","EmailDomain","CreatedAt")
VALUES (gen_random_uuid(),'TIMS Staging','<chosen-domain>',now());
```
then `POST /api/auth/signup` with an email at that exact domain, then
```sql
UPDATE users SET "Role" = 'super_admin', "UpdatedAt" = now() WHERE "Email" = '...';
```

Two schema traps: **tables are snake_case but columns are quoted PascalCase** — unquoted
`Id` folds to `id` and errors — and `'super_admin'` is the literal wire value of
`Roles.SuperAdmin`; a typo does not error, it produces an unrecognised role and a
confusing spray of 403s. `"SecurityStamp"` defaults in the DB and `"SearchVector"` is
computed; neither needs a value.

### 3.3 Three more things the runbook did not say

- **`Database__RequireSessionPooler` is hardcoded `"true"`** in
  `infra/aws/climate-project-api-prod-service.yml` (line 214) — the same file the staging
  deploy renders. It is not a parameter. Prod armed it on 2026-08-17. **Staging inherits
  `"true"` on its first deploy**, so if the staging connection string is on port 6543 the
  service throws inside `ValidateOnStart`, never answers `/ready`, and the canary fails
  the deploy five minutes later with no obvious cause. Step 2's "port 5432, never 6543"
  is load-bearing, not advisory.
- **Vercel Deployment Protection** is on by default for new projects and 302s every
  request — including `curl` — to a Vercel SSO login. It reads as a broken deployment.
  Verify with a terminal command, because a logged-in browser masks it exactly:
  `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://<staging-domain>/`
- **`web/vercel.json` is inherited by staging** — see §6.5.

### 3.4 Is it thin?

The plan is not thin; its **console evidence** is. Every AWS, Vercel and
GitHub-environment fact in the runbook rests on a single console reading from
**2026-08-15**, ten days old. The one fact the lane re-confirmed today was the Supabase
project ref — and that ref is wrong (§6.1), so the re-confirmation confirmed the wrong
project. Treat the runbook as a good procedure over a stale survey, and re-read the
console at each step rather than trusting the preamble.

---

## 4. Monitoring — #158

### 4.1 The finding that reframes it

**The application is already well instrumented and connected to nothing.** Every
scheduled job emits a positive per-tick heartbeat; `/ready` round-trips Postgres;
`/version` reports its commit; `/admin/system/status` grades database, queue, dispatcher
and all seven jobs; `deploy-drift.yml` already ships the commit-drift detection #158 asks
for and has passed daily since 2026-08-16. What does not exist is anything that can tell
a person. #158 is a **wiring** problem, not an instrumentation one — which is why it is
achievable before 16 Nov.

### 4.2 What was authored

- `infra/aws/climate-project-observability.yml` — 20 log metric filters, 22 alarms, two
  SNS topics, and a Lambda translating SNS into a Teams Adaptive Card. Deliberately a
  **separate stack** from the service: alarms are edited far more often than the service
  is, and an alarm typo must never be able to roll the running service. Passes
  `aws cloudformation validate-template`; needs `CAPABILITY_NAMED_IAM`.
- `.github/workflows/ops-synthetic-probe.yml` — the outside-in half, `actionlint` clean.
- `docs/runbooks/alerting.md` — thresholds with reasoning, exact commands, the
  unobservable list, the human-decision list.

**Why an external probe as well as CloudWatch:** every alarm is built on a log metric
filter, and a metric filter produces a datapoint only when CloudWatch *receives* a log
event. The failures it structurally cannot report are the total ones — service deleted,
log group deleted, alarm stack rolled back, region unreachable — and each of those looks
exactly like a healthy midnight. The probe asks the customer's question from outside AWS
every 15 minutes, and relays `deploy-drift.yml` failures to Teams via `workflow_run`
**without editing that workflow**.

### 4.3 The thresholds, and the one rule behind them

Every job-absence window is a multiple of **that job's own interval**, never a flat
number — a flat threshold across jobs ticking every minute and every day is necessarily
either deaf to the fast one or screaming about the slow one. Where possible the multiple
is **3×**, matching the `HeartbeatStaleTolerance` the in-process monitor already applies,
so the external and internal detectors agree rather than contradict.

| Job | Interval | Window | Severity | Why this one |
|---|---|---|---|---|
| `notification-dispatch` | 1 min | 10 min | Critical | Not 3× — 3 min is too twitchy for a rolling deploy. Set against `BacklogAgeThresholdSeconds` = 900s so the alert lands 5 min *before* the product itself calls the queue a backlog. |
| `survey-lifecycle` | 5 min | 15 min | Critical | The only job that mutates live customer data on a timer: a stall means surveys do not close on their end date and keep accepting responses past the deadline. |
| `invitation-reminders` | 15 min | 45 min | Critical | Critical despite the long window because a missing reminder is *invisible in the product* — no failed row, no error, no screen that differs. |
| `digests` | 15 min | 45 min | Warning | Convenience over notifications already visible in-app. |
| `scheduled-reports` | 5 min | 15 min | Warning | Reports are daily at most. |
| `survey-draft-retention` | 1 h | 3 h | Warning | Three periods, because a timer drifting across restarts puts two runs in one fixed hourly window and none in the next. |
| `retention-cleanup` | 1 day | 2 days | Warning | Period must be a full day or a healthy job reads as zero; two consecutive for the same jitter reason. GDPR obligation (#144). |

The counted heartbeat is logged **only by the instance holding the advisory lease**, so
the fleet-wide rate is ~1 per interval whether 1 or 25 instances run — that is what makes
a fixed threshold meaningful under autoscaling. `DefaultValue: 0` plus
`TreatMissingData: breaching` covers both failure shapes: logs flowing but no heartbeat
(wedged) reports a real 0; no logs at all (process gone) reports nothing and breaches.

Presence alarms: `job-reported-stale-in-process` at **1** (the monitor already spent 3×
tolerance before logging, so the finding is established); `job-throwing` at **3 in 15
min** (`TickAsync` deliberately swallows and retries, so one throw is a lock timeout that
self-heals; three is not).

Readiness and database: `readiness-failing` at **3 in 5 min** — App Runner replaces after
`UnhealthyThreshold 5 × Interval 20` = 100s continuous, so 3 fires *with* the first
replacement rather than explaining one. `5xx-elevated` at **20 in 5 min** with
`TreatMissingData: notBreaching` (App Runner publishes no request metrics with no
requests, and an idle night is not a fault). `db-pool-exhausted` at **1** — Max Pool Size
10 × 25 instances = 250 was chosen to sit *under* the Supabase limit, so exhaustion is a
failure against a bound meant to be unreachable; there is no acceptable rate, so no rate
to tune. `transaction-pooler-regression` at **1** (#220's signature; the armed guard
should prevent boot, so a hit means it was disarmed).

Mail and rate limiting: `mail-not-configured` at **1/hour**, categorical not statistical.
`mail-permanent-rejections` at **10 in 15 min** — the code deliberately dead-letters a
handful of dead mailboxes and a government HR import legitimately hard-bounces; ten is
the shape of losing the *channel* (SPF/DKIM, revoked credentials, blocklist) rather than
a message. `mail-transient-rejections` at **50**, deliberately *above* the permanent
threshold because a 4xx is the relay asking us to slow down.
`rate-limit-rejection-spike` at **100 in 5 min** — a real survey launch will produce
rejections and alarming on those trains everyone to ignore it; the dangerous reading is
not an attack but `RateLimiting__TrustedProxyHopCount` being wrong, making every caller
share one bucket.

Routing: two SNS topics (critical/warning) both to the same Teams channel and mailbox,
split so severity can diverge later without re-pointing 22 alarms.
`TeamsForwarderFailingAlarm` routes **email only** — every other alarm goes *through* the
forwarder, so routing a broken-Teams alert through Teams is a loop.

### 4.4 Prerequisite: the logs are not currently alarmable by level

The app uses the default `SimpleConsole` formatter, which writes each event as **two
lines**. App Runner ships each line as a separate CloudWatch event, so **level and message
never share an event and no metric filter can test both.** That is why every pattern
matches message text.

The fix needs no code change — two env vars on the service:
`Logging__Console__FormatterName=json` and
`Logging__Console__FormatterOptions__IncludeScopes=true`. That yields one JSON object per
event with `LogLevel`, `Category`, named placeholder fields and ASP.NET Core's
per-request `RequestId`, satisfying the correlation-id criterion. It was deliberately
**not** made: it changes what a `deploy-prod.yml` dispatch does and belongs in its own
commit and rollout. Every filter pattern is a quoted substring chosen to match in **both**
formats, so the alarms can go up first and need no rewrite when this lands. Test it on
staging.

### 4.5 PII audit (an acceptance criterion), and it substantially passes

`LoggingInvitationEmailSender` explicitly stopped logging `{Email}` and `{Token}` (an
invitation token is a bearer credential); SMTP exceptions log a code only; `/ready`
returns no Npgsql detail to unauthenticated callers. **No log statement in `src/` writes
survey response content.** Two residuals: `{ClientIp}` at `RateLimitPolicies.cs:466` is
personal data currently retained forever (retention is the mitigation — item 12), and
`/ready`-failure Npgsql text carries the production DB host, name and user into
CloudWatch.

### 4.6 Is it thin?

The artifact is thick; **the evidence under it is thin, and knowingly so.** "Production
has no alarms" is *inferred* from code comments and from #158 being open, not measured —
the lane's credentials were for the wrong AWS account. The instance-replacement filter
pattern is an outright guess written without sight of a real App Runner service log
event. The mail and rate-limit thresholds have no production traffic to calibrate
against. The JSON formatter behaviour follows from framework documentation, not from
observation of this app. This is exactly why item 14 deploys with `AlarmsEnabled=false`
and item 15 verifies the instrument before anyone is paged by it. **Do not skip the 48
hours.**

---

## 5. Tracking service — #219

### 5.1 What is true right now

`services/tracking-api` is deployed nowhere: no CloudFormation stack, no ECR repository,
no image, no database, and before this branch no deploy workflow. It also has **no CI at
all** — `ci.yml` restores, builds and tests `ClimateProject.slnx` only; `ClimateTracking.slnx`
is built by nothing and never has been. The client-facing feature that merged on 2026-08-24
(`fab4c40`, #386 — the Procomer `.xlsx` export) therefore has **no path to the client**.
That is not a rollback question; seven weeks from go-live it is a "can it ship at all"
question.

#156 and #159 both independently surfaced this and both said "file an issue". It is
filed, it is #219, and its branch is pushed — see item 5.

### 5.2 The three source changes that gate the first dispatch

None are in the branch, because two other lanes owned that tree. Exact code is in
`docs/runbooks/tracking-service-provisioning.md` §3.

1. **`GET /ready` doing `SELECT 1`.** App Runner probes it and the host serves only a
   static `/health` today, so the canary fails at its 300s deadline with best=0. Do
   **not** lower the health check to `/health` instead — that is the configuration #221
   removed, because `/health` opens no connection, so an instance that has lost Postgres
   passes forever and is never replaced.
2. **`GET /version` reporting a 40-hex commit.** `scripts/read-deployed-commit.sh` exits 1
   on anything else, including the literal `unknown`.
3. **Co-host the workers** — `ClimateTracking.Api` must reference `ClimateTracking.Workers`
   and register `CacheSyncWorker` + `DailySemaforoWorker`. Without it the service deploys
   **green and healthy and syncs nothing**: caches stay empty, every nodo/persona name
   renders blank, no notification is ever sent. A separate Workers App Runner service is
   not merely rejected but *unavailable* — App Runner needs a listening port and
   `ClimateTracking.Workers` is a `Host`, not a `WebApplication`.

Also recommended in the same PR: an `IDesignTimeDbContextFactory<ClimateTrackingDbContext>`,
because `dotnet ef` otherwise fails with `Missing ProcomerCompanyId configuration` unless a
placeholder is injected.

### 5.3 The three infrastructure decisions

- **`MaxSize 1`, deliberately.** The two workers are plain `BackgroundService`s on
  `PeriodicTimer`s with **no distributed lease**. climate-project runs 25 instances safely
  only because its jobs take `PostgresAdvisoryJobLease`; nothing equivalent exists here.
  On N instances `DailySemaforoWorker` runs N times a day and it **sends notifications**,
  with read-then-write idempotency and no lock — two instances can both read "not sent"
  and both send. Duplicate 30-day and 15-day reminders to a government client. If scale is
  ever needed the fix is a lease in the workers, not a bigger number.
- **A new Supabase project** for the tracking database (item 9). A second database in the
  existing project is not a supported Supavisor path; a separate schema needs source
  changes and puts the tracking workload on climate-project's connection budget. A
  separate project is the only option under which a mistake in the tracking migration
  cannot touch the climate-project database — which matters more than usual given §6.1.
- **`Maximum Pool Size=10` written into the connection string.** There is no
  `DatabaseConnectionStringPolicy` in the tracking service, so Npgsql takes its driver
  default of **100 per process** — a 40% increase on climate-project's entire
  250-connection ceiling. Npgsql honours the value written into the string, so this is
  fixable in the secret with no code change, and that is the only place it can be fixed
  today. Port **5432** (session pooler), never 6543 — and note the tracking host has **no
  `Database__RequireSessionPooler` equivalent**, so the wrong port degrades silently the
  way climate-project's did before #220.

### 5.4 How the two services authenticate, and the enforcement that makes it stick

One Secrets Manager entry, `climate-project-api/prod/InternalApiKey`, read by both
services under two different configuration key names — `InternalApiKey` on
climate-project, `ClimateProjectInternalApiKey` on tracking. That asymmetry is why the
coupling is invisible from either side alone. Three layers:

1. **The same `production` GitHub environment**, so `vars.INTERNAL_API_KEY_SECRET_ARN` is
   literally the same variable object both workflows read. No second copy exists to drift.
2. **A credential-free preflight** that fails in seconds: emptiness for all eight required
   values plus shape checks `deploy-prod.yml` does not have — ARN prefix scoped to region
   and account, GUID for `PROCOMER_COMPANY_ID`, `^https://[^/]+$` for
   `CLIMATE_PROJECT_BASE_URL`. An emptiness check happily passes a pasted secret *name*, a
   pasted secret *value*, or an ARN from the wrong account.
3. **An identity preflight** that reads `InternalApiKeySecretArn` and `TrackingJwtSecretArn`
   back off the **live** `climate-project-api-prod` stack and requires string equality.
   This is the only check that catches the failure #219 is actually about: a
   separately-managed copy is a perfectly well-formed ARN, both services boot, and every
   `/api/internal/*` call 401s at whatever moment the first cross-service call happens.
   `TrackingJwtSecret` gets identical treatment — climate-project **mints** the tokens
   this service **validates** off the same HMAC key, so a second copy is not degradation,
   it is every authenticated tracking route 401ing forever.

`PROCOMER_COMPANY_ID` is not knowable from this repository —
`SELECT id, name FROM companies ORDER BY name;` against production. Blank makes the host
refuse to start, **correctly**: a blank tenant made `MatchingTenantRequirement` compare
every caller against `""`, which climate-project's company-less `super_admin`s match,
handing them the whole tenant API (#153). Non-GUID boots fine and then 400s every
`/api/internal/{nodos,personas}` call, so the cache silently never fills.

### 5.5 The out-of-order table

| Sequence | Result |
|---|---|
| bootstrap → secrets → tracking deploy → verify → Vercel variable | correct |
| Vercel variable **before** the deploy | client loses Action Plans *and* gets a dead module. Reverse by unsetting and redeploying. |
| different `InternalApiKey` ARN | every `/api/internal/*` 401s, fail-closed, first seen at the first cross-service call. **Blocked by the identity preflight.** |
| different `TrackingJwtSecret` ARN | every authenticated tracking route 401s forever. **Blocked by the identity preflight.** |
| tracking migration string pointed at climate-project's DB | 8 `CREATE TABLE` + 1 `DROP TABLE` in the live client database, with no PITR. **Blocked by the same-database guard** (sha256 comparison, never printed, plus a `postgres.<project-ref>` match). |
| deployed without the workers co-hosted | green and healthy; caches never fill; every name blank; no notification ever sent. **Blocked by nothing — this is the quiet one.** |

**The first dispatch will trip the destructive-migration guard, and that is correct.**
Scripted from zero, the history contains exactly one destructive statement —
`DROP TABLE hallazgos_cache;` against a table created 116 lines earlier in the same script.
On a virgin database it destroys nothing that ever held a row. So the first dispatch needs
`-f confirm_destructive_migration=yes`, and **only** the first. Download the
`tracking-migration-sql` artifact from the refused run and confirm those are still the
only two lines before typing it.

### 5.6 Rotation, once both sides are live

The mechanism that decides the ordering: **App Runner resolves secret ARNs at instance
start, not at deploy time.** `put-secret-value` alone changes nothing; the two redeploys
*are* the rotation, and they bound the mismatch window. Rotate the one secret, dispatch
`deploy-prod.yml` (~21 min), then dispatch `deploy-tracking-prod.yml` (~20 min), then
verify. **Do not stop after the first redeploy.** Which side goes first does not matter —
both orders give the same symmetric window — but both must happen with nothing else
dispatched in between. The cost of the window: `CacheSyncWorker` logs one error per entity
type per 15-minute tick and syncs nothing (at most two missed ticks, self-healing), and
plan creation still works because the hallazgo lookup swallows client failures. **No
user-facing request fails.**

### 5.7 Is it thin?

The static verification is strong (cfn-lint clean on both templates, actionlint clean,
both CI guard scripts still passing, gitleaks clean, the solution builds Release with 0
warnings). The **runtime** verification is zero: the stacks have never been deployed, the
workflow has never been dispatched, the Dockerfile has never been built, and the tracking
test suite has never been run anywhere — including by the workflow that runs it before
deploying. And the whole plan stops at a boundary it could not cross: three source changes
in a tree another lane owned.

---

## 6. Cross-cutting — where the four plans meet

### 6.1 Supabase: the project ref was wrong in one document, and PITR is settled

Three lanes reported PITR as unverifiable. One measured it. They were looking at
different databases.

- `docs/security/rotation-inventory.md` enumerated both projects on 2026-08-15 via the
  authenticated CLI: org `lbxqfmlcxervtttrspjv` holds **`tims-ats`** (ref
  `lzhfnjfsdwdywwnlqgqq`, created 2026-05-28) and **`organizational-climate-platform`**
  (ref `uleeeziiceduvmiftgby`, created 2026-07-31). That same file already warns, in
  capitals, that **the Supabase MCP server on this machine points at `tims-ats`** and that
  any advisor or key output obtained through it describes the wrong project.
- Two lanes rediscovered that independently last night (one by noticing migrations in
  `__EFMigrationsHistory` that do not exist in this repo, one by reading an ATS schema of
  candidates and vacancies) and correctly refused to assert anything about backups.
- **`docs/runbooks/staging-provisioning.md` names `lzhfnjfsdwdywwnlqgqq` as "the Supabase
  project"** in its grounding preamble, and offers "a persistent branch on
  `lzhfnjfsdwdywwnlqgqq`" as Decision box 2's Option B. Both are wrong and Option B is
  dangerous. **Item 3 fixes this.** The #156 lane re-confirmed that ref and its zero
  branches "still matches" — it confirmed the wrong project, which is precisely the trap
  the security inventory documents.
- Against the **correct** ref, `supabase backups list --project-ref uleeeziiceduvmiftgby -o json`
  returned `{"backups": [], "physical_backup_data": {}, "pitr_enabled": false, "region": "us-east-1", "walg_enabled": true}`.

**Resolution: PITR is off and the API lists zero backups.** `walg_enabled: true` only means
the physical-backup engine is available; it is not evidence of a restorable copy. Whether
Supabase holds daily logical backups outside that endpoint is *still* a dashboard question
— so the risk is **confirmed, not disproven**, and the remaining doubt runs in the
comforting direction only if someone looks.

Why this matters beyond a checkbox: `SurveyDraftRetentionWorker` runs **hourly** and
`RetentionCleanupWorker` **daily**, both hard-deleting rows, and both were confirmed
running in production. So "scheduled jobs delete rows" is established and "there is
something to restore from" is not. That makes the pre-deploy `pg_dump` in the rollback
runbook not a good habit but **the only recovery lever that currently exists**, and it
makes trigger T5 ("any credible report of data loss → roll back first, investigate
second") the correct shape rather than an over-reaction.

### 6.2 The live API/web split — verified today, and it is the shape of the whole problem

Measured 2026-08-25 against the production API:

```
GET /version              -> commit fc539367…, builtAt 2026-08-19T15:31:59Z
GET /admin/users          -> 401     (route exists, wants a token)
GET /admin/question-library -> 404   (route absent)
```

`main` is `8f0eacc`, **23 commits ahead**. The route exists in `main`'s source
(`QuestionLibraryEndpoints.cs:44`, behind `RequireAuthorization()`), so on a deployed
`main` it would answer 401 like its neighbour. The live web bundle ships a Question
Library picker that calls it. **Every health check is green throughout** — `/ready` is
200, the drift job passed, nothing is red.

The cause is structural, not an oversight: the web ships on every merge via Vercel's git
integration; the API ships only on a manual dispatch. The halves are decoupled by design
and drift by default.

The drift guard is about to notice, and by the time you read this it may already have.
`deploy-drift.yml` runs at 13:00 UTC with `MAX_COMMITS_BEHIND: 20`. The 2026-08-24 run
passed because production was **18** commits behind at the moment it fired (13:52 UTC);
five more merged after it. At 23 behind, **the next run fails** — checked at 13:22 UTC on
2026-08-25, that run had not yet fired, so it is due within the hour. That is correct
behaviour, and the fix is item 4, not raising the threshold — unless raising it is a
deliberate release-cadence decision someone writes down.

The single pending EF migration is `20260819200824_AddQuestionRepositories` and it is
purely additive (29 Create/Add, zero DROP/TRUNCATE in `Up()`), so a dispatch takes
`confirm_destructive_migration=no`. The cheaper alternative — a Vercel rollback of the web
to match `fc53936` — is faster and equally valid; it just leaves the gap for later.

### 6.3 Mail is not configured in production

The service template sets zero `Email__` variables, so every email notification is
currently recorded as failed. For a survey platform whose invitations are email, that is
not a monitoring detail — it is a go-live blocker with a longer lead time than any alarm.
Recent commits (#366, #368, #387) fixed *reporting* mail correctly and made the invitation
link open the survey; none of that helps while there is no relay. Item 17 is a decision
about a vendor and a domain, and those take days.

The `mail-not-configured` alarm will be a standing red until it is armed. Arm mail first
or accept the red deliberately — **deleting the alarm is not an option.**

### 6.4 The money, in one place

| Line | $/mo | Note |
|---|---|---|
| Staging App Runner — provisioned memory (0.5 GB) | **2.56** | A floor, not an estimate. Charged as long as the service exists, used or not. |
| Staging App Runner — active vCPU (0.25) | 0.00–**11.68** | The one genuinely unknown line. See §7. |
| Staging Secrets Manager (3) | **1.20** | |
| Staging ECR storage | 0.20–0.40 | |
| Staging Supabase Micro | **10.00** | |
| Staging auto-deploy pipeline / build minutes | 0.00 | `AutoDeploymentsEnabled: false`; prebuilt images pushed |
| Staging Vercel second project | 0.00 | |
| **Staging subtotal** | **≈ 14–26** | Verified against the AWS Price List API, us-east-1, 2026-08-24 |
| Tracking App Runner (prod, Max 1) | ≈ same shape | Not separately priced by any lane; assume the same 2.56 floor plus vCPU |
| Tracking Supabase project | **10.00** | if the recommended separate project is chosen |
| Tracking Secrets Manager + ECR | ≈ 0.60 | |

Order of magnitude: **$25–$50/month recurring** for staging plus tracking, before any
Supabase plan change. One owner (item 8), one approval, once — not three separate asks.

The plan question underneath it: if the Supabase org is on Free and already holds two
projects, creating a third simply fails. And Free-plan projects pause after roughly a week
of inactivity — staging is used in bursts, exactly the pattern that trips it, and a paused
DB fails `/ready`, fails the canary, and reads as a broken deploy. Both of those are
general knowledge, not a reading of this org's billing page (§7).

### 6.5 `web/vercel.json` — one file, two findings, one change

`web/vercel.json` sits at the `web/` root, so **every Vercel project importing this repo
with root `web/` inherits it** — `climate-staging` included. Line 32 sets
`Content-Security-Policy-Report-Only` with
`connect-src 'self' https://bhgrdkd4gt.us-east-1.awsapprunner.com` — **production's** App
Runner host, hardcoded. Vercel does not interpolate env vars into `vercel.json` headers,
so this cannot be varied per environment by setting a variable.

Today it is cosmetic, because the header is Report-Only. Two consequences that are not:

- **Staging** (from #156): its console fills with a violation for every call to its own
  API — the same console the smoke test tells you to watch for CORS errors. If anyone ever
  promotes the header to enforcing, it fails **backwards**: staging's front end would be
  blocked from reaching staging's API while remaining permitted to reach production's.
- **Tracking** (from #219): the tracking origin is not in `connect-src` either, and the
  same promotion would block the module the client is being shown.

**Make it one change**, owned by whoever owns `web/`: either move the CSP somewhere that
can vary by environment, or widen `connect-src` to list every host any environment
legitimately calls. And **do not promote Report-Only to enforcing before both are
settled** — a natural-looking pre-go-live hardening step that would break staging and
tracking simultaneously.

### 6.6 The dependency graph, stated plainly

```
[H] prod AWS credentials (item 2)
      ├─> #158 observability stack ──┐
      ├─> #156 staging ──────────────┼─> #159 rehearsal ─> #159 closable
      └─> #219 bootstrap stack       │
                                     │
[H] decisions 6-12 ─> #156 staging ──┘
[H] threshold ratification (27) ─────┘

#158 ─> #159 triggers T2 (5xx rate) and T3 (auth failures) become measurable
#156 ─> #159 rehearsal has somewhere to run
#219 source changes (24) ─> #219 deploy (25) ─> web capability flag (26)
```

Two edges deserve emphasis because they were only implicit in the separate plans:

- **#159 cannot be closed honestly without #156.** Its rehearsal workflow is
  staging-only by construction and fails with a readable "#156 first" message if staging
  is absent — the dependency is executable rather than a footnote. And two of its six
  triggers are decorative without #158. So a "tested rollback" is downstream of *both*
  other issues, and #156 is itself downstream of four human decisions nobody has made.
  **This chain is the reason staging cannot be left to November.**
- **The tracking deploy and the main API deploy interact.** The cross-service contract is
  unchanged between the live commit `fc53936` and `main` — checked as an empty diff over
  `TrackingInternalEndpoints.cs`, `InternalApiKeyFilter.cs`,
  `ClimateProject.Application/Tracking`, `JwtTokenService.cs` and
  `TrackingTokenValidation.cs` — so climate-project does **not** have to move for tracking
  to deploy. But two rules hold anyway: **re-run that diff** if the tracking deploy slips
  past further merges, and if any future change *does* touch the internal contract,
  **climate-project deploys first**, because tracking is the client and
  `ClimateProjectClient` calls `EnsureSuccessStatusCode()` — a 404 becomes an exception
  inside `CacheSyncWorker`, logged per entity type, silently syncing nothing.

### 6.7 What rollback actually is here — the correction that outranks the rest of #159

The rollback runbook that existed described **reverting DNS to a warm legacy stack**. Both
halves are false and someone following it during an incident would waste the incident.

- **There is no legacy stack.** The Mongo migration was dropped on 2026-08-19
  (`docs/decisions/no-data-migration.md`). The new platform is the only one and it is
  already carrying real users. #157, the dry run meant to prove the rollback, was closed
  **not planned**.
- **No rollback in this system touches DNS.** `climate.timsint.com` resolves to Vercel
  anycast; rolling the web back re-points a Vercel *alias*, instantly, with no resolver
  cache involved. The API has no custom domain at all. **`cutover.md` Phase B's TTL
  lowering is therefore not a rollback prerequisite and must not be allowed to gate a
  date.**

What is reversible, and what is not:

| Layer | Reversible? | Time |
|---|---|---|
| Web (Vercel) | **Yes, cleanly** — ~20 production deployments retained, 5 days back, all Ready | seconds |
| API (App Runner) | **Yes**, for the last **40** `prod-*` images (ECR lifecycle, verified in the bootstrap template) | minutes |
| Config / secrets | **Yes**, but a secret change needs a *new rollout* to take effect | minutes |
| Database schema/data | **No, not in general** | — |

**Do not re-dispatch `deploy-prod.yml` at an older commit** to roll back. Three
independent reasons: it runs the full test suite and a `docker build` to produce an image
that already exists in ECR (~21 minutes of rebuild wearing a rollback's name); it runs
`dotnet ef database update`, a no-op against an already-ahead database that quietly
implies the schema came back too; and it pushes the old image over `prod-latest`,
destroying the record of what was most recently built. Use `rollback-prod.yml`, which
reports the migration delta it is **not** undoing, swaps the image, gates on 20
consecutive `/ready` 200s and writes an incident record — and nothing else.

Three traps worth memorising: **never roll back to `prod-latest`** (the tag is MUTABLE and
always names the newest build); **`aws apprunner start-deployment` is not a rollback** (it
re-pulls the *same* image — right tool for a half-failed rollout, wrong here and it looks
right); and `aws apprunner update-service` works but leaves CloudFormation describing an
image that is not running, invisibly.

**`Down()` is a development tool, not a production rollback mechanism here.** Six of six
recent migrations were read and all six are unsafe: `AddQuestionRepositories` drops 7
tables; `NormaliseDemographicsIntoTables` restores jsonb as NULL and its own comment
refuses to re-encode ("a faithful reverse would be a fiction") — total loss of every
user's demographics; `MakeUserCompanyIdNullable` backfills NULL with `Guid.Empty` which
the FK rejects, so the Down *fails*, leaving the migration half-applied;
`DropCommentPromptDefaults` fabricates data; `RenameOpenTextQuestionTypeToOpenEnded` is
lossy by design; and `LockDownPostgrestRoles.Down` is **intentionally empty**, because a
faithful inverse would re-grant CRUD to `anon`/`authenticated` and disable RLS. That last
one has a nasty second-order effect: because the Down is a no-op,
`dotnet ef database update <older>` **returns 0 while leaving the schema not actually
reverted** — a success message that proves nothing. If a schema change must be undone, the
instrument is **a new forward migration**, reviewed like any other change.

**The point of no return is three doors, not one.** PONR-1: a non-additive migration
commits. PONR-2: a hard-deleting job tick commits (`retention-cleanup`,
`survey-draft-retention`, GDPR `SubjectErasure`; `survey-lifecycle` mutates statuses).
PONR-3: an email leaves — since #368, `sent` is recorded only after a provider accepts,
and you cannot unsend a token an older API rejects. For an **additive** migration PONR-1
never arrives at all, which is what makes a code rollback cheap — and that is a property
of the migration, not of the platform. Hence the governing rule to 16 November:

> **No migration ships non-additively unless the team has explicitly decided to give up
> the ability to roll code back across it, and written that down.** Treat a
> `confirm_destructive_migration=yes` as *"we are closing PONR-1 today"*, not a checkbox.

The six trigger thresholds (item 27) are proposals with reasoning, not decisions: T1
`/ready` failing (≥3 consecutive non-200 at 10 s spacing **and** two instance replacements
in 10 min — fires only after the platform's own self-healing has failed); T2 5xx rate >2%
over 5 min (**needs #158**); T3 three distinct users failing with valid credentials in 10
min (**needs #158**); T4 any 404 on an endpoint the deployed bundle calls (**this is
today's live defect**, and invisible to every health check); T5 any credible report of data
loss — deliberately no threshold; T6 client-visible in a demo or UAT window, owner's
judgement.

---

## 7. Unverified — read this before quoting anything above

Grouped by why it is unverified. **Nothing in this document was verified against
production AWS by anyone last night**, because no lane held credentials for account
`747814092517`; every lane's `aws sts get-caller-identity` returned
`arn:aws:iam::795965600143:user/Federico`, the DEV account, where `apprunner` returns
`SubscriptionRequiredException`.

### 7.1 Verified today, and how

For contrast, this is the short list of things in this document that *are* observations,
each re-checked on 2026-08-25 from this worktree:

| Claim | How |
|---|---|
| Prod API serves `fc539367…`, built 2026-08-19T15:31:59Z | `curl /version` |
| `/admin/question-library` → 404 while `/admin/users` → 401 | two `curl`s, unauthenticated |
| The route exists in `main` behind `RequireAuthorization()` | `QuestionLibraryEndpoints.cs:44` |
| `main` is 23 commits ahead of the live commit; **18** at the moment the 2026-08-24 drift run fired | `git rev-list --count`, with and without `--before` |
| `MAX_COMMITS_BEHIND: 20`, cron `0 13 * * *` | `deploy-drift.yml:27,43` |
| GitHub environments are `Preview` and `production` only — **no `staging`** | `gh api …/environments` |
| `deploy-staging.yml` has **never run** | `gh run list --workflow deploy-staging.yml` (empty) |
| `Database__RequireSessionPooler` is hardcoded `"true"`, not a parameter | `climate-project-api-prod-service.yml:213-214` |
| Health check `Interval: 20`, `Timeout: 5`, `HealthyThreshold: 3` → a 60 s hard floor on every rollout | same file, 286-288 |
| ECR keeps the **40** most recent tagged images | `climate-project-api-bootstrap.yml:134-135` |
| `web/vercel.json` CSP is Report-Only and hardcodes production's App Runner host | `web/vercel.json:31-32` |
| Only two of the four branches are on `origin` | `git ls-remote --heads origin` |
| The Supabase project ref in the staging runbook is `tims-ats`, not this platform | `staging-provisioning.md:16` vs `rotation-inventory.md:208-211` |

### 7.2 Could not be verified for lack of production credentials

- **"Production has zero alarms."** Inferred from code comments and from #158 being open.
  Consistent, but confirm with `aws cloudwatch describe-alarms` and `aws sns list-topics`
  before assuming the stack is creating something new rather than colliding.
- **Every App Runner runtime claim** — health-check behaviour in practice, image
  identifiers, lifecycle behaviour at the 40-image edge. All read from CloudFormation
  templates and workflow comments, not from the live service. Nobody has tested where the
  rollback horizon actually is.
- **Whether any human holds credentials that can update `climate-project-api-prod`.** The
  only principal provably holding `cloudformation:UpdateStack` on that stack is the GitHub
  OIDC role, assumable only from Actions. If no human does, break-glass does not exist —
  item 2.
- **The 3–7 minute rollback estimate is a guess and is labelled as one throughout.** Only
  the 60 s health-gate floor and a 9.4 s cold-start probe (measured in #220) are provable;
  CloudFormation change-set overhead and ECR pull time are guesses. Replacing this number
  is the rehearsal's main job.
- **What happens to in-flight requests during a swap.** Deliberately not asserted. App
  Runner documents deployments as zero-downtime and publishes no drain timeout;
  `rollback-probe.sh` exists to produce the measured answer, and it measures *short*
  requests only — it will not see a long-running export severed mid-flight, so start one by
  hand if that is the question.
- **The Vercel rollback itself.** The CLI (50.22.1) has `rollback` and `rollback status`,
  the account is authenticated for the right scope, and ~20 production deployments are
  retained and Ready — all verified. A rollback was **not** run, because that would have
  changed production.
- **AWS App Runner behaviour at `MaxSize 1` during a rolling deploy** — whether it
  temporarily exceeds the ceiling or briefly drops to zero healthy instances. If the
  latter, every tracking deploy is a short outage rather than a rollover. Measure it on the
  second deploy and correct the template comment.

### 7.3 Guesses that will page someone if left uncorrected

- **The instance-replacement filter pattern** (`"Health check failed"`) in the
  observability template was written **without sight of a real App Runner service log
  event**. It is flagged loudly in both the template and the runbook. Confirm it with
  `aws logs filter-log-events` and **delete it** rather than leave a filter that can never
  fire.
- **The JSON console formatter behaviour** follows from .NET framework documentation, not
  from observation against this app. Test on staging first.
- **The mail thresholds (10 permanent / 50 transient) and the rate-limit threshold (100)**
  are stated as guesses in both the template comments and the runbook. There is no
  production mail or rate-limit traffic to calibrate against. Retune after the first real
  invitation batch and the first real survey launch.
- **90-day log retention** is a proposal, not a derived number — item 12.
- **The heartbeat text itself.** Every job-absence alarm asserts a specific log line
  appears. Confirm the text really appears in CloudWatch before enabling notification.

### 7.4 Money and plan limits

- **Whether App Runner health-check probes bill as active vCPU.** Worth **$11.68/mo** — the
  entire difference between the $14 and $26 ends of the staging estimate. The service is
  probed every 20 s forever, and AWS documents CPU as billed while "actively processing
  requests" without saying which side a health check falls on. Settle it by reading the
  first month's Cost Explorer line for `USE1-AppRunner-vCPU-hours`, and budget on neither
  figure until then.
- **Supabase's two-project Free-plan cap and the ~7-day inactivity pause.** Reported from
  general knowledge, not from a reading of this org's billing page. The pause matters more
  than the cap: a paused DB fails `/ready`, fails the canary, and reads as a broken deploy.
- Everything else in §6.4 was verified against the AWS Price List API for us-east-1 on
  2026-08-24, except the tracking rows, which nobody priced.

### 7.5 Supabase, precisely

**Settled:** PITR is off and the backups endpoint lists nothing, measured against ref
`uleeeziiceduvmiftgby` — the ref independently enumerated as
`organizational-climate-platform` in `docs/security/rotation-inventory.md`.

**Not settled:** whether Supabase holds daily logical backups *outside* that endpoint. That
needs the dashboard. `walg_enabled: true` is not evidence of a restorable copy.

**A warning in itself:** do not let anyone run "the Supabase MCP" on this machine believing
it points at this platform. It points at `tims-ats`. Three lanes hit that trap last night;
one of them recorded a security advisory for that other product (17 tables with RLS
disabled, legacy anon key still enabled) which belongs to whoever owns it, not here.

### 7.6 Not run, by instruction

No lane ran the .NET or web test suites (one lane held Docker all night), nobody built the
new Dockerfile, nobody deployed, nobody dispatched a workflow, and no state-changing `aws`,
`gh`, `supabase` or migration command was run by anyone. The tracking test suite has never
run **anywhere** — including inside the workflow that runs it before deploying. Static
gates that did pass, at the versions CI pins: `cfn-lint 1.53.3`, `actionlint 1.7.12`,
`shellcheck`, `gitleaks 8.30.1`, `scripts/verify-prod-deploy-invariants.py` and
`scripts/verify-oidc-trust-subs.py`. None of that is a deploy.

### 7.7 Two issue bodies that are wrong

- **#219** says `services/tracking-api` "is built and tested in CI". It is not, and never
  has been — `git log -S'ClimateTracking' -- .github/workflows/ci.yml` returns nothing,
  ever. That is why step 0 of the tracking plan is *adding* a CI job, not deploying.
- **#156**'s finding "file a tracking-api deployment issue" is satisfied by #219, whose
  branch is already pushed.

Item 5 fixes both.

---

## 8. What is thin, said plainly

- **#159 is the best-evidenced of the four** — it measured production, self-tested its own
  probe against the live API, and corrected one of its own claims mid-flight. Its central
  number is still a guess.
- **#219 is strong on paper and zero on execution.** Its templates lint, its solution
  builds, and none of it has ever run. It also stops at a boundary it could not cross —
  three source changes another lane owned — so the branch as it stands **cannot be
  deployed**, by design.
- **#156's plan is sound; its survey is ten days stale**, and the one fact it re-confirmed
  was of the wrong database.
- **#158's evidence is the thinnest of the four.** Twenty-one alarms sit on filters nobody
  has seen match a real log event, in an account nobody could read, with thresholds nobody
  could calibrate. That is not a criticism of the work — it is why the plan deploys with
  alarms disabled and soaks for 48 hours first. **The 48 hours is the plan, not a delay in
  it.**
- **Nothing anywhere in these four plans has been executed end to end against the systems
  it describes.** The first honest end-to-end evidence this project will have is the first
  clean staging rehearsal, and that is four human decisions and a multi-hour session away.
