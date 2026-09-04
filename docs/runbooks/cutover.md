# Production cutover runbook — #162 (the day)

**Status: RE-VERIFIED CLAIM-BY-CLAIM 2026-09-02.** Every step below now carries one of
exactly three tags:

- `[VERIFIED 2026-09-02: <how>]` — re-measured today, with the command or file that proves it.
- `[STALE — was: <old>; now: <new>]` — the claim was wrong or out of date; the correction and
  its evidence are on the line.
- `[CANNOT VERIFY FROM HERE: <what access it needs>]` — true or false cannot be established
  from this repository plus read-only AWS/GitHub/DNS; it needs a console, a credential, or a
  human.

The document was originally grounded in `origin/main` at `1219dc6` (2026-08-15). That is
**three weeks and roughly 90 commits stale**; production is now `b371a9d`
(`curl https://bhgrdkd4gt.us-east-1.awsapprunner.com/version` →
`{"commit":"b371a9d74b20ad0423f05370a50ff10e7ad2da00","builtAt":"2026-09-02T18:04:34Z"}`,
HTTP 200). This repo's docs have gone stale before; they went stale again. Re-verify anything
below if you are reading it after **2026-09-02**.

> **Amended 2026-08-19.** Two things changed after this document was written: gate **A1**
> closed (workers co-hosted and verified in production), and the **data migration was
> dropped entirely** — the legacy Mongo data was mock, so there is nothing to migrate. Gate
> A2, #157's dry run and C3's index-before-ETL step are all void. Anything below still
> phrased as though a migration were coming is stale; treat
> [`docs/decisions/no-data-migration.md`](../decisions/no-data-migration.md) as authoritative.
> [VERIFIED 2026-09-02: `docs/decisions/no-data-migration.md` exists (3685 bytes, 2026-08-19);
> `git ls-files | grep -iE 'etl|mongo'` returns **nothing** — the ETL is gone from the tree,
> not merely disused. `Api.csproj` now carries
> `<ProjectReference Include="..\ClimateProject.Workers\ClimateProject.Workers.csproj" />`,
> so A1's co-host is real in source. #275 and #155 are both **CLOSED** (`gh issue view`).]

> **Amended again 2026-08-24 (#159).** [`rollback.md`](./rollback.md) has been rewritten
> from scratch and no longer agrees with this file in two places. (1) **Rollback is not a
> DNS operation.** The web is on Vercel's anycast address, so rolling it back re-points a
> Vercel alias, not a DNS record; the API has no custom domain at all. **Phase B's TTL
> lowering below is therefore not a rollback prerequisite** and should not be allowed to
> gate a date. (2) The **point of no return is not one moment** — there are three
> independent one-way doors (a non-additive migration, a hard-deleting job tick, an email
> leaving), each closing on its own schedule. Where this file and `rollback.md` disagree,
> `rollback.md` is the later document.
> [VERIFIED 2026-09-02: both halves still hold and are now measurable.
> `dig +short climate.timsint.com @8.8.8.8` → `76.76.21.21`, Vercel's anycast address, so the
> web layer is an alias promotion and not a record edit. And
> `aws apprunner describe-custom-domains --service-arn …/climate-project-api-prod` returns
> `"CustomDomains": []` — the API still has no custom domain, so it has no DNS to revert.]

> **Amended a third time 2026-09-02 — the premise of this runbook has changed.** This
> document was written for a *big-bang cutover*: freeze the legacy stack, migrate its data,
> flip DNS, smoke-test. Two of those three no longer exist. There is no data to migrate
> (2026-08-19), and **the customer-facing DNS is already pointing at the new stack**:
> `climate.timsint.com` resolves to Vercel and serves
> `<title>Organizational Climate Platform</title>` (HTTP 200), while the legacy
> `organizational-climate-platform.vercel.app` still answers 200 but serves
> `<title>web</title>` — the Vite default this repo replaced in `d905c02` on 2026-08-07, i.e.
> a stale unrelated deployment, not this product.
> [VERIFIED 2026-09-02: `curl -s https://climate.timsint.com | grep -o '<title>[^<]*</title>'`
> → `<title>Organizational Climate Platform</title>`;
> the same command against `organizational-climate-platform.vercel.app` → `<title>web</title>`.]
>
> What is left of #162 is therefore **not a flip**. It is: finish the preconditions listed
> immediately below, get the recorded human go-ahead, run the smoke tests, and watch. Do not
> read Phase D as a sequence that still has to be executed end to end — read it as a
> checklist of which of its steps are already done, which are void, and which are impossible.

Companions:

- [`rollback.md`](./rollback.md) — what "roll back" means per layer, which layers are
  genuinely reversible, and the three one-way doors. Read it **before** the window opens,
  not during an incident. [VERIFIED 2026-09-02: file present, 41244 bytes, §8.1 "The
  health-check margin this exposed" is at line 602.]
- [`legacy-dependencies.md`](./legacy-dependencies.md) — everything still pointing at the
  legacy stack, row by row, with what replaces it. [VERIFIED 2026-09-02: file present;
  but it has not been touched since 2026-08-15 and **its rows 5, 8 and 9 are now wrong** —
  see "Errors found in neighbouring documents" at the foot of this file.]

Claims below that depend on console state (Vercel, Supabase, Google Cloud, the DNS registrar's
control panel) are marked as such; nothing in this repository can verify them. Claims that
depend on **read-only AWS or DNS** are no longer in that category — they were verified today.

---

## Preconditions not yet met (as of 2026-09-02)

Nothing in this list blocks the product from serving today — it already serves. Each line is
something #162's own acceptance criteria or pre-flight checklist assumes is true, and which is
**not true right now**.

| # | Not true yet | Evidence measured 2026-09-02 |
|---|---|---|
| P1 | **No staging environment.** #156 is open; `deploy-staging.yml` has **0 lifetime runs**. Only the bootstrap exists. | `gh run list --workflow=deploy-staging.yml` → empty. DEV account `795965600143`: `climate-project-api-staging-bootstrap`, `CREATE_COMPLETE`, created `2026-09-02T19:21:34Z`. No staging **service** stack. |
| P2 | **Rollback has never been executed anywhere.** #159 open. `rollback-prod.yml` and `rollback-rehearsal-staging.yml` each have **0 lifetime runs**; `rollback.md` §8's rehearsal table is still all `____`. | `gh run list --workflow=rollback-prod.yml` → empty; same for `rollback-rehearsal-staging.yml`. `rollback-prod.yml:4-6` says so in its own header. |
| P3 | **No CloudWatch alarms exist.** #158 open. `infra/aws/climate-project-observability.yml` has never been deployed. | PROD account `747814092517`: `aws cloudwatch describe-alarms --query "MetricAlarms[?contains(AlarmName,'climate')].AlarmName"` → `[]` (the account holds 39 alarms, none of them this product's). No `climate-project-*-observability` stack in `describe-stacks`. **See P13: even if an alarm existed, the routing to a human is unverified.** |
| P4 | **The API has no custom domain.** #160 open. Everything external addresses it by its generated App Runner hostname. | `aws apprunner describe-custom-domains …/climate-project-api-prod` → `"CustomDomains": []`, `"DNSTarget": "bhgrdkd4gt.us-east-1.awsapprunner.com"`. |
| P5 | **DNS TTLs are 1800 s, not ≤ 300 s.** Phase B was never executed. This caps how fast *any* DNS-level revert propagates — see the 2026-08-24 amendment for why that is not the rollback blocker it was once written as, but it is still the honest number. | `dig +noall +answer climate.timsint.com @dns1.registrar-servers.com` → `climate.timsint.com. 1799 IN A 76.76.21.21`; apex, `www`, `MX` and the SPF `TXT` all report the same 1800 s class. |
| P6 | **`web/vercel.json` hardcodes the App Runner hostname** in its CSP `connect-src`. If the API ever gets the custom domain of P4, this file must change in the same breath or the browser stops the calls. It is `Content-Security-Policy-Report-Only` today, so the failure would be a console report rather than an outage — that is a mitigation, not an excuse. | `web/vercel.json`, the `Content-Security-Policy-Report-Only` header: `connect-src 'self' https://bhgrdkd4gt.us-east-1.awsapprunner.com`. There is **no** `crons` key in that file. |
| P7 | **Secret rotation (#70) has not started.** Every credential exposed by the `tailwind.config.js` incident is still live. | `docs/security/rotation-inventory.md:3` — "**Status: NOT STARTED. No credential below has been rotated.**" |
| P8 | **UAT with real users (#161) has not happened.** | `gh issue view 161` → OPEN, "User acceptance testing with real users before cutover". |
| P9 | ~~**No maintenance page (#141).**~~ **MET 2026-09-04.** C8 below assumes one exists, and now it does. | `web/public/maintenance.html` (#430), static and app-independent; 200 observed on the Vercel preview. #141's logs-viewer half is a recorded decision, not a build — `docs/decisions/operational-pages.md`. |
| P10 | **The tracking service is not deployed in production at all.** D7 cannot be executed as written. | PROD account: `describe-stacks --query "Stacks[?contains(StackName,'tracking')].StackName"` → `[]`. `deploy-tracking-prod.yml` has exactly **one** lifetime run, `2026-08-27T21:21:19Z`, conclusion **failure**. |
| P11 | **Google OAuth origins are unconfirmed for `climate.timsint.com`.** | [CANNOT VERIFY FROM HERE: Google Cloud console access to the OAuth client.] |
| P12 | **`#163` (nothing external points at legacy) is partly answered — see `docs/decisions/legacy-dependency-inventory.md`.** The legacy app never ran on Vercel: it ran on a **Coolify host whose address appears in no repository**, so the post-cutover log review (criterion 2) has no target yet. `organizational-climate-platform.vercel.app` still answers 200, but it is an unrelated stale deployment, not the legacy stack. | `curl -o /dev/null -w '%{http_code}' https://organizational-climate-platform.vercel.app` → `200`. `gh issue view 163` → OPEN. |
| P13 | **No alert is routed anywhere.** Read with P3: there are no CloudWatch alarms to fire, and the one prober that does run posts only if `TEAMS_WEBHOOK_URL` exists. If it does not, the probe fails loudly *in the Actions tab* and nowhere else — which nobody is watching at 02:00. This is the precondition under D9's "someone actually watching, rollback criteria live": today "watching" means a human refreshing a browser tab, not a page. Decide before the window who holds that tab, or accept that the first report of an outage comes from the customer. | `ops-synthetic-probe.yml:20-23` — "NOT ENABLED ON A SCHEDULE UNTIL THE SECRET EXISTS. `TEAMS_WEBHOOK_URL` is read through an `if:` guard on every posting step, so until someone adds it this workflow probes and fails loudly in the Actions tab without ever attempting a post." [CANNOT VERIFY FROM HERE: whether the secret is set. Reading repository secrets is not possible read-only; `gh secret list` requires admin and does not reveal values.] Corroborated by P3 (zero alarms) and by A4. |
| P14 | **Five seeded role accounts exist on the live production system with one shared, documented password** (`superadmin@`, `companyadmin@`, `leader@`, `supervisor@`, `employee@` `nexadev.ai`; see `project_deployment_topology` and the #138 live walk). They are the UAT fixtures, and they are also five working logins to production with a password written in more than one place. Before real employee data arrives: rotate them, or disable them and re-create for UAT with per-account passwords. | [VERIFIED 2026-09-02: all five authenticated against `bhgrdkd4gt.us-east-1.awsapprunner.com/auth/login` during the #138 verification.] |

---

## Phase A — prerequisite gates (weeks before)

Every gate must be green before a cutover **date** is even chosen. The status column was
written against `1219dc6` and has been **re-measured today**; six of the ten rows had moved.

| # | Gate | Tracking | Status re-measured 2026-09-02 |
|---|---|---|---|
| A1 | Worker hosting decided **and deployed** | #275 | **CLOSED** [VERIFIED 2026-09-02: `gh issue view 275` → CLOSED. `src/ClimateProject.Api/ClimateProject.Api.csproj` carries a `ProjectReference` to `ClimateProject.Workers`, so the API host runs the jobs.] [STALE — was: "all six jobs reporting heartbeats"; now: **eight** jobs — `WorkerJobs.All` at `src/ClimateProject.Application/Scheduling/WorkerJobs.cs:74-84` lists `notification-dispatch`, `invitation-reminders`, `digests`, `scheduled-reports`, `survey-draft-retention`, `retention-cleanup`, `survey-lifecycle`, `microclimate-lifecycle`, and `src/ClimateProject.Workers/Jobs.cs` defines eight matching `*Worker` classes at lines 28, 72, 111, 151, 207, 274, 331, 390.] |
| A2 | ~~ETL tool built, reconciliation harness included~~ | ~~#154~~ | **VOID — there is no data migration.** [VERIFIED 2026-09-02: `git ls-files \| grep -iE 'etl\|mongo'` returns nothing.] See [`no-data-migration.md`](../decisions/no-data-migration.md) |
| A3 | Staging environment with production parity | #156 | **Open — bootstrap only.** [STALE — was: "Open"; now: partially advanced. The DEV account holds `climate-project-api-staging-bootstrap` (`CREATE_COMPLETE`, created today `2026-09-02T19:21:34Z`) and the GitHub OIDC provider, but **no staging service stack and no staging database**, and `deploy-staging.yml` has 0 lifetime runs.] |
| A4 | Monitoring/alerting live, worker heartbeats scraped | #158 | **Open — half built, nothing deployed.** [STALE — was: "`WorkerHeartbeats` exists, nothing scrapes it"; now: an outside-in prober **does** exist and runs (`.github/workflows/ops-synthetic-probe.yml`, last success `2026-09-02T17:53:50Z`), but **zero CloudWatch alarms exist** (P3) and `infra/aws/climate-project-observability.yml` has never been deployed.] [CANNOT VERIFY FROM HERE: whether the `TEAMS_WEBHOOK_URL` secret has been set — the workflow guards every posting step on it (`ops-synthetic-probe.yml:20-23`), so alerts may be silently unrouted. Reading repository secrets is not possible read-only.] This now has its own precondition row, **P13**, because it is what stands underneath D9's "someone actually watching". |
| A5 | Rollback tested, not just written | #159 | **Open.** [VERIFIED 2026-09-02: `rollback.md` has been rewritten and is substantial, and `rollback-prod.yml` exists — but 0 lifetime runs on both rollback workflows (P2), so the gate as stated ("tested, not just written") is not met.] |
| A6 | Secret rotation | #70 | **NOT STARTED** [VERIFIED 2026-09-02: `docs/security/rotation-inventory.md:3`.] |
| A7 | Runtime DB secret on session pooler (5432) and guard armed | #220 | **CLOSED.** [VERIFIED 2026-09-02: `infra/aws/climate-project-api-prod-service.yml:230-231` sets `Database__RequireSessionPooler` to `"true"`; `gh issue view 220` → CLOSED; 20 of 20 live `/ready` probes returned 200 today.] [STALE — was: "Live secret still says 6543 per `infra/aws/README.md`"; now: the secret was moved to 5432 on 2026-08-10 and the guard armed 2026-08-17. **`infra/aws/README.md:58` still claims the guard is `"false"` and is itself wrong** — see the foot of this file.] |
| A8 | Production email actually configured | #100 | **CLOSED.** [STALE — was: "**Not configured** … the service template passes no `Email__*` variables, so production email today is the stub"; now: `infra/aws/climate-project-api-prod-service.yml:265-294` passes `Email__Provider=smtp`, `Email__SmtpHost=email-smtp.us-east-1.amazonaws.com`, `Email__SmtpPort=587`, `Email__FromAddress=no-reply@timsint.com`, `Email__AppBaseUrl=https://climate.timsint.com`, `Email__SesConfigurationSet=tims-transactional`, with the SMTP username/password as `RuntimeEnvironmentSecrets` (lines 302-305). SES in the prod account is **out of the sandbox and sending**: `aws sesv2 get-account` → `ProductionAccessEnabled: true`, `SendingEnabled: true`, `SentLast24Hours: 27`; `aws sesv2 get-email-identity --email-identity timsint.com` → `VerifiedForSendingStatus: true`, DKIM `SUCCESS`. `gh issue view 100` → CLOSED.] |
| A9 | `deploy-prod.yml` has at least one successful dispatch | — | **CLOSED.** [STALE — was: "**Zero dispatches, lifetime**"; now: **18 lifetime runs**, the most recent `2026-09-02T17:44:41Z`, conclusion `success`, on `b371a9d`, and that commit is what `/version` reports live.] |
| A10 | UAT complete | #161 | **Open.** [VERIFIED 2026-09-02: `gh issue view 161` → OPEN. Its stated dependency #100 is now CLOSED, so UAT is no longer blocked — it is simply undone.] |
| A11 | API custom domain | #160 | **Open — new row.** Added because a verified fact makes several steps below unexecutable without it: B4/B5/D8 all speak of "the custom domain", and there is none. [VERIFIED 2026-09-02: `describe-custom-domains` → `"CustomDomains": []`.] |

### A1 — Worker hosting decision (#275): an explicit prerequisite gate

This was a gate, not a task, because cutting over without it produced a **silent** outage:
the legacy Vercel cron (`climate-project/vercel.json`) runs `/api/cron/send-reminders`
every 15 minutes in production today, and at the time this paragraph was written its
replacement had never executed anywhere.

[STALE — was: "its replacement has never executed anywhere", stated in the present tense;
now: **the replacement is deployed and its schedule is armed by default.** The API host
calls `builder.Services.AddClimateProjectScheduling(builder.Configuration)`
(`src/ClimateProject.Api/Program.cs:406`); that extension registers all eight `*Worker`
classes plus `WorkerHeartbeatMonitor` as hosted services
(`src/ClimateProject.Workers/SchedulingServiceCollectionExtensions.cs:81-89`); the API
project carries the reference that puts them in the image
(`src/ClimateProject.Api/ClimateProject.Api.csproj:14`); the master switch defaults **on**
(`src/ClimateProject.Workers/WorkerSchedulingOptions.cs:55` →
`public bool Enabled { get; set; } = true;`) and **production overrides nothing** —
`grep -c 'Scheduling__' infra/aws/climate-project-api-prod-service.yml` → `0`. That image
is what production runs: `deploy-prod` run `33662956354` succeeded on `b371a9d`
(`2026-09-02T17:44:41Z`) and `/version` reports the same commit, HTTP 200. What is still
unobserved is the *heartbeat log line* — see the exit criterion at the end of this section;
"deployed and enabled by default" is a source-and-deploy measurement, not a log.]

**This inverts the instruction for the night, so read it before you touch the legacy stack.**
Because the new stack's `invitation-reminders` job is running, leaving the legacy 15-minute
cron armed means *both* stacks send reminders for the same product — the double-send risk A8
names ("both stacks can send mail from this product at the same time, which is the one email
risk that survives"). Disarm the legacy cron; do not keep it armed as a safety net.
[CANNOT VERIFY FROM HERE: the legacy `climate-project` repository is a *separate* GitHub
repo — `gh repo list TIMSInternational` shows `climate-project` present and **not archived**
— and is not checked out here, so its `vercel.json` cannot be read, and whether its cron is
still armed is Vercel console state. The only `vercel.json` in this tree is
`web/vercel.json`, and it has **no** `crons` key.]

**The rest of this section is history, kept because the argument is still worth reading, not
because it still describes the code.** Every "the API cannot run the jobs" claim below was
true at `1219dc6` and is false now:

- ~~`.github/workflows/deploy-prod.yml` builds only the root `Dockerfile` (the API image).~~
  [VERIFIED 2026-09-02: still literally true — `deploy-prod.yml:170-176` builds `.` and
  `Dockerfile.workers` is referenced by no workflow (`grep -l Dockerfile.workers
  .github/workflows/*` → nothing). It no longer *matters*, because of the next line.]
- ~~`ClimateProject.Api.csproj` has no `ProjectReference` to `ClimateProject.Workers`.~~
  [STALE — was: no reference; now: `src/ClimateProject.Api/ClimateProject.Api.csproj`
  contains `<ProjectReference Include="..\ClimateProject.Workers\ClimateProject.Workers.csproj" />`.
  That single line is what closed this gate: the API image carries the jobs.]
- `infra/aws/` defines exactly one **deployed** service for this product. [VERIFIED
  2026-09-02: `ls infra/aws/` returns **seven** files — `README.md`,
  `climate-project-api-bootstrap.yml`, `climate-project-api-prod-service.yml`,
  `climate-project-observability.yml`, `climate-project-synthetic-probe.yml`,
  `climate-tracking-api-bootstrap.yml`, `climate-tracking-api-prod-service.yml`. Two of them
  are service templates (`climate-project-api-prod-service.yml`,
  `climate-tracking-api-prod-service.yml`) and only the first is deployed —
  `describe-stacks` shows `climate-project-api-prod` (`UPDATE_COMPLETE`,
  `2026-09-02T18:06:36Z`) and no tracking stack at all.]
  [STALE — was: an enumeration of two files carrying a VERIFIED tag; now: the full listing.
  The omission mattered because two of the five files left out are load-bearing elsewhere in
  this document — `climate-project-observability.yml` is the never-deployed template P3 turns
  on, and `climate-tracking-api-bootstrap.yml` is half of what C5/P10/D7 say has never been
  deployed.]
- ~~Therefore every job in `WorkerJobs.All` has **never run in production**.~~
  [STALE — was: never run; now: the co-host is deployed and the list is **eight** jobs, not
  six (see the A1 row above).]

#275 offered two fixes (second service vs. co-host in the API); the co-host was chosen and
deployed, which is why this gate reads CLOSED. What this gate required was that one be
**chosen, recorded in `docs/decisions/`, deployed, and evidenced by a heartbeat log line in
production** — #275's own acceptance criteria. Code existing is not the gate; a log line is.
[VERIFIED 2026-09-02: the decision is recorded at `docs/decisions/worker-hosting.md`.]

**Exit criterion:** a structured heartbeat line from each of the **eight** jobs observed in
production logs. `____` (date observed, who verified)
[CANNOT VERIFY FROM HERE: reading App Runner application logs is a CloudWatch Logs query
against production; this lane is read-only on AWS and production logs are out of scope. The
`____` stays a blank because nobody has filled it, not because it cannot be filled.]

### A2 — ETL tool (#154): VOID

**There is no data migration.** The legacy MongoDB database held mock data produced by a
previous development team, not production records, so it is abandoned rather than migrated.
The ETL tool, its design document and its CI job were deleted on 2026-08-19 — see
[`docs/decisions/no-data-migration.md`](../decisions/no-data-migration.md), which also records
what was deliberately kept and how to reverse the decision.
[VERIFIED 2026-09-02: the decision file exists and opens "there is no data migration (#154 and
the whole ETL, dropped) … Taken 2026-08-19 by Federico"; `git ls-files` matches nothing for
`etl` or `mongo`; `gh issue view 157` → **CLOSED, reason `NOT_PLANNED`, `2026-08-19T15:44:29Z`**.]

Consequences for this runbook, applied below: **#157's dry run** was rehearsing the
migration and has no subject; the **"index before ETL"** sequencing in pre-flight C3 is void;
and the new platform starts from an empty database populated by real use.

### A7 — database secret on the session pooler, guard armed (#220)

**Done in full as of 2026-08-17** — secret flipped and verified 2026-08-10, and
`Database__RequireSessionPooler` armed `"true"` in the template.
[VERIFIED 2026-09-02: `infra/aws/climate-project-api-prod-service.yml:230-231`.]
Kept for the record:

Do this **before cutover week**, not during. While the runtime secret points at port
6543, `/ready` alternates 200/timeout on the live service (measured in
`infra/aws/README.md`, "Connection pooling"), which turns every canary in Phase C and D
into noise — you cannot distinguish "cutover broke something" from the pre-existing
defect. The ordered fix (flip the secret → verify 20+ consecutive `/ready` 200s and the
`TRANSACTION pooler` warning gone from App Runner logs → set
`Database__RequireSessionPooler` to `"true"` in
`infra/aws/climate-project-api-prod-service.yml`) is written down under "Arming the
guard" in `infra/aws/README.md`. Steps 1–2 need write access to the Secrets Manager
value `climate-project-api/prod/database-connection-string` (console state).

### A8 — production email

[STALE — the whole of this section's original text described an unconfigured stub, and that
is no longer the state. The corrected facts are in the A8 table row above. What follows is
the surviving argument, with the outcome attached.]

The new stack has a real SMTP sender (`SmtpEmailTransport`), and delivery falls back to
logging stubs when `EmailOptions` is unconfigured, announced by a startup WARNING. That
fallback is the failure mode to fear — a healthy service that delivers nothing.
[STALE — was: `Program.cs:348` for the transport registration and "the factory around lines
360–366" for the fallback; now: `src/ClimateProject.Api/Program.cs:367`
(`AddScoped<IEmailTransport, SmtpEmailTransport>()`) and the three
`EmailOptions.IsConfigured` ternaries at **lines 378, 394 and 418**. The file is 677 lines;
the old numbers point into unrelated code.]

It is configured now. The legacy stack sends mail via Brevo SMTP; the new stack sends via
Amazon SES from `no-reply@timsint.com`. That means **both stacks can send mail from this
product at the same time**, which is the one email risk that survives.
[VERIFIED 2026-09-02: SES `SentLast24Hours: 27` in the prod account. Brevo's state is
console-only.] [CANNOT VERIFY FROM HERE: whether the legacy Brevo sender is still armed —
that is the Vercel/Coolify env for the retired repo.]

One thing worth knowing before the day, because it is invisible until a bounce: the domain's
public mail policy is the registrar's forwarder, not SES.
[VERIFIED 2026-09-02: `dig timsint.com TXT @dns1.registrar-servers.com` →
`"v=spf1 include:spf.efwd.registrar-servers.com ~all"`, and the MX records are
`eforward1..5.registrar-servers.com`. SES DKIM on `timsint.com` is `SUCCESS`, so DKIM-aligned
DMARC passes regardless — but a receiver checking SPF alignment alone sees `~all`. This is
not a cutover blocker; it is the reason to watch the SES `tims-transactional` configuration
set's bounce rate during the watch period rather than assume silence means success.]

**Exit criterion:** ~~email configuration delivered to the App Runner service~~ — met, via
the service template. Still open: **a real invitation email received in an inbox from the
production service**, and the startup stub-warning absent from logs. `____` (date, who verified)
[CANNOT VERIFY FROM HERE: requires an inbox and production log access.]

---

## Phase B — DNS TTL lowering (DAYS before)

[STALE — was: "hard scheduling constraint". The 2026-08-24 amendment already demoted this
section, and today's measurements finish the job: the web layer's rollback is a Vercel alias
promotion, and the API has no DNS record at all. **This phase gates nothing.** It is kept
because its reasoning is correct and will apply the day #160 puts a custom domain on the API.]

**Why days before:** rollback propagates no faster than the TTL that was on the record
**when clients cached it**. A 86400-second TTL means up to 24 hours of users pinned to the
new stack after you have "rolled back" — the long TTL quietly ruins the rollback while
everything else works. Lowering the TTL is itself subject to the *old* TTL: resolvers keep
serving the cached record (with the old TTL) until it expires. So the lowering must precede
the window by **at least the longest current TTL, with margin**.

[STALE — was: "Today production runs on generated hostnames — an App Runner
`*.awsapprunner.com` URL and `organizational-climate-platform.vercel.app` (#160;
`README.md:75-76`). The customer-facing domain and its DNS host appear nowhere in this
repository: **UNVERIFIED-NEEDS-CONSOLE**." Now: **the customer-facing domain is
`climate.timsint.com`, it is live, and it is named inside this repository** —
`infra/aws/climate-project-api-prod-service.yml:280` sets
`Email__AppBaseUrl: "https://climate.timsint.com"`. The DNS host is **Namecheap**, not
Route 53: `dig timsint.com NS @8.8.8.8` → `dns1.registrar-servers.com` /
`dns2.registrar-servers.com`, and the prod AWS account has **zero** Route 53 hosted zones.
`organizational-climate-platform.vercel.app` is a stale unrelated deployment, not this
product — it serves `<title>web</title>`. Only the **API** half of the old claim survives:
it is still on its generated App Runner hostname.]

The enumeration B1 asked for is done. Records, measured against the authoritative
nameserver today:

| Record | Type | Value | TTL |
|---|---|---|---|
| `climate.timsint.com` | A | `76.76.21.21` (Vercel anycast) | 1800 |
| `timsint.com` | A | `76.76.21.21` | 1800 |
| `www.timsint.com` | A | `76.76.21.21` | 1800 |
| `timsint.com` | MX | `eforward1..5.registrar-servers.com` (prio 10/10/10/15/20) | 1800 |
| `timsint.com` | TXT | `v=spf1 include:spf.efwd.registrar-servers.com ~all` | 1800 |
| `api.timsint.com`, `api.climate.timsint.com`, `climate-api.timsint.com` | — | **NXDOMAIN / no answer** | — |

[VERIFIED 2026-09-02: `dig +noall +answer <name> [type] @dns1.registrar-servers.com` for each
row, cross-checked for the A records against `@8.8.8.8` and `@1.1.1.1` (identical answers).
The API-subdomain row is the evidence for A11/P4 from the DNS side.]

| Step | Action | Status 2026-09-02 |
|---|---|---|
| B1 | Enumerate every DNS record involved (apex, `www`, API subdomain, anything mail-related) at the DNS host | **DONE** — table above. [VERIFIED 2026-09-02: `dig` against `dns1.registrar-servers.com`.] [CANNOT VERIFY FROM HERE: that the table is *exhaustive* — `dig` can only confirm names you already suspect. A zone listing needs the Namecheap control panel, and AXFR is refused.] |
| B2 | At **T minus ≥ the longest TTL found in B1, and no less than 3 days**: lower every record's TTL to ≤ 300 s | **NOT DONE, and not required** — see the amendment above. [VERIFIED 2026-09-02: all TTLs are 1800 s.] [CANNOT VERIFY FROM HERE: editing TTLs needs the Namecheap control panel.] |
| B3 | Verify with `dig +noall +answer <record>` from at least two public resolvers (`@8.8.8.8`, `@1.1.1.1`) that the served TTL is ≤ 300 | **FAILS as specified** — served TTL is 1800 from both resolvers. [VERIFIED 2026-09-02: both resolvers returned `1799 IN A 76.76.21.21` for `climate.timsint.com`.] |
| B4 | Update `CORS_ALLOWED_ORIGIN` … to the final customer domain and redeploy, **before** any user resolves to the new stack | **ALREADY DONE.** [VERIFIED 2026-09-02: `curl -X OPTIONS -H 'Origin: https://climate.timsint.com' -H 'Access-Control-Request-Method: GET' https://bhgrdkd4gt.us-east-1.awsapprunner.com/version` → `204` with `access-control-allow-origin: https://climate.timsint.com`. The same preflight from `https://organizational-climate-platform.vercel.app` → `204` with **no** `access-control-allow-origin` header, i.e. the legacy origin has been removed from the allowlist.] |
| B5 | Confirm the Google OAuth client's authorized JavaScript origins / redirect URIs include the final domain (the web flow redirects back to `<origin>/auth/loading`) | **UNCONFIRMED.** [VERIFIED 2026-09-02 (repo half only): `web/src/auth/googleOAuth.ts:68` — `export const GOOGLE_REDIRECT_PATH = '/auth/loading'`, used at line 130 as `${origin}${GOOGLE_REDIRECT_PATH}`. So the value that must be allowlisted is exactly `https://climate.timsint.com/auth/loading`.] [CANNOT VERIFY FROM HERE: Google Cloud console.] |

---

## Phase C — pre-flight checks (cutover day)

Run in order. Any failure is a **no-go**; do not improvise fixes inside the window.

Let `API` be the live API base URL —
`https://bhgrdkd4gt.us-east-1.awsapprunner.com`. [STALE — was: "the custom domain after
#160"; now: #160 is still open and `describe-custom-domains` is empty, so the App Runner
hostname is not a placeholder for the day, it *is* the address.]

### C1 — `/version` drift check

```
curl -sSf "$API/version" | jq -r .commit
```

Must equal the commit you intend to serve (normally `origin/main` HEAD). `/version`
reports the commit the running image was built from; `deploy-prod.yml`'s final step asserts
this at deploy time precisely because production once sat **156 commits behind main
unnoticed**.
[STALE — was: `src/ClimateProject.Api/Program.cs:501`; now: `Program.cs:613`
(`app.MapGet("/version", …)`).] [VERIFIED 2026-09-02: the assertion step is
`deploy-prod.yml:452-460`, "Verify deployed commit matches this run", and its comment carries
the 156-commit history at lines 446-451.]

If it does not match, the fix is a deploy, and the cutover date moves. **Do not dispatch a
deploy to fix this while another is in flight** — `deploy-prod.yml` declares
`concurrency: {group: deploy-prod, cancel-in-progress: false}` (lines 26-28), so a second
dispatch **queues**; it does not race and it does not pre-empt. A run that appears to hang at
"waiting" is that queue, not a fault. [VERIFIED 2026-09-02: read at `deploy-prod.yml:26-28`,
with the reasoning at lines 14-25.]

- Expected commit: `b371a9d74b20ad0423f05370a50ff10e7ad2da00` Reported:
  `b371a9d74b20ad0423f05370a50ff10e7ad2da00` Duration: `0.26 s`
  [VERIFIED 2026-09-02: `curl -sS -w 'HTTP %{http_code} in %{time_total}s' $API/version` →
  `{"service":"climate-project-api","runtime":"10.0.11","environment":"Production","commit":"b371a9d74b20ad0423f05370a50ff10e7ad2da00","builtAt":"2026-09-02T18:04:34Z"}`,
  `HTTP 200 in 0.263832s`.]

### C2 — `/ready` canary

```
for i in $(seq 1 20); do curl -s -o /dev/null -w "%{http_code}\n" "$API/ready"; sleep 3; done
```

**All 20 must be 200.** Twenty and not one, because the known #220 failure mode
*alternates* — `infra/aws/README.md` records five timeouts in ten probes on the live
service, and "one green probe proves nothing." `/ready` round-trips Postgres with a real
`SELECT 1`; `/health` is a static literal and proves nothing about the database.
[STALE — was: `Program.cs:468` for `/ready`; now: `Program.cs:580`. `/health` is at
`Program.cs:563`, and its own comment (lines 558-562) says it is **not** what App Runner
polls.] [VERIFIED 2026-09-02: `#220` is CLOSED, so the alternating signature is history —
but the 20-probe standard stays, because it is also what `deploy-prod.yml`'s own canary
enforces (`REQUIRED_CONSECUTIVE: 20`, `deploy-prod.yml:399`).]

**Read this before you interpret a red probe as a failure.** App Runner health-checks
`/ready` with `Timeout: 5`, `Interval: 20`, `HealthyThreshold: 3`, `UnhealthyThreshold: 5`
(`infra/aws/climate-project-api-prod-service.yml:339-345`), and a **cold-start `/ready` has
been measured at 9.4 s** — roughly twice that timeout. So a freshly-replaced instance
**fails its first health checks by design**, and a correct rollback or redeploy looks like a
failing one for about a minute. `rollback.md` §8.1 states this outright: "a rollback that
appears to stall in health checks for a minute or more is the **expected** behaviour of this
configuration, not a failed rollback. Do not abort it on that signal alone; abort on the §5
triggers." The same caveat applies to *this* check: if you are probing within a minute or two
of a rollout, a non-200 is warm-up, not an incident. Probe again from a settled service
before calling a no-go.
[VERIFIED 2026-09-02: thresholds read from the template at lines 339-345; the 9.4 s figure
and the "do not abort on that signal" instruction from `docs/runbooks/rollback.md:602-618`;
`deploy-prod.yml:406-411` sets its own probe timeout to 15 s explicitly "above the 9.4s
cold-start probe measured post-deploy in #220".]

- 20/20 green: **yes** Duration: **max 0.267 s, min 0.163 s across 20 consecutive probes**
  [VERIFIED 2026-09-02: 20 back-to-back `curl -s -o /dev/null -w '%{http_code}:%{time_total}'
  --max-time 15 $API/ready` — all `200`, slowest `0.2665 s`. Note this was run
  **without** the 3-second sleep the snippet specifies, so it samples a ~4-second window
  rather than a ~60-second one; run the snippet as written on the day.]

### C3 — migrations at head

[STALE — was: "and the #155 index gate: **index before ETL**". There is no ETL, and #155 is
CLOSED. The ordering gate below is **VOID**; the migration-parity check is not.]

```
# What the deployed commit contains:
# NOTE the second grep. ClimateProjectDbContextModelSnapshot.cs matches the glob and is NOT
# a Designer file, so the snippet as it stood emitted 56 lines for 55 migrations.
git ls-files 'src/ClimateProject.Infrastructure/Migrations/*.cs' \
  | grep -v Designer | grep -v ModelSnapshot

# What the database has (session pooler, port 5432):
psql "$MIGRATION_CONN" -c 'SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY "MigrationId";'
```

The two lists must match — migrations are applied by `deploy-prod.yml` as a workflow
step ("Apply EF Core migrations"), so a matching list is evidence the deploy path ran,
not an assumption.
[VERIFIED 2026-09-02: the step is `deploy-prod.yml:194-302`. The repo half of the check
returns **55 migrations**, head `20260902024642_AddSurveyForeignKeys.cs`.]
[STALE — was: the snippet without `| grep -v ModelSnapshot`, beneath a stated result of 55.
Measured: `git ls-files 'src/ClimateProject.Infrastructure/Migrations/*.cs' | grep -v Designer
| wc -l` → **56**, the extra line being `ClimateProjectDbContextModelSnapshot.cs`, which is a
snapshot of the model and never a row in `__EFMigrationsHistory`. Run verbatim on the night
the old snippet produced a guaranteed one-row mismatch on a check whose failure is a declared
no-go. Corrected above; the count of 55 was always the right number.]
[CANNOT VERIFY FROM HERE: the `psql` half. Querying the production database is out of scope
for this lane. The nearest read-only proxy is that `deploy-prod` run `33662956354` succeeded
today on `b371a9d` and its migration step is not skippable.]

**Do not "help" this check by hand-applying a migration.** `deploy-prod.yml` scans the
**pending** delta for `DROP TABLE` / `DROP COLUMN` / `TRUNCATE` and refuses the deploy
unless the dispatch carried `confirm_destructive_migration=yes`
(`deploy-prod.yml:287-296`). That guard is the only thing standing between a bad migration
and the single copy of production data, and it is only in the path when migrations are
applied *by the workflow*. Applying SQL directly bypasses it entirely.
[VERIFIED 2026-09-02: `grep -inE '(DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|TRUNCATE)'
migration-pending.sql` at `deploy-prod.yml:287`, with the input declared at lines 6-12 and
the refusal at 291-294. The full and pending SQL are uploaded as the `migration-sql`
artifact on **every** run including a failed one (`if: always()`, lines 308-317, retained
365 days) — read that artifact before ever passing `yes`.]

~~This check is also the **ordering gate for the identity backfill**~~ — **VOID.** Migration
`20260801012028_AddPersonaExternalIdUniqueIndex` still exists and still creates the unique
filtered index `IX_users_persona_external_id`, and the asymmetry it exploits is still real,
but there is no ETL to order it against.
[VERIFIED 2026-09-02: the migration file is present in `git ls-files`; `gh issue view 155` →
**CLOSED**.] The argument is preserved because the failure mode it names has not gone away —
it now applies to *ordinary use* rather than to a load:

- `TrackingIdentifiers.ExternalPersonaId` falls back to the fresh Postgres GUID when
  `PersonaExternalId` is null — so a **missed or wrong backfill is silent**:
  `/api/internal/personas` happily returns GUIDs, and every existing tracking record
  dangles, presenting as empty dashboards with no error (#155).
  [STALE — was: `src/ClimateProject.Application/Tracking/TrackingIdentifiers.cs:9`; now:
  **line 11**. Line 9 is `ExternalNodoId`, the department equivalent, which has the same
  fallback shape and the same silence.]
- The unique index converts the one detectable variant — two users claiming the same
  legacy `_id` — into a **loud insert failure**, where it is cheap, instead of a quiet
  corruption discovered from a dashboard.

- Lists match: `____` (repo half: 55 migrations, head `20260902024642_AddSurveyForeignKeys`)
  `IX_users_persona_external_id` present: `____` Duration: `____`

### C4 — worker heartbeats (A1's evidence, re-checked on the day)

All **eight** job names from `WorkerJobs.All` seen emitting heartbeat lines in production
logs within the last hour. The scheduling design logs a heartbeat on **every** tick
including no-op ticks, so absence is meaningful.
[STALE — was: "All six job names"; now: eight — `WorkerJobs.cs:74-84` adds `survey-lifecycle`
and `microclimate-lifecycle`, and both matter more than the other six on a cutover day:
`SurveyLifecycle` is the only job that changes a status on live customer data
(`WorkerJobs.cs:56-62`), and `MicroclimateLifecycle` closes a microclimate whose responses
**cannot be unpicked afterwards** once accepted past the deadline (`WorkerJobs.cs:64-72`).
A checklist of six would have silently omitted both.]

- Eight seen: `____` Duration: `____`
  [CANNOT VERIFY FROM HERE: production CloudWatch Logs access.]

### C5 — tracking service configuration read back

`services/tracking-api` reads `ProcomerCompanyId`, `ClimateProjectBaseUrl`,
`ClimateProjectInternalApiKey`.
[VERIFIED 2026-09-02: `services/tracking-api/src/ClimateTracking.Api/appsettings.json:13-15`
and `services/tracking-api/src/ClimateTracking.Workers/appsettings.json:10-12` — the cited
line numbers are still exactly right, and all three values are empty strings in the repo.]

**But there is nothing to read back.** [STALE — was: "the real values are per-deployment,
**console state**", implying a deployment exists; now: **the tracking service is not deployed
in production at all.** The PROD account has zero CloudFormation stacks whose name contains
`tracking` (`describe-stacks` → `[]`), and `deploy-tracking-prod.yml` has exactly one lifetime
run — `2026-08-27T21:21:19Z`, conclusion **failure**. `infra/aws/climate-tracking-api-prod-service.yml`
and `climate-tracking-api-bootstrap.yml` exist in the repo and have never been deployed.]

This makes D7 unexecutable as written; see there.

- `ClimateProjectBaseUrl` today: **n/a — no deployment** `ProcomerCompanyId` today: **n/a**
  Where configured: **nowhere yet** [VERIFIED 2026-09-02: as above.]

### C6 — TTLs actually low

Re-run B3's `dig` checks. A TTL that crept back up (or was never lowered on one record)
is a no-go — it silently caps rollback speed.

- All ≤ 300 s: **NO — all 1800 s.** [VERIFIED 2026-09-02: see the Phase B table.]
  [STALE — was: a no-go condition; now: **not a no-go**, per the 2026-08-24 amendment. The
  web rollback is a Vercel alias promotion that does not touch DNS, and the API has no DNS
  record. Record the number, do not let it block the date. It becomes a real gate the day
  #160 lands.]

### C7 — legacy stack still deployable, dump access confirmed

Rollback depends on the legacy stack being warm (#159). Confirm a legacy deploy is
possible **without executing one from an old commit**: the legacy repo's history holds a
live malware sample at `40fc19a` — building any checkout from before the removal commit
`81363af` (2026-07-29) executes it. Deploy only from the retired repo's current HEAD.
[VERIFIED 2026-09-02: `docs/security/rotation-inventory.md:21` names the window
`40fc19a` → `81363af` (2026-07-29), and lines 413-414 confirm the sample is still reachable
by SHA in that repository's history. `gh repo list TIMSInternational` shows `climate-project`
still present and **not archived**, so the hazard is live, not historical.]

~~Confirm also read access to the production MongoDB (the ETL's source).~~ **VOID** — there
is no ETL and no dump. [VERIFIED 2026-09-02: A2 above.]

- Legacy deployable from safe HEAD: `____` [CANNOT VERIFY FROM HERE: the legacy repo is not
  checked out and its hosting is Vercel/Coolify console state.] ~~Mongo dump access~~: void

### C8 — communications

Maintenance window announced; maintenance page ready (#141, per #162's scope).

- Done: `____` [UPDATED 2026-09-04: **the page now exists.** `web/public/maintenance.html`,
  merged as #430 — static, no JavaScript, no API call, served by Vercel from `public/`, so it
  does not need the application it covers for. `GET /maintenance.html` → 200 observed on the
  Vercel preview. The keep/drop decisions #141 asked for are recorded in
  `docs/decisions/operational-pages.md`. What is still `____` is the human half: announcing
  the window and deciding, per the amendment above (there is no freeze and no flip), whether
  a maintenance window is the right shape at all.]

### C9 — go/no-go

#162: **explicit human authorisation, recorded, on the day.** Named decision owner:
`____`. Rollback trigger table in `rollback.md` filled in and agreed: `____`.
[VERIFIED 2026-09-02: #162's acceptance criteria still require this — "Explicit human
go-ahead recorded on the day", and its Why says "Nothing here should be executed
autonomously." This is the one gate that no amount of measurement can close.]

- GO recorded at: `____` by: `____`

---

## Phase D — the window (sequence from #162)

Each step names its evidence. [STALE — was: "The Duration column is the whole point of the
dry run: the sum of D1–D8 is the maintenance window, and #157 exists to find out whether that
window is viable at all." Now: **#157 is CLOSED as `NOT_PLANNED` (2026-08-19)**, so no dry run
will ever fill this column, and the ETL that dominated the estimate no longer exists. The
durations below stay as fields to fill on the day, not as predictions to be measured
beforehand.]

| # | Step | Evidence of success | Status 2026-09-02 | If it fails |
|---|---|---|---|---|
| D1 | Freeze legacy writes (mechanism: `____` — legacy maintenance mode / Vercel env flip) | Legacy app rejects writes; a test write fails | [CANNOT VERIFY FROM HERE: legacy Vercel/Coolify console.] Ask first whether it is needed: with no data migration, freezing legacy writes protects nothing that is being copied. Its only remaining purpose is to stop two stacks accepting real user input at once. | Unfreeze; abort — nothing has changed yet |
| D2 | ~~Final ETL run against production Mongo → production Postgres~~ | — | **VOID** [VERIFIED 2026-09-02: A2 — no ETL in the tree, `#154` dropped, `#157` closed NOT_PLANNED.] | — |
| D3 | ~~Reconciliation: per-collection counts, content spot-checks, FK integrity~~ | — | **VOID** — same reason. | — |
| D4 | Identity continuity (#155): take ≥ 1 real `PlanDeAccion` from the tracking database and prove it resolves to the correct user and department via `/api/internal/personas` + `/api/internal/nodos` | Record resolves; orphan count = 0 | **Cannot be run today, and not because of #155.** [VERIFIED 2026-09-02: `#155` is CLOSED; `src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs` exists (22 869 bytes). But there is **no tracking database in production** to take a `PlanDeAccion` from — see C5/P10.] [CANNOT VERIFY FROM HERE: calling `/api/internal/*` needs the production `InternalApiKey`.] | Abort — this failure is silent (see C3) |
| D5 | Pre-flip smoke test: log in as each role, open every major page, run a report, view tracking dashboards | Checklist of pages/roles all pass | **Partly done today, by the orchestrator, not by this lane.** All five seeded role accounts log in; every self-service endpoint answers 200; an employee gets 403 on admin routes. The **tracking dashboards** part cannot pass — there is no tracking deployment (P10). The role/route surface itself is defined by `web/src/navigation/roleCapabilities.ts` and `navSections.ts` and is test-covered. | Abort |
| D6 | ~~**Flip DNS** to the new stack~~ | `dig` from two public resolvers returns new targets | **ALREADY DONE for the web; NOT APPLICABLE for the API.** [VERIFIED 2026-09-02: `climate.timsint.com` resolves to `76.76.21.21` from both `8.8.8.8` and `1.1.1.1` and serves the new app's title; the API has no custom domain, so there is no API record to flip.] The step that was the centre of this runbook is no longer a step. **But the layer that IS cut over needs its reversal written down, and this runbook never named it.** The web reverse is a Vercel alias promotion, not a DNS edit, and the identifiers are: Vercel project **`climate`**, scope/team **`federicos-projects-21f2ff63`** (both at `README.md:75`), canonical alias **`climate.timsint.com`** (`rollback.md:57`, "Web canonical URL"; note `README.md:75` itself still names `web-one-green-86.vercel.app` and is stale — foot item 5). The procedure is `rollback.md` **§3.1 "Web — Vercel, seconds, no rebuild", lines 107-135** — `vercel list climate --prod` to pick the build, then `vercel rollback https://climate-<id>-federicos-projects-21f2ff63.vercel.app --scope federicos-projects-21f2ff63 -y`, confirmed with `vercel rollback status climate --scope federicos-projects-21f2ff63`. [VERIFIED 2026-09-02: identifiers read at `README.md:75`; the commands and their line range read at `docs/runbooks/rollback.md:107-135`, which also records ~20 retained production deployments over 5 days and that `vercel rollback` was confirmed present in CLI 50.22.1 on 2026-08-24 — but that **a rollback actually succeeds has never been tested** (`rollback.md:135`).] Note `rollback.md` §9 H8 (`rollback.md:652`): the web auto-deploys on every merge to main, so a web rollback that a later merge silently undoes is not a rollback — and what to do about that during an incident is recorded there as an **unmade human decision**, not as a step. Settle it before the window. | — (see `rollback.md`, "point of no return"); to reverse the web layer, `rollback.md` §3.1 |
| D7 | Update `services/tracking-api` config: `ClimateProjectBaseUrl` → new API domain, `ProcomerCompanyId` → the migrated company GUID; redeploy the tracking service | Tracking dashboards populate | **IMPOSSIBLE AS WRITTEN.** [VERIFIED 2026-09-02: zero `tracking` stacks in the PROD account; `deploy-tracking-prod.yml` has one lifetime run and it **failed** on 2026-08-27. There is no service to reconfigure or redeploy.] The prerequisite step this runbook is now missing: **provision the tracking service first** — see [`tracking-service-provisioning.md`](./tracking-service-provisioning.md), which exists precisely for this and is the document to follow before D7 means anything. Added here because a verified fact makes D7 unexecutable without it. | Tracking degrades but the platform serves |
| D8 | Post-flip smoke: `curl https://<domain>/version` (commit check), 20× `/ready`, login through the real domain (exercises CORS per B4 and OAuth origins per B5) | All green | [VERIFIED 2026-09-02 for the API half: `/version` returns `b371a9d…` HTTP 200 in 0.26 s; 20/20 `/ready` probes returned 200; the CORS preflight from `https://climate.timsint.com` returns that exact origin.] [CANNOT VERIFY FROM HERE: a real browser login through `climate.timsint.com`, which is what actually exercises B5's Google origins.] [STALE — was: `curl https://<custom-domain>/version`; now: there is no API custom domain — use `https://bhgrdkd4gt.us-east-1.awsapprunner.com/version`.] | Evaluate against rollback triggers |
| D9 | Watch period, someone actually watching, rollback criteria live (#162) | No trigger met for its full length | See the cadence warning below. **"Someone actually watching" is literal today** — no CloudWatch alarm exists (P3) and the one prober's posting steps are guarded on a secret whose existence cannot be verified from here (P13), so the alert is a browser tab a named human is refreshing. | Execute `rollback.md` — **but read this before you dispatch it: `rollback-prod.yml` has 0 lifetime runs (P2), so the first execution of the API rollback will be happening live, under pressure, untested.** The workflow says so in its own header (`rollback-prod.yml:4-5`: "It is new (#159) and has never been run. Read docs/runbooks/rollback.md before the first dispatch."). Read `rollback.md` §3.2 (API) and §5 (triggers) **before** the window opens, not during it, and expect the health-check warm-up of C2 to make a correct rollback look like a failing one for about a minute. The web layer at least has its commands written out and its CLI confirmed present, but it too has never been executed against this project (`rollback.md:135`) — see D6. |

**Do not size the watch period from the synthetic probe's declared schedule.**
`.github/workflows/ops-synthetic-probe.yml` declares `cron: "*/15 * * * *"`, and its own
header is honest that GitHub delays scheduled runs — but on *this* repository the delay is
not "several minutes and occasionally tens of them", it is **hours**. Observed consecutive
run starts: `2026-09-01T20:33:44Z`, `22:49:26Z`, `2026-09-02T00:48:44Z`, `05:26:15Z`,
`09:49:12Z`, `14:04:39Z`, `17:53:50Z` — gaps of **2h 16m, 1h 59m, 4h 37m, 4h 23m, 4h 15m,
3h 49m**. So "wait for the probe to confirm" means **hours, not fifteen minutes** — and do not
take 4h 37m as the ceiling: `alerting.md`'s longer sample (lines **465-468**, over 2 days
19 hours) measures min 1h 59m, **max 8h 00m**, mean 4h 13m, median 4h 19m, and only 17 of the
271 runs the cron declares. [STALE — was: "lines 463-470"; now: **465-468**. Line 463 is the
last row of the gap table and 464 is blank; the measured-cadence bullets are 465-468. The
substance was right, the citation was off by two at both ends, and in this document the
citation *is* the evidence.] `deploy-drift.yml` behaves the same way: it declares 13:00 UTC
daily and its last four runs started at 17:01, 17:11, 19:24 and 17:13 UTC.

**And do not read a green Actions tab off `deploy-drift.yml` — three of those last four runs
failed.** [VERIFIED 2026-09-02: `gh run list --workflow=deploy-drift.yml --limit 6` →
`2026-09-02T17:01:46Z success`, `2026-09-01T17:11:24Z **failure**`,
`2026-08-31T19:24:45Z **failure**`, `2026-08-30T17:13:28Z **failure**`,
`2026-08-29T17:00:48Z **failure**`, `2026-08-28T22:54:37Z **failure**` — five failures in the
last six. The failing job is "Compare live /version against main", and its error on run
`33536298102` reads "Production is 29 commits behind main (threshold 20). Dispatch
deploy-prod.yml, or raise the threshold deliberately if this is the intended release
cadence."] That is the workflow **working** — it was detecting a real drift that today's
deploy of `b371a9d` cleared — but it means two things for the night: the drift alarm is a
gauge that has been red for most of a week, so its going red again is easy to miss; and
`alerting.md:24`'s claim that this workflow "has passed every day since 2026-08-16" is false
(see the foot of this file).

If the watch period needs a confirmation sooner than that, dispatch the probe manually
(`workflow_dispatch` is declared on it) rather than waiting on the schedule.
[VERIFIED 2026-09-02: `gh run list --workflow=ops-synthetic-probe.yml` and
`--workflow=deploy-drift.yml`, timestamps and conclusions as quoted; cron declarations read
from the workflow files.]

And do not treat a red probe during a rollout as a trigger — re-read C2's health-check
caveat first.

**Total window (D1–D8): `____`** [STALE — was: "(dry-run measured; decide from this whether
an offline window is even acceptable — #157's stated purpose)". #157 is closed NOT_PLANNED and
D2/D3/D6 are void or already done, so the window this field was built to size no longer
exists in the shape it was written for.]

## Phase E — after the window

- **Decommission nothing.** #162 is explicit: the legacy stack stays intact and
  deployable; retirement is M8 (#164–#167), gated on weeks of legacy access-log evidence
  (#163). See `legacy-dependencies.md`.
  [VERIFIED 2026-09-02: `gh issue view` — #163, #164, #165, #166, #167 are **all OPEN**, and
  `climate-project` / `climate-tracking` are both still present and unarchived on GitHub. The
  legacy Vercel deployment still answers `200`. Nothing has been decommissioned, which is the
  correct state.]
- ~~Write every measured duration from this run back into this document — that is #157's
  final acceptance criterion~~ [STALE — #157 is closed NOT_PLANNED; there is no dry run whose
  timings feed this.] **What still holds:** write the durations *this* run measures back into
  this document, and re-date the tags. A runbook whose tags are three weeks old is the
  document this one had become.

---

## Dry-run record

[STALE — was: "(#157 requires two consecutive clean runs)". #157 is **CLOSED, NOT_PLANNED,
2026-08-19T15:44:29Z**, and every column below (Mongo snapshot, ETL duration, reconciliation)
describes work that no longer exists. The table is void and is kept only so a reader who
remembers it being here does not go looking for a version where it was filled in.]

| | Run 1 | Run 2 | (Run n) |
|---|---|---|---|
| Date | VOID | VOID | |
| ~~Snapshot used (Mongo dump date)~~ | VOID | VOID | |
| ~~ETL duration (D2)~~ | VOID | VOID | |
| ~~Reconciliation clean?~~ | VOID | VOID | |
| Rollback practised (per `rollback.md`)? | **never — 0 lifetime runs on both rollback workflows** | | |
| Total window (D1–D8) | VOID | VOID | |

The one row above that is not void — rollback rehearsal — has moved to `rollback.md` §8,
which carries the real rehearsal table and is where a rehearsal should be recorded.

---

## Errors found in neighbouring documents (not edited by this pass)

This lane owns only `cutover.md`. These were measured today and are wrong where they live:

1. **`infra/aws/README.md:58`** — states "Only step 3 of 'Arming the guard' is outstanding:
   `Database__RequireSessionPooler` is still `"false"`". It is **`"true"`**
   (`infra/aws/climate-project-api-prod-service.yml:230-231`), and the root `README.md`
   already says so ("the flag is armed (`true`) in prod as of 2026-08-17"). Two documents in
   this repo give opposite answers about a startup-failure guard.
2. **`docs/runbooks/legacy-dependencies.md:40` (row 5)** — cites the new frontend as
   `organizational-climate-platform.vercel.app` per `README.md:75`. Both halves are stale:
   the frontend is `climate.timsint.com`, and `README.md:75` no longer says that.
3. **`docs/runbooks/legacy-dependencies.md:43` (row 8)** — states the new stack's prod mail is
   "the logging stub" and cites `Program.cs:348` / "factory ~360–366". Mail is configured
   (SES, `Email__*` at template lines 265-305) and the line numbers are now 367 / 378, 394, 418.
4. **`docs/runbooks/legacy-dependencies.md:44` (row 9)** — "DNS — … **appears nowhere in
   either repo**". `climate.timsint.com` is in
   `infra/aws/climate-project-api-prod-service.yml:280`, and the zone is at Namecheap
   (`dns1`/`dns2.registrar-servers.com`), measurable with `dig`.
5. **`README.md:75`** — names the production frontend as `web-one-green-86.vercel.app`, and
   the string `climate.timsint.com` **appears nowhere in `README.md`** (`grep -n` → no match).
   The live customer-facing frontend is `https://climate.timsint.com` (HTTP 200,
   `<title>Organizational Climate Platform</title>`). The same bullet's "⚠️ Known break …
   the production API's CORS allowlist still names the OLD url" is also resolved — the
   allowlist now returns `access-control-allow-origin: https://climate.timsint.com` and
   returns no such header for the old origin.
6. **`docs/runbooks/rollback.md`** — no factual error found in the sections read (§1, §3, §8.1,
   §4). Its §8.1 health-check caveat is correct and is quoted above. Its rehearsal table is
   still empty, which is a fact about the world, not an error in the document.
7. **`docs/runbooks/alerting.md:26`** — its "Verified today" table asserts "**Mail is not
   configured in production** | `infra/aws/climate-project-api-prod-service.yml` contains zero
   `Email__` variables". The template now contains **eight** `Email__` variables (lines
   265-294) plus two `Email__*` runtime secrets (302-305). Two further rows in that table are
   snapshot-stale (`Production runs fc53936` — it runs `b371a9d`; `Production is 23 commits
   behind main`), and the section is headed "Verified today" with **no date**, which is what
   let it age silently. Its §"Declared interval" analysis (lines **465-468**: measured min
   1h59m, max 8h00m, mean 4h13m, median 4h19m against a declared 15 minutes, and 17 of 271
   declared runs) is **current and correct**, and independently corroborates the D9 cadence
   warning above. [STALE — this file previously cited that analysis as "lines 463-478" here
   and "463-470" at D9. Measured with `sed -n '460,480p' docs/runbooks/alerting.md`: 463 is
   the last row of the gap table, 464 is blank, and the measured-cadence bullets are
   **465-468**. Corrected in both places.] Its line 99 ("`services/tracking-api` is
   entirely unmonitored because it is entirely undeployed") corroborates P10.
8. **`docs/runbooks/alerting.md:24`** — a fourth stale row in that same undated table, and the
   only one that is operationally live rather than cosmetic: "`deploy-drift.yml` runs daily and
   has **passed every day** since 2026-08-16". It has not. Measured 2026-09-02,
   `gh run list --workflow=deploy-drift.yml --limit 6`: `2026-09-02T17:01:46Z` success,
   `2026-09-01T17:11:24Z` **failure**, `2026-08-31T19:24:45Z` **failure**,
   `2026-08-30T17:13:28Z` **failure**, `2026-08-29T17:00:48Z` **failure**,
   `2026-08-28T22:54:37Z` **failure** — five of the last six failed. The failing job is
   "Compare live /version against main" and the error on run `33536298102` is "Production is 29
   commits behind main (threshold 20)". This matters here twice over, which is why it is also
   called out at D9: this runbook quotes deploy-drift's *start times* from the very listing that
   shows the failures, and C1's drift argument leans on the workflow as the thing that catches a
   production/main divergence. The workflow did catch it — today's deploy of `b371a9d` is what
   cleared it — but a document telling an operator it "has passed every day" invites them to read
   a red run as new when it is a week old, or to skip the listing entirely.
