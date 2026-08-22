import { authFetch } from '../../../api/authFetch'

/**
 * The node and person pickers a plan form needs.
 *
 * ## These are NOT on the tracking service
 *
 * Everything else in this folder talks to `climate-tracking` at
 * `VITE_TRACKING_API_BASE_URL`. These two do not: `TrackingPickerEndpoints` lives
 * in **this repository's own API** (`src/ClimateProject.Api/Endpoints/TrackingPickerEndpoints.cs`,
 * mounted at `/tracking/picker`), because the names behind a `nodoExternalId` and a
 * `personaExternalId` are `Department` and `User` rows in climate-project's
 * database. climate-tracking only ever holds the opaque external ids.
 *
 * So `baseUrl` here defaults to `VITE_API_BASE_URL`, not to
 * `getTrackingApiBaseUrl()`. Passing the tracking base URL to these would 404.
 *
 * ## Admin-only, and the create form has to say so
 *
 * `CanAccessCompany` in that endpoint file allows `super_admin` and a
 * `company_admin` on their own company — **and nobody else**. A `leader` is
 * allowed to create a plan (`Roles.PlanCreator` includes them) but is refused by
 * both pickers, so the create form cannot offer a leader a list of people to
 * involve. That is a real gap in the service, not something this client can paper
 * over; `PlanDeAccionForm` degrades to typed external ids and says why rather than
 * rendering two empty dropdowns.
 *
 * Optional `baseUrl` goes LAST, after the required `companyId` — the house rule,
 * and the one a prior bug in this repo broke by putting it first.
 */

export interface NodoPickerItem {
  id: string
  name: string
}

export interface PersonaPickerItem {
  id: string
  name: string
  email: string
}

/** `NodoPickerResponse` — the array is under `nodos`, not at the root. */
interface NodoPickerResponse {
  nodos: NodoPickerItem[]
}

/** `PersonaPickerResponse` — the array is under `personas`. */
interface PersonaPickerResponse {
  personas: PersonaPickerItem[]
}

function defaultBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL as string
}

export async function listNodoOptions(
  companyId: string,
  baseUrl: string = defaultBaseUrl(),
): Promise<NodoPickerItem[]> {
  const response = await authFetch(
    `${baseUrl}/tracking/picker/nodos?companyId=${encodeURIComponent(companyId)}`,
  )
  const body = (await response.json()) as NodoPickerResponse
  // `?? []` because the envelope is what the SERVER promises, not what the type
  // system checks: `body.nodos` is declared `NodoPickerItem[]` and would compile
  // while handing every caller `undefined`. Both pickers are decorative enough
  // that a shape surprise must degrade, never throw into a page render.
  return body.nodos ?? []
}

export async function listPersonaOptions(
  companyId: string,
  baseUrl: string = defaultBaseUrl(),
): Promise<PersonaPickerItem[]> {
  const response = await authFetch(
    `${baseUrl}/tracking/picker/personas?companyId=${encodeURIComponent(companyId)}`,
  )
  const body = (await response.json()) as PersonaPickerResponse
  return body.personas ?? []
}

/**
 * Every active nodo in `companyId`, as `externalId -> name` — the same request as
 * {@link listNodoOptions}, shaped for the dashboards.
 *
 * ## Why the dashboards need it at all
 *
 * Neither `/consolidado` nor `/tablero-seguimiento` returns a nodo NAME. Both key
 * everything on `nodoExternalId`, which is `TrackingIdentifiers.ExternalNodoId` —
 * a department's `LegacyExternalId` when it has one and its raw GUID otherwise, or
 * the synthetic `unassigned-<companyId>` for people with no department. A
 * consolidado that prints `3f5c1a9e-7b2d-4e18-9a44-0c6e2b8d1f70` in the column a
 * reader is meant to recognise their own jefatura in is not a screen, and this
 * lookup is what stops §7's audience ever seeing one.
 *
 * A `Map` rather than the array, because both callers do a lookup per row and the
 * alternative is a scan per row. Built on `listNodoOptions` rather than issuing
 * its own fetch: #125 and #126 each grew a picker module against this endpoint —
 * two spellings of the same request, two copies of `NodoPickerItem` — and one
 * request written once is what keeps them from drifting.
 *
 * The lookup is strictly decorative: every caller falls back to the raw id, so a
 * failed or forbidden picker call costs the reader a name and never a page. The
 * `?? []` guard matters for the same reason — a response shape this client did not
 * expect must not throw into a page render.
 */
export async function getNodoNames(
  companyId: string,
  baseUrl: string = defaultBaseUrl(),
): Promise<ReadonlyMap<string, string>> {
  const nodos = await listNodoOptions(companyId, baseUrl)
  return new Map(nodos.map((nodo) => [nodo.id, nodo.name]))
}
