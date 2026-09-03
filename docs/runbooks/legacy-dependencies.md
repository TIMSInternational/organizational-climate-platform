# Legacy-stack dependency inventory — #163

> **SUPERSEDED 2026-09-03. Read
> [`docs/decisions/legacy-dependency-inventory.md`](../decisions/legacy-dependency-inventory.md)
> first.** That document is the current inventory; this one was written 2026-08-15 against
> `1219dc6`, and §(e) of the newer file lists row by row which claims below have since gone
> stale. It asks for this banner in as many words —
> `docs/decisions/legacy-dependency-inventory.md:219-221`: *"**This document supersedes it.**
> `legacy-dependencies.md` should be marked superseded at its head so #163 has one answer and
> not two."* Rows 5, 8 and 9 below were corrected in place on 2026-09-03 against
> production `e0896f9`; the inventory-wide caveat was corrected on the same date. Everything
> not carrying a `[CORRECTED 2026-09-03]` tag is still a 2026-08-15 measurement and should be
> re-measured before it is acted on.


Everything known to still point at, run on, or depend on the legacy stack (the Next.js
app in the retired `TIMSInternational/climate-project` repo, its Vercel deployment, and
MongoDB Atlas), with what replaces each item in the new stack and how the row was
verified.

**Verification statuses, used honestly:**

- **VERIFIED** — checked against a file at a stated path/commit. For rows citing the
  legacy repo, the source is the local checkout of `TIMSInternational/climate-project`
  at commit `ab3266c` (its origin HEAD as of 2026-08-15). A repo file is authoritative
  for what a deploy *from that commit* does — whether the live deployment was built from
  that commit is console state, noted where it matters.
- **UNVERIFIED-NEEDS-CONSOLE** — the claim depends on dashboard state (Vercel, MongoDB
  Atlas, Google Cloud, AWS, Supabase, the DNS host) that nothing in either repository
  can confirm. These rows are *leads to check*, not facts. Do not treat them as
  inventory until someone with console access initials them.

New-stack citations are against `organizational-climate-platform` at `origin/main`
commit `1219dc6` (2026-08-15).

> **Inventory-wide caveat on "what replaces it" — ~~every worker named below exists in
> code and runs nowhere~~. [CORRECTED 2026-09-03: the workers are deployed.]** #275 is
> CLOSED and the API process *is* the scheduler. `src/ClimateProject.Api/Program.cs:406`
> calls `builder.Services.AddClimateProjectScheduling(builder.Configuration)`;
> `src/ClimateProject.Workers/SchedulingServiceCollectionExtensions.cs:81-89` registers
> **eight** jobs plus the heartbeat monitor as hosted services —
> `NotificationDispatchWorker`, `InvitationReminderWorker`, `DigestWorker`,
> `ScheduledReportWorker`, `SurveyDraftRetentionWorker`, `RetentionCleanupWorker`,
> `SurveyLifecycleWorker`, `MicroclimateLifecycleWorker`, then `WorkerHeartbeatMonitor`;
> the eight `*Worker` classes are defined at `src/ClimateProject.Workers/Jobs.cs:28, 72,
> 111, 151, 207, 274, 331, 390` and named in `WorkerJobs.All`
> (`src/ClimateProject.Application/Scheduling/WorkerJobs.cs:74-84`); and
> `src/ClimateProject.Api/ClimateProject.Api.csproj:14` is the `ProjectReference` that puts
> them in the API image `deploy-prod.yml` already builds. That image is live —
> `GET https://bhgrdkd4gt.us-east-1.awsapprunner.com/version` on 2026-09-03 returns
> `"commit":"e0896f99f132087c7b97a4a9129b4f2baf25db6a"`.
>
> **The consequence inverts.** This caveat used to say the legacy stack must stay armed
> until #275 closed. It has closed, so the opposite now holds: leaving the legacy
> 15-minute cron armed (row 1) means *both* stacks send invitation reminders for the same
> product. Disarm the legacy cron; do not keep it as a safety net. Cutover gate A1 in
> [`cutover.md`](./cutover.md) reads CLOSED for the same reason.
>
> Still unobserved, and the reason this is a source-and-deploy measurement rather than a
> runtime one: **no heartbeat log line from any of the eight jobs has been read out of
> production.** "Deployed and enabled by default" is not "ran".

## The inventory

| # | What | Where configured | What replaces it | Verified how | Status |
|---|---|---|---|---|---|
| 1 | Vercel cron: `/api/cron/send-reminders`, `*/15 * * * *` — the only cron entry in the file, sending survey-invitation reminders in production today | `climate-project/vercel.json` (legacy repo) | `invitation-reminders` worker (`src/ClimateProject.Application/Scheduling/WorkerJobs.cs`; cadence matches legacy exactly per `docs/superpowers/specs/2026-08-06-scheduling-design.md`) | Read `vercel.json` in the legacy checkout at `ab3266c`: exactly one cron entry. Deployed-cron config could differ if the live deploy predates this commit — confirm in the Vercel dashboard | **VERIFIED** (file) / deploy-state console check pending |
| 2 | Legacy route `/api/cron/process-reminders` — exists as a route; **not** in `vercel.json`'s crons, so its caller (dashboard-configured cron? external scheduler? nothing?) is unknown | `climate-project/src/app/api/cron/process-reminders/` (route exists); caller: Vercel dashboard or external | `notification-dispatch` worker (`WorkerJobs.cs` names it as replacing this route) | Route directory listed in the legacy checkout; `vercel.json` contains no entry for it | **UNVERIFIED-NEEDS-CONSOLE** (who calls it, if anyone) |
| 3 | Legacy route `/api/cron/scheduled-reports` — same shape as row 2 | `climate-project/src/app/api/cron/scheduled-reports/`; caller unknown | `scheduled-reports` worker (`WorkerJobs.cs`) | Same method as row 2 | **UNVERIFIED-NEEDS-CONSOLE** (caller) |
| 4 | Legacy route `/api/gdpr/retention-cleanup` — GDPR storage-limitation sweep | `climate-project/src/app/api/gdpr/retention-cleanup/`; caller unknown (not in `vercel.json`) | `retention-cleanup` worker (`WorkerJobs.cs` cites this route by name, per #144) | Route directory listed in the legacy checkout; no cron entry for it | **UNVERIFIED-NEEDS-CONSOLE** (caller) |
| 5 | The legacy Vercel deployment itself — the Next.js app serving legacy production (Vercel project `climate`, per `docs/security/rotation-inventory.md` row E) | Vercel dashboard, project `climate`; builds from the retired repo | Frontend: `web/` SPA on Vercel at **`https://climate.timsint.com`**. API: App Runner `https://bhgrdkd4gt.us-east-1.awsapprunner.com` (`infra/aws/README.md`) — still no custom domain (#160). [CORRECTED 2026-09-03. This cell previously named `organizational-climate-platform.vercel.app` and cited `README.md:75`; both halves were stale. Measured today: `curl -s -o /dev/null -w '%{http_code} %{remote_ip}' https://climate.timsint.com/` → `200 76.76.21.21` (Vercel), `<title>Organizational Climate Platform</title>`; `dig +noall +answer climate.timsint.com` → `climate.timsint.com. 1798 IN A 76.76.21.21`; the `production` environment variable `CORS_ALLOWED_ORIGIN` is `https://climate.timsint.com` (`gh variable list --env production`) and it is the **only** exact origin the API allows — a preflight from `https://organizational-climate-platform.vercel.app` returns 204 with **no** `access-control-allow-origin` header. `README.md:75` no longer names either URL. See [`docs/decisions/web-hosting.md`](../decisions/web-hosting.md).] | Project name from rotation-inventory (itself derived from the incident analysis); live URL, custom-domain state and env contents are dashboard state | **UNVERIFIED-NEEDS-CONSOLE** (production URL, domains, env) |
| 6 | MongoDB Atlas — the legacy production database (`MONGODB_URI` in the legacy Vercel env; production shape `mongodb+srv://…` per legacy `ENV_VARIABLES.md:321`) | Legacy Vercel env; Atlas console | Supabase-hosted Postgres, project `organizational-climate-platform`, `us-east-1` (`README.md:78`). Until the final ETL run it is also the **source** the migration reads (`docs/superpowers/specs/2026-08-03-mongo-to-postgres-etl-design.md`); decommissioning is #165, after #163's evidence window | `ENV_VARIABLES.md` read in the legacy checkout; cluster identity, users and network rules are Atlas console state. Credential rotation pending — #70, rotation-inventory row B | **UNVERIFIED-NEEDS-CONSOLE** (cluster identity/config) |
| 7 | NextAuth Google OAuth client — legacy sign-in uses NextAuth with `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `NEXTAUTH_SECRET` (legacy `ENV_VARIABLES.md:97-112,201-202`) | Legacy Vercel env; Google Cloud console | New stack: OIDC id-token redirect flow in the SPA (`web/src/auth/googleOAuth.ts` — `VITE_GOOGLE_CLIENT_ID`, redirect back to `<origin>/auth/loading`), verified server-side by `GoogleTokenVerifier` reading only `GoogleClientId` (`src/ClimateProject.Infrastructure/Auth/GoogleTokenVerifier.cs:13`) — **no client secret in the new stack**. NextAuth and `NEXTAUTH_SECRET` retire with the legacy app | Both code paths read in-repo. **Unknown: whether the same Google OAuth client is reused.** If yes, its authorized JavaScript origins and redirect URIs must include the new frontend origin and, after #160, the custom domain — or sign-in breaks at the flip. Also confirm the live `NEXTAUTH_SECRET` was never the published example at legacy `ENV_VARIABLES.md:128` (rotation-inventory, "History scan") | **UNVERIFIED-NEEDS-CONSOLE** (client reuse, authorized origins) |
| 8 | Brevo SMTP — legacy outbound email credentials (rotation-inventory row E, citing legacy `ENV_VARIABLES.md`) | Legacy Vercel env | `SmtpEmailTransport` + `EmailOptions` (`src/ClimateProject.Api/Program.cs:367`; the three `EmailOptions.IsConfigured` fallback ternaries are at lines **378, 394 and 418**). **It IS the replacement in production, and has been since 2026-08-26.** [CORRECTED 2026-09-03. This cell previously said prod delivery was "the logging stub" because the service template passed no `Email__*` variables, and cited `Program.cs:348` / "factory ~360–366" — the file is 677 lines and those numbers now point into unrelated code. Measured today: `grep -n "Email__" infra/aws/climate-project-api-prod-service.yml` → **eleven** hits, eight plain variables at lines 265-293 (`Email__Provider=smtp`, `Email__SmtpHost=email-smtp.us-east-1.amazonaws.com`, `Email__SmtpPort`, `Email__SmtpUseStartTls`, `Email__FromAddress`, `Email__FromName`, `Email__AppBaseUrl=https://climate.timsint.com`, `Email__SesConfigurationSet`) plus `Email__SmtpUsername`/`Email__SmtpPassword` as `RuntimeEnvironmentSecrets` at 302-305; and the **live** service carries them — `aws --profile claude apprunner describe-service … RuntimeEnvironmentVariables` → `"Email__Provider": "smtp"`, `"Email__SmtpHost": "email-smtp.us-east-1.amazonaws.com"`, `"Email__AppBaseUrl": "https://climate.timsint.com"`. The ARNs are on the `production` environment as `EMAIL_SMTP_USERNAME_SECRET_ARN` / `EMAIL_SMTP_PASSWORD_SECRET_ARN`, both created `2026-08-26T17:47Z` (`gh variable list --env production`). Cutover gate A8 reads **CLOSED**. **The risk this row now carries is the opposite one:** both stacks can send mail for this product at the same time, so the legacy Brevo sender must be disarmed, not merely ignored. Still unmeasured from here: a real message received in a real inbox — see UAT gate 2.] | Repo halves verified by grep of the service template and `Program.cs`. Whether legacy Brevo is actively sending, and with which account, is console state | **VERIFIED** (both repo halves) / Brevo account **UNVERIFIED-NEEDS-CONSOLE** |
| 9 | DNS — the customer-facing domain and wherever its records are hosted | **Namecheap** (`dns1.registrar-servers.com` / `dns2.registrar-servers.com`), **not** Route 53. [CORRECTED 2026-09-03. This cell previously said DNS "**appears nowhere in either repo**". It does: `climate.timsint.com` is the value of `Email__AppBaseUrl` at `infra/aws/climate-project-api-prod-service.yml:280`, and it is the `CORS_ALLOWED_ORIGIN` and `TRACKING_CORS_ALLOWED_ORIGIN` production variables. The zone is measurable without any console: `dig +noall +answer timsint.com NS` → `dns1.registrar-servers.com.` / `dns2.registrar-servers.com.`; `dig +noall +answer climate.timsint.com @dns1.registrar-servers.com` → `1797 IN A 76.76.21.21` (Vercel). What remains console-only is the registrar login needed to *change* a record, and the TTL, which is still the 1800 s class rather than the ≤300 s Phase B asks for. The API half of #160 is genuinely unmet: `aws --profile claude apprunner describe-custom-domains` → `"CustomDomains": []`, `"DNSTarget": "bhgrdkd4gt.us-east-1.awsapprunner.com"`. See [`docs/decisions/web-hosting.md`](../decisions/web-hosting.md).] | Custom domains with TLS on both the App Runner API and the Vercel frontend (#160), with TTLs lowered days ahead (`cutover.md` Phase B) and CORS + OAuth origins updated before the flip | #160 issue text; absence of any domain config in-repo confirmed by search | **UNVERIFIED-NEEDS-CONSOLE** (domain, host, records, TTLs) |
| 10 | `services/tracking-api` configuration — `ClimateProjectBaseUrl`, `ProcomerCompanyId`, `ClimateProjectInternalApiKey` decide which climate API the tracking service calls and which tenant key it expects | `services/tracking-api/src/ClimateTracking.Api/appsettings.json:13-15` and `.../ClimateTracking.Workers/appsettings.json:10-12` — empty strings in-repo; real values are per-deployment | At cutover: `ClimateProjectBaseUrl` → the new API domain, `ProcomerCompanyId` → the migrated company GUID (#162 sequence, #155 scope), against `/api/internal/nodos` + `/api/internal/personas` (`src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs`) | Config keys verified in-repo. Where the tracking service is deployed and what its production values currently hold is console state — recorded at pre-flight C5 in `cutover.md` | **VERIFIED** (keys) / current values + hosting **UNVERIFIED-NEEDS-CONSOLE** |
| 11 | Undeclared consumers — webhooks, third-party integrations, saved links/bookmarks, anything external calling the legacy API. #163: "There are likely others nobody remembers" | Unknown by definition | Case-by-case: migrated, or explicitly accepted as lost (#163 AC) | Only one method exists: **legacy access logs reviewed for live traffic in the weeks after cutover** — traffic after cutover is the clearest evidence of an undeclared dependency. This is why the legacy stack stays up but idle until #165 | **UNVERIFIED** by nature — closes only with post-cutover log evidence |

## How to close the UNVERIFIED rows

1. **Enumerate the legacy Vercel project's environment and cron configuration first**
   (rows 1–5, 7, 8). This is also step 1 of the #70 rotation
   (`docs/security/rotation-inventory.md`, "Suggested order"): anything configured only
   in the dashboard is on no inventory derived from code. One console session closes
   both gaps.
2. **Google Cloud console** (row 7): read the OAuth client's authorized origins and
   redirect URIs; record whether legacy and new stack share a client.
3. **Atlas console** (row 6): cluster, database users, IP allowlist — and note that the
   preferred end state per rotation-inventory is decommissioning the cluster (#165)
   rather than rotating a credential for a database nothing should use again.
4. **DNS host** (row 9): enumerate records and TTLs into `cutover.md` Phase B1.
5. **Row 11 closes last**, weeks after cutover, from legacy access logs. Do not switch
   anything off before that evidence exists — that ordering is the whole of #163.

## Decommissioning note (for #164–#167, not for cutover day)

Nothing in this inventory is switched off at cutover. When retirement does start:
before archiving the legacy repo, handle the live malware sample reachable at its
commit `40fc19a` — building any checkout from before removal commit `81363af` executes
the `tailwind.config.js` payload (`docs/security/rotation-inventory.md`, "Related").
