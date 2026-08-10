# Final whole-branch review fix report

Plan: `docs/superpowers/plans/2026-08-01-tracking-integration-api.md`
Branch: `feature/tracking-integration-api`
Starting HEAD: `9afd1ad06b33350276d3db325506b06bce397aca`

All 5 findings from the final review were fixed in a single pass. Details below.

---

## 1. (Critical) `/api/internal/personas` emitted a `nodo_id` that never joins to `/api/internal/nodos`

**Root cause:** `TrackingInternalEndpoints.ListPersonasAsync` read `u.NodoId ?? string.Empty`.
`User.NodoId` is a legacy JWT-claim column with no write path anywhere in this repo (confirmed
by re-running `grep -rn "NodoId\s*=" src tests`, which still only turns up the JWT-claims
mapping and a unit-test `with` clone). The real user→department link is `User.DepartmentId`.

**Fix (`src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs`):**
`ListPersonasAsync` now loads the `Departments` referenced by the queried users'
`DepartmentId` values and computes `NodoId` via `TrackingIdentifiers.ExternalNodoId(department)`
— the same helper and the same external-id convention `/nodos` already uses — falling back to
`string.Empty` only when a user has no `DepartmentId` at all. This guarantees a persona's
`nodo_id` is always either empty or a value that appears in the `/nodos` response for the same
company.

**Test coverage (finding 5, see below):** a new integration test asserts this join explicitly
across both endpoints, not just the individual response shapes.

---

## 2. `InternalApiKey` was never wired into deployment (prod 500s on every `/api/internal/*` call)

**Root cause:** `infra/aws/climate-project-api-prod-service.yml` only declared Secrets-Manager
plumbing for `TrackingJwtSecret` and the DB connection string; there was no
`InternalApiKeySecretArn` parameter, no `RuntimeEnvironmentSecrets` entry, and no
`AppRunnerInstanceRole` read permission for it. Root `README.md` didn't mention it either.

**Fix:**
- `infra/aws/climate-project-api-prod-service.yml`: added an `InternalApiKeySecretArn`
  parameter (documented as required — without it, every `/api/internal/*` route 500s via
  `InternalApiKeyFilter`'s fail-closed check), added it to the `AppRunnerInstanceRole`'s
  `read-runtime-secrets` policy `Resource` list, and added an `InternalApiKey` entry to
  `RuntimeEnvironmentSecrets` alongside the existing two.
- `infra/aws/README.md`: the manual deploy runbook (the one actually used, since GitHub
  Actions is billing-blocked) now has a callout explaining that `InternalApiKeySecretArn` (and
  the other no-default parameters already omitted from the steady-state command, which rely on
  CloudFormation's `UsePreviousValue` behavior on stack updates) must be supplied explicitly
  the first time it's deployed, with the exact parameter-override to add.
- `README.md`: line 47's deployment blurb now lists `InternalApiKey` alongside
  `TrackingJwtSecret` as a Secrets-Manager-backed runtime secret, and a new "Tracking-module
  integration (#56)" section spells out the 500-if-unset failure mode.

This is infra/docs-only — no CloudFormation stack was actually deployed as part of this fix
(no AWS credentials in this environment); the template and runbook are now correct for
whoever runs the next manual or automated deploy.

---

## 3. Task 4's frontend client is inert until climate-tracking gets CORS — now recorded in-repo

**Root cause:** the design spec noted the CORS dependency, but nothing in the code, env
file, or README recorded it — so a future reader of just this repo (not the design doc)
would have no way to know `trackingApi.ts` doesn't actually work yet.

**Fix:**
- `web/src/features/tracking/api/trackingApi.ts`: added a block comment at the top of the
  file stating plainly that every exported function will fail from a browser today because
  climate-tracking has no CORS configuration and `authFetch` always forces a preflight
  (`Authorization` + `Content-Type: application/json` on every request), with a pointer to
  the design doc and to "#56 Plan B" as the repo where the fix lands. This pass did not
  touch `authFetch` itself — it's shared with the already-working
  climate-project-api calls, so changing its header behavior is out of scope and would be a
  regression for the working path.
- `web/.env.example`: added a comment above `VITE_TRACKING_API_BASE_URL` noting the same
  thing.
- `README.md`: the new "Tracking-module integration (#56)" section states this explicitly
  and tells future contributors not to wire UI to this client until climate-tracking's CORS
  fix lands.

---

## 4. Cross-task validation drift: `/nodos`, `/personas` 400 on non-GUID `company_id`; `/ciclos-encuesta`, `/hallazgos` always 200

**Fix (`src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs`):**
- Extracted the GUID-parse-or-400 logic all four `company_id`-consuming routes need into one
  shared `TryParseCompanyId` helper, and applied it uniformly to `ListCiclosAsync` and
  `ListHallazgosAsync` (previously unvalidated) as well as the two routes that already had it.
  All 5 `/api/internal/*` routes now fail closed identically on a bad `company_id`, instead of
  two succeeding and two 400ing on the same misconfigured value.
- Added a class-level doc comment on `TrackingInternalEndpoints` stating the contract:
  `company_id` must be a climate-project `Company` GUID, and documenting that
  climate-tracking calls every route with the same configured value.
- Added integration tests (`TrackingInternalStubEndpointsTests`) asserting the two stub
  routes now 400 on a non-GUID `company_id`, matching the existing coverage on the real
  routes.

---

## 5. (Promoted minor) No test coverage for `NodoPadreId`/`LiderId`/`ManagerId` relationship mapping, and no cross-endpoint join assertion

**Fix (`tests/ClimateProject.IntegrationTests/Tracking/TrackingInternalEndpointsTests.cs`):**
Rewrote the seed data from "one department, one unrelated user" to a real small hierarchy:
- A parent department ("Headquarters") with no parent/manager.
- A manager user belonging to the parent department.
- A child department ("Engineering") whose `ParentDepartmentId` points at the parent and
  whose `ManagerId` points at the manager.
- A persona user belonging to the child department, managed by the manager.

Then:
- `Returns_nodos_with_snake_case_envelope_shape` now asserts both nodos are returned, that
  the child's `NodoPadreId` equals the parent's `NodoId`, and that the child's `LiderId`
  equals the manager's external persona id.
- `Returns_personas_with_persona_external_id` now asserts the persona's `ManagerId` resolves
  to the manager's external persona id and its `NodoId` resolves to the child department's
  external nodo id.
- A new test, `Personas_nodo_id_resolves_to_a_nodo_id_present_in_the_nodos_response`, calls
  both endpoints and asserts every non-empty persona `nodo_id` appears in the set of nodo
  ids returned by `/nodos` — this is exactly the assertion that would have caught finding 1
  on its own, and now guards against a regression.

---

## Verification

### Backend — `dotnet test` (from repo root)

```
Passed!  - Failed:     0, Passed:    23, Skipped:     0, Total:    23, Duration: 2 s - ClimateProject.UnitTests.dll (net10.0)
Passed!  - Failed:     0, Passed:   210, Skipped:     0, Total:   210, Duration: 2 m 35 s - ClimateProject.IntegrationTests.dll (net10.0)
```

233/233 passing (up from 227 before this fix pass — added 3 new nodo/persona join &
company_id-validation assertions worth of tests: the promoted join test, plus two
company_id-validation tests on the stub endpoints; the existing 2 internal-endpoint tests
grew additional assertions rather than new test methods).

### Frontend — `npm test -- --run` and `npm run build` (from `web/`)

```
 Test Files  22 passed (22)
      Tests  99 passed (99)
```

```
✓ 1844 modules transformed.
dist/index.html                   0.45 kB │ gzip:   0.29 kB
dist/assets/index-DGNrK5qb.css    1.78 kB │ gzip:   0.81 kB
dist/assets/index-Dgg3xqC3.js   327.31 kB │ gzip: 100.01 kB
✓ built in 241ms
```

Both suites green, build clean.

## Files changed

- `src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs` — findings 1 and 4
- `tests/ClimateProject.IntegrationTests/Tracking/TrackingInternalEndpointsTests.cs` — findings 1 and 5
- `tests/ClimateProject.IntegrationTests/Tracking/TrackingInternalStubEndpointsTests.cs` — finding 4
- `infra/aws/climate-project-api-prod-service.yml` — finding 2
- `infra/aws/README.md` — finding 2
- `README.md` — findings 2, 3, 4
- `web/src/features/tracking/api/trackingApi.ts` — finding 3
- `web/.env.example` — finding 3

## Concerns / follow-ups not addressed here (out of scope for this fix pass)

- The actual AWS Secrets Manager secret for `InternalApiKey` and the CloudFormation
  stack-update that supplies `InternalApiKeySecretArn` for the first time still need to be
  run out-of-band by whoever has AWS credentials — this pass only makes the template/runbook
  correct, it doesn't (and can't, from this environment) touch the live App Runner service.
- climate-tracking's CORS configuration is explicitly out of scope (separate repo, tracked as
  "#56 Plan B" per the design doc) — this pass only ensures the gap is now documented in this
  repo instead of silently missing.
- `deploy-prod.yml`'s `parameter-overrides` list still doesn't pass `TrackingJwtSecretArn` /
  `DatabaseConnectionStringSecretArn` / Cors params / the new `InternalApiKeySecretArn` —
  consistent with the pre-existing `UsePreviousValue`-reliant pattern for all the other
  no-default secrets, not a new inconsistency introduced here. Left as-is to match established
  convention; flagged in the infra README instead.
