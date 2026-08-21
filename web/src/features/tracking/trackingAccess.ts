import { getToken } from '../../auth/token'
import { decodeJwtPayload } from '../../auth/jwt'

/**
 * Who the caller is to the tracking service, and what the tracking service will
 * let them do to a plan.
 *
 * ## This mirrors a server rule; it does not invent one
 *
 * `ClimateTracking.Application.Auth.PlanAccessHandler` is the authority, and it
 * reads:
 *
 * - `Roles.Admin` (`company_admin`, `super_admin`) → read and write, always.
 * - `role == "leader"` **and** the caller's `nodoId` claim equals the plan's
 *   `NodoExternalId` → read and write.
 * - the `responsable_ejecucion`, or anyone in `involucrados` → **read only**.
 *
 * That last line is the one worth stating out loud, because it is easy to get
 * backwards: the person executing the plan cannot record their own progress. Only
 * the node's leader (or an admin) can call `avance`, `cumplir` or `involucrados`.
 * An involucrado gets a task list they can read, which is exactly what
 * `MisTareasPage` is.
 *
 * The UI mirrors it so that a button which would come back 403 is never drawn —
 * not as a security boundary. The service re-checks every one of these on every
 * request; nothing here is load-bearing for authorization.
 *
 * ## Where the claims come from
 *
 * The same JWT the rest of the app holds. `climate-project-api`'s
 * `JwtTokenService` mints `nodoId` unconditionally (`claims.NodoId ?? string.Empty`)
 * and `ClimateTracking.Application.Auth.ClaimsPrincipalExtensions.GetCurrentUser`
 * reads `sub`, `role` and `nodoId` off it — the two services read one token, which
 * is why this can be decoded client-side rather than fetched.
 *
 * **Never from an env var**, and never from a prop: company and node scoping is a
 * claim, and a page that took either as input would be a page that could be
 * pointed at someone else's node by editing a URL.
 */
export interface TrackingClaims {
  /** `sub` — the tracking service's `PersonaExternalId`. */
  personaExternalId: string
  role: string
  /** `nodoId`, or `''` for a caller who leads no node. */
  nodoExternalId: string
}

/**
 * Roles `ClimateTracking.Application.Auth.Roles.Admin` treats as unrestricted.
 *
 * Exported because `navigation/navSections.ts` reads the same list: the nav must
 * never offer a row the backend would 403 (the house rule), and a page whose URL
 * is typeable must defend itself anyway. Those are the same question asked twice,
 * so they read one answer rather than each spelling out a role list that can drift
 * from the other.
 */
export const CAN_VIEW_CONSOLIDADO_ROLES: readonly string[] = ['company_admin', 'super_admin']

/**
 * Roles `ClimateTracking.Application.Auth.Roles.PlanCreator` lets create a plan —
 * the service's own notion of "the node leader plus the people above them", and
 * the list the full tablero is offered to.
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
export const CAN_VIEW_TABLERO_ROLES: readonly string[] = [
  'leader',
  'company_admin',
  'super_admin',
]

const ADMIN_ROLES = CAN_VIEW_CONSOLIDADO_ROLES
const PLAN_CREATOR_ROLES = CAN_VIEW_TABLERO_ROLES

/**
 * True when `/consolidado` will answer this role with something other than 403.
 *
 * `DashboardEndpoints.ConsolidadoAsync` returns `Results.Forbid()` for anyone
 * outside `Roles.Admin`, so this is a real boundary mirrored — unlike
 * {@link canViewTablero}, which is a product rule.
 */
export function canViewConsolidado(role: string | undefined): boolean {
  return role !== undefined && CAN_VIEW_CONSOLIDADO_ROLES.includes(role)
}

/** True when the full nodo board is this role's screen — see {@link CAN_VIEW_TABLERO_ROLES}. */
export function canViewTablero(role: string | undefined): boolean {
  return role !== undefined && CAN_VIEW_TABLERO_ROLES.includes(role)
}

function claimString(payload: Record<string, unknown>, name: string): string {
  const value = payload[name]
  return typeof value === 'string' ? value : ''
}

/**
 * The tracking-relevant claims of the stored token, or `null` when there is no
 * readable token at all.
 *
 * A token with no `sub` is `null` too: `GetCurrentUser` throws on that case
 * server-side ("Token is missing the required 'sub' claim"), so a caller holding
 * one is not a tracking caller and treating them as an anonymous one here keeps
 * the two ends agreeing.
 */
export function readTrackingClaims(): TrackingClaims | null {
  const token = getToken()
  if (!token) return null
  const payload = decodeJwtPayload(token)
  if (!payload) return null
  const personaExternalId = claimString(payload, 'sub')
  if (personaExternalId === '') return null
  return {
    personaExternalId,
    role: claimString(payload, 'role'),
    nodoExternalId: claimString(payload, 'nodoId'),
  }
}

export function isTrackingAdmin(claims: TrackingClaims | null): boolean {
  return claims !== null && ADMIN_ROLES.includes(claims.role)
}

/**
 * Whether this caller may mutate this plan — `RegistrarAvance`, `MarcarCumplido`,
 * `AgregarInvolucrado`.
 *
 * The empty-node guard is not cosmetic. `nodoId` is minted as `string.Empty` for a
 * user who leads nothing, and `PlanResponse.NodoExternalId` is `required` and
 * therefore never blank — but a defensive `'' === ''` here would hand write access
 * to every leader in the tenant the day a plan is created with a blank node. The
 * comparison is refused rather than trusted.
 */
export function canManagePlan(
  plan: { nodoExternalId: string },
  claims: TrackingClaims | null,
): boolean {
  if (claims === null) return false
  if (isTrackingAdmin(claims)) return true
  if (claims.role !== 'leader') return false
  if (claims.nodoExternalId === '' || plan.nodoExternalId === '') return false
  return claims.nodoExternalId === plan.nodoExternalId
}

/**
 * Whether this caller may create a plan at all.
 *
 * `CreateAsync` gates on `Roles.PlanCreator` and then, for a non-admin, on
 * `currentUser.NodoExternalId == request.NodoExternalId` — so a leader with no
 * node claim can pass the role check and still be refused on every node they
 * could pick. Refusing here as well means they get the page's explanation rather
 * than a 403 on submit.
 */
export function canCreatePlan(claims: TrackingClaims | null): boolean {
  if (claims === null) return false
  if (isTrackingAdmin(claims)) return true
  return PLAN_CREATOR_ROLES.includes(claims.role) && claims.nodoExternalId !== ''
}

/**
 * The nodes this caller may create a plan for, given the full picker list.
 *
 * An admin may pick any; a leader may only pick their own, because `CreateAsync`
 * forbids the rest. Returning the filtered list rather than validating on submit
 * is what stops the form offering a choice the service will refuse.
 */
export function creatableNodos<T extends { id: string }>(
  nodos: readonly T[],
  claims: TrackingClaims | null,
): T[] {
  if (claims === null) return []
  if (isTrackingAdmin(claims)) return [...nodos]
  return nodos.filter((nodo) => nodo.id === claims.nodoExternalId)
}
