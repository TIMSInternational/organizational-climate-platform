# Final whole-branch review fix pass — action-plans-core

Plan: `docs/superpowers/plans/2026-07-31-action-plans-core.md`
Base commit: `76897d8e2dcb90b998be93859cf8ead5b7e11b56`

All five findings from the final review were fixed in this pass. Details below,
followed by real verification output.

---

## Finding 1 — Unvalidated TemplateId FK

**File:** `src/ClimateProject.Api/Endpoints/ActionPlanEndpoints.cs` (`CreateAsync`)

Added a scoped existence check before persisting the plan: the referenced
`ActionPlanTemplate` must exist, be active, and belong either to the caller's
own company or be a system-wide template (`CompanyId == null`) — the exact
scoping rule the templates List endpoint already uses for visibility. An
absent/out-of-scope id now returns `400` with a message instead of letting a
`DbUpdateException` from the FK constraint fall through to Program.cs's
generic 500 handler, and a CompanyAdmin can no longer reference another
tenant's template id.

As a side effect this also closes the "UsageCount is permanently zero" half of
Finding 5: once a template passes the scoped lookup, `UsageCount` is
incremented and `UpdatedAt` touched when the plan is created.

**Tests added** (`tests/.../ActionPlans/ActionPlanEndpointsTests.cs`):
- `Create_with_unknown_template_id_returns_400_not_500`
- `Create_with_another_companys_template_id_is_rejected` (also asserts the
  plan was never persisted)
- `Create_with_a_valid_own_company_template_id_succeeds_and_increments_usage_count`

## Finding 2 — Read authorization broader than the Global Constraint

**Files:** `ActionPlanEndpoints.cs`, `ActionPlanTemplateEndpoints.cs`

Restored the precedent `CanAccessCompany` clause (`UserEndpoints.cs`,
`DemographicFieldEndpoints.cs`): SuperAdmin, or CompanyAdmin scoped to their
own company — dropping the divergent "any authenticated user whose companyId
claim matches" form. `ActionPlanTemplateEndpoints.ListAsync`'s inline check
had the identical divergence; extracted it into the same-named private
`CanAccessCompany` helper for consistency with every other endpoint file.
List/Get on both action plans and templates are now Admin-only, matching the
plan's stated Global Constraint verbatim.

**Test added:** `NonAdmin_cannot_list_or_read_plans_in_their_own_company` —
an Employee gets `403` on both `GET /action-plans` and
`GET /action-plans/{id}` for a plan in their own company.

No existing test relied on non-admin read access, so this was a pure
tightening with zero collateral breakage (confirmed by the full green test
run below).

## Finding 3 — SuperAdmin nav entry leads to a silently mis-scoped page

**Files:** `web/src/navigation/navSections.ts`, `navSections.test.ts`,
`web/src/features/action-plans/pages/ActionPlansListPage.tsx`

Two changes, addressing both the visibility and the underlying defect:

1. Dropped the `/action-plans` nav entry from the `super_admin` section until
   #57 (cross-cutting company-context selector) lands, and corrected the
   file's header invariant comment to explain why (Action Plans has no
   company-picker, so a SuperAdmin landing on it would be silently
   single-company-scoped).
2. Fixed the page itself, since dropping the nav entry alone doesn't stop a
   SuperAdmin who types the URL directly. The old comment's premise
   ("SuperAdmin has no companyId claim at all") was factually wrong —
   `JwtTokenService.cs:36` unconditionally emits the `companyId` claim off the
   non-nullable `User.CompanyId` column, so the `if (!companyId)` branch was
   dead code for SuperAdmin and every SuperAdmin silently fell through to
   "use my own user row's company." The page now checks `role === 'super_admin'`
   explicitly and shows an explicit "not available yet — see #57" message
   instead of ever calling `listActionPlans`/`createActionPlan` with an
   incidental company id.

**Tests added** (`navSections.test.ts`):
- `does not give a super_admin an Action Plans link...`
- `gives a company_admin an Action Plans link...` (regression guard so the
  CompanyAdmin entry isn't accidentally dropped too)

## Finding 4 — Off-by-one due dates for users west of UTC

**Files:** `web/src/features/action-plans/api/actionPlans.ts`,
`web/src/features/action-plans/components/ActionPlanList.tsx`,
`actionPlans.test.ts`

Verified the reported `System.Text.Json` behavior directly (`dotnet run`
against net10.0 with `TZ` set to `CST6CDT` / `UTC` / `America/New_York`):
a bare `"2026-12-01"` deserializes to midnight in whatever offset the
*server process* is running in, not UTC — confirmed as the root cause.

Fixed both ends of the round trip so the bug can't reappear even if the
production container's timezone configuration ever changes:

- **Send:** `createActionPlan`/`updateActionPlan` now normalize a bare
  `YYYY-MM-DD` due date to an explicit `T00:00:00.000Z` before serializing,
  so every environment agrees on the same UTC instant for "this calendar
  date" regardless of server-local time zone. Already-explicit-offset strings
  pass through untouched.
- **Display:** `ActionPlanList`'s date cell now formats with
  `toLocaleDateString(undefined, { timeZone: 'UTC' })` instead of the
  browser's local zone, so the calendar date rendered always matches the
  UTC-midnight instant stored, regardless of the viewer's own time zone.

**Tests added** (`actionPlans.test.ts`):
- normalizes a bare due date to `2026-12-01T00:00:00.000Z` on create
- leaves an already-explicit-offset due date untouched
- normalizes a bare due date on update too

(No new component-rendering test for `ActionPlanList`'s UTC formatting fix —
the repo has no React Testing Library dependency and no existing
component-render tests for this feature to follow the pattern of; the fix is
a one-line, easily-inspectable `Intl` option change.)

## Finding 5 — Template feature end-to-end orphaned

**Files:** `web/src/features/action-plans/components/ActionPlanForm.tsx`,
`web/src/features/action-plans/pages/ActionPlansListPage.tsx`,
`ActionPlanEndpoints.cs` (usage-count increment, covered under Finding 1)

Re-read Task 3's own scope note carefully: template *application* (copying
KPIs/objectives) was explicitly never in scope for this plan — only "the
frontend just lists templates for reference; wiring template selection into
`CreateActionPlanRequest.TemplateId` is a one-field pass-through." That
one-field wiring is what Task 5 dropped and what's now built:

- `ActionPlansListPage` fetches `listActionPlanTemplates` alongside
  `listActionPlans` and passes the result into `ActionPlanForm`.
- `ActionPlanForm` renders an optional "Start from template" `<select>` when
  templates exist; picking one sets `templateId` on the create request. A
  code comment makes explicit that this does not copy KPIs/objectives — that
  auto-population remains out of scope, same as the plan says.
- `UsageCount` now actually increments (see Finding 1) — the counter is no
  longer permanently zero, and this was verified by an integration test.

This closes the "no consumer" gap for the one-field pass-through path that
was genuinely in scope, without expanding scope into KPI/objective copying
that the plan explicitly deferred. `CreateActionPlanInput.templateId` is now
populated by a real caller (`ActionPlanForm` → `ActionPlansListPage.handleCreate`).

---

## Verification

### Backend — `dotnet test` (from the worktree root)

```
Passed!  - Failed:     0, Passed:    23, Skipped:     0, Total:    23, Duration: 2 s - ClimateProject.UnitTests.dll (net10.0)

Passed!  - Failed:     0, Passed:   197, Skipped:     0, Total:   197, Duration: 2 m 35 s - ClimateProject.IntegrationTests.dll (net10.0)
```

(197 integration tests = the pre-existing suite plus the 4 new tests added in
this pass: 3 for Finding 1, 1 for Finding 2.)

### Frontend — `npm test -- --run`

```
 Test Files  15 passed (15)
      Tests  61 passed (61)
```

### Frontend — `npm run build`

```
✓ 1844 modules transformed.
dist/index.html                   0.45 kB │ gzip:   0.29 kB
dist/assets/index-DGNrK5qb.css    1.78 kB │ gzip:   0.81 kB
dist/assets/index-D5bpTPLq.js   328.69 kB │ gzip: 100.29 kB
✓ built in 255ms
```

TypeScript project build (`tsc -b`) passed with no errors as part of this
build step.

---

## Files changed

- `src/ClimateProject.Api/Endpoints/ActionPlanEndpoints.cs`
- `src/ClimateProject.Api/Endpoints/ActionPlanTemplateEndpoints.cs`
- `tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanEndpointsTests.cs`
- `web/src/features/action-plans/api/actionPlans.ts`
- `web/src/features/action-plans/api/actionPlans.test.ts`
- `web/src/features/action-plans/components/ActionPlanForm.tsx`
- `web/src/features/action-plans/components/ActionPlanList.tsx`
- `web/src/features/action-plans/pages/ActionPlansListPage.tsx`
- `web/src/navigation/navSections.ts`
- `web/src/navigation/navSections.test.ts`

## Notes / residual scope

- Program.cs's generic `DbUpdateException` → 500 safety net was left as-is
  (it's a documented last-resort catch-all for *other* domains' residual/racy
  constraint violations); Finding 1 is fixed at the endpoint level per the
  finding's own suggested fix, so the FK path is now pre-checked rather than
  relying on that net.
- `#57` (cross-cutting company-context selector) remains the real fix for
  SuperAdmin's Action Plans access; this pass only stops the silent
  mis-scoping, it does not build the selector.
