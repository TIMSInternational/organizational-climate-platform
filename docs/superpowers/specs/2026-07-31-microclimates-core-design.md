# Microclimates migration — Core (`#52`)

## Context

Legacy: `microclimates` route.ts (384), `[id]/route.ts` (369), `templates/route.ts` (180) —
in scope. `analytics/route.ts` (217) and `bulk/route.ts` (299) deferred, same rationale as
`#53`'s deferred pieces (analytics overlaps `#54`; bulk creation is a fast-follow, not core).

EF Core entities already exist (`#49`): `Microclimate` (with `Targeting`/`Scheduling`/
`RealtimeSettings`/`LiveResults` owned types matching legacy exactly), `MicroclimateQuestion`,
`MicroclimateTemplate`, `MicroclimateInvitation`, `MicroclimateDepartmentTarget`,
`MicroclimateAiInsight`. This spec is endpoints + UI on existing schema.

## Decisions (approved 2026-07-31, see `[[project_migration_blocking_decisions_resolved]]`)

- **Polling, not WebSockets.** `GET /microclimates/{id}/live-results` returns current
  `LiveResults` snapshot; frontend polls every 5s while a session is active.
- **Sentiment analysis stubbed.** `SentimentScore` computed as a fixed neutral value (0) on
  every response; `WordCloudData` built from simple word-frequency counting on open-text
  responses (deterministic, no AI call) rather than a real NLP pipeline. `EngagementLevel`
  derived from `ResponseCount` / `TargetParticipantCount` ratio (low/medium/high thresholds)
  — a real, useful signal, just not AI-driven.

## Backend

| Method | Route | Authorization | Notes |
|---|---|---|---|
| GET | `/microclimates?companyId=&status=` | SuperAdmin any, CompanyAdmin own company | List |
| POST | `/microclimates` | `Roles.Admin.Contains` + own-company | Create, with nested questions |
| GET | `/microclimates/{id}` | Same scoping | Detail, includes questions |
| PUT | `/microclimates/{id}` | Same scoping | Update profile fields, status (draft→active→closed) |
| GET | `/microclimates/{id}/live-results` | Same scoping | Current live snapshot (stubbed sentiment) |
| POST | `/microclimates/{id}/responses` | **Unauthenticated if `AnonymousResponses`, authenticated otherwise** — mirrors the survey-response pattern this domain shares conceptually, decided here rather than left ambiguous | Submit answers, updates `ResponseCount`/`LiveResults` |
| GET | `/microclimate-templates?companyId=` | Same scoping, nullable `CompanyId` = system template | List |
| POST | `/microclimate-templates` | `Roles.Admin.Contains` | Create |

No DELETE — `Status` covers lifecycle (`draft`/`active`/`closed`, verified against
`src/models/Microclimate.ts`).

Responses are NOT persisted as individual queryable rows in this core slice — no
`microclimate_responses` table exists in the `#49` schema (only the aggregate `LiveResults`
on the parent). Each response updates the aggregate in place (`ResponseCount++`, recompute
`EngagementLevel`, append word-frequency counts into `WordCloudData`). Individual response
history/export is out of scope here — flag as a real gap for `#54` if per-response analytics
are needed later.

## Frontend

```
web/src/features/microclimates/
├── api/
│   ├── microclimates.ts
│   └── microclimateTemplates.ts
├── components/
│   ├── MicroclimateFilters.tsx
│   ├── MicroclimateList.tsx
│   ├── MicroclimateForm.tsx       # create, includes nested question sub-form
│   ├── LiveResultsPanel.tsx       # polls live-results every 5s while status=active
│   └── ResponseForm.tsx           # participant-facing, unauthenticated when anonymous
└── pages/
    ├── MicroclimatesListPage.tsx
    ├── MicroclimateDetailPage.tsx     # includes LiveResultsPanel
    └── MicroclimateRespondPage.tsx    # public route, /microclimates/:id/respond
```

New nav entry: "Microclimates" alongside "Action Plans" (top-level, own domain).

## Testing

Same xUnit + Testcontainers + Vitest pattern. Live-results test: submit 2 responses, confirm
`ResponseCount` and `EngagementLevel` update correctly; confirm anonymous response path
requires no auth token when `AnonymousResponses=true`.

## Out of scope

Analytics/bulk-create (deferred), real AI sentiment (deferred per decision above), individual
response rows/export, surveys/action-plans/reports/notifications (separate domains).
