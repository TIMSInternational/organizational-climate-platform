# Task 6: Frontend — SystemSettingsPage + CompanySettingsForm

## Summary
Implemented the frontend for system settings and company settings/branding management, wiring them into the admin interface routes.

## Execution Details

### Step 1: System settings form + page
- **Created:** `web/src/features/org-structure/components/SystemSettingsForm.tsx`
  - Form component managing 5 fields: loginEnabled, maintenanceMode, maintenanceMessage, maxLoginAttempts, sessionTimeoutMinutes
  - Error handling and submission state
  - Matches the plan's exact interface requirements

- **Created:** `web/src/features/org-structure/pages/SystemSettingsPage.tsx`
  - Page component that loads settings via `getSystemSettings()` on mount
  - Handles updates and reloads after successful save
  - Passes settings to form and provides error display

### Step 2: Company settings form
- **Created:** `web/src/features/org-structure/components/CompanySettingsForm.tsx`
  - Form managing 4 fields: surveyFrequency, microclimateEnabled, anonymousSurveys, primaryColor
  - Accepts both settings and branding data
  - Submission handler for update operations
  - Color input for primaryColor branding field

### Step 3: Wire into CompanyDetailPage
- **Modified:** `web/src/features/org-structure/pages/CompanyDetailPage.tsx`
  - Added imports: `updateCompanySettings`, `CompanySettingsResponse`, `CompanySettingsForm`, `CompanySettingsFormValues`
  - Added state: `companySettings` to track loaded settings/branding
  - Added handler: `handleUpdateSettings()` to call API and update local state
  - Added UI section with "Load settings" button pattern (leverages optional fields in PUT endpoint)
  - Settings section placed between company edit and departments sections

### Step 4: Wire SystemSettingsPage route
- **Modified:** `web/src/app/router.tsx`
  - Added import: `SystemSettingsPage`
  - Added route: `/admin/system-settings` as sibling of other AdminLayout routes

### Step 5: Verification
- **npm test:** All 38 tests pass (11 test files)
- **npm run build:** Build succeeds with no errors
  - Output: 310.04 kB total, 96.35 kB gzipped

### Step 6: Commit
```
git add web/src/features/org-structure/components/SystemSettingsForm.tsx \
        web/src/features/org-structure/pages/SystemSettingsPage.tsx \
        web/src/features/org-structure/components/CompanySettingsForm.tsx \
        web/src/features/org-structure/pages/CompanyDetailPage.tsx \
        web/src/app/router.tsx
git commit -m "feat: add SystemSettingsPage and company settings/branding form"
```
**Commit SHA:** `280e5dd7b343f81ae72f6a704e31fa63ccc1ff4c`

## Files Changed
- Created: `web/src/features/org-structure/components/SystemSettingsForm.tsx`
- Created: `web/src/features/org-structure/pages/SystemSettingsPage.tsx`
- Created: `web/src/features/org-structure/components/CompanySettingsForm.tsx`
- Modified: `web/src/features/org-structure/pages/CompanyDetailPage.tsx`
- Modified: `web/src/app/router.tsx`

## Deviations
None. All steps followed exactly as specified in the plan.

## Test Results
- `npm test`: PASS, 38 tests (11 files)
- `npm run build`: PASS, no errors or warnings

## Concerns
None. All implementation follows the plan precisely, and all tests pass with successful build verification.

## Fix round

### Finding fixed
1. `web/src/features/org-structure/pages/CompanyDetailPage.tsx:110` — the "Load settings"
   button called `updateCompanySettings(baseUrl, id!, {}).then(setCompanySettings)` directly
   in the `onClick` with no `.catch`, unlike every other page-level handler in this file
   (`reload()`). A failed request (e.g. 403 for a non-owning CompanyAdmin, or a network error)
   produced an unhandled promise rejection and the button silently did nothing, with zero user
   feedback. This was copied verbatim from the plan's own Step 3 code block, so it was a
   plan-mandated defect, not an implementer deviation.

### Change made
Extracted the inline `.then()` chain into a proper `handleLoadSettings()` async function that
mirrors the existing `reload()` error-handling pattern already used in this file: it clears
`error`, wraps the `updateCompanySettings` call in `try/catch`, and on failure calls
`setError(err instanceof Error ? err.message : 'Failed to load company settings')` — which
surfaces via the component's existing `if (error) return <p role="alert">{error}</p>` guard,
the same path `reload()` failures already take. The button's `onClick` now points at this
handler instead of the bare unhandled promise chain.

```tsx
async function handleLoadSettings() {
  if (!id) return
  setError(null)
  try {
    const result = await updateCompanySettings(baseUrl, id, {})
    setCompanySettings(result)
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to load company settings')
  }
}
```
and
```tsx
<button onClick={handleLoadSettings}>Load settings</button>
```

No test file exists (or existed before this fix) covering `CompanyDetailPage.tsx` — the
frontend suite in this repo has no component-rendering test infrastructure at all (no
`@testing-library/react`, no `.test.tsx` files anywhere in `web/src`); the only frontend
tests are API-client unit tests plus one pure-function test (`postAcceptRoute.test.ts`).
Introducing React Testing Library / component-render tests would be a net-new pattern not
established anywhere in this codebase and out of scope for this fix, so verification follows
this task's own Step 5 precedent ("no browser available to this implementer, matching every
prior frontend UI task's precedent"): the full `npm test` suite plus `npm run build` (and
`npm run lint` for good measure), confirming no regressions from the change.

### Test output

`npm test` (from `web/`) — all pre-existing tests still pass unchanged (11 files, 38 tests;
none of these files touch `CompanyDetailPage.tsx`, so this is a regression check, not new
coverage of the fixed code path):

```
> web@0.0.0 test
> NODE_OPTIONS=--no-experimental-webstorage vitest run


 RUN  v4.1.10 /Users/federicotafur/.../org-structure-slice3/web

 Test Files  11 passed (11)
      Tests  38 passed (38)
   Start at  22:19:57
   Duration  1.64s (transform 306ms, setup 0ms, import 560ms, tests 101ms, environment 9.72s)
```

`npm run build` (from `web/`) — TypeScript project build + Vite production build, both clean:

```
> web@0.0.0 build
> tsc -b && vite build

vite v8.2.0 building client environment for production...
✓ 1829 modules transformed.
dist/index.html                   0.45 kB │ gzip:  0.29 kB
dist/assets/index-DGNrK5qb.css    1.78 kB │ gzip:  0.81 kB
dist/assets/index-CpAuTzFR.js   310.16 kB │ gzip: 96.37 kB
✓ built in 321ms
```

`npm run lint` (from `web/`) — no new warnings introduced by the change; the 4 pre-existing
`react-hooks/exhaustive-deps` warnings (on `CompanyDetailPage.tsx`, `CompaniesListPage.tsx`,
`UsersListPage.tsx`, `SystemSettingsPage.tsx`, all about the `reload` dependency) are unchanged
and unrelated to this fix.

### Fix commit SHA
`<filled in after commit — see below>`
