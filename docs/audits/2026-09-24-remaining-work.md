# What is left — 2026-09-24

**Commit measured:** `649fd077` (`main`). Production API at `649fd077`, **drift 0**. Web live at
`https://climate.timsint.com`. 36 open issues, 0 open PRs, 60 declared routes.
**53 days to go-live (16 November 2026).**

**What this is.** An additive successor to `2026-09-05-gap-closures.md` and
`2026-09-03-functional-gaps.md`, neither of which it edits. The 09-03 audit was pinned to
`835bcee`; `main` has moved a long way since, so most of this file is **drift measurement**: which
of its rows closed, which did not, and what is new. Every row was re-opened against the working
tree or the live account at `649fd077`; a citation nobody opened is a rumour.

**The one-sentence answer.** The product is close to functionally complete and **what remains is
overwhelmingly operational, not code** — but production is running with **alerting that reaches
nobody** and **no restorable backup regime**, and those two outrank every feature row below.

---

## 1. The headline finding: the alarms notify nobody

The 09-03 audit recorded `describe-alarms` → `[]` for this product. That has changed, and the
change is less than it looks.

```
$ aws cloudwatch describe-alarms --alarm-name-prefix climate --region us-east-1
  climate-project-api-prod-synthetic-probe-api-down   OK   AlarmActions: 0
  climate-project-api-prod-synthetic-probe-api-slow   OK   AlarmActions: 0
  climate-project-api-prod-synthetic-probe-web-down   OK   AlarmActions: 0
$ … --query 'length(MetricAlarms[?length(AlarmActions)==`0`])'   →  3
```

**Three alarms exist. All three have zero actions.** They evaluate, they change state, and no
human is told. The account holds 46 alarms in total; the other 43 are `nexa-*`, a different
product — counting the account total reads as monitoring this product does not have.

The runbook says so itself, and honestly — `docs/runbooks/alerting.md:568`:

> CloudWatch alarms in this stack | Evaluate and change state. **Notify nobody** — the deploy
> command below passes `AlarmTopicArn=''`

And `alerting.md:426`: worker heartbeat alarms are **"Templates authored, not applied. Seven
per-job alarms plus the in-process stale alarm."**

```
$ aws cloudformation describe-stacks --query 'Stacks[?contains(StackName,`climate`)]'
  climate-project-synthetic-probe-prod   CREATE_COMPLETE
  climate-project-api-prod               UPDATE_COMPLETE
  climate-project-api-bootstrap          UPDATE_COMPLETE
```

`infra/aws/climate-project-observability.yml` is **not a deployed stack**. So of the alarm set the
alerting runbook specifies, 3 are deployed and muted and the rest do not exist.

**Why this row is first.** An alarm with no action is worse than no alarm: it produces the
appearance of monitoring. A 24-hour outage would be discovered by the client, not by us.

**In fairness to whoever built it, the darkness was deliberate and correct.** `alerting.md:688`
sets the gate explicitly — *"Only wire `AlarmTopicArn` after you have seen a run of green
periods"* — because a probe warming up legitimately goes `ALARM` once, and a channel whose first
message is a false alarm teaches people to ignore it. The failure is not the dark deploy. It is
that **step two never happened, and the gate has been met for three weeks**:

```
$ aws cloudwatch describe-alarm-history --alarm-name climate-project-api-prod-synthetic-probe-api-down
  2026-09-02T18:39:32  Alarm updated from ALARM to OK
  2026-09-02T18:37:32  Alarm updated from INSUFFICIENT_DATA to ALARM
```

One early `ALARM` on `api-down` and `web-down`, cleared in two minutes exactly as predicted
(`api-slow` went straight to `OK`), then **zero state changes on all three alarms for 22 days**.
The derived-period reasoning held and nothing flapped. There was nothing left to wait for.

What was actually missing was a button: **no workflow deploys
`climate-project-observability.yml` at all**, so the only route was a hand-pasted command from the
runbook. Addressed by `.github/workflows/ops-deploy-observability.yml` (#510). The human part is
unchanged and small — a Teams webhook URL, a fallback distribution list, and clicking the SNS
confirmation link, which is silently discarded if nobody does.

## 2. The standing risk, unchanged since 3 September

Production still has **no restorable backup regime**.
`docs/runbooks/tracking-service-provisioning.md:28` records
`{"backups": [], "pitr_enabled": false, "walg_enabled": true}` — `walg_enabled` means the engine
exists, not that anything restorable is listed. Two hard-deleting jobs (`retention-cleanup`,
`survey-draft-retention`) run against that database on a timer, and the 09-05 audit notes the one
`supabase db dump` that was taken **is on a laptop**.

## 3. Closed since 2026-09-03 — measured, not assumed

The 09-03 audit's §8 ordered list of fourteen agent-buildable items is now largely spent:

| 09-03 gap | State at `649fd077` |
|---|---|
| §8.1 report rendering produces no file | **CLOSED** — `ReportEndpoints.cs:299` `Results.File(bytes, …)`; pdf and csv both produced |
| §8.2 no question-library importer | **CLOSED** — `scripts/import-question-library.mjs` + `.test.mjs` |
| §8.3 no UI mints a report share token | **CLOSED** — `ReportShareDialog` (+ test) |
| §8.4 no web caller for microclimate export | **CLOSED** for export — `features/microclimates/api/microclimateExport.ts`. `/insights` deliberately unread (§5) |
| §8.5 maintenance page | **CLOSED** — `web/public/maintenance.html`. Logs-viewer half: see §6 |
| §8.6 no credential-rotation script | **CLOSED** — `scripts/rotate-seeded-accounts.mjs` + test |
| §8.7 CSP pins only the old API host | **CLOSED** — `web/vercel.json:32` carries `https://api.climate.timsint.com` alongside it |
| §8.9 web build not stamped | **CLOSED** — `vite.config.ts:20,47`, `VITE_BUILD_COMMIT`, with `buildInfo.test.ts` |
| §8.11 four untested routed pages | **3 of 4 CLOSED** — `CompaniesListPage` 2, `SystemSettingsPage` 1, `AcceptInvitationPage` 2 test files. `StorefrontGalleryPage` 0 (dev-only) |
| §8.12 no QR renderer | **CLOSED** — `qrcode-generator@2.0.4`; `ShareLinkQr.tsx`, `SessionQr.tsx`. CLIMA-005's user-facing half is delivered client-side |
| §8.14 no `CLAUDE.md`, architecture doc, gotchas index | **CLOSED** — `CLAUDE.md` (7.5 KB), `docs/architecture.md`, `docs/gotchas.md`, `docs/retrospective.md` |
| §4 `notification_templates` ignored at dispatch | **CLOSED** — `EmailNotificationSender.cs:116` `NotificationTemplateDispatch.Compose` |
| §4 signup enforces length only | **CLOSED** — `AuthEndpoints.cs:120` `PasswordPolicyValidation.Validate` |
| §4 `scheduled-reports` job structurally dead | **CLOSED** — `ReportEndpoints.cs:393,424` write `IsRecurring` |
| §4 no period-over-period comparison | **CLOSED** (#452) |
| §1 no production question-library route | **CLOSED** — `router.tsx:412` `/admin/question-library` (#423 closed) |

Shipped since, outside the 09-03 inventory: licence metering for surveys (#497) and microclimates
(#507), and the JWT rotation window (#508).

## 4. Still open — CODE

| Gap | Evidence | Size |
|---|---|---|
| Report **configuration/filters** and **report templates** are the last two unbuilt sections | `ReportGeneration.cs:184` — the in-document note now reads only *"Sections not yet generated: report configuration/filters, report templates"*, and confirms pdf/csv and comparison DO render | medium |
| **`Survey.Type` has no server-side validation** | bare `required string`; `SurveyEndpoints.cs` validates question types only. `ServiceType` IS validated, so #496 cannot recur through the new field, but the original hole stands | small, with a blast radius on existing rows |
| **No staging synthetic seed script** | `ls scripts/ \| grep -iE "staging\|synth"` → none. 09-03 §8.13 listed it; it gates #156 | small |
| Report **dead columns** | `FilePath`, `FileSize`, `SharedWith` — **0 writers** each in `src/` | trivial (schema honesty) |
| `StorefrontGalleryPage` untested | dev-only route, low consequence | trivial |

Blocked on a human decision rather than on code: sentiment/NLP/adaptive questions (#92, #111,
#119) all wait on AI-provider approval and a cost ceiling. `MicroclimateEndpoints.cs` still sets
`SentimentScore = 0` and the UI discloses it — that is correct behaviour for an unapproved
dependency, not a defect.

## 5. Still open — OPERATIONAL, and this is the critical path

| # | Item | Measured | Gate |
|---|---|---|---|
| 158 | Monitoring/alerting | 3 muted alarms; observability stack undeployed | 2 values + 1 click |
| — | Restorable backup | `pitr_enabled: false`, `backups: []` | a plan decision or one command |
| 156 | Staging with prod parity | `deploy-staging.yml` — **0 lifetime runs** | a Supabase purchase |
| 159 | Rollback **tested** (P0) | `rollback-prod.yml` **0 runs**, `rollback-rehearsal-staging.yml` **0 runs** | needs #156 + a named decision owner |
| 161 | UAT with real users | 618-line script, header still `NOT EXECUTED` | people, and #156 |
| 162 | Execute cutover | every upstream gate | go-ahead on the day |
| 70 | Secret rotation | **now unblocked by #508.** Secret created 2026-07-31, one version, `LastRotated: None`; the migration spec (`legacy-issues/climate-project-issues.md:560`) said *"reuse the actual secret value too"* from the compromised legacy app | run the rotation |
| P10 | Tracking service deploy | `deploy-tracking-prod.yml` last run 2026-08-27 → **failure**; still no stack | 3 config values, 2 needing a bought DB |
| P14 | Seeded production accounts | five live logins sharing one password | decision + new passwords (script exists) |

**The chain that decides the date:** #156 → #161 → #159 → #162. Nothing in it is code, and
nothing in it has started.

## 6. Issues that look built but are still open

Flagged rather than asserted — verified against **code**, not against each issue's own acceptance
criteria, and this repo has been wrong in that exact gap before.

| # | Why it looks closeable |
|---|---|
| 134 | Dashboard export: `DashboardEndpoints.cs:128,131` now map `/company-admin/export` and `/department-admin/export`. The 09-03 audit recorded "five routes, none `/export`" |
| 167 | Four of five deliverables exist: `CLAUDE.md`, `docs/architecture.md`, `docs/gotchas.md`, `docs/retrospective.md` |
| 141 | Closed on GitHub, but `docs/decisions/operational-pages.md` still ends `Logs viewer: ____ / Decided by: ____`. The 09-05 audit called this out; it is unchanged. The maintenance page half is genuinely shipped |
| 140, 133 | Both were classified BUILDABLE-NOW where the buildable deliverable is a **decision record** ("recommend dropping if unused"), not a feature |

## 7. What this audit does not cover

- **Production data.** No authenticated production call was made and no production database was
  queried; that is off limits to an agent. So "the question library is empty in production" and
  "a real invitation arrived in a real inbox" remain unverified from here.
- **Acceptance criteria.** §6 compares code against audit rows, not issues against their own
  checkboxes. Closing anything in §6 needs the criteria read first.
- **The tracking module's functional completeness.** It is a separate solution that has never
  deployed successfully, so nothing about its runtime behaviour is measurable.
