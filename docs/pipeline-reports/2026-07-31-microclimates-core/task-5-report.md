# Task 5: Frontend — MicroclimatesListPage

## Summary
Successfully implemented the MicroclimatesListPage frontend task, including filters, list display, and form for creating microclimates. All components created, routes wired, navigation updated, and all tests passing.

## Work Completed

### Step 1: Created MicroclimateFilters component
- File: `web/src/features/microclimates/components/MicroclimateFilters.tsx`
- Implements filter interface with status options: '', 'draft', 'active', 'closed'
- Simple select-based filtering component

### Step 2: Created MicroclimateList component
- File: `web/src/features/microclimates/components/MicroclimateList.tsx`
- Renders list of microclimates in a table format
- Shows title (as link to detail page), status, and response count
- Displays message when no microclimates found

### Step 3: Created MicroclimateForm component
- File: `web/src/features/microclimates/components/MicroclimateForm.tsx`
- Implements form for creating new microclimates
- Fields: title, startTime, endTime, targetParticipantCount, anonymousResponses, questions
- Support for adding multiple questions with type selection
- Proper error handling and submission state management

### Step 4: Created MicroclimatesListPage
- File: `web/src/features/microclimates/pages/MicroclimatesListPage.tsx`
- Main page component using VITE_DEFAULT_COMPANY_ID from environment
- Loads and displays microclimates with filtering support
- Toggle to show/hide create form
- Reload functionality after creating new microclimate

### Step 5: Updated router.tsx
- Added import for MicroclimatesListPage
- Added route: `{ path: '/microclimates', element: <MicroclimatesListPage /> }`
- Route is nested under AdminLayout and RequireAuth (authenticated only)

### Step 6: Updated navSections.ts
- Added import for Waves icon from lucide-react
- Added Microclimates nav entry with Waves icon
- Entry added to company_admin role navigation as sibling of Action Plans

## Test Results

### npm run build
```
✓ built in 186ms
dist/index.html                   0.45 kB │ gzip:   0.29 kB
dist/assets/index-DGNrK5qb.css    1.78 kB │ gzip:   0.81 kB
dist/assets/index-BESMAGjJ.js   329.31 kB │ gzip: 100.47 kB
```
Build completed successfully.

### npm test
```
Test Files  17 passed (17)
     Tests  69 passed (69)
  Start at  08:56:29
  Duration  1.83s (transform 655ms, setup 0ms, import 1.18s, tests 138ms, environment 9.04s)
```
All tests passed (69/69).

## Commit
```
commit 901d12f9de45edb97a23d9ac5f01cb8228f0e4b7
Author: Federico Tafur <fedetafur2@gmail.com>
Date:   Thu Aug 1 08:56:43 2026 +0000

    feat: add MicroclimatesListPage (list, filter, create)
```

## Deviations from Plan
None. All steps completed exactly as specified in the plan.

## Notes
- All files match the exact code provided in the plan
- The stopgap company context selector using VITE_DEFAULT_COMPANY_ID is in place (as documented in the plan)
- The page integrates with Task 4's API clients (listMicroclimates, createMicroclimate)
- Ready for Task 6 (detail page + live results polling) to be implemented

## Fix round

Addressed review findings on commit `901d12f9de45edb97a23d9ac5f01cb8228f0e4b7`:

1. **companyId read from `VITE_DEFAULT_COMPANY_ID` instead of the authenticated user's JWT claims** — this hardcoded a single build-time company for every CompanyAdmin, so anyone whose company differed from the baked-in env var got a 403 (`Results.Forbid()`) from the backend's `CanAccessCompany` check on every list/create call.
2. Same broken pattern already fixed elsewhere in this codebase for `ActionPlansListPage` (commit `0f11de6`) — ported that exact fix here instead of re-deriving it.
3. The in-file comment claiming "Same stopgap as ActionPlansListPage" was stale/false since `ActionPlansListPage.tsx` no longer uses the env-var stopgap — replaced with a comment describing the actual (now-correct) approach, matching `ActionPlansListPage.tsx`'s own comment almost verbatim since the logic is now identical.

### What changed
`web/src/features/microclimates/pages/MicroclimatesListPage.tsx`:
- Removed `import.meta.env.VITE_DEFAULT_COMPANY_ID` usage entirely (grep confirms zero remaining references to `VITE_DEFAULT_COMPANY_ID` anywhere under `web/`).
- `companyId` and `role` are now derived from the authenticated user's JWT via `getToken()` (`../../../auth/token`) + `decodeJwtPayload()` (`../../../auth/jwt`), reading `claims.companyId` / `claims.role` — mirroring `ActionPlansListPage.tsx` exactly.
- Added the `isSuperAdmin` guard: SuperAdmin (who always carries a `companyId` claim off their own user row, per `JwtTokenService`) is explicitly blocked from list/create rather than silently falling through and getting scoped to their own single company with no picker and no indication of scoping — same rationale as `ActionPlansListPage`, pending issue #57 (cross-cutting company-context selector).
- `reload()` and `handleCreate()` now bail out (no-op) when `!companyId || isSuperAdmin`, same as `ActionPlansListPage`.
- Render guards updated: SuperAdmin sees an explicit "not available yet -- see issue #57" alert; missing companyId (non-SuperAdmin, e.g. malformed/missing token) sees "No company is associated with your account." instead of the old "VITE_DEFAULT_COMPANY_ID is not configured." message, since the env var no longer exists in this code path.
- Updated the header comment to describe the actual claims-based approach (copied from `ActionPlansListPage.tsx`'s comment, adapted for microclimates) instead of the now-false "Same stopgap as ActionPlansListPage" line.

### Test output

`npx tsc --noEmit -p .` (web/) — clean, no output/errors.

`npm test -- --run` (web/):
```
> web@0.0.0 test
> NODE_OPTIONS=--no-experimental-webstorage vitest run --run

 RUN  v4.1.10 .../microclimates-core/web

 Test Files  17 passed (17)
      Tests  69 passed (69)
   Start at  09:03:10
   Duration  1.69s (transform 718ms, setup 0ms, import 1.39s, tests 164ms, environment 8.34s)
```
All 69/69 tests still pass. Note: neither `MicroclimatesListPage.tsx` nor `ActionPlansListPage.tsx` has a dedicated component test file in this repo (only their API-client modules, e.g. `microclimates.test.ts`, are covered) — the 69-test full suite and a clean `tsc` typecheck are the tests that cover this file's compilation/integration surface; there was no page-level test to update.

`npm run build` (web/):
```
> web@0.0.0 build
> tsc -b && vite build

✓ 1849 modules transformed.
dist/index.html                   0.45 kB │ gzip:   0.29 kB
dist/assets/index-DGNrK5qb.css    1.78 kB │ gzip:   0.81 kB
dist/assets/index-Ca7CHPO3.js   333.36 kB │ gzip: 101.05 kB
✓ built in 250ms
```

Verified `grep -rn "VITE_DEFAULT_COMPANY_ID" web/` (excluding node_modules) returns zero matches — the stopgap pattern is now fully removed from the frontend.
