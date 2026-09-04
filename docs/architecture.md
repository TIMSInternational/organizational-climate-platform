# Architecture — the system as shipped

Written for whoever inherits this. It describes what **is**, measured against `main` on
2026-09-04, not what was planned. Where something is absent, it says so; a document that only
lists what exists is how the next person loses a week discovering what does not.

Companion documents: `CLAUDE.md` (the rules an agent cannot derive), `docs/gotchas.md` (things
that cost real time), `docs/runbooks/` (procedures), `docs/decisions/` (rulings and their
reasoning).

## One paragraph

A .NET 10 minimal-API monolith serving a React SPA, over one Postgres database, plus a second,
smaller .NET service for action-plan tracking that has its own database and has never been
deployed. Companies run climate surveys and microclimates; employees answer them; results are
read back as dimension scores, a climate map and action plans, under an anonymity floor that is
applied at read time and is the single invariant most of the design bends around.

## The pieces

| Project | Lines | What it is |
|---|---|---|
| `web/` | 67,745 | React 19 + Vite SPA, 56 production routes, en/es at exact key parity |
| `src/ClimateProject.Api` | 26,590 | Minimal-API endpoint groups, one file per domain area (51 of them, 217 endpoints) |
| `src/ClimateProject.Application` | 21,492 | Domain services, projections, exports, privacy rules. No EF, no HTTP |
| `src/ClimateProject.Infrastructure` | 9,442 | EF Core, 56 migrations, persistence configuration, scheduling primitives |
| `src/ClimateProject.Domain` | 1,821 | Entities only |
| `src/ClimateProject.Workers` | 1,149 | Nine hosted services and their registration extension |
| `services/tracking-api/` | 2,082 | A separate solution: Domain, Application, Api. Its own database, its own CI job |

Migrations are excluded from every line count above — there are 56 of them and 227,510
generated lines, which would otherwise be three-quarters of the repository.

## The request path

```
browser ──▶ Vercel (web/, static SPA)
              │  fetch with a bearer token; never <a href> for an authorized download
              ▼
        AWS App Runner ──▶ ClimateProject.Api ──▶ Application ──▶ EF Core ──▶ Postgres (Supabase)
        climate-project-api-prod                                              session pooler, 5432
```

The SPA is served entirely by Vercel and talks to one API host, pinned in
`web/vercel.json`'s CSP `connect-src`. **A CSP violation fails in the browser console, not as
an HTTP status** — which is why that file has to change in the same breath as any API hostname
change.

## Authentication and the five roles

JWT bearer (`Program.cs:213`), no cookies, no session store. Five roles, in
`Application/Auth/Roles.cs`:

`super_admin` · `company_admin` · `leader` · `supervisor` · `employee`

Two things about them that surprise people:

- **`leader` and `supervisor` are the same product today.** They reach an identical set of
  routes; the one route that would separate them belongs to the undeployed tracking module.
- **A `super_admin` has no implicit company.** Since #191 their `companyId` claim is the empty
  string, so anything company-scoped requires an explicit selection through `company-context/`.
  Pages branch on `useCompanyScope()`'s three states rather than inventing a default.

Route-level gating is deliberately thin: `/admin/*` routes are not role-gated in the router.
Every endpoint checks `Roles.Admin` and then scopes by role, so a leader who types an admin URL
meets the page's own error state, never another tenant's data. `navigation/navSections.ts` is
what keeps the row out of their sidebar, and `navigation/roleCapabilities.ts` is the table that
must gain any new destination or the suite goes red.

## The invariant: a floor of five

`Application/Surveys/SurveyResultsPrivacy.cs:61` — `MinimumRespondents = 5`.

It is applied **at read time**, not at write time, and it governs every surface: screens,
exports, reports and public share links. The classic leak is rendering a suppressed segment as
`0`, which reads as "nobody answered" rather than "we will not say". Verbatim open-text
response content is never returned anywhere — word frequencies only.

Any new read path inherits this. It is not optional and it is not per-feature.

## Scheduling — nine workers, in the API process

`Program.cs:406` calls `AddClimateProjectScheduling`, so **every API instance runs all nine
hosted services**:

`NotificationDispatchWorker` · `InvitationReminderWorker` · `DigestWorker` ·
`MicroclimateLifecycleWorker` · `SurveyLifecycleWorker` · `SurveyDraftRetentionWorker` ·
`RetentionCleanupWorker` · `ScheduledReportWorker` · `WorkerHeartbeatMonitor`

They do not duplicate work across instances because each takes a **Postgres advisory lock**
first (`Infrastructure/Scheduling/PostgresAdvisoryJobLease.cs`). As the comment in `Program.cs`
puts it, twenty-five API instances are exactly one scheduler.

**`Dockerfile.workers` exists and nothing deploys it.** It builds `ClimateProject.Workers` as a
standalone host — a topology the code supports and the infrastructure does not use. Do not
assume from its presence that workers run separately; they do not.

## The tracking service

`services/tracking-api/` is a **separate solution** (`ClimateTracking.slnx`), with its own
database, its own CI job, and its own deploy workflow. `dotnet test ClimateProject.slnx` does
**not** cover it — running only the first and calling it "the full suite" misses 164 tests.

It is **single-tenant by construction**: there is no company column anywhere in its domain, and
`ProcomerCompanyId` pins the whole deployment to one client. "Scope it by company" is not a
change that can be made to it.

It has never been deployed. Its screens ship dormant in the web bundle, gated by
`isTrackingEnabled()`, which is false when `VITE_TRACKING_API_BASE_URL` is blank. Turning it on
changes the navigation: `/action-plans` is **replaced** by `/tracking/planes`, by a ruling of
2026-08-21 — one place to manage plans, not two that disagree.

## What is deployed, and what is not

| | State |
|---|---|
| `climate-project-api-prod` (App Runner) | **live**, commit `e0896f9` |
| Web (Vercel) | **live**, `climate.timsint.com` |
| Postgres (Supabase) | **live**, 56 migrations applied. **Backed up 2026-09-04T22:38Z** — the first restorable copy this project has had |
| `climate-project-synthetic-probe-prod` | **live** — 3 alarms that notify nobody |
| `climate-project-observability` | **written, never deployed** — 22 alarms, 20 metric filters |
| `climate-tracking-api-*` | **written, never deployed** |
| Staging | **does not exist** — `deploy-staging.yml` has 0 lifetime runs |

## What the code does not do

Named because absence is the expensive thing to discover late:

- **No AI inference anywhere.** There is no Bedrock or Anthropic call in `src/`. Microclimate
  sentiment is a hard-coded zero; the provider decision is an unapproved draft. See
  `docs/decisions/adaptive-questions-are-rule-based.md`.
- **Scheduled reports are unreachable.** `ScheduledReportJob` filters on `IsRecurring`; no API
  path sets it, so the job runs and selects nothing.
- **Adaptive questions are stored and never evaluated.** `QuestionConditionalLogic` is
  persisted, duplicated and GDPR-classified; nothing reads it to decide what a respondent sees,
  and no UI creates one.
- **Report comparison and filters** are two TODOs in `ReportGeneration.cs`, tagged to #88 — the
  only two TODO markers in 1,176 source files.
- **Self-signup has no gate.** Anyone at a registered email domain creates a live employee
  account, with no approval and no off-switch of its own. Written up in
  `docs/decisions/self-signup-gate.md`; still undecided.

## Testing shape

7,053 tests. Web 3,736 (vitest, happy-dom — **no layout engine**, see `docs/gotchas.md`),
.NET 1,585 unit + 1,568 integration against real Postgres in Testcontainers, tracking 95 + 69.

There is **no coverage tooling** in this repository — no coverlet, no v8, no CI threshold. The
suites are large and green and nothing measures what they do not reach.
