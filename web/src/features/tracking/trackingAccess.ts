/**
 * Which roles each tracking dashboard is for.
 *
 * ## One list, read by the nav and by the page
 *
 * `navigation/navSections.ts` must never offer a row the backend would 403 (the
 * house rule), and a page whose URL is typeable must defend itself anyway. Those
 * are the same question asked twice, so they read the same answer from here rather
 * than each spelling out a role list that can drift from the other.
 *
 * ## Where each list comes from
 *
 * Both mirror a constant in `services/tracking-api`
 * (`ClimateTracking.Application.Auth.Roles`), which is the authority — these are a
 * copy for the browser, not a second opinion:
 *
 * - `Roles.Admin = ["company_admin", "super_admin"]`, and
 *   `DashboardEndpoints.ConsolidadoAsync` returns `Results.Forbid()` for anyone
 *   else. So the consolidado is admin-only and that is a real boundary.
 * - `Roles.PlanCreator = ["leader", "company_admin", "super_admin"]` is the
 *   service's own notion of "the node leader plus the people above them", and it is
 *   what {@link CAN_VIEW_TABLERO_ROLES} tracks.
 *
 * ## The tablero list is a PRODUCT rule, not a boundary — read this before relying on it
 *
 * `DashboardEndpoints.TableroAsync` does **not** check `Roles.PlanCreator`. It
 * checks the nodo: an admin may name any `nodoId`, and everyone else silently gets
 * their own (`nodoId ?? currentUser.NodoExternalId`). So the service will serve the
 * full board — every plan in the jefatura — to any authenticated member of that
 * nodo, including a plain employee.
 *
 * The client's spec §7 says the full tablero belongs to the node leader and that
 * `involucrados` get a task-only view (`/tracking/mis-tareas`), so this module
 * enforces that as the product's behaviour. It is not, and must not be described
 * as, protection: anyone who can hold a token for that nodo can call the endpoint
 * directly. Closing it needs a role check in `TableroAsync`, which is a
 * tracking-service change and is reported as an open gap rather than papered over
 * by this list.
 */

export const CAN_VIEW_CONSOLIDADO_ROLES = ['company_admin', 'super_admin'] as const

export const CAN_VIEW_TABLERO_ROLES = ['leader', 'company_admin', 'super_admin'] as const

/** True when `/consolidado` will answer this role with something other than 403. */
export function canViewConsolidado(role: string | undefined): boolean {
  return role !== undefined && (CAN_VIEW_CONSOLIDADO_ROLES as readonly string[]).includes(role)
}

/** True when the full nodo board is this role's screen — see the module note. */
export function canViewTablero(role: string | undefined): boolean {
  return role !== undefined && (CAN_VIEW_TABLERO_ROLES as readonly string[]).includes(role)
}
