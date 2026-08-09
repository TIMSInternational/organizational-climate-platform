# Fix report: #56 tracking-integration-api independent review findings

Fixing HEAD `d865257` on branch `feature/tracking-integration-api`, against
`docs/superpowers/plans/2026-08-01-tracking-integration-api.md`.

## Finding 1 — `/api/internal/personas` emitted `nodo_id: ""` for departmentless users

**Root cause:** `ListPersonasAsync` fell back to `string.Empty` when a user had no
`DepartmentId`. Since plain `/auth/signup` and Google login never set `DepartmentId`
(only `BulkImportEndpoints`, `UserEndpoints`, `InvitationEndpoints`,
`InvitationAcceptEndpoints` do), most real personas would sync with an empty `nodo_id`.
climate-tracking's `PersonaDto.NodoId` is non-nullable and used for tablero authorization
scoping (`targetNodoId != currentUser.NodoExternalId`), so an empty value is a real
authorization/functionality bug, not cosmetic.

**Fix:**
- Added `TrackingIdentifiers.UnassignedNodoId(Guid companyId)` — a deterministic synthetic
  nodo id, per company, for personas with no department.
- `/api/internal/personas` now falls back to this id instead of `string.Empty`.
- `/api/internal/nodos` now includes a matching synthetic `"Sin nodo asignado"` entry
  (with `CantidadColaboradores` = the count of departmentless users) whenever a company has
  at least one such user, so the persona's `nodo_id` always resolves to something present
  in the `/nodos` response — same invariant the existing join test already checked for the
  department-backed case.
- Existing fixtures (all users have `DepartmentId` set) are unaffected — the synthetic nodo
  only appears when needed, so `Returns_nodos_with_snake_case_envelope_shape`'s
  `Assert.Equal(2, ...)` still holds.

**New test:** `TrackingInternalEndpointsTests.Personas_with_no_department_resolve_to_a_synthetic_unassigned_nodo_present_in_nodos_response` — adds a departmentless user, asserts `/nodos` includes the synthetic entry with the right count, and `/personas` resolves that user's `nodo_id` to it.

**Files:** `src/ClimateProject.Application/Tracking/TrackingIdentifiers.cs`,
`src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs`,
`tests/ClimateProject.IntegrationTests/Tracking/TrackingInternalEndpointsTests.cs`.

## Finding 2 — stub endpoints 400ing on non-GUID `company_id` was an unrequested contract change

**Root cause:** the plan's Task 3 Step 2 stub bodies (`/ciclos-encuesta`, `/hallazgos`,
`/send-notification`) are unconditional empty/no-op responses with no validation. A prior
pass added the same `company_id` GUID validation used by the real `/nodos`/`/personas`
routes to the two GET stubs, to "close a drift" — an unrequested, self-approved scope
change. In practice this makes things worse: climate-tracking's
`ClimateProjectClientOptions.ProcomerCompanyId` is an unconstrained `required string` that
defaults to `""`, and `ClimateProjectClient` calls `response.EnsureSuccessStatusCode()`, so
a blank/legacy value would throw on the stub routes too, when the plan's intent was for
them to degrade gracefully regardless of `company_id`.

**Fix:** reverted `ListCiclosAsync`/`ListHallazgosAsync` to the plan's literal (unconditional,
no validation) stub bodies. `/nodos` and `/personas` keep their plan-specified validation —
that part was never a deviation. Updated the class-level contract comment on
`TrackingInternalEndpoints` and the plan doc (amendment note under Task 3) to record why the
stubs stay permissive.

**Test changes:** removed the two now-incorrect
`{Ciclos,Hallazgos}_endpoint_rejects_non_guid_company_id` tests; replaced with
`{Ciclos,Hallazgos}_endpoint_returns_empty_envelope_even_for_a_non_guid_company_id`, which
assert 200 + empty envelope for a non-GUID `company_id`, matching the plan.

**Files:** `src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs`,
`tests/ClimateProject.IntegrationTests/Tracking/TrackingInternalStubEndpointsTests.cs`,
`docs/superpowers/plans/2026-08-01-tracking-integration-api.md`.

## Finding 3 — Task 2's `User.NodoId` deviation was correct but undocumented/unfiled

The deviation itself (resolving persona `nodo_id` via `User.DepartmentId` instead of the
plan's literal `u.NodoId ?? string.Empty`) was independently re-verified as correct —
`grep -rn "NodoId = " src/` still returns zero writers of `User.NodoId`. What was missing:

- **Plan amendment**: added to `docs/superpowers/plans/2026-08-01-tracking-integration-api.md`
  under Task 2, recording both the original `User.DepartmentId` deviation and the
  departmentless-user fix from Finding 1, with rationale and links.
- **Cleanup issue filed**: [climate-project#73](https://github.com/TIMSInternational/climate-project/issues/73)
  — "tech-debt: User.NodoId is a confirmed-dead column (tracking integration)", asking for a
  decision to drop or repurpose the column. Referenced from the code comment in
  `TrackingInternalEndpoints.cs`.

No further code change was needed for this finding beyond the doc/issue trail and the
Finding 1 fix it flagged as still incomplete.

## Finding 4 — Task 4 frontend client ships inert/unreachable, unverified against a real instance

**What changed:**
- Added `web/src/features/tracking/api/config.ts` (`getTrackingApiBaseUrl()`), the one place
  in `web/src` that reads `VITE_TRACKING_API_BASE_URL`. Every `trackingApi.ts` export now
  defaults its `baseUrl` parameter to this, so the env var is actually wired end-to-end
  (`grep -rn VITE_TRACKING_API_BASE_URL web/src` now returns a hit) instead of only existing
  in `web/.env.example`. Callers (including the existing 9 tests) can still pass an explicit
  `baseUrl` to override it.
- Added `web/src/features/tracking/api/trackingApi.live.test.ts` — an opt-in test, skipped
  by default (`describe.skipIf(!liveUrl)`), that calls `getConsolidado` against a real
  `TRACKING_API_LIVE_URL` when the caller sets that env var (plus optionally
  `TRACKING_API_LIVE_TOKEN`). This gives a real way to verify the client against a running
  climate-tracking instance, which the existing 9 stubbed-fetch tests structurally cannot do.
- Added a test proving the default-`baseUrl` wiring actually works
  (`defaults baseUrl to VITE_TRACKING_API_BASE_URL when no explicit baseUrl is passed`).
- Updated the header comment on `trackingApi.ts` to explain the deliberate no-caller state
  (tracking pages are explicitly out of scope for this plan — see Global Constraints) rather
  than leaving that only implied.
- **What was intentionally not done**: building an actual tracking-module page that calls
  this client. The plan's own Global Constraints explicitly exclude that from this plan's
  scope ("Building actual tracking pages is separate future scope") — doing it here would
  repeat the same "self-approved scope expansion" problem as Finding 2. Instead, filed
  [climate-project#74](https://github.com/TIMSInternational/climate-project/issues/74) —
  "tech-debt: wire trackingApi.ts client into actual tracking-module UI pages" — and recorded
  an amendment in the plan doc under Task 4 pointing to it.

**Files:** `web/src/features/tracking/api/config.ts` (new),
`web/src/features/tracking/api/trackingApi.ts`,
`web/src/features/tracking/api/trackingApi.test.ts`,
`web/src/features/tracking/api/trackingApi.live.test.ts` (new),
`docs/superpowers/plans/2026-08-01-tracking-integration-api.md`.

## Verification (real output)

### `dotnet build`
```
Build succeeded.
    0 Warning(s)
    0 Error(s)
```

### `dotnet test`
```
Passed!  - Failed:     0, Passed:    23, Skipped:     0, Total:    23, Duration: 2 s - ClimateProject.UnitTests.dll (net10.0)
Passed!  - Failed:     0, Passed:   211, Skipped:     0, Total:   211, Duration: 3 m 27 s - ClimateProject.IntegrationTests.dll (net10.0)
```
234/234 total (was 233/233 on HEAD `d865257`; net +1 from the new departmentless-persona
regression test, with the two stub-validation tests replaced 1:1).

### `npm test -- --run` (web/)
```
 Test Files  22 passed | 1 skipped (23)
      Tests  100 passed | 1 skipped (101)
```
The 1 skipped file is the new opt-in `trackingApi.live.test.ts` (skipped because
`TRACKING_API_LIVE_URL` isn't set in this environment, by design).

### `npm run build` (web/)
```
✓ 1844 modules transformed.
dist/index.html                   0.45 kB │ gzip:   0.29 kB
dist/assets/index-DGNrK5qb.css    1.78 kB │ gzip:   0.81 kB
dist/assets/index-Dgg3xqC3.js   327.31 kB │ gzip: 100.01 kB
✓ built in 350ms
```
Clean build (had to fix one incidental TS error while adding the live test: `process.env`
isn't typed without `@types/node` in this project's tsconfig, so the live test reads it via
a narrow `globalThis` cast instead of adding a new dependency).

## Follow-up issues filed
- [climate-project#73](https://github.com/TIMSInternational/climate-project/issues/73) —
  decommission/repurpose the dead `User.NodoId` column.
- [climate-project#74](https://github.com/TIMSInternational/climate-project/issues/74) —
  wire `trackingApi.ts` into real tracking-module UI pages once built.
