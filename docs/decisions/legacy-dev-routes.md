# The legacy `test-*` / `debug` routes are dev scaffolding and are NOT migrated

Decided while resolving #149. Thirty route handlers under the legacy Next.js app's
`src/app/api/` are deliberately absent from the .NET API. This records the classification so a
later parity audit finds an answer here instead of thirty unexplained gaps.

Four further scaffolding handlers that #149's list does not name — `admin/seed-data`,
`admin/seed-data/users`, `admin/scope-test` and `system/integration-tests` — are classified in
[their own section](#adjacent-scaffolding-the-issue-did-not-name-4) for the same reason: an
auditor sweeping `src/app/api/` for dev scaffolding reaches them too, and a record that stops at
the issue's list would leave them looking like oversights.

The sibling record for one route classified the same way during #107 is
[`survey-template-seed.md`](survey-template-seed.md).

## Scope of this document

This is a **migration decision record**. It says which legacy routes exist, what each was for,
and why none is being ported.

It deliberately does **not** describe the authorization posture of individual legacy handlers.
The audit did produce security findings, and they are recorded where the affected code lives —
see [The security half](#the-security-half). This repository is public and the legacy
application is not; a per-route security map published here would be useful to precisely one
audience, and it is not this one.

## Decision

**All thirty are dev scaffolding. None is migrated. None gets a replacement route.** The same
verdict applies to the four adjacent handlers classified further down. Their names must not be
recreated in the .NET API; `web/src/test/legacyDevRoutes.test.ts` enforces that.

## What was examined

The legacy checkout, not the route names. Every one of the thirty `route.ts` files under
`src/app/api/` was read. Each of the thirty exports exactly one HTTP method, so thirty files is
thirty endpoints. (That does not hold for the four adjacent files — see their section;
`admin/seed-data` alone exports three.)

The issue title says 32. **The count derived from the issue's own list is 30**: it names 25 path
prefixes — 22 `test-*` directories plus `create-test-report`, `check-report-data` and
`seed-survey-data` — and `debug/*`, and `debug/` holds five handlers. 25 + 5 = 30.

Where 32 came from is not recorded and cannot be recovered: the issue shows no derivation, and
the archived tracker entry it replaces gives a third figure —
`docs/legacy-issues/climate-project-issues.md:1202` says "21 routes under `src/app/api/test-*`"
where that directory holds 22. So the headline number is not a file count and should not be
reconciled against one. What can be checked is the file count, and the four scaffolding routes
the issue's list does not name are classified below on their own merits rather than used to make
a difference add up.

## The security half

#149 requires that a production-reachable mutating route be escalated as a finding rather than
quietly dropped. It was, on 2026-08-10.

| | |
| --- | --- |
| Raised | 2026-08-10, from this issue's audit |
| Tracked as | `climate-project#75` — **private repository** |
| Owner | @tafurfede |
| Status when this was written | **Open.** Not closable from this repository. |

The detail lives in that issue, in the repository that holds the affected code. What remains
open there is a **deployment** question rather than a code question, and it is the reason the
finding cannot simply be closed as historical: it turns on whether the legacy application is
still served from a public origin. That is also why **#164** (retire the legacy Vercel
deployment) is the remedy rather than patching routes in a stack being retired.

## Classification

Seventeen of the thirty write to the database. The "Classification" column records what each
handler was *for* — enough for a parity auditor to confirm nothing of value was dropped.

### Read-only (13)

| Route | Method | Classification |
| --- | --- | --- |
| `test-check-company-ids` | GET | Dev-only. Dumps ids and company ids for companies, surveys and responses. |
| `test-check-completion-times` | GET | Dev-only. Dumps response timing and completion flags. |
| `test-check-responses` | GET | Dev-only. Newest survey plus its responses with per-response answer counts. |
| `test-db` | GET | Dev-only connectivity probe: three `countDocuments()` calls. Superseded by `/ready`. |
| `test-debug-report-object` | POST | Dev-only. Logs the newest report's key set and the runtime types of `metadata` / `metrics`. A Mongoose typing probe, nothing more. |
| `test-generate-data` | POST | Dev-only. Runs `ReportService.generateReportData` and returns row counts. Named "generate", writes nothing. |
| `test-simple-report` | POST | Dev-only. Reads surveys and responses and returns counts. Writes nothing despite POST. |
| `test-report-filters` | GET | Dev-only. Prints a report's `filters` plus survey ids and titles. |
| `check-report-data` | GET | Dev-only. Returns a report document whole. |
| `debug/users` | GET | Dev-only. A short user listing. |
| `debug/raw-users` | GET | Dev-only. The same, fetched through the raw driver to bypass the model's post-find hook. |
| `debug/test-user-query` | GET | Dev-only. Looks one hardcoded address up three ways to compare the results. |
| `debug/session` | GET | Dev-only. Echoes the caller's own session and three permission booleans. |

### Writing (17)

| Route | Method | Classification |
| --- | --- | --- |
| `test-fix-company-ids` | POST | Dev-only repair script. Reassigns company ids on survey and response documents. |
| `seed-survey-data` | POST | Dev-only seeder. Inserts fabricated surveys and responses; a query-string flag clears the collections first. |
| `debug/fix-user-email` | POST | Dev-only repair script. Overwrites a user's email. Written for a masking-on-save bug the legacy model no longer has — its `pre('save')` hook now documents that the masking "was corrupting the actual data" and skips it. |
| `test-mongoose-save` | POST | Dev-only. Overwrites a report's `metadata` and `metrics` with fixed invented numbers. |
| `test-populate-report` | POST | Dev-only. Regenerates and overwrites a report's populated sections through `ReportService`. |
| `test-update-report-filters` | POST | Dev-only. Overwrites a report's `filters.survey_ids`. |
| `test-update-time-filter` | POST | Dev-only. Overwrites a report's `filters.time_filter` with a hardcoded window. |
| `create-test-report` | POST | Dev-only. Inserts a fully populated report with invented demographics. |
| `test-report-creation` | POST | Dev-only. Inserts and populates a report, scoped to the caller's own company. |
| `test-fresh-report` | POST | Dev-only. Inserts a report with invented metrics. |
| `test-schema-validation` | POST | Dev-only. The same insert, to see which fields survive validation. |
| `test-simple-save` | POST | Dev-only. Inserts then re-saves with invented metrics, to isolate insert from update. |
| `test-minimal-report` | POST | Dev-only. Inserts a required-fields-only report. |
| `test-simple-report-creation` | POST | Dev-only. Inserts a slightly larger report. |
| `test-minimal-seed` | POST | Dev-only. Inserts one survey and five responses. |
| `test-survey-creation` | POST | Dev-only. Inserts a one-question draft survey. |
| `test-mixed-schema` | POST | Dev-only. Registers a throwaway model, saves, reads back and deletes, to check whether `Schema.Types.Mixed` round-trips. The only writer that cleans up after itself. |

### Adjacent scaffolding the issue did not name (4)

Sweeping every `route.ts` under the legacy `src/app/api/` for scaffolding names turns up five
more handlers that #149's list does not mention. Four are classified here; the fifth,
`surveys/templates/seed`, already has its own record from #107
([`survey-template-seed.md`](survey-template-seed.md)) and is not repeated.

These four get the same verdict — **dev-only, not migrated, no replacement** — and are recorded
so the sweep does not leave them unexplained. Nothing calls them either: the only match for
their paths outside their own files is a comment in `src/lib/tracking-api-client.ts:19`.

They are a separate table because one property of the thirty does not hold: three of the four
export more than one HTTP method (`admin/seed-data` exports three), so file count is not
endpoint count.

| Route | Methods | Classification |
| --- | --- | --- |
| `admin/seed-data` | POST, GET, DELETE | Dev-only seeder. POST inserts a fixed set of companies and departments; DELETE clears them; GET returns listings and a role distribution. |
| `admin/seed-data/users` | POST | Dev-only seeder. Inserts a fixed roster of users. Refuses to run when users already exist unless forced. |
| `admin/scope-test` | POST, GET | Dev-only harness. Runs `ScopeTestingService` against synthetic role contexts and returns a report. It asserts multi-tenant scoping rather than implementing it — a test suite behind an HTTP endpoint. |
| `system/integration-tests` | POST, GET | Dev-only harness. POST runs the app's integration suite in-process and returns the report; GET lists the available suites. Already recorded as deliberately not ported in `src/ClimateProject.Api/Endpoints/SystemStatusEndpoints.cs`; #147 asked for that evaluation to happen here, and this is it. |

## Why none of the thirty is hiding behaviour we need

Three independent checks, all negative:

1. **Nothing calls them.** Grepping the whole legacy `src/` tree for these paths returns no
   caller — no component, no hook, no test.
   (`src/__tests__/demographics-flow-integration.test.ts` matches `test-db` only inside the
   string `mongodb://localhost:27017/test-db-global`, a database name.) They were driven by hand
   from a terminal.

2. **The one capability worth keeping already exists.** `test-db` answered "is the database
   reachable". The .NET API answers it better: `GET /ready` in
   `src/ClimateProject.Api/Program.cs` executes a real `SELECT 1` and returns 503 on failure,
   where `/health` is a static literal for the App Runner liveness probe. Everything else these
   thirty do is either a read the product's own authorized endpoints already cover, or a write
   nobody should be able to make.

3. **They are debugging transcripts, not designs.** Seven of the seventeen writers insert a
   near-identical report and differ only in which field they omit —
   `test-minimal-report` → `test-simple-report-creation` → `test-simple-save` →
   `test-fresh-report` → `test-schema-validation` is one person bisecting a Mongoose
   `Schema.Types.Mixed` persistence problem one route at a time, with `test-mixed-schema` and
   `test-mongoose-save` as the reduced cases. There is no behaviour in the sequence, only its
   author's search path.

## The one thing worth carrying to #88, and the trap in it

The issue asked whether the report-filter routes encode real filter behaviour worth reading
before #88. **They do not.** `test-report-filters` only prints `report.filters`. Neither
`test-update-*` route derives a filter from anything a caller supplied — they read no request
body at all: `test-update-time-filter` assigns a hardcoded 2024–2025 window (`route.ts:19`), and
`test-update-report-filters` assigns `[survey._id.toString()]` for whichever survey happens to be
newest (`route.ts:29`). One is a literal and one is a database lookup, but neither encodes filter
*behaviour* — there is no predicate, no validation and no shape to port. What reading them does
establish is the legacy filter shape, which is the useful part:

```ts
filters: {
  survey_ids: string[],
  time_filter: { start_date: Date, end_date: Date },
}
```

`IReportFilters` in `src/models/Report.ts` additionally declares optional `demographic_filters`,
`department_filter`, `survey_types` and `benchmark_ids`, none of which any dev route exercises.

**The trap:** `create-test-report` and `test-report-creation` write a `config` of
`{ sections, includeCharts, includeExecutiveSummary, includeRawData }`. That is not the declared
shape. `ReportConfigSchema` in the same file declares only `include_charts`, `include_raw_data`,
`include_ai_insights`, `include_recommendations`, `chart_types` and `custom_sections`, and sets
no `strict: false` anywhere in the file — so under Mongoose's default strict mode those four
camelCase keys are silently discarded on save. Anyone mining `create-test-report` for a reference
report config would be copying keys that legacy never persisted. The snake_case set is the real
one.

## The rule this leaves behind

**A diagnostic endpoint is a production endpoint.** These thirty were written as "just for
testing", and every one of them was nonetheless part of whatever HTTP surface the app shipped
with, because nothing in Next.js makes a route conditional on the environment unless the handler
does it itself.

So: no `test-*` or `debug` route in the .NET API, and no route that skips authorization on the
grounds that it is temporary. Diagnostics belong in a test project, or behind the same
authorization as the data they read. The single legitimate need in the whole set — "is the
database reachable" — is met by `/ready`, which is unauthenticated on purpose, reads no tenant
data, and is careful not to echo the Npgsql failure message back to the caller.

## Consequences

- Thirty legacy endpoints have no counterpart, permanently, and neither do the four adjacent
  handlers in their own table. A parity audit should reconcile the legacy `src/app/api/` dev
  scaffolding against this file plus [`survey-template-seed.md`](survey-template-seed.md), which
  covers the one remaining seeder. Reconcile against the file list, not against the "32" in the
  issue title — that number has no derivation behind it.
- The security half of #149 is escalated and open as `climate-project#75`, in the private
  repository. It cannot be closed from here, and its remedy runs through **#164**.
- There is still no seeding mechanism in the product, by the same decision recorded in
  [`survey-template-seed.md`](survey-template-seed.md). Bringing up a populated environment is a
  separate, deliberate piece of work, not a route.
- `web/src/test/legacyDevRoutes.test.ts` fails if a row is dropped from any of the three tables
  above, if a row moves between the read-only and writing tables, if a heading's count stops
  matching its rows, or if the escalation loses its tracking id. It also fails if one of the
  thirty names reappears as an endpoint route in `src/ClimateProject.Api/` — the adjacent four
  are excluded from that last check on purpose, because `system/integration-tests` is named there
  deliberately, in the paragraph of `Endpoints/SystemStatusEndpoints.cs` that records why it was
  not ported.
- **It also fails if this document regains a per-route authorization column or similar
  disclosure detail.** That guard exists because the first version of this file carried one and
  had to be removed from a public repository.
