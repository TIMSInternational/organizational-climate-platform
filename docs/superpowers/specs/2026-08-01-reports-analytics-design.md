# Reports & Analytics domain (#54) design

## Context

Migrate `Report`, `Benchmark`+`BenchmarkMetric`, `AnalyticsInsight`+`AnalyticsMetricData`+
`AnalyticsTimeSeries`, `AIInsight`, `DemographicSnapshot`+`DemographicSnapshotEntry`+
`DemographicSnapshotChange` to `.NET` API + React pages. Schema for all of these already
exists (`#49`). `DemographicField` (a sibling entity in the same GitHub issue) is
**already done** — `DemographicFieldEndpoints.cs` shipped in org-structure Slice 3; not
revisited here.

## Scope decisions (approved)

- **Report generation is stubbed.** `Report` CRUD/scheduling/status endpoints are real;
  actually rendering a PDF/CSV from survey/analytics data is out of scope — creating a
  report sets `Status = "generating"` then a stub immediately marks it `"completed"`
  with a placeholder `ReportOutput`, matching the stub-now-real-later pattern already
  used for `#52`/`#56`. A real rendering engine is separate future work.
- **Analytics computation is stubbed.** `AnalyticsInsight`/`AIInsight`/etc. get CRUD +
  list + acknowledge endpoints; nothing computes them from real survey responses yet —
  that requires `#51` (surveys, not started) to exist first so there's real response
  data to aggregate. `SurveyId`/`DepartmentId` FKs are still validated against the real
  `Surveys`/`Departments` tables (both already exist from `#49`'s schema).
- **`Benchmark.PriorPeriodBenchmarkId`** (already in the schema) is the fix for the `#20`
  prior-year-benchmark gap — a benchmark can self-reference an earlier period's
  benchmark; the endpoint just needs to accept and validate it, no new field needed.

## Architecture

Same as every prior domain: minimal-API endpoints in `src/ClimateProject.Api/Endpoints/`,
`CanAccessCompany`/`Roles.Admin` authorization pattern, `Application/Reports/` +
`Application/Analytics/` DTOs, typed frontend API clients under
`web/src/features/reports/` and `web/src/features/analytics/`.

## Endpoints

- `ReportEndpoints`: `POST/GET/GET-by-id /admin/reports`, `POST
  /admin/reports/{id}/download` (increments `DownloadCount`, returns the stub
  `ReportOutput`). Creation immediately runs the stub generation synchronously (no
  background job needed since it's instant).
- `BenchmarkEndpoints`: `POST/GET/GET-by-id/PUT /admin/benchmarks`, nested
  `BenchmarkMetric` create/list under `/admin/benchmarks/{id}/metrics`.
- `AnalyticsInsightEndpoints`: `POST/GET/GET-by-id /admin/analytics-insights`, nested
  `AnalyticsMetricData`/`AnalyticsTimeSeries` list under
  `/admin/analytics-insights/{id}/metric-data` and `/time-series`.
- `AIInsightEndpoints`: `POST/GET/GET-by-id /admin/ai-insights`, `POST
  /admin/ai-insights/{id}/acknowledge`.
- `DemographicSnapshotEndpoints`: `POST/GET/GET-by-id /admin/demographic-snapshots`,
  nested `DemographicSnapshotEntry` list + `DemographicSnapshotChange` list.

## Frontend

`web/src/features/reports/` (list/create/download UI) and
`web/src/features/analytics/` (insights/benchmarks read-only dashboards + AI-insight
acknowledge action), following the `action-plans` feature folder's exact structure
(typed API client, components, pages).

## Testing

Integration tests per endpoint group against Testcontainers Postgres, same convention
as every prior domain. Frontend: typed API client unit tests (mocked fetch).

## Out of scope

Real PDF/CSV rendering, real survey-response-based analytics computation (both stubbed
per the decisions above, revisited once `#51` exists), notification delivery on
report-ready (that's `#55`'s territory).
