# Final whole-branch review fix report

Plan: `docs/superpowers/plans/2026-07-31-microclimates-core.md`
Branch: `feature/microclimates-core`
Base HEAD reviewed: `9233379b5fd02111d4b17e762bfe51fa82e3d4b1`

All five findings from the final whole-branch review are fixed in one coherent pass.

## Finding 1 + 2 (fixed together): non-functional/wrong company-context on MicroclimatesListPage

**Root cause:** the page read a brand-new `VITE_DEFAULT_COMPANY_ID` env var that exists
nowhere else in the repo (not in `web/.env.example`, not in Vercel), so the page always
rendered a "not configured" error in dev and prod. Even if configured, it would have been
one hardcoded company id for every company_admin, which the backend's
`MicroclimateEndpoints.CanAccessCompany` (`SuperAdmin || own-company CompanyAdmin`) would
403 for any company_admin whose company didn't match.

**Fix:** `web/src/features/microclimates/pages/MicroclimatesListPage.tsx` no longer reads
any env var for company context. It now derives `companyId` from the signed-in user's own
JWT claim, exactly the way `web/src/app/AdminLayout.tsx` and `web/src/app/router.tsx`
(`HomeRedirect`) already do: `getToken()` + `decodeJwtPayload(token)` →
`claims.companyId`. This is the same source `navSections.ts` relies on for its own
role-aware-nav invariant ("neither SuperAdmin's nor CompanyAdmin's entries point anywhere
the backend would 403 for that role"), so the nav entry added in Task 5 now actually works
for every company_admin, not just one hardcoded company.

- No env var needed at all now, so nothing to add to `.env.example`/Vercel — the stopgap
  pattern is removed entirely rather than propped up.
- The stale "Same stopgap as ActionPlansListPage" comment (referencing a page that does
  not exist in this repo) is removed and replaced with a comment explaining the real
  JWT-derivation approach and why it matters.
- `web/src/app/RequireAuth.tsx` already guards this route (`/microclimates` is nested under
  `RequireAuth` + `AdminLayout` in `router.tsx`), so a token is always present by the time
  this page renders in the real app; the "no companyId claim" / "no token" guard is a
  defensive fallback, covered by new tests.
- Updated `MicroclimatesListPage.test.tsx` to set a real JWT via `setToken(...)` instead of
  stubbing the env var, and added a case for "no token at all" in addition to the existing
  "no companyId claim" case.

## Finding 3 + 4 (fixed together): unauthenticated leak + dead-end respond flow

**Root cause:** `GET /microclimates/{id}/respond` (`AllowAnonymous`) served
title/description/status/questions for **any** microclimate id with no gating at all —
including unpublished drafts and microclimates with `AnonymousResponses == false`, even
though `SubmitResponseAsync` requires authentication for the latter and the frontend's
`submitResponse` never attaches a token. The net effect: the public respond page could
render a fillable form for a non-anonymous microclimate that could never be submitted, and
could leak a draft's still-being-authored question text to an unauthenticated caller with
only a v4 GUID.

**Fix:** `MicroclimateEndpoints.GetPublicRespondDetailsAsync` now returns the same 404
("Microclimate not found") shape unless the microclimate exists **and**
`RealtimeSettings.AnonymousResponses == true` **and** `Status == "active"`. This:
- closes the unauthenticated read of draft/non-anonymous microclimate content (Finding 4),
  and
- transitively closes the dead-end flow (Finding 3): since the public respond page can now
  only ever load a microclimate that *is* anonymous-eligible and active, `submitResponse`'s
  anonymous POST always matches what `SubmitResponseAsync`'s
  `!microclimate.RealtimeSettings.AnonymousResponses` check requires — there is no longer a
  reachable case where the page renders a form it cannot submit.
- 404 (not 403) was chosen deliberately so an anonymous caller cannot distinguish "doesn't
  exist" from "exists but isn't public right now," consistent with the existing
  not-found behavior for unknown ids.

Also fixed the factually-incorrect comment on `submitResponse` in
`web/src/features/microclimates/api/microclimates.ts` — it claimed "a token IS still
attached if one happens to be present," which was never true (plain `fetch`, no
`Authorization` header ever set). Replaced with an accurate comment explaining that no
token is ever attached, and why that's now safe given the GET-side gate above.

New backend tests added to `MicroclimateEndpointsTests.cs`:
- `Public_respond_details_returns_404_for_a_microclimate_that_requires_authentication_to_respond`
- `Public_respond_details_returns_404_for_an_unpublished_draft_microclimate`
- `Submitting_a_response_to_a_non_anonymous_microclimate_as_an_authenticated_company_member_succeeds`
  (confirms the *intended* authenticated path for non-anonymous microclimates still works)

## Finding 5: inconsistent authorization between the two endpoint files

**Root cause:** `MicroclimateTemplateEndpoints.ListAsync` only checked
`currentUser.Role != Roles.SuperAdmin && currentUser.CompanyId != companyId.ToString()`,
omitting the `Roles.Admin.Contains(...)` check that `MicroclimateEndpoints.CanAccessCompany`
uses and that this same file's own `CreateAsync` already applies. Any employee/supervisor/
leader in the company could list that company's templates (plus every system template)
while being 403'd from listing microclimates by the sibling endpoint file.

**Fix:** `ListAsync` now checks
`!Roles.Admin.Contains(currentUser.Role) || (currentUser.Role != Roles.SuperAdmin && currentUser.CompanyId != companyId.ToString())`,
matching `CanAccessCompany`'s semantics (SuperAdmin: any company; CompanyAdmin: own company
only; everyone else: forbidden) and making the file internally consistent with its own
`CreateAsync`.

New test added to `MicroclimateTemplateEndpointsTests.cs`:
- `Employee_cannot_list_microclimate_templates`

## Verification (real output)

### Backend — `dotnet test` (from the worktree root)

```
Passed!  - Failed:     0, Passed:    23, Skipped:     0, Total:    23, Duration: 2 s - ClimateProject.UnitTests.dll (net10.0)
Passed!  - Failed:     0, Passed:   198, Skipped:     0, Total:   198, Duration: 2 m 27 s - ClimateProject.IntegrationTests.dll (net10.0)
```

(198 integration tests, up from the pre-fix baseline, includes the 4 new tests added above
plus all pre-existing tests, all green.)

### Frontend — `npm test -- --run` (from `web/`)

```
 Test Files  21 passed (21)
      Tests  90 passed (90)
```

### Frontend — `npm run build` (from `web/`)

```
✓ 1844 modules transformed.
dist/index.html                   0.45 kB │ gzip:   0.29 kB
dist/assets/index-DGNrK5qb.css    1.78 kB │ gzip:   0.81 kB
dist/assets/index-Dgg3xqC3.js   327.31 kB │ gzip: 100.01 kB
✓ built in 217ms
```

`tsc -b` passed with no type errors, `vite build` succeeded.

## Files changed

- `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs`
- `src/ClimateProject.Api/Endpoints/MicroclimateTemplateEndpoints.cs`
- `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateEndpointsTests.cs`
- `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateTemplateEndpointsTests.cs`
- `web/src/features/microclimates/api/microclimates.ts`
- `web/src/features/microclimates/pages/MicroclimatesListPage.tsx`
- `web/src/features/microclimates/pages/MicroclimatesListPage.test.tsx`
