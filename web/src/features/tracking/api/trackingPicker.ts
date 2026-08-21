import { authFetch } from '../../../api/authFetch'

/**
 * The nodo directory, read from **climate-project-api** rather than from the
 * tracking service.
 *
 * ## Why this is not in `trackingApi.ts`
 *
 * Different service, different origin, different base URL. `trackingApi.ts` talks to
 * `services/tracking-api` at `VITE_TRACKING_API_BASE_URL`; this talks to
 * `/tracking/picker/nodos` on the main API at `VITE_API_BASE_URL`
 * (`TrackingPickerEndpoints.cs`). Folding a second origin into that module would
 * make its one `baseUrl` parameter mean two things.
 *
 * ## Why the dashboards need it at all
 *
 * Neither `/consolidado` nor `/tablero-seguimiento` returns a nodo NAME. Both key
 * everything on `nodoExternalId`, which is `TrackingIdentifiers.ExternalNodoId` —
 * a department's `LegacyExternalId` when it has one and its raw GUID otherwise, or
 * the synthetic `unassigned-<companyId>` for people with no department. A
 * consolidado that prints
 * `3f5c1a9e-7b2d-4e18-9a44-0c6e2b8d1f70` in the column a reader is meant to
 * recognise their own jefatura in is not a screen, and this module's whole purpose
 * is that §7's audience never sees one.
 *
 * The lookup is strictly decorative: every caller falls back to the raw id, so a
 * failed or forbidden picker call costs the reader a name and never a page.
 *
 * ## Authorization
 *
 * `ListNodosAsync` admits `super_admin`, and `company_admin` for their own company
 * only. That is a superset of `/consolidado`'s own gate (`Roles.Admin`), so the
 * consolidado adds no permission by calling this. The tablero is loadable by a
 * non-admin, which is exactly why the fallback is not optional there.
 */

export interface NodoPickerItem {
  id: string
  name: string
}

interface NodoPickerResponse {
  nodos: NodoPickerItem[]
}

/**
 * Every active nodo in `companyId`, as `externalId -> name`.
 *
 * A `Map` rather than the array, because both callers do a lookup per row and the
 * alternative is a scan per row.
 *
 * Optional parameters last, per the house rule — the prior bug this repo records is
 * a `baseUrl` placed BEFORE the required arguments, which broke five exports.
 */
export async function getNodoNames(
  companyId: string,
  baseUrl: string = import.meta.env.VITE_API_BASE_URL as string,
): Promise<ReadonlyMap<string, string>> {
  const response = await authFetch(
    `${baseUrl}/tracking/picker/nodos?companyId=${encodeURIComponent(companyId)}`,
  )
  const body = (await response.json()) as NodoPickerResponse
  return new Map((body.nodos ?? []).map((nodo) => [nodo.id, nodo.name]))
}
