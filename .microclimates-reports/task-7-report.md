# Task 7: Frontend — MicroclimateRespondPage (public)

## Summary

Implemented the public-facing microclimate response submission page (MicroclimateRespondPage), allowing anonymous users to view and respond to active microclimates. This is the final task in the microclimates-core implementation plan.

## Completed Steps

### Step 1: Create MicroclimateRespondPage.tsx ✓

Created `web/src/features/microclimates/pages/MicroclimateRespondPage.tsx` with:
- Loads microclimate details using `getMicroclimate` from Task 4 API client
- `authFetch` is used but omits Authorization header when no token is present, allowing anonymous access
- Displays microclimate title and questions for data entry
- Accepts user input for all questions in a form
- Submits responses via `submitResponse` (unauthenticated endpoint from Task 2)
- Shows appropriate states: loading, error, submitted confirmation, and inactive microclimate states
- All required fields marked as `required` based on question configuration
- Submit button has disabled state during submission to prevent double-submission

**File location:** `web/src/features/microclimates/pages/MicroclimateRespondPage.tsx`
**Lines of code:** 66

### Step 2: Wire the route (unauthenticated) ✓

Modified `web/src/app/router.tsx` to:
1. Added import: `import MicroclimateRespondPage from '../features/microclimates/pages/MicroclimateRespondPage'`
2. Added route as a sibling of `/login` and `/accept-invitation/:token` (NOT nested under RequireAuth/AdminLayout):
   ```tsx
   { path: '/microclimates/:id/respond', element: <MicroclimateRespondPage /> }
   ```
   This ensures the route is publicly accessible without authentication.

**File location:** `web/src/app/router.tsx`
**Changes:** 1 import added + 1 route added

### Step 3: Verify with npm run build and npm test ✓

#### Build Output
```
> web@0.0.0 build
> tsc -b && vite build

vite v8.2.0 building client environment for production...
[2Ktransforming...✓ 1852 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.45 kB │ gzip:   0.29 kB
dist/assets/index-DGNrK5qb.css    1.78 kB │ gzip:   0.81 kB
dist/assets/index-BO3UTdAS.js   336.68 kB │ gzip: 101.62 kB

✓ built in 198ms
```

Result: **SUCCESS** - Build completed in 198ms with no errors.

#### Test Output
```
> web@0.0.0 test
> NODE_OPTIONS=--no-experimental-webstorage vitest run

 RUN  v4.1.10 /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api/.worktrees/microclimates-core/web

 Test Files  17 passed (17)
      Tests  69 passed (69)
   Start at  09:17:31
   Duration  1.69s (transform 481ms, setup 0ms, import 1.08s, tests 213ms, environment 8.17s)
```

Result: **SUCCESS** - All 69 tests passed across 17 test files.

### Step 4: Commit ✓

```bash
git add web/src/features/microclimates/pages/MicroclimateRespondPage.tsx \
        web/src/app/router.tsx
git commit -m "feat: add public MicroclimateRespondPage"
```

**Commit SHA:** `7fecc77148216dc792a5b95618a288500479f77f`
**Files changed:** 2
**Insertions:** 72

## Implementation Notes

1. **Route Security:** The route is intentionally placed as a sibling of `/login` and `/accept-invitation/:token`, making it accessible without authentication. Users can either be anonymous (no token) or logged in (token present in authFetch).

2. **API Client Usage:** 
   - `getMicroclimate` uses `authFetch` which gracefully handles missing tokens
   - `submitResponse` is deliberately unauthenticated and uses raw `fetch`
   - This allows both anonymous visitors and logged-in users to use the same flow

3. **User Experience:**
   - Loading state shows "Loading…" while fetching microclimate details
   - Error states display error messages with role="alert" for accessibility
   - Submitted state confirms "Thank you for your response"
   - Inactive microclimates show appropriate message: "This microclimate is not currently accepting responses"
   - Form is cleared on submission but could be improved with redirect to success page

4. **Code Quality:**
   - TypeScript types properly enforced throughout (FormEvent, MicroclimateDetail)
   - React hooks properly used (useEffect, useState)
   - Form validation enforced via HTML `required` attribute per question configuration
   - Error handling in both fetch and submission phases
   - All tests pass without modification

## Testing Verification

- **TypeScript compilation:** ✓ Passed (tsc -b)
- **Vite build:** ✓ Passed (no errors)
- **Unit tests:** ✓ 69 tests passed
- **Test files:** ✓ 17 test files passed
- **Bundling:** ✓ Final bundle: 336.68 kB JS, 1.78 kB CSS, gzipped sizes acceptable

## No Deviations from Plan

The implementation follows the plan exactly as specified:
- Component code matches provided source
- Route added in correct location (unauthenticated sibling, not nested under RequireAuth)
- Both build and test commands executed and passed
- Commit message is exact as specified: "feat: add public MicroclimateRespondPage"

## Completion Status

✅ **COMPLETE** - Task 7 is fully implemented and tested. All steps completed successfully:
- Step 1: MicroclimateRespondPage.tsx created
- Step 2: Route wired in router.tsx
- Step 3: Build passed, all tests passed
- Step 4: Committed with correct message

## Fix round

Code review of commit `7fecc77` (the original Task 7 commit) found three problems, all now fixed:

1. **Backend: GET /{id:guid} 401'd real anonymous visitors.** The `/microclimates` route group
   carried `.RequireAuthorization()` with no `AllowAnonymous` exception for the detail route, so
   an anonymous visitor with no stored JWT got a 401 from `getMicroclimate`, and `authFetch`
   turns *any* 401 into "clear token + hard-redirect to `/login`" — before the respond form could
   ever render. The page only worked for already-logged-in users previewing the form, not real
   anonymous respondents.

   Fix: `group.MapGet("/{id:guid}", GetAsync).AllowAnonymous();` in
   `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs`. `GetAsync` now branches on
   `principal.Identity?.IsAuthenticated`: authenticated callers still get the existing
   `CanAccessCompany` check (cross-company access → 403, same as before); unauthenticated callers
   are served only when `microclimate.RealtimeSettings.AnonymousResponses` is `true` (401
   otherwise) — the same policy `SubmitResponseAsync` already enforced for the actual submission.

   Also closed a related gap surfaced by the same review: `SubmitResponseAsync` accepted any
   freeform string for `multiple_choice`/`rating`/`yes_no` answers with no validation against the
   question's own allowed values. Added validation in `SubmitResponseAsync`: `yes_no` must be
   "yes"/"no" (case-insensitive); `rating` must be one of `question.Options` if configured, else
   an integer 1–5; `multiple_choice` must be one of `question.Options` if configured. Invalid
   answers now get a 400 instead of silently polluting `ResponseCount`/live results.

2. **Plan doc contradiction.** The plan's Task 7 prose (around the old line 1789) asserted "an
   anonymous visitor can still read microclimate details" via `authFetch`, which was false given
   the plan's own Task 1 code (`group.RequireAuthorization()` with no exception) — a
   plan-authored contradiction the original implementer carried forward uncritically. Replaced
   that paragraph with a "Correction (post-review, 2026-08-01)" note describing the real defect
   and the two-part fix (backend `AllowAnonymous` + frontend `getMicroclimatePublic`), and added a
   "Superseded by the Task 7 review-fix round" note after the original code sample so the plan no
   longer misrepresents what actually ships.

3. **Frontend: every question type rendered as one freeform `<input type="text">`.**
   `question.options` was never read; multiple_choice, rating, and yes_no respondents got no
   valid-value affordance at all.

   Fix: `MicroclimateRespondPage.tsx` now has a `QuestionInput` component that renders per
   `question.type`: `multiple_choice` → radio group from `question.options`; `rating` → radio
   group from `question.options` if configured, else a default 1–5 scale; `yes_no` → Yes/No radio
   group; `open_text` (and any unrecognized type) → the original text input. The page's `getMicroclimate`
   call was also replaced with a new `getMicroclimatePublic` (plain `fetch`, token attached only if
   one happens to already be present, no `authFetch`/401-redirect coupling) so a 401 renders as a
   normal in-page error instead of yanking an anonymous visitor to `/login`.

### Files changed in this round
- `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs` — `AllowAnonymous()` on GET
  `/{id:guid}`, anonymous-aware `GetAsync`, answer-options validation in `SubmitResponseAsync`.
- `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateEndpointsTests.cs` — 2 new
  tests: anonymous read allowed for an anonymous-enabled microclimate; anonymous read rejected
  (401) for a non-anonymous-enabled one.
- `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateLiveResultsTests.cs` — 3 new
  tests: out-of-range rating rejected, invalid yes_no answer rejected, multiple_choice answer
  outside configured options rejected (and a valid one accepted).
- `web/src/features/microclimates/api/microclimates.ts` — new `getMicroclimatePublic`.
- `web/src/features/microclimates/api/microclimates.test.ts` — 3 new tests for
  `getMicroclimatePublic` (no-token → no Authorization header; token present → header attached;
  non-ok response → plain thrown error, no navigation side effect).
- `web/src/features/microclimates/pages/MicroclimateRespondPage.tsx` — `QuestionInput` component
  rendering per question type; uses `getMicroclimatePublic`.
- `docs/superpowers/plans/2026-07-31-microclimates-core.md` — correction notes (described above).

### Test output (real, from this fix round)

Backend, filtered to Microclimate tests (`dotnet test ClimateProject.slnx --filter
"FullyQualifiedName~Microclimate"`):

```
Passed!  - Failed:     0, Passed:    28, Skipped:     0, Total:    28, Duration: 27 s - ClimateProject.IntegrationTests.dll (net10.0)
```
(28 = the prior 23 Microclimate tests + 5 new: 2 anonymous-GET tests in
`MicroclimateEndpointsTests`, 3 answer-validation tests in `MicroclimateLiveResultsTests`.)

Full backend suite (`dotnet test ClimateProject.slnx`), run to confirm no regressions elsewhere:

```
Passed!  - Failed:     0, Passed:    23, Skipped:     0, Total:    23, Duration: 2 s - ClimateProject.UnitTests.dll (net10.0)
Passed!  - Failed:     0, Passed:   211, Skipped:     0, Total:   211, Duration: 2 m 46 s - ClimateProject.IntegrationTests.dll (net10.0)
```

Frontend (`npm test` from `web/`):

```
 Test Files  17 passed (17)
      Tests  72 passed (72)
   Start at  09:37:38
   Duration  1.93s (transform 651ms, setup 0ms, import 1.32s, tests 146ms, environment 9.83s)
```
(72 = the prior 69 + 3 new `getMicroclimatePublic` tests.)

Frontend build (`npm run build`): succeeded, no TypeScript errors.
