# Action Plans migration — Core (`#53`)

## Context

Legacy footprint is large (3898 lines across 9 routes) but splits cleanly: a self-contained
core (plans, KPIs, objectives, progress tracking, templates — matches `#49`'s schema exactly)
plus four cross-domain/analytics routes that genuinely depend on other not-yet-built domains.

**In scope (this spec):** `action-plans` (CRUD), `action-plans/[id]` (detail/update),
`action-plans/templates` (CRUD) — core plan lifecycle + KPI/objective progress tracking.

**Deferred, not part of this spec** (approved 2026-07-31):
- `alerts` (332 lines) — needs `#55` (Notifications) for real delivery.
- `follow-up-microclimates` (504 lines) — needs `#52`'s microclimate-creation API.
- `reports` (726 lines), `metrics` (592 lines), `commitments` (431 lines, confirmed a
  read-only query over KPIs/objectives, not a separate model) — analytics/reporting views,
  belong with `#54` or a fast-follow once core data exists to query.
- `bulk-create`/`bulk` (200+431 lines) — bulk plan creation, same shape family as Slice 3's
  bulk-import; deferred as a fast-follow once core CRUD is proven, not blocking.

EF Core entities already exist (`#49`): `ActionPlan`, `ActionPlanKpi`, `ActionPlanObjective`,
`ActionPlanProgressUpdate` + `ActionPlanKpiUpdate` + `ActionPlanObjectiveUpdate`,
`ActionPlanTemplate` + `ActionPlanTemplateKpi` + `ActionPlanTemplateObjective`. This spec is
endpoints + UI on top of existing schema, same as every prior slice.

## Backend

Same pattern as every prior domain: minimal-API + manual role check, `Application/ActionPlans/`
services (new top-level folder — this is its own domain, not org-structure).

| Method | Route | Authorization | Notes |
|---|---|---|---|
| GET | `/action-plans?companyId=&departmentId=&status=` | SuperAdmin any, CompanyAdmin own company | List, filterable |
| POST | `/action-plans` | `Roles.Admin.Contains` + own-company | Create, with nested KPIs+objectives in one payload |
| GET | `/action-plans/{id}` | Same scoping as company | Detail, includes KPIs+objectives+progress-update history |
| PUT | `/action-plans/{id}` | Same scoping | Update profile fields, status, priority |
| POST | `/action-plans/{id}/progress` | Same scoping | Record a progress update (KPI values + objective status in one call, matches legacy's combined update shape) |
| GET | `/action-plan-templates?companyId=` | Same scoping (nullable `CompanyId` = system template, visible to all) | List |
| POST | `/action-plan-templates` | `Roles.Admin.Contains` | Create |

No DELETE anywhere — matches the established no-hard-delete convention (`Status` field covers
lifecycle: `not_started`/`in_progress`/`completed`/`cancelled`).

`SourceSurveyId`/`SourceInsightId` fields exist on `ActionPlan` but are write-only pass-through
in this spec (accepted if provided, not validated against Survey/Insight tables since those
domains don't exist yet) — becomes real FK validation once `#51`/`#54` land.

## Frontend

```
web/src/features/action-plans/
├── api/
│   ├── actionPlans.ts
│   └── actionPlanTemplates.ts
├── components/
│   ├── ActionPlanFilters.tsx
│   ├── ActionPlanList.tsx
│   ├── ActionPlanForm.tsx        # create + edit, includes KPI/objective sub-forms
│   ├── ProgressUpdateForm.tsx
│   └── ProgressHistory.tsx
└── pages/
    ├── ActionPlansListPage.tsx
    └── ActionPlanDetailPage.tsx  # includes progress-update UI, same embedding pattern as
                                   # CompanyDetailPage's departments
```

New top-level nav entry: "Action Plans" alongside "System Administration" in `navSections.ts`
(first non-org-structure nav section — this is genuinely a different domain, not a sub-item
of Companies).

## Testing

Same xUnit + Testcontainers + Vitest pattern as every prior domain.

## Out of scope

Everything in the "Deferred" list above, plus surveys/microclimates/reports/notifications
themselves (separate domains).
