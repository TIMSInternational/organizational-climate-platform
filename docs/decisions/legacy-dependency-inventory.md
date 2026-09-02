# Legacy-stack dependency inventory — #163

Everything in this repository that points at, depends on, or is a consumer of the **legacy
stack**, with the evidence that each has a live equivalent in the new stack or is explicitly
lost. Compiled 2026-09-02 against `main` at `b371a9d`.

#163's acceptance criteria are four. This document delivers **1** (inventory complete),
**3** (every cron confirmed replaced and running) and the *identified* half of **4** (every
remaining consumer named, and each one migrated or accepted as lost). Criterion **2**
(legacy access logs reviewed post-cutover) cannot be met from a repository at all and is
listed under [Cannot be verified here](#cannot-be-verified-from-this-repository).

**Baseline, and one caveat about it.** Every line number below is against `main` at
`b371a9d`. Three files were being rewritten in the working tree while this was compiled
(`git status --porcelain` → ` M .github/workflows/ops-synthetic-probe.yml`,
` M docs/runbooks/cutover.md`, `?? infra/aws/climate-project-synthetic-probe.yml`). If this
document is read alongside those changes:

- every `ops-synthetic-probe.yml` citation here is **+30 lines** in the working tree (a
  30-line header was prepended): cron `:35`→`:65`, `API_BASE_URL` `:47`→`:77`,
  `secrets.TEAMS_WEBHOOK_URL` `:68,113`→`:98,143`, the `env.WEBHOOK != ''` guards
  `:71,182`→`:101,212`;
- `docs/runbooks/cutover.md` is rewritten wholesale (`git diff --stat HEAD` → +619/−158), so
  every reference to it below names the **step id** (B1, B5, …), which survives a renumber,
  as well as the `b371a9d` line;
- `infra/aws/climate-project-synthetic-probe.yml` is new and is a **third scheduler**:
  `:421` `Type: AWS::Events::Rule`, `:427`
  `ScheduleExpression: !Sub rate(${ProbeIntervalMinutes} minutes)`. Undeployed — prod holds
  exactly two CloudFormation stacks and neither is it — but the scheduler count in (b) is
  two-at-baseline, three-in-tree.

## Status vocabulary

| Status | Meaning |
|---|---|
| **REPLACED by X** | The legacy behaviour has a named, in-repo successor, and the successor is deployed. |
| **STILL LEGACY** | A live reference in this repo still names the legacy stack. Must be changed. |
| **LOST-ACCEPTED** | Deliberately not carried across. A decision record says so. |
| **NEW-STACK-ONLY** | Never existed in the legacy stack; listed because a sweep reaches it. |
| **UNKNOWN** | Depends on console state no repository can see. |

## Two corrections before the tables

Both prior descriptions of the legacy stack are wrong in a way that changes what cutover
must do.

**1. The legacy Next.js app did not run on Vercel. It ran on Coolify.**
`docs/security/2026-08-15-exfiltration-audit.md:44-48` records the measurement from the
legacy repo's own HEAD: `deploy.sh` line 3 reads `# Deployment script for Coolify`, and
`.vercel/project.json` is **absent** (GitHub API 404). `docs/security/rotation-inventory.md:86`
carries the same correction — *"the legacy app never deployed on any Vercel scope this
account can reach"*, on an 882-deployment history and 8,700-event activity feed pulled to
exhaustion. `https://organizational-climate-platform.vercel.app` is therefore **not** the
legacy production app; it is an unrelated stale Vercel deployment that still answers 200
(`README.md:77`). The legacy production host is a **Coolify instance whose address appears
nowhere in this repository**. Anyone hunting for "the legacy stack" at a `vercel.app`
address is looking at the wrong machine.

**2. The CORS break `README.md:79` calls open is closed.** Measured today:

```
$ curl -s -o /dev/null -D - -H "Origin: https://climate.timsint.com" \
    https://bhgrdkd4gt.us-east-1.awsapprunner.com/version | grep -i 'HTTP/\|allow-origin'
HTTP/1.1 200 OK
access-control-allow-origin: https://climate.timsint.com

$ ... -H "Origin: https://organizational-climate-platform.vercel.app" ...
HTTP/1.1 200 OK            # no access-control-allow-origin header

$ ... -H "Origin: https://web-one-green-86.vercel.app" ...
HTTP/1.1 200 OK            # no access-control-allow-origin header
```

The production API allowlists the canonical domain and **no legacy origin**. Corroborated
by `gh variable list --env production` → `CORS_ALLOWED_ORIGIN = https://climate.timsint.com`
(set 2026-08-19).

---

## (a) Hostnames

Every host reachable by grepping `src`, `web`, `services`, `infra`, `.github`, `scripts`,
`docs` for `vercel.app`, `awsapprunner.com`, `timsint.com`, `mongodb`, `atlas`, and by
enumerating every `https?://` literal in live code. `node_modules`, `.git`, `bin/`, `obj/`,
`TestResults/` and `.claude/worktrees/` excluded.

| Item | Stack | Evidence | Status |
|---|---|---|---|
| `https://bhgrdkd4gt.us-east-1.awsapprunner.com` — production API | new | `/version` → `{"commit":"b371a9d…","builtAt":"2026-09-02T18:04:34Z"}`, HTTP 200 | correct post-cutover; a generated hostname, retired by #160 |
| Same host in the frontend CSP `connect-src` | new | `web/vercel.json:32` (`Content-Security-Policy-Report-Only`) | correct today; **must change with #160** — report-only, so it will fail silently when enforced |
| Same host as the tracking service's upstream | new | `infra/aws/climate-tracking-api-prod-service.yml:216`; `gh variable list --env production` → `CLIMATE_PROJECT_BASE_URL = https://bhgrdkd4gt.us-east-1.awsapprunner.com` (2026-08-31) | correct **today**, wrong the moment #160 lands — it is a live production variable pinned to the retiring hostname. On the cutover checklist, item 3 |
| Same host as the probe/drift default | new | `.github/workflows/ops-synthetic-probe.yml:47`, `.github/workflows/deploy-drift.yml:38` — both `${{ vars.PROD_API_BASE_URL \|\| '…awsapprunner.com' }}`; `PROD_API_BASE_URL` is **not** set (`gh variable list`), so the literal is live | correct today; overridable without a code change |
| `https://climate.timsint.com` — canonical web app | new | `infra/aws/climate-project-api-prod-service.yml:281` (`Email__AppBaseUrl`); `gh variable list --env production` → `CORS_ALLOWED_ORIGIN`, `TRACKING_CORS_ALLOWED_ORIGIN` | correct **only if #160 keeps this hostname resolving**; if it replaces it, all three values and every link already in circulation move together. Checklist items 2, 3 and 9 |
| `organizational-climate-platform.vercel.app` | **neither** | `README.md:77` — answers 200 but serves `<title>web</title>`, the Vite default this repo replaced 2026-08-07 in `d905c02`; bundle lacks a string added 2026-08-17 | **STILL LEGACY** in docs only; no live reference. See correction 1 — it is *not* the legacy app |
| `web-one-green-86.vercel.app` | new (stale) | `README.md:75`, `docs/runbooks/staging-provisioning.md:17`, `docs/security/rotation-runbook.md:66` name it as *the* production frontend | **STILL LEGACY** as guidance: it is a Vercel-generated name, no longer the canonical URL, and gets no CORS header (measured above) |
| `https://climate-*-federicos-projects-21f2ff63.vercel.app` — preview wildcard | new | `gh variable list --env production` → `CORS_ALLOWED_WILDCARD_ORIGIN`; `infra/aws/climate-project-api-prod-service.yml:205-210` | correct; scopes previews to this team, not to all of `vercel.app` |
| `https://*.vercel.app` | — | `tests/ClimateProject.UnitTests/Cors/CorsOriginMatcherTests.cs:116-125` documents the hazard: it admits `https://evil.vercel.app` | test fixture only, never a configured value |
| MongoDB / Atlas | legacy | **No driver, no connection string, no host anywhere in this repo.** `docs/security/rotation-inventory.md:390`: "No MongoDB driver or connection string exists in this repo." Every remaining hit is prose or a test identifier (`legacy-mongo-id-…`, `tests/…/IdentityMappingClaimsTests.cs:69`) | **LOST-ACCEPTED** — `docs/decisions/no-data-migration.md:9`: "The legacy MongoDB data is not migrated. It is abandoned." |
| `https://conocete.timsint.com/` | third-party (TIMS marketing site) | `web/src/styles/storefront.css:5`, `web/src/components/storefront/StorefrontPrimitives.tsx:4` — both are `Ported from …` comments | comment only; nothing fetches it |
| `fonts.googleapis.com` | — | single occurrence, `web/scripts/shot-harness.test.mjs:243`, a fixture asserting the classifier calls it `external`. Fonts ship as `@fontsource/*` npm packages (`web/package.json`) | no runtime font CDN |
| Coolify (legacy production host) | legacy | `docs/security/2026-08-15-exfiltration-audit.md:44` — `deploy.sh` line 3; `:45` — only 2 of 1,041 files mention it; `:48` — `.vercel/project.json` absent | **UNKNOWN** — address exists in no repository |

## (b) Crons and schedules

Every legacy scheduled behaviour, and the successor that runs it now.

**The "runs nowhere" caveat in `docs/runbooks/legacy-dependencies.md:23-30` is obsolete.**
That document (2026-08-15, at `1219dc6`) states the workers "exist in code and **run
nowhere**", because the API had no project reference to them. It does now:
`src/ClimateProject.Api/ClimateProject.Api.csproj:14` references
`ClimateProject.Workers`, and `src/ClimateProject.Api/Program.cs:406` calls
`AddClimateProjectScheduling(builder.Configuration)`. The comment at
`ClimateProject.Api.csproj:6-13` records the decision (#275). Verbatim, `:7-9`:
*"Co-hosting (#275): the API process is the scheduler. Program.cs calls
AddClimateProjectScheduling, so the **six** jobs and the heartbeat monitor deploy with the
API image `deploy-prod.yml` already builds"*. The API is deployed at `b371a9d`
(`/version`, 200), so the schedule is deployed.

**That comment's count is stale, and only the comment.** The registration is eight
`AddHostedService` calls — `src/ClimateProject.Workers/SchedulingServiceCollectionExtensions.cs:81-88`
(`NotificationDispatchWorker`, `InvitationReminderWorker`, `DigestWorker`,
`ScheduledReportWorker`, `SurveyDraftRetentionWorker`, `RetentionCleanupWorker`,
`SurveyLifecycleWorker`, `MicroclimateLifecycleWorker`) — plus `WorkerHeartbeatMonitor` at
`:89`. Behaviour is right; the sentence a reader trusts is two jobs short.

**No `Scheduling__Enabled` is set anywhere** — not in
`infra/aws/climate-project-api-prod-service.yml`, not in `.github/workflows/`, not in
`src/ClimateProject.Api/appsettings.json` — so the default applies:
`WorkerSchedulingOptions.cs:55`, `Enabled = true`.

**There is a second in-process scheduler, in `services/tracking-api`.** The paragraph above
sweeps `src/` only, which is how it gets missed.
`services/tracking-api/src/ClimateTracking.Api/Program.cs:58-60` says it outright — *"ONE
PROCESS, TWO JOBS (#219). This host IS the scheduler: CacheSyncWorker and
DailySemaforoWorker run inside the API image"* — and `:76` calls
`AddClimateTrackingWorkers(builder.Configuration)`, reachable because
`ClimateTracking.Api.csproj:17` references `ClimateTracking.Workers`. Two consequences the
`src/`-only sweep cannot see:

- **Its own master switch.** `Workers:Enabled`
  (`ClimateTracking.Workers/WorkerServiceCollectionExtensions.cs:16` `SectionName = "Workers"`,
  `:24` `Enabled { get; set; } = true`; resolved inside the hosted-service factories at
  `:77` and `:84`). **No `Workers__Enabled` is set anywhere** — zero hits across `infra/`,
  `.github/` and both tracking `appsettings.json`. Production sets nothing, so the day the
  tracking service deploys, both jobs tick.
- **Its own interval key.** `CacheSyncIntervalMinutes`, read from the configuration **root**
  and deliberately not from the `Workers` section
  (`WorkerServiceCollectionExtensions.cs:66-69`, default 15). Shipped 15
  (`ClimateTracking.Workers/appsettings.json:13`), templated at
  `infra/aws/climate-tracking-api-prod-service.yml:250,413-414`, passed as `"15"` by
  `.github/workflows/deploy-tracking-prod.yml:616`.

| Legacy behaviour | Stack | Evidence | Status |
|---|---|---|---|
| Vercel cron `/api/cron/send-reminders`, `*/15 * * * *` — the **only** entry in the legacy `vercel.json` | legacy | `docs/security/2026-08-15-exfiltration-audit.md:47`: legacy `vercel.json` "contains **only** a `crons` array (one entry, `/api/cron/send-reminders`)" | **REPLACED by** `invitation-reminders` — `WorkerJobs.cs:26` names the route it replaces; `Jobs.cs:72` `InvitationReminderWorker`; interval 15 min, `WorkerSchedulingOptions.cs:59`, deliberately identical (`:18-21`) so cutover changes no observable behaviour |
| Legacy route `/api/cron/process-reminders` — a route, not in `vercel.json`'s crons | legacy | prior inventory row 2, `docs/runbooks/legacy-dependencies.md:37` | **REPLACED by** `notification-dispatch` — `WorkerJobs.cs:16-19` names it; `Jobs.cs:28`; 1 min, `WorkerSchedulingOptions.cs:57`. *Who called the legacy route, if anyone, is still UNKNOWN* — but the behaviour is covered either way |
| Legacy route `/api/cron/scheduled-reports` | legacy | prior inventory row 3 | **REPLACED by** `scheduled-reports` — `WorkerJobs.cs:35-39`; `Jobs.cs:151`; 5 min, `WorkerSchedulingOptions.cs:63` |
| Legacy route `/api/gdpr/retention-cleanup` — GDPR storage-limitation sweep | legacy | prior inventory row 4 | **REPLACED by** `retention-cleanup` — `WorkerJobs.cs:48-54`; `Jobs.cs:274`; daily, `WorkerSchedulingOptions.cs:72` |
| — | new | `WorkerJobs.cs:32` `digests`, `:46` `survey-draft-retention`, `:62` `survey-lifecycle`, `:72` `microclimate-lifecycle`. `WorkerJobs.cs:57-60` states `survey-lifecycle` "replaces no legacy cron: nothing anywhere ever did this" | **NEW-STACK-ONLY** — 8 jobs total, `WorkerJobs.All:74-84` |
| — | new (tracking) | `cache-sync`, every 15 min. `LeasedScheduledWorker.cs:12-15` `public static class TrackingJobs` / `CacheSync = "cache-sync"`; `CacheSyncWorker.cs:31` `syncInterval ?? TimeSpan.FromMinutes(15)`. Fills the `*_cache` tables; an empty cache renders every nodo and persona **name** blank in the plans list and the `.xlsx` export (`WorkerServiceCollectionExtensions.cs:32-35`) | **NEW-STACK-ONLY**, and **not ticking**: the tracking service is not deployed (see (d)) |
| — | new (tracking) | `daily-semaforo`, every 24 h. `DailySemaforoWorker.cs:30` `LeasedScheduledWorker(TrackingJobs.DailySemaforo, TimeSpan.FromHours(24), …)`. Recomputes plan semáforos and sends **30-day / 15-day / vencimiento notifications to each action plan's `LiderExternalId`, `ResponsableEjecucionExternalId` and `InvolucradosExternalIds`** (`:141-152`) by calling the main API's `POST /api/internal/send-notification` (`:171`) | **NEW-STACK-ONLY**, not ticking. Switching the tracking service on switches outbound mail to the client's action-plan owners on with it — there is no separate mail flag |
| GitHub Actions cron `*/15 * * * *` — synthetic probe | new | `.github/workflows/ops-synthetic-probe.yml:35` | live. **Declared cadence is not delivered cadence**: observed runs are 2–4.5 h apart (GitHub delays scheduled workflows on this repo). Anything that must be prompt cannot live here |
| GitHub Actions cron `0 13 * * *` — deploy drift | new | `.github/workflows/deploy-drift.yml:27` | live, same caveat: observed landings are 17:00–22:54 UTC against a declared 13:00 |
| Vercel crons on the **new** frontend | new | `web/vercel.json` has no `crons` key (46 lines, read in full) | none exist, by design — the new stack schedules nothing in Vercel |

**Scheduler count at `b371a9d`:** two scheduled GitHub workflows
(`grep -n 'cron:' .github/workflows/*.yml` → `ops-synthetic-probe.yml:35`,
`deploy-drift.yml:27`) and **two** in-process schedulers holding **ten** jobs — eight in
climate-project (`SchedulingServiceCollectionExtensions.cs:81-88`, deployed and ticking) and
two in the tracking service (`WorkerServiceCollectionExtensions.cs:77,84`, deployed nowhere).
A **third** scheduler exists in the working tree but not at this baseline: the EventBridge
`rate()` rule in the new `infra/aws/climate-project-synthetic-probe.yml:421,427` (see the
baseline caveat at the top).

## (c) Third-party integrations

| Integration | Stack | Config that names it | Breaks at cutover? |
|---|---|---|---|
| **Amazon SES** (outbound mail) | new | `infra/aws/climate-project-api-prod-service.yml:265-294`: `Email__Provider=smtp`, host `email-smtp.us-east-1.amazonaws.com`, `Email__FromAddress=no-reply@timsint.com`, `Email__SesConfigurationSet=tims-transactional`; credentials via `EMAIL_SMTP_USERNAME_SECRET_ARN` / `EMAIL_SMTP_PASSWORD_SECRET_ARN` (`gh variable list --env production`, set 2026-08-26) | No. **`Email__AppBaseUrl` (`:281`) is `https://climate.timsint.com`** — every invitation and share link in mail is built from it (`EmailOptions.cs:214-221`). Change it in the same deploy as any domain change or mail will point at the old host. **Shared blast radius:** `…prod-service.yml:282-294` records that this SES account is shared with `tims-marketing`, `formmaps`, `pca`, `alto` and `tims-suite`, and SES scores bounce and complaint rate against the **account** — *"a bad enough day pauses sending for all six"*. A cutover-day blast to a stale recipient list is therefore a shared-fate dependency on five products outside this repo. `Email__SesConfigurationSet=tims-transactional` makes this product's sends separately **measurable**; it does not isolate the reputation |
| **Brevo SMTP** (legacy mail) | legacy | Zero hits for `brevo` in `src`, `web/src`, `services`, `infra`, `.github`. Named only in `docs/security/rotation-inventory.md:211` as a legacy credential to rotate | **REPLACED by** SES. Row 8 of the prior inventory (`legacy-dependencies.md:43`) said prod had no `Email__*` variables; that is now false — the template carries all of them |
| **Google OAuth** | both | New stack: `web/src/auth/googleOAuth.ts:89` reads `VITE_GOOGLE_CLIENT_ID`, redirects to `https://accounts.google.com/o/oauth2/v2/auth` and back to `<origin>/auth/loading` (`:130`); server verifies against `GoogleClientId` only (`Program.cs:202`) — **no client secret**. Legacy used NextAuth (`rotation-inventory.md:201`) | **Yes, if the origin changes.** The redirect URI is derived from `window.location.origin`, so the Google client's authorized origins/redirect URIs must already contain the final domain. `docs/runbooks/cutover.md` carries this as **step B5** — line **153** at `b371a9d`
(`git show HEAD:docs/runbooks/cutover.md | sed -n '153p'`); `:150` is step B2, lowering DNS
TTLs. The file is rewritten in the working tree, so quote the step id, not the line. **UNKNOWN** whether legacy and new share one OAuth client — Google Cloud console |
| **Supabase** (Postgres) | new | `gh variable list --env production` → `DATABASE_CONNECTION_STRING_SECRET_ARN` (`…/prod/database-connection-string-jgthiv`); `rotation-inventory.md:83` — project `organizational-climate-platform`, ref `uleeeziiceduvmiftgby`, created 2026-07-31 | No. Not a legacy dependency: the legacy DB was Mongo. Two legacy-format keys (`anon`, `service_role`) exist unused and should be disabled (`rotation-inventory.md:84-85`) |
| **Vercel** (frontend hosting) | new | `web/vercel.json`; `README.md:75` project `climate`, team `federicos-projects-21f2ff63` | No. The legacy app was never here (correction 1) |
| **AWS App Runner** | new | `infra/aws/climate-project-api-prod-service.yml`; stack `climate-project-api-prod` | No |
| **AWS Secrets Manager** | new | five ARNs at `infra/aws/climate-project-api-prod-service.yml:296-305`, IAM grant at `:162-173`; all five set as production variables | No |
| **Microsoft Teams webhook** | new | `.github/workflows/ops-synthetic-probe.yml:68,113` read `secrets.TEAMS_WEBHOOK_URL`; both alert steps are guarded `if: … env.WEBHOOK != ''` (`:71`, `:182`). `infra/aws/climate-project-observability.yml:29` parameter `TeamsWebhookUrl` | **Not configured.** `gh secret list` returns **empty** and `gh secret list --env production` shows only `MIGRATION_DATABASE_CONNECTION_STRING`. The probe runs and posts nothing. The observability stack has never been deployed. Placeholder: `<TEAMS_WEBHOOK_URL>` |
| Analytics / error tracking (Sentry, Datadog, GA, PostHog) | — | Zero hits across `src`, `web/src`, `services`, `infra`, `.github`, `scripts`. `web/package.json` dependencies are Radix, Recharts, react-router, date-fns, sonner, lucide, fontsource — no SDK | none exist |
| Slack / Teams *product* notifications | — | `Department.NotificationSlack` (`src/ClimateProject.Domain/Entities/Department.cs:25`) and the `notification_settings.email/slack/teams` shape (`User.cs:85`) are **columns carried from the legacy schema**. No transport reads them | **LOST-ACCEPTED** — a persisted preference with no sender, in both stacks |

## (d) The tracking service (`services/tracking-api`)

This service is not only a consumer of config values. It is **a second scheduler** (two jobs
— see (b)) and the repository's **only** cross-service HTTP client. Both facts are pinned to
hostnames #160 changes, so both belong on the cutover checklist and not only in this table.

| Config value | Stack | Evidence | Status |
|---|---|---|---|
| `ClimateProjectBaseUrl` | new | Ships empty (`services/tracking-api/src/ClimateTracking.Api/appsettings.json:14`, `.../ClimateTracking.Workers/appsettings.json:11`). Deploy-time value: `gh variable list --env production` → `CLIMATE_PROJECT_BASE_URL = https://bhgrdkd4gt.us-east-1.awsapprunner.com` (2026-08-31). Template `infra/aws/climate-tracking-api-prod-service.yml:216` requires it with no default: *"Point it at the API's OWN origin, not at the web app's"* | **points at the new API** — no legacy reference anywhere in the tracking service, but it is **not** "correct post-cutover": it names the App Runner hostname #160 retires, and it is the base address of the only cross-service HTTP client in the repo. Cutover checklist item 3 |
| `ClimateProjectInternalApiKey` | shared | `appsettings.json:15`; `infra/aws/climate-tracking-api-prod-service.yml:191`. `deploy-tracking-prod.yml` refuses to deploy unless this equals the live climate-project stack's `InternalApiKeySecretArn` (`infra/aws/climate-tracking-api-prod-service.yml:214`). Prod variable `INTERNAL_API_KEY_SECRET_ARN` = `…/prod/InternalApiKey-rILWWK` | correct; fails closed — stale key ⇒ per-request 401, absent ⇒ startup failure |
| `TrackingJwtSecret` | shared | `appsettings.json:12`; prod variable `TRACKING_JWT_SECRET_ARN` = `…/prod/tracking-jwt-secret-rtayFN`. Template `:150-162` requires the **same ARN** as climate-project's | correct |
| `ProcomerCompanyId` | new | `appsettings.json:13` empty; template `:227` pattern-constrained to a GUID. **`PROCOMER_COMPANY_ID` is not set** — absent from `gh variable list --env production` | **UNKNOWN** — a human decision, not a legacy pointer |
| `TRACKING_DATABASE_CONNECTION_STRING_SECRET_ARN` | new | Required by `deploy-tracking-prod.yml`; **not set** (`gh variable list --env production`) | blocked on the tracking DB existing |
| Outbound HTTP to the main API | new | `services/tracking-api/src/ClimateTracking.Infrastructure/ExternalApi/ServiceCollectionExtensions.cs:25` — `AddHttpClient<IClimateProjectClient, ClimateProjectClient>` with `client.BaseAddress = new Uri(options.BaseUrl)`. It is the **only** non-test `AddHttpClient`/`new HttpClient` in `src/` + `services/` (`grep -rn --include='*.cs' -E "AddHttpClient\|new HttpClient" src services` → one hit outside `ClimateProjectClientTests.cs`). Routes: `ClimateProjectClient.cs:30,37,44` GET `/api/internal/nodos`, `/personas`, `/ciclos-encuesta`; `:50,58` `/api/internal/hallazgos`; `:70` POST `/api/internal/send-notification`, which is what `DailySemaforoWorker.cs:171` calls | **the only cross-service consumer in the repository,** and its base address is `CLIMATE_PROJECT_BASE_URL` = the App Runner hostname #160 replaces. Not a legacy pointer — but it is a hostname change nobody deploying climate-project alone will remember |
| `Cors:AllowedOrigins` / `TRACKING_CORS_ALLOWED_ORIGIN` | new | `ClimateTracking.Api/appsettings.json:16-17` (`"Cors": { "AllowedOrigins": [] }`); prod variable `TRACKING_CORS_ALLOWED_ORIGIN = https://climate.timsint.com` (2026-08-31). **No wildcard counterpart**, unlike climate-project's: `infra/aws/climate-tracking-api-prod-service.yml:131-139` — `Program.cs` binds a plain string array and calls `policy.WithOrigins(allowedOrigins)`, with no `Cors:AllowedWildcardOrigins` and no pattern matcher | **must change with #160.** And it carries a standing operational instruction the same block states: a Vercel **preview** deployment can never call this service, so *"Keep that variable [`VITE_TRACKING_API_BASE_URL`] on Vercel's Production scope only until the tracking host grows wildcard support"* — which is the answer to that variable's row in the cannot-verify table below |
| Deployment state | new | `gh run list --workflow=deploy-tracking-prod.yml` → one lifetime run, **failure**, 20 s, 2026-08-27. Prod holds exactly two CloudFormation stacks, neither of them `climate-tracking-api-prod` | **The tracking service is not deployed.** It consumes nothing today, legacy or otherwise |
| `web/src/features/tracking/api/trackingApi.ts` (browser client) | new | Defaults to `getTrackingApiBaseUrl()` reading `VITE_TRACKING_API_BASE_URL` (`trackingApi.ts:23-25`); `web/.env.example:40` ships it **commented out**, so the module is off without it | inert until the service exists. `README.md:94-99` still says the tracking host "has no CORS configuration" — stale: `ClimateTracking.Api/appsettings.json:16-17` has `Cors:AllowedOrigins`, and `TRACKING_CORS_ALLOWED_ORIGIN = https://climate.timsint.com` is set |

`docs/runbooks/tracking-service-provisioning.md:23` opens with a stale header ("production is
on commit `fc53936`, `main` is 23 commits ahead"); production is `b371a9d` today. Line 372
and 379 of the same file already prescribe the correct `CLIMATE_PROJECT_BASE_URL`.

## (e) Docs and saved links that still send a person to the legacy stack

**Which of the two inventories is authoritative.** `docs/runbooks/legacy-dependencies.md:1`
carries the *identical* title — `# Legacy-stack dependency inventory — #163`. It was
compiled 2026-08-15 at `1219dc6`, and three of its rows are disproved in this table.
**This document supersedes it.** `legacy-dependencies.md` should be marked superseded at its
head so #163 has one answer and not two; that file is outside this lane's ownership, so the
one-line edit belongs to whoever lands #163.

| Item | Evidence | Status |
|---|---|---|
| `README.md:5-8` — links to `TIMSInternational/climate-project` issues #17 and #47 for the migration epic | The repo still exists (`gh repo view TIMSInternational/climate-project` → 200, description *"Organizational climate platform (Next.js) — Procomer climate module"*). Its **issues are gone**: `gh issue view 17 --repo TIMSInternational/climate-project` → `Could not resolve to an issue or pull request with the number of 17`. `docs/legacy-issues/MAPPING.md:5` says they "were archived … and then deleted" | **STILL LEGACY** — two dead links in the first paragraph of the README. Archives are in `docs/legacy-issues/` |
| `README.md:75` — names `web-one-green-86.vercel.app` as the production frontend | canonical is `climate.timsint.com` (200, and the only CORS-allowed origin) | **STILL LEGACY** (stale) |
| `README.md:79` — "⚠️ Known break, open as of 2026-08-18" (CORS names the old URL) | disproved by the `curl` in correction 2 | **STILL LEGACY** (stale) — a reader will chase a closed bug |
| `README.md:94-99` — "climate-tracking has no CORS configuration … don't wire up UI that calls this client" | contradicted by `ClimateTracking.Api/appsettings.json:16-17` and `TRACKING_CORS_ALLOWED_ORIGIN` | **STILL LEGACY** (stale) |
| `docs/runbooks/cutover.md:141-142` — "production runs on … `organizational-climate-platform.vercel.app`" | that host is not this project's frontend (`README.md:77`) and never was the legacy app (correction 1) | **STILL LEGACY** (stale) — appears in the phase that decides DNS TTLs |
| `docs/runbooks/legacy-dependencies.md:23-30` — "every worker named below … **runs nowhere**" | obsolete since #275: `ClimateProject.Api.csproj:14`, `Program.cs:406` | **STILL LEGACY** (stale) — states cutover gate A1 which no longer exists |
| `docs/runbooks/legacy-dependencies.md:4,40` — frames the legacy stack as a Vercel deployment | correction 1 | **STILL LEGACY** (wrong) |
| `docs/runbooks/staging-provisioning.md:17`, `docs/security/rotation-runbook.md:66-67` — `web-one-green-86.vercel.app` as the production frontend / login probe target | same as `README.md:75` | **STILL LEGACY** (stale) |
| `docs/superpowers/plans/2026-07-31-monorepo-frontend-consolidation.md:637,673,681,790` — deploy commands using `CorsAllowedOrigin=https://organizational-climate-platform.vercel.app` | a dated plan document, not a runbook | leave as-is; it is a record of what was done in July |
| `docs/decisions/legacy-dev-routes.md:29-30` — 30 legacy `test-*`/`debug` routes plus 4 adjacent handlers | "All thirty are dev scaffolding. None is migrated. None gets a replacement route." | **LOST-ACCEPTED**, on the record |
| `docs/decisions/no-data-migration.md:9` — the legacy Mongo data | "It is abandoned." | **LOST-ACCEPTED**, on the record |

## (f) The public surface

The question: does any URL already handed to an outsider carry a hostname that changes at
cutover?

| Surface | Evidence | Status |
|---|---|---|
| Share link `POST /admin/reports/{id}/share` | Returns a **relative** path: `src/ClimateProject.Api/Endpoints/ReportShareEndpoints.cs:158` → `$"/shared/reports/{token}"`. No hostname is minted server-side | the *token* survives a domain change; the *URL an admin copied out of the browser* does not |
| `GET /shared/reports/{token}` (API, unauthenticated) | `ReportShareEndpoints.cs:87`; described at `:19` as "the highest-exposure endpoint in the product" | **NEW-STACK-ONLY** — #139. No legacy equivalent, so no external link predates it |
| `/shared/reports/:token` (SPA route) | `web/src/app/router.tsx:281`. The comment at `:273-274` records that the path is kept literal because it matches the legacy path shape `src/app/shared/reports/[token]/page.tsx` | the **path** is legacy-compatible; the **origin** is not. A legacy-era share link would be `<coolify-host>/shared/reports/<token>` with a token this database has never seen — it 404s, it does not leak |
| `/s/:token` public survey link | `web/src/app/router.tsx:248`; server prefix `SurveyAccessTokens.cs:40` (`PublicLinkPrefix = "/s/"`). Absolute links in mail come from `EmailOptions.AppBaseUrl` (`SurveyAccessTokens.cs:46`) = `https://climate.timsint.com` (`…prod-service.yml:281`) | **already on the canonical domain.** Mail sent before the SES config landed used no absolute link — the provider was the logging stub |
| `/survey-invitations/:token` — the invitee link | `EmailNotificationSender.cs:244` → `options.LinkTo(SurveyAccessTokens.InvitationLinkPath(token))`; prefix `SurveyAccessTokens.cs:59`; SPA route `router.tsx:249`. `…prod-service.yml:278` calls it "the address that starts the whole respond loop" | **absolute**, built from `Email__AppBaseUrl`, already in inboxes — the highest-volume public URL the product mints |
| `/microclimate-invitations/:token` | `EmailNotificationSender.cs:293` → `options.LinkTo(MicroclimateInvitationLinks.LinkPath(token))`; prefix `MicroclimateInvitationLinks.cs:42` | **absolute**, same origin dependency |
| `/accept-invitation/:token` — account invitation | `EmailInvitationEmailSender.cs:62` → `options.LinkTo(string.Format(InvitationEmailComposer.AcceptPathTemplate, …))`; template `:36` | **absolute**; a pending invitee whose link dies cannot create their account |
| `/settings/notifications` — the unsubscribe/preferences link in every notification mail | `EmailNotificationSender.cs:112` → `options.LinkTo(NotificationEmailComposer.PreferencesPath)`; path `:42` | **absolute**; a dead preferences link is a deliverability and compliance problem, not just a broken page |
| `X-Robots-Tag: noindex, nofollow` on `/shared/reports/(.*)` | `web/vercel.json:37-42`; rationale `web/src/lib/noIndex.ts:37` | **a Vercel-layer header.** It does not move with the API. Any future host for the SPA must reproduce it or shared reports become indexable |

**The one thing that changes:** every externally-distributed link — six token families, four of
them minted as absolute URLs by `EmailOptions.LinkTo()` over `Email__AppBaseUrl` — is
`https://climate.timsint.com/...`.
If #160 replaces that hostname rather than adding to it, every share link and every survey
link already in a recipient's inbox dies. Keep `climate.timsint.com` resolving.

---

## What cutover must not forget

1. **Do not look for the legacy stack at a `vercel.app` address.** It is a Coolify host
   whose address is in no repository (correction 1). Access logs — criterion 2 — must be
   pulled from there, and nobody in this repo knows where "there" is.
2. **`Email__AppBaseUrl` and `CORS_ALLOWED_ORIGIN` change together, before any user
   resolves to a new host.** They are separate systems: a CloudFormation parameter
   (`…prod-service.yml:281`) and a GitHub environment variable, both applied by
   `deploy-prod.yml`. Missing the first sends live mail pointing at the old domain.
3. **Five values change with a hostname, not two — and one of them is not a variable at all,
   it is a rebuild.** `VITE_API_BASE_URL` is the address every API call in the SPA is built
   from (`web/src/App.tsx:9` `import.meta.env.VITE_API_BASE_URL`; 64 files read it). Vite
   inlines `import.meta.env` **at build time**, so it lives in Vercel's project settings, not
   in this repository (`web/.env.example:1` carries only the localhost default), and changing
   it means a **Vercel rebuild and redeploy of the web app** — a different action with a
   different lead time from `gh variable set` or a CloudFormation redeploy. It is the one
   value on this list whose omission takes the whole product down rather than degrading a
   corner: a frontend built against the old host keeps calling a hostname that no longer
   resolves. The other two of the five live in the tracking stack. `CLIMATE_PROJECT_BASE_URL` (`https://bhgrdkd4gt.us-east-1.awsapprunner.com`,
   set 2026-08-31) is the base address of the repository's only cross-service HTTP client
   (`ExternalApi/ServiceCollectionExtensions.cs:25`), and `TRACKING_CORS_ALLOWED_ORIGIN`
   (`https://climate.timsint.com`, set 2026-08-31) is the tracking service's **only**
   allowed origin, with no wildcard fallback
   (`infra/aws/climate-tracking-api-prod-service.yml:131-139`). Both are live `production`
   environment variables; both are pinned to hostnames #160 replaces. The tracking service
   is not deployed today, so getting these wrong costs nothing **until** it is — at which
   point a wrong `CLIMATE_PROJECT_BASE_URL` means empty `*_cache` tables (blank nodo and
   persona names everywhere) and a wrong `TRACKING_CORS_ALLOWED_ORIGIN` means every tracking
   request fails at the preflight.
4. **Deploying the tracking service arms a daily mail job.** `Workers:Enabled` defaults to
   `true` and is set nowhere (`WorkerServiceCollectionExtensions.cs:16,24`), so
   `DailySemaforoWorker` (24 h, `DailySemaforoWorker.cs:30`) starts sending 30-day / 15-day
   / overdue notices to each action plan's líder, responsable and involucrados (`:141-152`,
   `:171`) on the first boot. There is no separate switch for the mail. Do not turn the
   service on in the cutover window unless the client expects that mail that day.
5. **`web/vercel.json:32`'s CSP `connect-src` hardcodes the App Runner host.** It is
   `Report-Only`, so a wrong value costs nothing today and everything the day it is
   enforced.
6. **Google's authorized origins must already contain the final domain.** The redirect URI
   is computed from `window.location.origin` at run time (`googleOAuth.ts:130`); sign-in
   breaks the instant the origin changes, with no deploy to roll back.
7. **The workers now ship inside the API image.** Rolling the API back rolls the scheduler
   back with it. There is no separate service to check, and `Dockerfile.workers` builds in
   no workflow.
8. **Alerting is armed but mute.** `TEAMS_WEBHOOK_URL` does not exist and
   `climate-project-observability.yml` has never been deployed, so a cutover-day failure
   notifies nobody. Cheapest fix before the window: set the secret; the probe's post step
   is already written and already guarded.
9. **Keep `climate.timsint.com` resolving after #160**, or every share link and survey link
   already in circulation breaks (see (f)).
10. **Nothing here is switched off at cutover.** The legacy stack stays up but idle until
   criterion 2 has an evidence window — that ordering is the whole of #163.

## Cannot be verified from this repository

| Gap | Why | Who closes it |
|---|---|---|
| **Legacy access logs post-cutover** (#163 criterion 2) | The legacy host is a Coolify instance addressed nowhere in this repo | Whoever holds the vendor's Coolify console |
| The legacy repo's own `vercel.json` / `deploy.sh` / `ENV_VARIABLES.md` | Not checked out here. Prior readings are quoted at second hand through `docs/security/2026-08-15-exfiltration-audit.md` | Re-read `TIMSInternational/climate-project` at HEAD — the repo still exists |
| Who, if anyone, called `/api/cron/process-reminders`, `/api/cron/scheduled-reports`, `/api/gdpr/retention-cleanup` | They are routes with no `vercel.json` entry. Their successors run regardless, so this affects *whether legacy still ticks*, not whether the behaviour is covered | Coolify / legacy scheduler console |
| Whether legacy and new share one Google OAuth client | Both code paths read here; the client's identity is console state | Google Cloud console |
| MongoDB Atlas cluster identity, users, IP allowlist | No Mongo artifact exists in this repo | Atlas console — and `rotation-inventory.md` prefers **decommission** over rotate |
| DNS records and TTLs for `timsint.com` | Namecheap (`dns1/dns2.registrar-servers.com`); there are **zero** Route 53 hosted zones in the prod account, so no AWS read reaches them | Namecheap console → `cutover.md` step B1 |
| Vercel project environment variables (`VITE_API_BASE_URL`, `VITE_GOOGLE_CLIENT_ID`, `VITE_TRACKING_API_BASE_URL`) | Every one is read from `import.meta.env` at build time; none has an in-repo default. For `VITE_TRACKING_API_BASE_URL` there is a known-correct answer that still needs checking against the dashboard: it must be on the **Production scope only**, because the tracking service allowlists exactly one origin and previews get a preflight failure (`infra/aws/climate-tracking-api-prod-service.yml:131-139`) | Vercel dashboard, project `climate` |
| Undeclared external consumers — bookmarks, scripts, integrations nobody remembers | Unknowable by construction | Only post-cutover traffic on the legacy host answers this. It is the reason the legacy stack stays up |

## Method

Sweeps run 2026-09-02 on `main` at `b371a9d`, each blind to the others: (a) `grep -rn` for
`vercel.app`, `awsapprunner`, `timsint`, `mongo|atlas`, plus a `grep -rhoE 'https?://…'`
enumeration of every URL literal in `src`, `web/src`, `web/scripts`,
`services/tracking-api/src`, `infra`, `.github`, `scripts`; (b) `grep -n cron:
.github/workflows/*.yml`, `src/ClimateProject.Workers/Jobs.cs`,
`WorkerSchedulingOptions.cs`, `WorkerJobs.cs`,
`SchedulingServiceCollectionExtensions.cs`, and — after the first pass missed it by sweeping
`src/` only — `services/tracking-api/src/ClimateTracking.{Api,Workers}` plus a repo-wide grep
for `Workers__Enabled`, `Workers:Enabled` and `CacheSyncIntervalMinutes`; (c) `grep -rni` for
`webhook|sentry|datadog|gtag|posthog|slack|brevo`, `web/package.json`, `gh variable list`,
`gh secret list`; (d) both tracking `appsettings.json` files,
`infra/aws/climate-tracking-api-prod-service.yml`, `gh run list`, and
`grep -rn --include='*.cs' -E "AddHttpClient|new HttpClient" src services` to find every
cross-service caller (one, outside tests); (e) `docs/**`; (f)
`ReportShareEndpoints.cs`, `router.tsx`, `web/vercel.json`, `SurveyAccessTokens.cs`.
All `gh` and `aws` use was read-only. `node_modules`, `.git`, `bin/`, `obj/`,
`TestResults/` and `.claude/worktrees/` excluded throughout — the worktrees hold other
agents' copies and would have doubled every row.
