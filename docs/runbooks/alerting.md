# Runbook: monitoring, logging and alerting (#158)

Written 2026-08-24 against `main` at `8f0eacc`, production API at `fc53936`. Nothing in this
runbook has been applied. Everything below was authored read-only; the commands that change
state are written out for a human to run and are marked.

**The one-sentence version.** The application is already well instrumented — every scheduled
job emits a positive heartbeat, `/ready` round-trips Postgres, `/version` reports its commit,
`/admin/system/status` grades every component — and **none of it is connected to anything that
can tell a person.** There are zero CloudWatch alarms and zero SNS topics. #158 is not an
instrumentation problem; it is a wiring problem, and the wiring is the last mile.

---

## 1. What is verified, and what I could not check

### Verified today

| Fact | How |
|---|---|
| Production runs `fc53936`, built `2026-08-19T15:31:59Z` | `GET /version` on the live service |
| `/ready` returns 200 with `database: ok` in ~0.16s | `GET /ready`, twice |
| Production is **23 commits behind `main`** | `git rev-list --count fc53936..origin/main` |
| `deploy-drift.yml` runs daily and has passed every day since 2026-08-16 | `gh run list --workflow=deploy-drift.yml` |
| Today's drift run (13:52 UTC) passed at ≤20 commits behind | `gh run view 32735215787 --log` |
| **Mail is not configured in production** | `infra/aws/climate-project-api-prod-service.yml` contains zero `Email__` variables |
| No notification wiring exists anywhere in CI | `grep -rniI "teams\|webhook\|slack\|notify" .github/workflows/` returns only #158 to-do comments |
| The app uses the **default .NET console logger** | no `AddJsonConsole`/`AddSimpleConsole`/`ConsoleFormatter` anywhere in `src/`; `appsettings.json` sets only log *levels* |
| There are **no correlation ids** | no `CorrelationId`, `TraceIdentifier` or `Activity.Current` reference in `src/` |
| `services/tracking-api` has two background workers and no deploy path | `ClimateTracking.Workers/{CacheSyncWorker,DailySemaforoWorker}.cs`; `grep -rn tracking-api .github/workflows/` returns nothing |

**Because production is 23 commits behind and the threshold is 20, the next scheduled drift
run (2026-08-25 13:00 UTC) will fail.** Its only alert path today is a GitHub Actions failure
email to repository watchers. That is precisely the gap this runbook closes.

### Could NOT verify — say so rather than assume

- **The production AWS account.** The credentials on this machine are
  `arn:aws:iam::795965600143:user/Federico`. The repository variable `AWS_ACCOUNT_ID` is
  **`747814092517`**. They are different accounts. In 795965600143 there are zero log groups,
  zero CloudFormation stacks and zero alarms, and `apprunner:ListServices` returns
  `SubscriptionRequiredException`. **So "there are no alarms in production" is inferred, not
  measured** — it is consistent with the code comments and with #158 being open, but the first
  thing to do with correct credentials is confirm it:
  ```
  aws cloudwatch describe-alarms --region us-east-1 --query 'MetricAlarms[].AlarmName'
  aws sns list-topics --region us-east-1
  ```

- **Supabase PITR / restorable backups.** The standing risk (PITR off, zero restorable
  backups, while scheduled jobs hard-delete rows) is **unverified, and I could not verify it.**
  The Supabase MCP connection available here is pointed at project `lzhfnjfsdwdywwnlqgqq`,
  whose `__EFMigrationsHistory` contains `20260723032952_fx_rates` and
  `20260716000000_hris_domain` — migrations that do not exist in this repository, whose latest
  is `20260819200824_AddQuestionRepositories`. **That is a different product's database, not
  this platform's.** No tool available here can read the production project's backup settings.
  Treat the risk as open. A human must check Database → Backups in the correct Supabase
  project. This matters directly for alerting: `retention-cleanup` and `survey-draft-retention`
  delete rows on a timer, and every delete in this codebase is hard.

- **App Runner's instance-replacement log text.** The filter pattern
  `"Health check failed"` in the observability template is **a guess.** It was written without
  sight of a real replacement event. Verify before trusting it — §6.

---

## 2. What is currently unobservable

The brief's question: *if a job stops running, what would tell anyone?*

**Today: nothing, in any of these cases.**

| Failure | What exists | Who finds out |
|---|---|---|
| The whole API process dies | App Runner replaces the instance | Nobody, unless a user complains |
| A scheduled job wedges | `WorkerHeartbeatMonitor` logs at `Error` every 5 min | Nobody — the line goes to CloudWatch and is read by no one |
| Every job stops (Scheduling disabled, image without the worker registration) | `/admin/system/status` reports `stale` | Only a SuperAdmin who happens to open the page |
| The notification queue backs up | `/admin/system/status` reports `backlog` at 900s | Same — a human has to look |
| Mail is unconfigured | one `WARNING` per process start | Nobody. **This is the live state right now** |
| SMTP starts rejecting | per-send `Warning` | Nobody |
| Postgres pool exhausts | Npgsql exception in the log | Nobody |
| `/ready` starts failing | App Runner replaces instances, deploy-time canary is long past | Nobody |
| Production drifts from `main` | `deploy-drift.yml` fails | GitHub emails repo watchers — the only working alert in the system |

Three structural blind spots deserve naming separately, because no alarm in §4 fixes them:

1. **Queue depth is not a metric.** Notification queue depth, oldest-due-age and dead-letter
   count exist *only* inside `GET /admin/system/status`, which is SuperAdmin-authenticated.
   CloudWatch cannot see them. The heartbeat alarms detect *the dispatcher stopping*; they
   cannot detect *the dispatcher running and not keeping up*. Closing this properly needs the
   dispatch job to emit the depth (CloudWatch EMF is one line of JSON to stdout), which is a
   `src/` change and therefore a follow-up issue, not this one.

2. **Invitation sends are invisible to the queue.** Per `docs/decisions/worker-hosting.md`,
   survey invitations send **synchronously inside the request** and never become notification
   rows. They are not in queue depth and not in `dispatcher.lastDispatchAt`. A total invitation
   failure during a survey launch would show up as failed HTTP requests and nothing else.

3. **`services/tracking-api` is entirely unmonitored because it is entirely undeployed.**
   `CacheSyncWorker` and `DailySemaforoWorker` run nowhere. There is no alarm to write. Per
   #219, when it is first deployed `InternalApiKey` must be wired on both sides in the same
   change — and its two workers need heartbeat log lines and alarms of the same shape as §4
   before that deploy, not after.

---

## 3. Prerequisite: make the logs alarmable

The alarms in §4 match log *message text*, because right now they have no choice.

The app uses the default `SimpleConsole` formatter, which writes each event as **two lines** —
`fail: ClimateProject.Notifications.Delivery[0]` and then the indented message. App Runner
ships each line to CloudWatch as a separate event. **The level and the message are therefore
never in the same log event, and no metric filter can test both.** You cannot write "count
Errors"; you can only count message text.

**The fix needs no code change.** `ConsoleLoggerOptions.FormatterName` binds from
configuration, so two environment variables on the App Runner service turn on the built-in
single-line JSON formatter and request scopes:

```
Logging__Console__FormatterName=json
Logging__Console__FormatterOptions__IncludeScopes=true
```

That yields one JSON object per event with `LogLevel`, `Category`, `Message`, the named
placeholder values as fields, and — via scopes — ASP.NET Core's per-request `RequestId`, which
satisfies #158's correlation-id criterion *within a request*. Cross-service correlation
(API ↔ tracking) still needs code and is a separate piece of work.

Two cautions:
- **I have not run this against this application.** It follows from framework behaviour, not
  from observation. Test it on staging (`deploy-staging.yml` renders the same template) and
  read the log group before doing it in production.
- **Applying it means editing `infra/aws/climate-project-api-prod-service.yml`**, which changes
  what a `deploy-prod.yml` dispatch does. I deliberately did **not** make that edit. It belongs
  in its own commit and its own rollout, the way the `Database__RequireSessionPooler` ratchet
  was staged.

Every filter pattern in the observability template is a **quoted substring**, chosen so it
matches in both formats — the JSON line still contains the rendered message. **The filters do
not need rewriting when this lands.**

### Log retention — do this regardless

`LoggingInvitationEmailSender`'s own documentation records that production logs had *"no
retention policy at all, so: indefinitely."* App Runner log groups default to Never Expire.
That is a cost problem and a GDPR storage-limitation problem at once, because
`RateLimitPolicies.cs:466` logs `{ClientIp}` — an IP address is personal data.

**Human runs this** (state-changing; not run by me):
```bash
SVC=climate-project-api-prod
SID=<32-hex service id>
aws logs put-retention-policy --region us-east-1 \
  --log-group-name "/aws/apprunner/$SVC/$SID/application" --retention-in-days 90
aws logs put-retention-policy --region us-east-1 \
  --log-group-name "/aws/apprunner/$SVC/$SID/service" --retention-in-days 90
```

90 days is a proposal, not a derived number: long enough to investigate an incident reported
weeks late, short enough that indefinitely-retained IP addresses stop accruing. **A human with
the client's data-retention commitments must confirm it** — this is a government client and the
contract may specify something else.

### PII audit result

The codebase is already careful and the criterion is close to met. `LoggingInvitationEmailSender`
explicitly stopped logging `{Email}` and `{Token}` (an invitation token is a bearer credential);
`SmtpEmailTransport` logs provider exceptions but persists only a code; `NotificationDelivery`
logs the exception and never the payload; `/ready` deliberately returns no Npgsql detail to an
unauthenticated caller. **No log statement in `src/` writes survey response content.**

Two outstanding items, both for a human:
- `{ClientIp}` at `RateLimitPolicies.cs:466` — personal data, currently retained forever.
  Retention above is the mitigation; dropping to a hashed or truncated address is the
  alternative and is a `src/` change.
- Npgsql exception text logged on the `/ready` failure path contains the production database
  host, name and username. Not echoed to callers, but it is in CloudWatch. Acceptable if
  access to the log group is controlled; worth knowing.

---

## 4. The alarm set

All of it is in **`infra/aws/climate-project-observability.yml`** — 19 log metric filters, 21
alarms, two SNS topics, and the Teams forwarder. The template validates
(`aws cloudformation validate-template` accepted it; it needs `CAPABILITY_NAMED_IAM`).

Full reasoning for each number lives in the comment above each alarm in that file. Summary:

### Scheduled jobs — absence alarms

Each window is a multiple of **that job's own interval** from `WorkerSchedulingOptions`, never
a flat number. A flat threshold across jobs that tick every minute and every day is necessarily
either deaf to the fast one or screaming about the slow one. Where possible the multiple is
**3×**, the same `HeartbeatStaleTolerance` the in-process monitor already applies — so the
external and internal detectors agree instead of contradicting each other.

| Job | Interval | Alarms after | Why that number | Severity |
|---|---|---|---|---|
| `notification-dispatch` | 1 min | **10 min** | Not 3× (3 min — too twitchy for a rolling deploy). Set against `SystemStatusPolicy.BacklogAgeThresholdSeconds` = 900s: alerting at 10 min puts the alert 5 minutes *ahead* of the point the product itself calls the queue a backlog | Critical |
| `survey-lifecycle` | 5 min | **15 min** (3×) | The only job that mutates live customer data on a timer. A stall means surveys do not close on their end date and keep accepting responses past the deadline | Critical |
| `invitation-reminders` | 15 min | **45 min** (3×) | Critical despite the long window because the absence of a reminder is *invisible in the product* — no failed row, no error, no screen that looks different. Nothing else would ever surface it | Critical |
| `digests` | 15 min | **45 min** (3×) | Warning: a digest is a convenience over notifications the user can already see in-app | Warning |
| `scheduled-reports` | 5 min | **15 min** (3×) | Warning: recurring reports are daily at most, so 15 minutes has no observable consequence | Warning |
| `survey-draft-retention` | 1 h | **3 h** (3×) | Disk and tidiness only. Three periods because a timer that drifts across restarts will put two runs in one fixed hourly window and none in the next | Warning |
| `retention-cleanup` | 1 day | **2 days** | Period must be a full day or a healthy job reads as zero. Two consecutive empty days, not one, for the same boundary-jitter reason. GDPR storage-limitation obligation (#144) — a compliance signal, not a performance one | Warning |

The heartbeat these count is the line logged **only by the instance that held the advisory
lease**. Under the lease exactly one instance wins per tick, so the fleet-wide rate is ~1 per
interval whether one instance is running or twenty-five — which is what makes a fixed numeric
threshold meaningful under autoscaling. The "another instance holds the lease" line is
deliberately *not* counted; counting it would make 24 idle instances look like healthy work.

`DefaultValue: 0` plus `TreatMissingData: breaching` is what covers both shapes of failure:
logs still flowing but no heartbeat (job wedged) reports a real 0; no logs at all (process
gone) reports nothing and the alarm treats it as breaching.

### Scheduled jobs — presence alarms

| Alarm | Threshold | Why |
|---|---|---|
| `job-reported-stale-in-process` | **1** in 15 min | `WorkerHeartbeatMonitor` already waits 3× the interval before it says anything; by the time the line exists the tolerance is spent. Requiring a second occurrence adds 5 minutes of delay to an established fact. Catches the wedged-job case the absence alarms are worst at, because the other six jobs keep the log busy |
| `job-throwing` | **3** in 15 min | `TickAsync` deliberately swallows and retries; one throw is a lock timeout that the next tick clears by itself. Three in 15 minutes is not self-healing — for dispatch that is 3 of 15 ticks, for the 5-minute jobs it is every tick |

### Readiness, instances, database

| Alarm | Threshold | Why |
|---|---|---|
| `readiness-failing` | **3** `/ready` failures in 5 min | App Runner replaces after `UnhealthyThreshold` 5 × `Interval` 20s = 100s of continuous failure. Three inside five minutes fires at roughly the first replacement, so the alert arrives *with* the event rather than explaining one that already happened. Not 1 — the health-check thresholds were deliberately tuned to absorb a blip, and an alarm contradicting them pages someone for a condition the platform is designed to ride out |
| `instance-replacement-loop` | **3** health-check failures in 15 min | Distinguishes a loop from a single routine replacement. **Filter pattern unverified — see §6** |
| `5xx-elevated` | **20** in 5 min | App Runner's own metric, so it survives the log pipeline being broken — which every metric-filter alarm does not. Twenty because a government client's traffic is bursty and small; a threshold of 1 on a 42-route API is a muted alarm within a week. `TreatMissingData: notBreaching` because App Runner publishes no request metrics in a period with no requests, and "nobody called the API at 3am" is normal, not a fault |
| `db-pool-exhausted` | **1** in 5 min | `Maximum Pool Size` is 10/instance against a 25-instance ceiling = 250, chosen to sit *under* the Supabase pooler limit. Exhaustion is therefore not graceful degradation — it is a request that already failed against a bound that was supposed to be unreachable. There is no acceptable rate, so there is no rate to tune |
| `transaction-pooler-regression` | **1** in 5 min | The #220 signature. `Database__RequireSessionPooler` is armed so the host should refuse to boot instead; a hit means the guard was disarmed |

### Mail

| Alarm | Threshold | Why |
|---|---|---|
| `mail-not-configured` | **1** in 1 h | Categorical, not statistical: it means this deploy cannot send mail at all. Hour-long period only so a rolling replacement reads as one alert, not one per instance. **This will fire the moment you enable the stack** — see §5 |
| `mail-misconfigured` | **1** in 15 min | SMTP client could not be constructed. Nothing is being submitted at all |
| `mail-permanent-rejections` | **10** in 15 min | The code treats a handful of dead mailboxes as normal and dead-letters them; an invitation batch into a government org with stale HR data legitimately produces hard bounces. Ten in fifteen minutes is the shape of losing the *channel* (SPF/DKIM broken, credentials revoked, domain blocklisted) rather than losing a message. **A guess about this client's address hygiene — retune after the first real batch** |
| `mail-transient-rejections` | **50** in 15 min | Deliberately *above* the permanent threshold: a 4xx is the relay asking us to slow down and `EmailSendRateLimiter` already paces sends, so some transient rejection during a batch is the system working. Fifty means the pacing has lost |
| `notification-sender-throwing` | **5** in 15 min | The provider did not answer at all. Rows are retried until `RetryCount` is exhausted, so a sustained spike is silent permanent loss of notifications |
| `rate-limit-rejection-spike` | **100** in 5 min | Global ceiling is 600/min and per-address policies are tighter; a genuine survey launch *will* produce rejections and alarming on those trains everyone to ignore it. The dangerous reading is not an attack but `RateLimiting__TrustedProxyHopCount` being wrong, which makes every caller share one bucket. **A guess — no production rate-limit data exists to calibrate against** |

### Routing

Two SNS topics (`-alerts-critical`, `-alerts-warning`), both delivering to the same Teams
channel and the same mailbox. The split exists so severity can diverge later without
re-pointing 20 alarms.

`TeamsForwarderFailingAlarm` watches the forwarder itself and routes **email only** — every
other alarm goes *through* the forwarder, so routing a broken-Teams alert through Teams is a
loop.

---

## 5. Deploying it

### What a human must supply first

1. **AWS credentials for account `747814092517`.** Mine were for a different account.
2. **The App Runner `ServiceId`** — the 32-hex segment of the log group name. Not the ARN, not
   the hostname:
   ```bash
   aws apprunner list-services --region us-east-1 \
     --query "ServiceSummaryList[?ServiceName=='climate-project-api-prod'].ServiceId" --output text
   ```
3. **A Teams webhook URL.** The channel is decided; the *mechanism* needs a check. Microsoft
   has been retiring Office 365 connectors in favour of Power Automate "Workflows", and the two
   accept different payloads. The forwarder sends an Adaptive Card wrapped in
   `{"type":"message","attachments":[…]}`, which is the Workflows shape. **If your tenant still
   issues a classic connector webhook, that payload renders as an empty card and the POST still
   returns 200** — a silent failure. This is why §6 insists on a human looking at the channel,
   not on a green step.
4. **A fallback email address** — a distribution list, not a person. AWS sends a confirmation
   link that **must be clicked**; an unconfirmed subscription is silently discarded.
5. **A decision on log retention days** (§3).

### Create the stack

Deploy with notifications **off** first. Several thresholds here are reasoned from code rather
than measured against production traffic, and a noisy alarm on day one is how a channel gets
muted.

```bash
aws cloudformation create-stack \
  --region us-east-1 \
  --stack-name climate-project-observability-prod \
  --template-body file://infra/aws/climate-project-observability.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=ServiceName,ParameterValue=climate-project-api-prod \
    ParameterKey=ServiceId,ParameterValue=<32-hex service id> \
    ParameterKey=TeamsWebhookUrl,ParameterValue='<webhook url>' \
    ParameterKey=FallbackEmail,ParameterValue='<distribution list>' \
    ParameterKey=AlarmsEnabled,ParameterValue=false
```

Watch for 48 hours:
```bash
aws cloudwatch describe-alarms --region us-east-1 \
  --alarm-name-prefix climate-project-api-prod \
  --query 'MetricAlarms[].{name:AlarmName,state:StateValue,reason:StateReason}' --output table
```

Anything in `ALARM` that you do not believe is a threshold to fix *before* turning on
notification, not after. Then re-run the same command as `update-stack` with
`AlarmsEnabled=true`.

Expect `mail-not-configured` to be red immediately and correctly (§7 item 6), and expect the
two `-teams-forwarder-*` resources plus `5xx-elevated` to be the only ones that can go red
without a metric filter behind them.

**The stack will fail to create if the App Runner log groups do not exist yet** — metric
filters require a real log group. They exist as soon as the service has started and logged.

### Enable the synthetic probe

`.github/workflows/ops-synthetic-probe.yml` is authored and lints clean (`actionlint`, exit 0).
It probes `/ready` and `/version` from outside AWS every 15 minutes and relays
`deploy-drift.yml` failures to Teams.

It needs the repository secret **`TEAMS_WEBHOOK_URL`**. Until that exists, every posting step
is skipped by an `env`-guarded `if:` and the workflow still fails loudly in the Actions tab —
deliberately, because a notify step that silently no-ops on a missing secret is how an alerting
pipeline becomes decorative.

```bash
gh secret set TEAMS_WEBHOOK_URL   # paste the URL when prompted
```

Two notes: the `workflow_run` trigger only fires once the file is on the **default branch**;
and it relays drift failures **without touching `deploy-drift.yml`**, on purpose — that
workflow is the one thing standing between production and another month-old build, and a
notify step appended to it is a new way for it to fail.

---

## 6. Verify the instrument before trusting it

Two filters in the template can be silently wrong. Both fail *closed to silence*, which is the
worst way to fail, so check them.

**1. Does the heartbeat text actually appear in CloudWatch?** If it does not, every job alarm
is permanently in `ALARM` — or worse, permanently green with `DefaultValue` doing the talking.
```bash
aws logs filter-log-events --region us-east-1 \
  --log-group-name "/aws/apprunner/climate-project-api-prod/<service-id>/application" \
  --filter-pattern '"Heartbeat: scheduled job notification-dispatch completed a run"' \
  --start-time $(( ($(date +%s) - 900) * 1000 )) \
  --query 'events[].message' --output text
```
Expect roughly 15 lines for a 15-minute window. Zero means the pattern is wrong, the jobs are
not running, or `Scheduling:Enabled` is false — all three are findings.

**2. What does an instance replacement actually log?** The `"Health check failed"` pattern is a
guess. Read the service log group and correct it:
```bash
aws logs filter-log-events --region us-east-1 \
  --log-group-name "/aws/apprunner/climate-project-api-prod/<service-id>/service" \
  --start-time $(( ($(date +%s) - 604800) * 1000 )) \
  --query 'events[].message' --output text | sort -u | head -50
```
If nothing matches, delete `InstanceReplacementFilter` and `InstanceReplacementLoopAlarm`
rather than leaving a filter that can never fire — a dead alarm on a dashboard is worse than a
missing one, because it reads as coverage.

**3. Send one real test alert and look at Teams with your eyes.**
```bash
aws sns publish --region us-east-1 \
  --topic-arn <critical topic arn> \
  --subject "test" \
  --message '{"AlarmName":"routing test","NewStateValue":"ALARM","AlarmDescription":"If you can read this in Teams, routing works.","NewStateReason":"Manual test."}'
```
A 200 from the webhook is not evidence. The card rendering in the channel is.

**4. Guard the filter strings against future edits.** Every pattern matches a literal from
`src/`. If someone rewords a log message, the alarm goes quiet and nothing anywhere errors.
Worth a test in `tests/` asserting the exact heartbeat format string — the same idea as
`WorkerHostingRegistrationTests`, which already fails if a worker stops being registered.

---

## 7. What only a human can decide or supply

1. **AWS credentials for `747814092517`**, and confirmation that production truly has zero
   alarms today (I inferred it; I could not measure it).
2. **Whether Supabase PITR is on.** Unverified and uncheckable from here. Scheduled jobs hard-
   delete rows daily. This is arguably a larger go-live risk than anything in §4.
3. **The Teams webhook URL, and which flavour it is** (Power Automate Workflows vs classic
   connector). Wrong flavour = silent 200s.
4. **Who is on the fallback distribution list**, and who is expected to act at 03:00. #158's
   criterion is "an alert nobody sees is not an alert"; the alarms are worthless until a named
   rota exists. A Costa Rican government client with a 16 Nov go-live needs this written down.
5. **Log retention days** (§3), against the client's data-retention commitments.
6. **Whether to arm mail before or after enabling `mail-not-configured`.** Production sends no
   mail today. That alarm will fire immediately and correctly. Either arm mail first, or turn
   the alarm on knowing it is a standing red until you do — but do not delete it.
7. **The drift decision, this week.** Production is 23 commits behind and the next drift run
   will fail. `deploy-prod.yml` is `workflow_dispatch`-only behind
   `confirm_destructive_migration` for good reasons; deploying is a person's call. But
   production has been running a front end newer than its API, and that gap widens on every
   merge to `main`.
8. **A deploy path for `services/tracking-api`.** None exists. A Procomer `.xlsx` export just
   merged into a service with no route to production, and #219 requires `InternalApiKey` wired
   on both sides in the same change. Out of scope for #158, but it is the largest unmonitored
   surface because it is the largest undeployed one.

---

## 8. Acceptance criteria (#158) — honest status

| Criterion | Status after this work |
|---|---|
| Structured logging with correlation ids | **Not met.** §3 gives a no-code-change path (two env vars) that satisfies it within a request. The edit to the service template is deliberately not made here |
| Error alerting configured, delivered to a real channel | **Templates authored, not applied.** Needs the webhook, the account and the stack create |
| Commit-drift alert active | **Detection already shipped** in `deploy-drift.yml`. Routing to Teams is added by `ops-synthetic-probe.yml`; needs the secret |
| Worker heartbeat alert active | **Templates authored, not applied.** Seven per-job alarms plus the in-process stale alarm |
| Logs verified free of PII and response content | **Substantially met and now audited** (§3). Two residual items: `{ClientIp}` and unbounded retention |
| Alert routing documented | **Met** — §4 routing, §5 setup, §7 the human decisions |
