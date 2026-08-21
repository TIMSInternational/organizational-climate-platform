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
  return body.nodos
}

export async function listPersonaOptions(
  companyId: string,
  baseUrl: string = defaultBaseUrl(),
): Promise<PersonaPickerItem[]> {
  const response = await authFetch(
    `${baseUrl}/tracking/picker/personas?companyId=${encodeURIComponent(companyId)}`,
  )
  const body = (await response.json()) as PersonaPickerResponse
  return body.personas
}
