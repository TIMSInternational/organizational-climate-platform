# Task 5 Implementation Report: Frontend — ActionPlansListPage

## Overview
Successfully implemented the ActionPlansListPage component with list, filter, and create functionality for the Action Plans domain.

## Task Completion Summary

### Step 1: Create ActionPlanFilters.tsx
**Status: DONE**
- Created component at: `web/src/features/action-plans/components/ActionPlanFilters.tsx`
- Implements status filtering with options: all statuses, not_started, in_progress, completed, overdue, cancelled
- Exact code from plan implemented without modifications

### Step 2: Create ActionPlanList.tsx
**Status: DONE**
- Created component at: `web/src/features/action-plans/components/ActionPlanList.tsx`
- Displays action plans in a table format
- Shows: Title (as link to detail page), Status, Priority, Due date
- Exact code from plan implemented without modifications

### Step 3: Create ActionPlanForm.tsx
**Status: DONE**
- Created component at: `web/src/features/action-plans/components/ActionPlanForm.tsx`
- Provides form for creating new action plans
- Supports adding multiple KPIs and Objectives
- Exact code from plan implemented without modifications

### Step 4: Create ActionPlansListPage.tsx
**Status: DONE**
- Created component at: `web/src/features/action-plans/pages/ActionPlansListPage.tsx`
- List page that loads plans from API and displays them
- Uses VITE_DEFAULT_COMPANY_ID from environment (as documented in code comments)
- Implements filter and create form UI logic
- Exact code from plan implemented without modifications

### Step 5: Wire the route and nav entry
**Status: DONE**

#### Modified `web/src/app/router.tsx`:
- Added import: `import ActionPlansListPage from '../features/action-plans/pages/ActionPlansListPage'`
- Added route: `{ path: '/action-plans', element: <ActionPlansListPage /> }` as sibling of AdminLayout children
- Exact code from plan implemented

#### Modified `web/src/navigation/navSections.ts`:
- Added import: `Target` icon from lucide-react
- Added "Action Plans" nav entry to both SuperAdmin and CompanyAdmin nav sections
- Each entry links to `/action-plans` with Target icon
- Note: Plan showed a static export, but actual code uses a `buildNavSections` function that's role-aware. Adapted implementation to both roles appropriately.

### Step 6: Verify manually
**Status: DONE**

#### npm test results:
```
✓ Test Files  15 passed (15)
✓ Tests  56 passed (56)
✓ Duration  1.78s
```

#### npm run build results:
```
✓ vite v8.2.0 building client environment for production...
✓ 1841 modules transformed
✓ dist/index.html                   0.45 kB │ gzip:  0.29 kB
✓ dist/assets/index-DGNrK5qb.css    1.78 kB │ gzip:  0.81 kB
✓ dist/assets/index-rZqlnmgy.js   319.88 kB │ gzip: 98.54 kB
✓ built in 247ms
```

Both tests and build passed successfully.

### Step 7: Commit
**Status: DONE**

Files committed:
- `web/src/features/action-plans/components/ActionPlanFilters.tsx` (new)
- `web/src/features/action-plans/components/ActionPlanList.tsx` (new)
- `web/src/features/action-plans/components/ActionPlanForm.tsx` (new)
- `web/src/features/action-plans/pages/ActionPlansListPage.tsx` (new)
- `web/src/app/router.tsx` (modified)
- `web/src/navigation/navSections.ts` (modified)

Commit message: `feat: add ActionPlansListPage (list, filter, create)`
Commit SHA: `c6a24741470bd6e04466b412add71ddcdc35020d`

## Notes

### Deviation from Plan
The plan showed a simple static `export const navSections` structure, but the actual codebase uses a `buildNavSections(role, companyId)` function that's role-aware. The implementation was adapted to work with the existing architecture by adding the "Action Plans" nav item to both the SuperAdmin and CompanyAdmin branches of the function.

### Design Decisions
- ActionPlansListPage uses `import.meta.env.VITE_DEFAULT_COMPANY_ID` as noted in the plan (temporary solution until #57 cross-cutting frontend work provides company context)
- Components follow the existing pattern of separating list display, filters, and form into individual components
- Form properly handles both KPIs and Objectives with dynamic adding capability

## Test Coverage
- All 56 existing tests continue to pass
- New frontend components are created but not directly tested in this task (tests in Task 4 cover the API clients)
- Build verification confirms no TypeScript or module resolution issues

## Completion Status
✅ Task 5 is COMPLETE
- All 7 steps completed as specified in the plan
- All tests pass
- Build succeeds with no errors
- Code committed with correct message

## Fix round

### Finding addressed
`web/src/features/action-plans/pages/ActionPlansListPage.tsx:11` — `companyId` was read
from a single global `VITE_DEFAULT_COMPANY_ID` env var instead of the authenticated user's
own company, so every CompanyAdmin on a deployment saw/created action plans for whichever
one company happened to be configured, not their own.

### Change made
`ActionPlansListPage.tsx` now derives `companyId` the same way `AdminLayout.tsx` already
does: read the JWT off `getToken()` (`web/src/auth/token.ts`), decode it with
`decodeJwtPayload()` (`web/src/auth/jwt.ts`), and take the `companyId` claim. This makes
each CompanyAdmin's list/create requests scoped to their real company, not a
globally-configured stand-in.

- Removed `import.meta.env.VITE_DEFAULT_COMPANY_ID` entirely; no other file in the repo
  referenced it, so nothing else needed cleanup.
- `companyId` is now `string | undefined` (matching how `AdminLayout.tsx` types it) instead
  of an unconditional `string`, since a real JWT may or may not carry the claim (SuperAdmin
  tokens don't). Updated the header comment to explain the new source and the still-open
  SuperAdmin gap (no company-context selector exists yet — tracked as before, until #57).
- Added a defensive `if (!companyId) return` at the top of `handleCreate` so the
  `CreateActionPlanInput.companyId: string` (required, non-optional) assignment type-checks;
  this is unreachable in practice since the component already early-returns before rendering
  `ActionPlanForm` when `companyId` is falsy, but it keeps the two code paths honest under
  strict typing without weakening the input type.
- Updated the "not configured" error copy from `VITE_DEFAULT_COMPANY_ID is not configured.`
  to `No company is associated with your account.` since the failure mode is now "your
  account/token has no companyId claim" rather than "an env var is unset".

### Why this fixes the finding
`getToken()`/`decodeJwtPayload()` read the same JWT `AdminLayout.tsx` already uses to build
nav sections and to resolve `/admin/companies/:companyId/...` routes for a CompanyAdmin, so
this page now agrees with the rest of the authenticated shell about which company the
logged-in CompanyAdmin belongs to, instead of trusting one shared, deployment-wide env var.
SuperAdmin (no `companyId` claim) still can't use this page — that's the pre-existing,
explicitly-scoped-out gap (no company-context selector for SuperAdmin exists anywhere in
this slice), not something this finding asked to be fixed, and the updated code comment
says so.

### Tests run

`npm test -- --run` (vitest, full suite, from `web/`):

```
 RUN  v4.1.10 .../.worktrees/action-plans-core/web

 Test Files  15 passed (15)
      Tests  56 passed (56)
   Start at  00:56:33
   Duration  1.89s
```

`npm run build` (tsc -b && vite build, from `web/`):

```
vite v8.2.0 building client environment for production...
✓ 1841 modules transformed.
dist/index.html                   0.45 kB │ gzip:  0.29 kB
dist/assets/index-DGNrK5qb.css    1.78 kB │ gzip:  0.81 kB
dist/assets/index-TcyvtP6r.js   324.36 kB │ gzip: 99.44 kB
✓ built in 306ms
```

(`tsc -b` ran clean as part of the build step above — no type errors — after fixing the
`string | undefined` vs required-`string` mismatch introduced by the JWT-derived type.)

`npm run lint` (oxlint, from `web/`): exits 0. Only pre-existing warnings remain, all
`react-hooks(exhaustive-deps)` on `reload` in every list-page component across the repo
(`ActionPlansListPage.tsx` included) plus one `react(only-export-components)` in
`router.tsx` — none introduced by this change, none related to the finding.

No test file exists for `ActionPlansListPage.tsx` (or any other page component) in this
repo — the existing test suite only covers API clients, JWT decode/token storage, and pure
routing/nav-building logic (`.test.ts`, not `.test.tsx`; no `@testing-library/react` is
installed). This matches the codebase's established test coverage boundary for Task 5, so
no new test file was added; the fix was verified via the full `npm test` + `npm run build`
+ `npm run lint` run above.

### Commit
Fix committed as a new commit on `feature/action-plans-core` (see git log for SHA).
