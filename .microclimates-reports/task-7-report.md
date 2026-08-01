# Task 7: Frontend — MicroclimateRespondPage (public) — Implementation Report

## Summary
Successfully implemented the public MicroclimateRespondPage component and wired it to the router. This is the final task in the microclimates-core plan (#52).

## Completed Steps

### Step 1: Create MicroclimateRespondPage component ✓
**File:** `web/src/features/microclimates/pages/MicroclimateRespondPage.tsx`

Created a React component that:
- Uses `useParams` to extract microclimate ID from URL
- Fetches microclimate details via `getMicroclimate()` (uses authFetch which conditionally adds token)
- Displays a form with all questions from the microclimate
- Allows users to fill in answers for each question
- Submits responses via `submitResponse()` which does NOT use authFetch (supports anonymous submission)
- Shows appropriate messages based on state: loading, error, submitted, or not-active
- Prevents submission if microclimate status is not "active"

Key implementation details:
- Uses `useEffect` to load microclimate on mount or when ID changes
- Tracks answers in local state as a Record<string, string>
- Handles submission errors gracefully
- Shows success message after submission
- Disables submit button while submission is in progress

### Step 2: Wire the route in router.tsx ✓
**File:** `web/src/app/router.tsx`

Added two changes:
1. Imported `MicroclimateRespondPage` at the top of the file
2. Added route at the top level (NOT nested under RequireAuth/AdminLayout):
   ```tsx
   { path: '/microclimates/:id/respond', element: <MicroclimateRespondPage /> }
   ```

This route is placed as a sibling of `/login` and `/accept-invitation/:token`, making it accessible without authentication.

### Step 3: Verified with npm run build and npm test ✓

**Build output:**
```
> web@0.0.0 build
> tsc -b && vite build

vite v8.2.0 building client environment for production...
✓ 1844 modules transformed.
dist/index.html                   0.45 kB │ gzip:  0.28 kB
dist/assets/index-DGNrK5qb.css    1.78 kB │ gzip:  0.81 kB
dist/assets/index-DhKoFlsl.js   323.25 kB │ gzip: 99.30 kB

✓ built in 189ms
```

**Test output:**
```
Test Files  20 passed (20)
     Tests  84 passed (84)
  Start at  01:59:59
  Duration  2.52s
```

All tests passed successfully. No new test files were added for this component as per the plan structure.

### Step 4: Committed changes ✓

**Commit SHA:** `dcd6e8d1a2508f393b8abee32037ec63c14c6deb`

**Files committed:**
- `web/src/features/microclimates/pages/MicroclimateRespondPage.tsx` (new)
- `web/src/app/router.tsx` (modified)

**Commit message:** `feat: add public MicroclimateRespondPage`

## Notes

- The component correctly uses `getMicroclimate()` which calls `authFetch` (bearer-token injection), but `authFetch` omits the Authorization header when no token is present, allowing anonymous visitors to read microclimate details
- The `submitResponse()` function deliberately does NOT use `authFetch`, allowing unauthenticated submission when the microclimate's `RealtimeSettings.AnonymousResponses` is true
- The route is correctly placed at the top level for public access (unauthenticated)
- All validation is handled by the backend (status check, authentication requirement based on AnonymousResponses setting)
- Frontend provides good UX with loading states, error handling, and success confirmation

## Test Coverage
No new test files were created as this is a simple public form component. Existing tests (20 test files, 84 tests total) all pass.

## Status
✅ COMPLETE - All steps executed successfully, build passes, tests pass, commit created.

## Fix round

Code review found that the "anonymous visitor can read microclimate details" claim in this
report (and in Task 7's own Step-1 preamble) was false: `getMicroclimate()` calls `authFetch`
against `GET /microclimates/{id}`, and that route sits inside
`app.MapGroup("/microclimates").RequireAuthorization()` with no `AllowAnonymous` override
(`src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs`). A genuinely anonymous
respondent (no token at all) got a real 401 from that route, and `authFetch`'s 401 handler
(`web/src/api/authFetch.ts`) clears any token and hard-redirects to `/login` — the form never
rendered. This was a plan-authored defect (the plan's own Step 1 text asserted the false
claim), and the original report repeated it without verifying against the actual route
registration.

### What changed

1. **Backend** — added a genuinely anonymous, minimal-data endpoint dedicated to the public
   respond flow, instead of loosening auth on the existing admin `GET /microclimates/{id}`
   route (which is also used by the authenticated `MicroclimateDetailPage` and must keep its
   `CanAccessCompany` check):
   - `src/ClimateProject.Application/Microclimates/MicroclimateDtos.cs` — added
     `PublicMicroclimateDetail(Guid Id, string Title, string? Description, string Status,
     List<QuestionDto> Questions)`, deliberately excluding `CompanyId`, `CreatedBy`,
     `ResponseCount`, `TargetParticipantCount`, `AnonymousResponses`, and `ShowLiveResults` so
     no internal/admin-only data leaks to an unauthenticated caller.
   - `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs` — registered
     `app.MapGet("/microclimates/{id:guid}/respond", GetPublicRespondDetailsAsync).AllowAnonymous()`
     outside the authorized group (alongside the existing anonymous-capable
     `POST /microclimates/{id:guid}/responses`), backed by a new `GetPublicRespondDetailsAsync`
     handler that does a straight lookup + 404 with no auth/role check.

2. **Frontend** —
   - `web/src/features/microclimates/api/microclimates.ts` — added
     `getMicroclimateForRespond(baseUrl, id)`: a plain, unauthenticated `fetch` against the new
     `/respond` route (mirrors how `submitResponse` deliberately avoids `authFetch`), plus a
     `PublicMicroclimateDetail` TS interface matching the new backend DTO.
   - `web/src/features/microclimates/pages/MicroclimateRespondPage.tsx` — now calls
     `getMicroclimateForRespond` instead of `getMicroclimate`/`authFetch`, so a visitor with no
     token never hits the authenticated route and never gets redirected to `/login`.
   - `MicroclimateDetailPage.tsx` (admin, authenticated) is untouched and still uses
     `getMicroclimate`/`authFetch` against the original `GET /microclimates/{id}` route.

3. **Tests added** (closing finding #2 — no verification previously existed):
   - `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateEndpointsTests.cs`:
     - `GetAsync_still_requires_authentication_for_a_completely_anonymous_caller` — pins down
       the exact original defect: a truly anonymous caller (no Authorization header) hitting
       `GET /microclimates/{id}` gets 401.
     - `Anonymous_visitor_can_read_public_respond_details_without_any_token` — proves the fix
       end-to-end: an anonymous caller hits `GET /microclimates/{id}/respond` and gets 200 with
       title/status/questions, and asserts the raw JSON body does not contain
       `companyId`/`createdBy`/`responseCount`/`targetParticipantCount`.
     - `Public_respond_details_returns_404_for_an_unknown_id_without_requiring_auth`.
   - `web/src/features/microclimates/api/microclimates.test.ts`: two new cases for
     `getMicroclimateForRespond` — asserts no `Authorization` header is ever sent (even when a
     token is set in storage) and that backend error messages (e.g. 404) surface correctly.
   - `web/src/features/microclimates/pages/MicroclimateRespondPage.test.tsx` (new file): renders
     the page with no token set, asserts the title/question render from the `/respond` route
     response, that no `Authorization` header was sent, that `window.location.href` was never
     mutated (i.e. `authFetch`'s 401→`/login` redirect never fired), that a full anonymous
     submit flow works, and that a 404 from the backend surfaces as a plain error rather than
     an auth failure.

### Test output

Backend — `dotnet test tests/ClimateProject.IntegrationTests --filter "FullyQualifiedName~Microclimate"`:
```
Passed!  - Failed:     0, Passed:    29, Skipped:     0, Total:    29, Duration: 28 s - ClimateProject.IntegrationTests.dll (net10.0)
```

Backend — full suite, `dotnet test`:
```
Passed!  - Failed:     0, Passed:    23, Skipped:     0, Total:    23, Duration: 2 s - ClimateProject.UnitTests.dll (net10.0)
Passed!  - Failed:     0, Passed:   194, Skipped:     0, Total:   194, Duration: 2 m 23 s - ClimateProject.IntegrationTests.dll (net10.0)
```

Frontend — `npm test -- --run` (from `web/`):
```
 Test Files  21 passed (21)
      Tests  89 passed (89)
```

Frontend — `npm run build` (from `web/`): succeeds (`tsc -b && vite build`), no errors.

### Status after fix

✅ Both findings addressed: the public respond page now reads microclimate details from a
genuinely anonymous, AllowAnonymous backend route instead of the authenticated one, and the
fix is covered end-to-end by backend integration tests (anonymous 200 on `/respond`, anonymous
401 on the original authenticated route, no data leakage) and frontend unit/component tests
(no Authorization header sent, no redirect to `/login`, full anonymous load+submit flow).
