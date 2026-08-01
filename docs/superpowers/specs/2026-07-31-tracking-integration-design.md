# climate-project-api tracking-module integration design (#56)

## Context

`climate-tracking` is a separate, already-live `.NET` service (clean architecture) that
old climate-project (Next.js/Mongo) integrated with via a Next.js BFF: frontend-facing
proxy routes forwarding a session-JWT, plus a reverse set of `/internal/*` routes that
climate-tracking calls back into for org/survey data. As climate-project's own backend
becomes `.NET` (`climate-project-api`) and its own React frontend replaces the Next.js UI,
this design decides how the two services talk to each other going forward.

Blocked-by `#48` (auth) — already shipped. This design assumes the Slice 2 identity work
is in place: `User.PersonaExternalId`, `Department.LegacyExternalId`, and `User.NodoId`
already exist and are backfilled/wired into JWT claims (see
`project_migration_blocking_decisions_resolved.md` #56 section).

## Findings that shaped this design

- **Auth is already compatible for direct calls.** `climate-project-api`'s
  `Program.cs` configures inbound JWT validation using the same symmetric
  `TrackingJwtSecret` climate-tracking uses, with an explicit comment that the two must
  match exactly for token compatibility. A JWT minted at climate-project-api login is
  already valid, as-is, against climate-tracking's API. No token exchange or gateway is
  needed for auth purposes.
- **The old BFF was two unrelated things, not one layer:**
  - Pure pass-through routes (`consolidado`, `mis-tareas`, `planes-accion`,
    `tablero-seguimiento`) that just forwarded the JWT and returned climate-tracking's
    response verbatim — no value added.
  - Picker-data routes (`nodos`, `personas`, `hallazgos` for the involucrados picker UI)
    that never called climate-tracking at all — they queried Mongo directly and reshaped
    it. These need genuine reimplementation against Postgres regardless of any BFF
    decision, since Mongo is gone.
- **`ClimateTracking.Infrastructure.ExternalApi.ClimateProjectClient`** expects exactly 5
  inbound contracts: `GetNodosAsync`, `GetPersonasAsync`, `GetCiclosAsync`,
  `GetHallazgosAsync(cicloId)`, `SendNotificationAsync` — snake_case JSON,
  `Envelope<T>{success,data}` shape, authed via a static `INTERNAL_API_KEY` header.
- **Existing contract bug:** `GetHallazgosAsync` sends `ciclo_id` as a query param, but
  the old `/internal/hallazgos` route never read it — silently returned all hallazgos for
  the company. Worth fixing when the endpoint is rebuilt.
- **Two known gaps, confirmed in code:**
  - `#2`: `CacheSyncWorker` syncs nodos/personas/ciclos every 15 min but never syncs
    hallazgos — dead code path, `PlanesAccionEndpoints.CreateAsync`'s hallazgo→ciclo
    lookup silently no-ops today.
  - `#3`: `GeneratePlanCodeAsync` does `COUNT(*) WHERE year = X` then formats
    `PA-{year}-{count+1:D5}` with no locking — a race window under concurrent creation.
- **climate-project-api's frontend has zero existing tracking-related code** — fully
  greenfield, no shape to preserve beyond matching `ClimateProjectClient`'s expectations.

## Architecture

Three distinct data paths, decided independently:

### 1. Outbound: frontend → climate-tracking (direct, no proxy)

The React frontend calls climate-tracking's API directly for planes de acción,
consolidado, tablero de seguimiento, bitácora, etc., using the same JWT/fetch wrapper
already established for climate-project-api calls (per `#48`), pointed at
climate-tracking's `BaseUrl` instead. 401s go through the existing refresh flow — there is
no separate auth path for these calls. climate-project-api is not in this request path.

Rejected alternative: keeping a thin pass-through proxy in climate-project-api. Since
auth already works end-to-end, a proxy that only forwards the JWT unchanged adds latency
and a maintenance surface with no offsetting benefit (no authorization logic, error
normalization, or API-surface hiding was identified as a real need).

**Requires:** climate-tracking's CORS config updated to allow the frontend's origin(s) —
in scope for `#56`.

### 2. Picker data: nodos/personas/hallazgos for the involucrados UI

These become ordinary climate-project-api endpoints reading Postgres directly — not a
port of the old Mongo-querying routes, a fresh implementation:

- nodos → `Departments` (company-scoped)
- personas → `Users` (company-scoped)
- hallazgos → same `/internal/hallazgos` contract described below, called from the
  frontend's own picker component rather than duplicated

### 3. Inbound: climate-tracking → climate-project-api (`/internal/*`)

climate-project-api exposes the same 5 contracts `ClimateProjectClient` expects, ported
1:1 in shape (snake_case DTOs, matching field names — not necessarily the literal old
`Envelope{success,data}` wrapper code, just field-compatible), authed via the existing
static `INTERNAL_API_KEY` pattern (kept as-is: single trusted service-to-service caller,
no benefit to service-JWT complexity here).

| Endpoint | Data source | Status at #56 ship |
|---|---|---|
| `/internal/nodos` | `Departments` (Postgres) | Real |
| `/internal/personas` | `Users` (Postgres) | Real |
| `/internal/ciclos-encuesta` | surveys domain (`#51`) | **Stub** — empty list |
| `/internal/hallazgos` | surveys domain (`#51`) | **Stub** — empty list; honors `ciclo_id` and `hallazgo_id` filters once real (bug fix vs. old behavior; `hallazgo_id` is new, needed by the `#2` gap fix below) |
| `/internal/send-notification` | notifications domain (`#55`) | **Stub** — no-op success |

`#51` and `#55` aren't built yet. Rather than block `#56` on them, the 3 dependent
endpoints ship as explicit stubs now — matching the "stub now, real later" pattern
already used for Slice 2's invitation email and `#52`'s sentiment analysis — and get
swapped to real implementations when `#51`/`#55` land. `#56` itself needs no further
changes at that point; it's `#51`/`#55`'s job to replace the stub bodies.

## Gap fixes

- **`#2` (HallazgoCache never synced):** Remove the dead cache-sync path. Today's lookup
  in `PlanesAccionEndpoints.CreateAsync` is `db.Hallazgos.FirstOrDefaultAsync(h =>
  h.ExternalId == request.HallazgoExternalId)` against the never-synced local
  `hallazgos_cache` table — always null. Replace it with a synchronous call to a **new**
  `ClimateProjectClient.GetHallazgoByIdAsync(hallazgoExternalId)` method, calling
  `/internal/hallazgos?hallazgo_id={id}` and returning the first match or null — not the
  existing `GetHallazgosAsync(cicloId)`, which takes a `cicloId` you don't have yet at this
  point (discovering the cicloId from a hallazgoId is the whole reason for this lookup) and
  whose `HallazgoDto` has no `CicloId` field. This requires adding a `CicloId` property to
  `HallazgoDto` and the corresponding query support in the endpoint. No cache, no staleness
  question to solve. Since `/internal/hallazgos` ships stubbed until `#51` lands, this
  lookup returns null for now (same net behavior as today's silent no-op, but now an
  explicit documented stub instead of dead code) and starts working automatically once
  `#51` makes the endpoint real — no further climate-tracking changes needed at that point.
  `GetHallazgosAsync(cicloId)` itself has no callers anywhere today; leave it in place for
  symmetry with the other list-fetch methods rather than removing it, since removing unused
  public API surface is out of scope for this fix.
- **`#3` (GeneratePlanCodeAsync race):** Replace the `COUNT(*)` + string-format approach
  with a Postgres sequence per year (`plan_code_seq_{year}`, created lazily on first use).
  Idiomatic for Postgres, avoids a retry-on-conflict loop.

## Data flow, error handling, testing

- Frontend → climate-tracking reuses the existing JWT/fetch wrapper and refresh flow;
  only the base URL differs from climate-project-api calls.
- Internal endpoints follow climate-project-api's current request-validation/error-envelope
  conventions, not a literal port of the old wrapper code — climate-tracking's
  deserializer only needs matching field names (it hardcodes `SnakeCaseLower`).
- Testing: integration tests for the 2 real internal endpoints (nodos, personas) against
  Testcontainers Postgres. The 3 stub endpoints get a contract test confirming response
  shape only (no real data to assert on yet). The race-condition fix gets a concurrency
  test — parallel plan-code generation, assert no duplicates.
- No new frontend E2E scope beyond what already covers the JWT/fetch wrapper, since
  direct-call wiring reuses it rather than introducing a new auth path.

## Out of scope

- Building `#51` (surveys) or `#55` (notifications) themselves — this design only stubs
  their 3 dependent internal endpoints.
- Any change to climate-tracking's own domain logic beyond the `GeneratePlanCodeAsync`
  fix and CORS config — this is climate-project-api's integration surface, not a
  climate-tracking feature change.
- Service-to-service auth redesign — static API key pattern is kept as-is for the
  inbound direction; JWT compatibility for the outbound direction already exists and
  needs no new work beyond CORS.
