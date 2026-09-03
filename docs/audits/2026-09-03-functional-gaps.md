# Functional gap audit — 2026-09-03

**Commit measured:** `835bcee` (`main`). Production API at `e0896f9`. Web at
`https://climate.timsint.com`. Go-live 16 November 2026.

**What this is.** A single durable record of what the application is *measured* to be
missing, assembled from four independent audits run this morning (frontend, backend, open
issues, cutover) and re-verified row by row against the working tree at `835bcee`. Every
row carries the `file:line` or command output it was derived from. Rows copied from an
audit were re-opened in this worktree before being written here; a citation nobody opened
is a rumour, and this document contains none.

**What this is not.** Not a plan, not a priority order for the team, and not a claim that
any gap will be closed. §5 separates what an agent can build unattended from what only a
human can supply; §6 lists the twelve lanes launched today so a reader knows which rows are
in flight, and says nothing about how any of them turns out.

---

## 1. Frontend — routes

58 route paths are declared in the single router
(`web/src/app/router.tsx`; `grep -c "path: '"` → 58). Three are stripped from a production
build by the `import.meta.env.DEV` gate at `web/src/app/router.tsx:168`, leaving 55 in the
bundle. Five `/tracking/*` routes are in the bundle but unreachable, because
`isTrackingEnabled()` returns false for a blank `VITE_TRACKING_API_BASE_URL`
(`web/src/features/tracking/api/config.ts:55-57`) and no tracking service is deployed.
**50 routes are actually reachable in production.**

| Gap | Evidence (re-verified at `835bcee`) |
|---|---|
| Question library has no production route — the only one is dev-only | `web/src/app/router.tsx:180` `path: '/dev/question-library'`, inside the `devOnlyRoutes` array gated at `router.tsx:168` (`const devOnlyRoutes: RouteObject[] = import.meta.env.DEV`) |
| Report rendering does not exist, and the UI says so on a routed page | `web/src/features/reports/pages/ReportsListPage.tsx:143` renders `t('reports.generationStubbed')` on `/admin/companies/:companyId/reports` |
| No UI mints a report share token | `grep -rn "reports/[^'\"]*/share" web/src` → 3 hits, **all comments**: `web/src/app/router.tsx:273`, `router.tsx:276`, `web/src/features/reports/api/sharedReports.ts:13`. No caller |
| No microclimate export control anywhere | `grep -rn "microclimates/.*export\|/export/csv" web/src/features/microclimates` → **0 hits** |
| `leader` and `supervisor` have identical production surfaces | `web/src/navigation/roleCapabilities.ts:532` `supervisor: [...SELF_SERVICE, TRACKING_TASKS]` vs `:518-530` leader = `SELF_SERVICE` + `/tracking/tablero` + `TRACKING_PLANS` + `TRACKING_TASKS`, every extra carrying `requiresTracking: true`; `reachableRoutes` filters those out when tracking is off (`:543-556`). `SELF_SERVICE` is 7 routes (`:144-210`) |
| Sentiment is not computed; the UI discloses it | `web/src/features/microclimates/components/MicroclimateSentimentNotice.tsx`; server side `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs:1602` `microclimate.LiveResults.SentimentScore = 0;` |
| No design-approval register of any kind exists | `grep -rniE "design coverage\|routes covered\|approved design" --include=*.md .` finds no route-to-design register; the only "approved design" strings are unrelated pipeline notes |

## 2. Frontend — tests

293 test files under `web/src` (`find web/src -name "*.test.ts*" | wc -l`). Four routed page
components have no test of any kind — re-verified with
`grep -rl "<Component>" web/src --include='*.test.tsx' --include='*.test.ts' | wc -l`:

| Page component | Route | Test files referencing it |
|---|---|---|
| `web/src/features/org-structure/pages/CompaniesListPage.tsx` | `/admin/companies` — the super_admin's primary entry point | **0** |
| `web/src/features/org-structure/pages/SystemSettingsPage.tsx` | `/admin/system-settings` | **0** |
| `web/src/features/org-structure/pages/AcceptInvitationPage.tsx` | `/accept-invitation/:token` — the onboarding entry point for every new user | **0** |
| `web/src/features/storefront/pages/StorefrontGalleryPage.tsx` | `/dev/storefront` (dev-only, low consequence) | **0** |

Counter-evidence worth recording beside them: i18n is at exact parity — 2,795 leaf keys in
each of `web/src/i18n/en.json` and `web/src/i18n/es.json`, zero drift in either direction,
zero empty values, enforced absolutely (not as a ratchet) by the AST walk in
`web/src/i18n/noHardcodedStrings.test.ts`.

## 3. Frontend — UAT coverage

`docs/runbooks/uat-script.md` — 618 lines, written against `main` at `b371a9d`, header
`docs/runbooks/uat-script.md:8`: **"Status: NOT EXECUTED.** Nothing below has been walked
against a running system by the author."

| Uncovered production route | Status |
|---|---|
| `/register` | No step anywhere. Self-service signup is never exercised (see §7 and `docs/decisions/self-signup-gate.md`) |
| `/auth/loading` | The Google OAuth `redirect_uri` — the page that creates the session — is never walked |
| `/auth/success` | No step |
| `/action-plans/:id` | §4.2 opens the list only; the detail page has no step |
| `/surveys/templates` | Named as a sidebar row; no step opens it |
| `/surveys/templates/:id` | Touched only indirectly via `POST /survey-templates/{id}/use` |
| `/tracking` ×5 | Declared blocked by §8.1 — no tracking service in production |

Six production routes have no UAT step and are **not** declared blocked. §8 additionally
declares five areas untestable: tracking (8.1), question library (8.2 — the picker renders
empty in production until an unexecuted import runbook is run), report share-token minting
(8.3), staging (8.4 — *UAT runs against live production data*), monitoring/rollback/domains
(8.5), microclimate insights/export (8.6).

## 4. Backend — stubs and dead paths

`grep -rnE "NotImplementedException|throw new NotSupported" src services --include='*.cs'`
→ **zero hits**. Nothing throws; everything degrades silently, which is why the suite is
green over all of it.

| Gap | Evidence (re-verified at `835bcee`) |
|---|---|
| Report download produces no file — it increments a counter and returns JSON | `src/ClimateProject.Api/Endpoints/ReportEndpoints.cs:109-126`: 404 → 403 → 400-unless-completed → `report.DownloadCount += 1` → `return Results.Ok(ToDetail(report));` (`:125`) |
| Every generated report document ships an apology inside itself | `src/ClimateProject.Api/Endpoints/ReportGeneration.cs:118` — `"Sections not yet generated: period-over-period comparative analysis, report configuration/filters, report templates. The requested \`format\` is not rendered: this document is JSON whatever was asked for."` |
| Three named report sections are unbuilt | `ReportGeneration.cs:106`, `:111`, `:115` — three `TODO(#88 follow-up)` blocks: comparative analysis, report configuration/filters/templates, and `reports.format` stored-but-not-honoured |
| A renderer already exists and is not wired to reports | `src/ClimateProject.Application/Exports/PdfDocument.cs` (556 lines) + `CsvStreamWriter.cs`, already consumed by `src/ClimateProject.Api/Endpoints/SurveyExportEndpoints.cs:59,62`. Reports do not use it |
| The `scheduled-reports` job is structurally dead | `src/ClimateProject.Infrastructure/Scheduling/ScheduledReportJob.cs:48-50` selects `report.IsRecurring && report.NextGeneration != null && report.NextGeneration <= nowUtc`; `grep -rn "IsRecurring" src/ClimateProject.Api` → **0 hits**. Nothing in the API can ever write those columns |
| `notification_templates` is a CRUD surface that dispatch ignores | `src/ClimateProject.Infrastructure/Notifications/EmailNotificationSender.cs:109-112` composes from the notification's own `Title`/`Message` via `NotificationEmailComposer.Compose`; no template row is read |
| No AI inference client exists anywhere | `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs:1315` — "*no inference client was ever built -- there is no Bedrock or Anthropic call*". `SentimentScore` hard-coded to `0` at `:1602` |
| Microclimate export and insights are finished, tested, and unreachable | Endpoints at `MicroclimateEndpoints.cs:92,93,113`; zero web callers (§1) |
| QR distribution stores a URL string, not an image | `src/ClimateProject.Api/Endpoints/SurveyDistributionEndpoints.cs:226` — "*QrCodeUrl is NOT NULL, and there is no QR renderer in this repository yet*" |
| Self-signup has no gate and no off-switch of its own | `src/ClimateProject.Api/Endpoints/AuthEndpoints.cs:37`, `:133-138`, `:148-149`; kill switches at `:428,:435`. Full treatment in `docs/decisions/self-signup-gate.md` |
| Signup enforces password *length* only | `AuthEndpoints.cs:448` calls `settings?.PasswordPolicy.MinLength ?? 8`; the four complexity flags at `src/ClimateProject.Domain/Entities/SystemSettings.cs:23-26` are never consulted from signup |
| `SystemSettings` has no registration switch | `src/ClimateProject.Domain/Entities/SystemSettings.cs:5-17` — `LoginEnabled`, `MaintenanceMode`, `MaxLoginAttempts`, `SessionTimeoutMinutes`, `PasswordPolicy`, `EmailSettings`. No `RegistrationEnabled`, no `AllowSelfSignup` |
| Dead columns imply a stored file that never exists | `src/ClimateProject.Domain/Entities/Report.cs:16,17,20,25` — `FilePath`, `FileSize`, `GenerationError`, `SharedWith`; nothing populates them |

## 5. Open issues — classified

`gh issue list --state open --limit 200 --json number --jq length` → **40** (re-run
2026-09-03). 15 are epics; 25 are not. Criteria counts below are the issues' own acceptance
checkboxes as measured by the issues audit.

| # | Class | Criteria met/total | What is missing |
|---|---|---|---|
| 134 | BUILDABLE-NOW | 0/4 | Dashboard export and share. `src/ClimateProject.Api/Endpoints/DashboardEndpoints.cs:95-101` maps five routes, none `/export`. Share, export and audit infrastructure all already exist to compose |
| 141 | BUILDABLE-NOW | 1/4 (+1 half) | Logs viewer (no `/logs` route in `web/src`) and an app-independent maintenance page. In-app 503 handling exists (`web/src/auth/authReason.ts:35,54-55`) but needs the app to be up |
| 423 | BUILDABLE-NOW (deferred by ruling 2026-09-02) | 1/4 | A production `/admin/question-library`; the seven API routes already exist |
| 167 | BUILDABLE-NOW (1 criterion human) | 0/5 | Architecture doc, retrospective, gotchas index, accurate `README.md` — and **`CLAUDE.md` does not exist** (`ls CLAUDE.md` → No such file) |
| 140 | BUILDABLE-NOW | 1/4 | Onboarding and in-app help; zero onboarding code in `web/src` |
| 133 | BUILDABLE-NOW | 1/4 | Dashboard customization; `widgets`/`themes` have no reference implementation to port |
| 210 | BUILDABLE-NOW | 2/6 (+1 vacuous) | 24 of 27 author-facing fields need paired `_en`/`_es` columns; the 3 `Category` fields stay gated behind #58 |
| 102 | NEEDS-RULING | 1/3 (vacuous) | A privacy decision on open/click tracking in employees' mail before anything is built |
| 148 | NEEDS-RULING | 2/4 (1 moot) | Whether the 2026-08-02 full-parity ruling still binds an abstraction with zero product consumers |
| 119 | NEEDS-RULING | 0/6 | Whether the rule-based conditional-logic engine stays in 16 Nov scope after the #113 deferral |
| 166 | NEEDS-RULING | 1/6 | Archive-versus-delete for the legacy repositories |
| 219 | BLOCKED-ON-HUMAN | **4/4** | Nothing to build; close on the first successful tracking deploy |
| 165 | BLOCKED-ON-HUMAN | 0/6 (4 moot) | Atlas console |
| 164 | BLOCKED-ON-HUMAN (premise wrong) | 0/5 | The legacy app ran on Coolify, not Vercel; the issue needs restating before it can be worked |
| 163 | BLOCKED-ON-HUMAN | 1/4 | Post-cutover log evidence from the previous vendor's host |
| 162 | BLOCKED-ON-HUMAN | 0/7 | Every upstream gate plus an explicit go-ahead on the day |
| 161 | BLOCKED-ON-HUMAN | 0/6 | Real people in each role; the 618-line script exists |
| 160 | BLOCKED-ON-HUMAN (has a buildable slice) | 1/6 (+1 half) | Registrar access; `timsint.com` is not in Route 53 |
| 159 | BLOCKED-ON-HUMAN | 3/6 | A named decision owner (blank in `docs/runbooks/rollback.md`); the dry run needs #156 |
| 158 | BLOCKED-ON-HUMAN | 2/6 | A webhook URL, a fallback address, one SNS confirmation click. `docs/runbooks/alerting.md:10` — "*There are zero CloudWatch alarms and zero SNS topics*" |
| 156 | BLOCKED-ON-HUMAN | 1/5 | A Supabase plan decision |
| 111 | BLOCKED-ON-HUMAN | 0/4 | AI provider approval, workspace, cost ceiling |
| 92 | BLOCKED-ON-HUMAN | 0/7 | Same provider gate, plus turnover-prediction sign-off |
| 71 | BLOCKED-ON-HUMAN | 3/5 (1 N/A) | Atlas console and the previous vendor's Coolify logs |
| 70 | BLOCKED-ON-HUMAN | 1/4 | Five consoles. `docs/security/rotation-inventory.md:3` — "**Status: NOT STARTED. No credential below has been rotated.**" |

**Class totals:** BUILDABLE-NOW 7 · NEEDS-RULING 4 · BLOCKED-ON-HUMAN 14 · ALREADY-BUILT 0.

**Criteria that map to no open issue** (tracker gaps): approve the AI provider draft (#67
items 1–2); configure production email; assert audit coverage of every mutating endpoint;
verify survey-side response anonymity; reconcile the legacy route ledger. **Criteria that
should be struck as moot:** #51's data-migration criterion, all five of #64's, #65's archive
criterion, and the "matches legacy output" criteria on #54 and #61 — there is no legacy
output to compare against, per `docs/decisions/no-data-migration.md`.

## 6. Cutover — preconditions and gates

`docs/runbooks/cutover.md` carries fourteen preconditions, **all fourteen unmet**, and 13
unfilled `____` fields (`grep -c "____" docs/runbooks/cutover.md` → 13).
`docs/runbooks/rollback.md` carries 22 (`grep -c "____"` → 22). The repo expresses unfilled
state as `____`, not as `TODO`.

| Precondition | Unmet because | Class |
|---|---|---|
| P1 staging | `docs/runbooks/cutover.md:90` — `deploy-staging.yml` has 0 lifetime runs; only a bootstrap stack exists in DEV `795965600143` | HUMAN (a purchase) |
| P2 rollback tested | `rollback-prod.yml` and `rollback-rehearsal-staging.yml` have 0 lifetime runs each | HUMAN |
| P3 monitoring | `describe-alarms` → `[]` for this product; no observability stack | HUMAN (prod creds) |
| P4 API custom domain | `describe-custom-domains` → `"CustomDomains": []` | HUMAN |
| P5 DNS TTLs | 1800 s across apex, `www`, MX, SPF — explicitly demoted, "should not be allowed to gate a date" | HUMAN, non-blocking |
| P6 CSP `connect-src` | `web/vercel.json:32` pins `connect-src 'self' https://bhgrdkd4gt.us-east-1.awsapprunner.com` — one hostname, the current one | CODE (after P4 names the new host) |
| P7 secret rotation | `docs/security/rotation-inventory.md:3` — "NOT STARTED" | HUMAN (four consoles) |
| P8 UAT | #161 OPEN | HUMAN |
| P9 maintenance page | #141 OPEN | CODE |
| P10 tracking deploy | No stack; `deploy-tracking-prod.yml` has one lifetime run, conclusion failure | HUMAN (3 config values, 2 needing a DB that must be bought) |
| P11 Google OAuth origins | CANNOT VERIFY — Google Cloud console | HUMAN (one paste) |
| P12 legacy host log review | Ran on a Coolify host whose address appears in no repository | HUMAN |
| P13 paging | `ops-synthetic-probe.yml` is not on a schedule until a secret exists; "watching" means a human refreshing a tab | HUMAN |
| P14 seeded prod accounts | `docs/runbooks/cutover.md:103` — five live production logins (`superadmin@`…`employee@` `nexadev.ai`) sharing one password, verified authenticating 2026-09-02 | HUMAN (decision + passwords); the rotation script is code |

| Gate | Status |
|---|---|
| A1 worker hosting | CLOSED, **exit criterion unmet** — eight heartbeat lines never observed in production logs |
| A8 production email | CLOSED (SES `ProductionAccessEnabled: true`), **exit criterion unmet** — no real invitation confirmed received in an inbox |
| C3 migrations at head | HALF — repo half verified (55 migrations); the `psql` half unverifiable from here |
| C8 communications / maintenance page | UNMET — "There is no maintenance page to be ready" |
| C9 go/no-go | UNMET — "**This is the one gate that no amount of measurement can close.**" |
| D4 identity continuity | Cannot be run — there is no tracking database in production |
| D7 tracking reconfigure | "IMPOSSIBLE AS WRITTEN" — there is no service to reconfigure |
| UAT gate 2 (a real mail in a real inbox) | UNMET — "the one most easily assumed into a pass" |

**The standing risk that outranks every row above:** production has no restorable backup.
`docs/runbooks/tracking-service-provisioning.md:28` records
`supabase backups list --project-ref uleeeziiceduvmiftgby -o json` →
`{"backups": [], "pitr_enabled": false, "walg_enabled": true}`. Two hard-deleting scheduled
jobs (`retention-cleanup`, `survey-draft-retention`) run against that database on a timer.

## 7. Client promises measured against code

| Promise | State |
|---|---|
| 200+ question pool (`docs/requirements/TECH_SPEC.md` §3) | NOT DELIVERED — library is empty in production; no importer script exists |
| AI adaptive questions | NOT DELIVERED — deferred by ruling, unsigned by the client |
| Report Center (`TECH_SPEC.md` §12) | STUBBED — see §4 |
| URL + QR distribution (CLIMA-005) | PARTIAL — share link complete, no QR renderer (`SurveyDistributionEndpoints.cs:226`) |
| Question Library with categories/search/tags/ES-EN (CLIMA-002, P0) | API complete; no production UI; no content loaded |
| Autosave / draft recovery (CLIMA-006, P0) | DELIVERED |
| Multilanguage ES/EN (P1) | DELIVERED — 2,795 keys each side, exact parity |
| Department-admin / leader capability matrix (PRD) | Of ~20 matrix capabilities, one ships. See `docs/decisions/leader-supervisor-scope.md` |

---

## 8. Ordered list — CODE/DOCS an agent can build with no human input

1. **Wire report rendering to the PDF/CSV serialisers that already exist.**
   `src/ClimateProject.Application/Exports/PdfDocument.cs` is written, tested and consumed
   by `SurveyExportEndpoints.cs:59,62`; `ReportEndpoints.cs:109-126` produces no file. The
   aggregation is already real — only the last mile is absent.
2. **A runnable question-library importer** (`scripts/import-question-library.*`) that
   creates categories parents-first, then items, checks response bodies not just status, is
   resumable and idempotent, and asserts the expected count. Today the procedure is a
   hand-pasted `curl` loop in `docs/runbooks/question-library-import.md` that has never been
   executed end to end. The instrument file and the global-vs-company ruling are human; the
   tool is not.
3. **A UI to mint a report share token.** `POST /admin/reports/{id}/share` is complete and
   defended (30 integration facts across `ReportShareEndpointsTests.cs` and
   `ReportShareRefutationTests.cs`); no button anywhere calls it, so UAT §6.4 can only be run
   by a TIMS operator with `curl`.
4. **Web callers for `/microclimates/{id}/export`, `/export/csv` and `/insights`** — or a
   `docs/decisions/` record saying they stay API-only. The server side is finished and
   tested; the copy-pattern is `web/src/features/surveys/api/surveyExport.ts` (bearer fetch
   → blob), not an `<a href>`, because the routes need an `Authorization` header.
5. **The maintenance page and logs viewer (#141)** — C8's own precondition, and the only
   code-shaped item on the cutover critical path.
6. **A credential-rotation script for the five seeded production accounts** over
   `POST /auth/admin/reset-credentials`, plus a `docs/decisions/` record for P14. Turns
   "rotate them, or disable them" from an unowned sentence into a one-command action. A
   human still runs it and distributes the results.
7. **Add the future API hostname to `web/vercel.json:32`'s `connect-src` alongside the
   current one.** A CSP violation fails in the browser console, not as an HTTP error, so at
   cutover it would not look like a DNS or CORS problem.
8. **Correct the stale claims in neighbouring documents** — `docs/runbooks/cutover.md`'s own
   "Errors found in neighbouring documents" section names eight, across `infra/aws/README.md`,
   `docs/runbooks/legacy-dependencies.md` (rows 5, 8, 9) and the root `README.md`. Two
   documents currently give opposite answers about a startup-failure guard.
9. **Stamp the web build with its commit** (one env var from `VERCEL_GIT_COMMIT_SHA`).
   Nothing can currently assert what commit the front end is at.
10. **A test pinning the exact worker heartbeat format string.** Every job-absence alarm the
    alerting runbook specifies asserts a literal from `src/`; a reword silences them all with
    no error anywhere.
11. **Tests for the four untested routed pages** in §2 — `CompaniesListPage`,
    `SystemSettingsPage`, `AcceptInvitationPage` first; the third is the onboarding entry
    point for every new user.
12. **A QR renderer for `/s/{token}`** — CLIMA-005 is a P0 client requirement and
    `QrCodeUrl` holds a URL string today.
13. **A synthetic seed script for staging (#156).** The anonymisation requirement collapsed
    into "synthesise" once `docs/decisions/no-data-migration.md` landed, so this no longer
    waits on the database decision to be *written*.
14. **`CLAUDE.md`, an architecture document, and a gotchas index (#167).** Four of five
    deliverables are writing against material already in the repo. `CLAUDE.md` does not
    exist, so every agent session starts from a wrong map.

## 9. Ordered list — HUMAN-ONLY, with the exact value, click, decision or payment

1. **A restorable production backup.** *Needed:* either a Supabase plan decision (Pro, and
   the org also bills a different client's product) **or** one command —
   `supabase db dump --linked -f ~/climate-backups/prod-$(date +%Y%m%d).sql`. Money, or ten
   minutes. Measured state: `pitr_enabled: false`, `"backups": []`.
2. **`aws sts get-caller-identity` against `747814092517`.** *Needed:* a human running one
   command, ten seconds. If nobody holds those credentials, break-glass rollback does not
   exist and every recovery depends on GitHub Actions being reachable.
3. **One real invitation email opened in one real inbox.** *Needed:* a mailbox and one hour.
   Until then "invitations work" is an inference about a YAML file. UAT gate 2, cutover A8's
   blank exit criterion.
4. **Rotate or disable the five seeded production accounts (P14).** *Needed:* the decision
   (rotate vs disable-and-recreate) and the new passwords, before real employee data arrives.
5. **A Teams webhook URL, a fallback distribution list, and someone clicking the SNS
   confirmation link.** *Needed:* two values and one click. `infra/aws/climate-project-observability.yml`
   declares `TeamsWebhookUrl` and `FallbackEmail` with no defaults; an unconfirmed SNS
   subscription is silently discarded.
6. **Name the incident decision owner and a backup, with the hours each covers, and ratify
   the six rollback thresholds.** *Needed:* two names and a meeting.
   `docs/runbooks/rollback.md:471` — "**Decision owner (one name, reachable for the whole
   watch period): `____`**" — is literally blank.
7. **The Supabase staging purchase (#156).** *Needed:* an owner who can commit the monthly
   spend on an org that also bills `tims-ats`. Unblocks #156 → #159's rehearsal → #162.
8. **`PROCOMER_COMPANY_ID`.** *Needed:* one GUID, read from production
   (`SELECT id, name FROM companies`), plus the tracking database and a connection string
   carrying `Maximum Pool Size=10` — there is no `DatabaseConnectionStringPolicy` in the
   tracking service, so Npgsql would default to 100 per process.
9. **Google OAuth authorized origins must contain `https://climate.timsint.com/auth/loading`.**
   *Needed:* one paste in the Google Cloud console. Sign-in breaks the instant the origin
   changes, with no deploy to roll back.
10. **Schedule UAT with real client users, five of whom must actually answer a survey.**
    *Needed:* the client's people, a date, and a mailbox they can open — plus an agreed
    `UAT — …` naming convention and a named person who deletes the production rows UAT
    creates, because there is no staging.
11. **PROCOMER's sign-off on two scope reductions:** (a) question adaptation deferred out of
    16 Nov; (b) turnover/attrition prediction dropped. *Needed:* a conversation and a
    signature. Both are binding PRD requirements; `docs/requirements/README.md` states that
    dropping one "needs the client's sign-off — not an engineering judgement call."
12. **The PROCOMER instrument file, plus the global-vs-company-owned ruling.** *Needed:* a
    44–50 question file and one irreversible choice — `CompanyId` is immutable after
    creation. Until then the question picker renders empty in production in both wizards.
13. **The `leader` / `supervisor` product decision.** *Needed:* Federico picks option 1, 2
    or 3 in `docs/decisions/leader-supervisor-scope.md`, and rules on whether the floor of 5
    applies to leader-facing counts.
14. **The self-signup decision.** *Needed:* one of the three options in
    `docs/decisions/self-signup-gate.md`. Today anyone who can spell a customer's email
    domain gets a live employee account inside that customer's tenant.
15. **An API hostname decision and a Namecheap login (#160).** *Needed:* a name and a
    console session. Note the trap: `VITE_API_BASE_URL` is a Vite **build-time** value, so
    this is a Vercel rebuild plus a `web/vercel.json` CSP change plus `CLIMATE_PROJECT_BASE_URL`
    — not a variable edit. And `climate.timsint.com` must keep resolving, or every share and
    survey link already in circulation breaks.
16. **Secret rotation (#70).** *Needed:* Atlas, the legacy vendor's host, Google and Brevo
    console sessions. Every `Rotated?` box in `docs/security/rotation-inventory.md` is still
    unticked.
17. **The Vercel auto-deploy posture during an incident.** *Needed:* one decision. Merges to
    `main` silently roll the web forward again, so a web rollback a merge undoes is not a
    rollback.
18. **`VITE_TRACKING_API_BASE_URL` on Vercel — Production scope only, and LAST.** *Needed:*
    one variable, set only after the tracking service is verified. Setting it early removes
    Action Plans from the client's navigation and offers a dead module. Deploying tracking at
    all arms `DailySemaforoWorker`, which mails action-plan owners on first boot with no
    separate switch.
19. **Log retention days.** *Needed:* one number, against a government client's data-retention
    commitments. Corrected measurement at `835bcee`: `grep -rn "RetentionInDays" infra/`
    returns exactly **one** hit —
    `infra/aws/climate-project-synthetic-probe.yml:284` — so the probe's own log group has a
    retention setting and the API service's logs do not. The earlier "zero hits repo-wide"
    note in the alerting runbook is stale; the gap is narrower than it says, and still open.
20. **The recorded go-ahead (C9).** *Needed:* a named person, on the day, in writing.
21. **The Coolify console** for #163 criterion 2. *Needed:* the previous vendor's access. The
    legacy host's address exists in no repository, so the post-cutover access-log evidence
    window has no target and the decommission milestone cannot start.

---

## 10. Wave launched 2026-09-03

Twelve lanes were launched against `835bcee` on the day this audit was written. They are
listed so a reader can tell which rows above are in flight. **Nothing here is a claim about
any lane's outcome** — a lane may land, be refuted, or be abandoned, and this document does
not know which.

**Code lanes (8):**

| Branch | Rows above it touches |
|---|---|
| `reports-file` | §4 report download; §8 item 1 |
| `notification-templates` | §4 templates ignored at dispatch |
| `signup-policy` | §4 self-signup; `docs/decisions/self-signup-gate.md` |
| `scripts` | §8 items 2, 6, 13 |
| `microclimate-export` | §1 and §4 microclimate export; §8 item 4 |
| `survey-qr` | §7 CLIMA-005; §8 item 12 |
| `web-stamp-tests` | §8 items 9, 11 |
| `maintenance-page` | §6 P9/C8; §8 item 5 |

**Docs lanes (4):**

| Branch | Rows above it touches |
|---|---|
| `uat-gaps` | §3 uncovered routes |
| `stale-docs` | §8 item 8 |
| `gap-audit` | this document, plus `docs/decisions/self-signup-gate.md` and the dated block in `docs/decisions/leader-supervisor-scope.md` |
| `claude-md` | §5 #167; §8 item 14 |
