import { getToken } from '../auth/token'
import { decodeJwtPayload } from '../auth/jwt'
import { matchesRoute, reachableRoutes } from './roleCapabilities'

/**
 * The only pages a RESPONDENT is offered, and the only ones they may navigate to.
 *
 * ## This is a product rule, not an authorization one
 *
 * `roleCapabilities` records what the SERVER will authorize a role to load, and the API
 * re-evaluates every one of those on every request. This set is narrower on purpose:
 * ESPH's 617 respondents are people who received one credentials email to answer one
 * survey, and every other destination the shell could offer them — their notifications,
 * their profile, their notification preferences, their privacy page, the list of their
 * own surveys — is a door with nothing behind it for that reader. Ruled 2026-10-19.
 *
 * The two are kept in step by `respondentSurface.test.ts`, which fails if anything named
 * here is NOT something `reachableRoutes('employee')` already authorized. Narrowing is
 * allowed; inventing a destination the server would refuse is not.
 *
 * ## Why `employee` and not every per-user role
 *
 * A `leader` reaches `/action-plans` to do their job and a `supervisor` has a team
 * surface, so neither is locked here. Measured before choosing that scope: enforcing
 * `roleCapabilities` as a GATE would block 22 of the router's 61 paths for a
 * `company_admin` and 19 for a `super_admin`, because that table was written for link
 * checking and was never completed for the admin roles. A gate is only as good as the
 * list behind it, so this one covers the role whose list is known to be complete.
 *
 * ## `/tracking/mis-tareas` is here on purpose
 *
 * ESPH does not use the tracking module and nothing links to that page for them, so it
 * costs them nothing. Removing it would lock a CLIO/PROCOMER employee out of their own
 * task list, which is a different client's product and not what this rule is about.
 *
 * ## Two links the product itself hands an employee (G26, 2026-10-22)
 *
 * The set was "pages the shell offers", and two links reach an employee from OUTSIDE the
 * shell. Both landed on `/dashboard` -- measured in `RequireAuth.test.tsx` before this
 * change -- so following them did nothing the reader could understand:
 *
 * - `/settings/notifications`: the footer of EVERY notification email reads "Gestiona tus
 *   preferencias de notificación" and links here (`NotificationEmailComposer.PreferencesPath`).
 *   It is the opt-out for mail the employee is receiving; a link to it that silently opens
 *   the dashboard is a broken unsubscribe. `GET/PUT /notifications/preferences` resolve the
 *   caller from the token and take no user id.
 * - `/tracking/planes/:id`: every row of Mis tareas links to its plan. `GET
 *   /api/planes-accion/{id}` admits the responsable and every involucrado read-only
 *   (`PlanAccessHandler`) -- the same predicate `MisTareasAsync` lists by, so every row
 *   the employee is shown opens. A plan they are not named on is refused by the API and
 *   the page says so (`forbidden`), which is the API's line, not a wider one.
 *
 * What did NOT change is the 2026-10-18 ruling on the SHELL: no rail, no account menu, no
 * link in the strip to either page (`AdminLayout.test.tsx` still asserts it). Reachable
 * from the link someone was mailed is not the same as offered while they answer a survey.
 */
export const RESPONDENT_SURFACE: readonly string[] = [
  '/dashboard',
  '/surveys/:id/respond',
  '/tracking/mis-tareas',
  '/tracking/planes/:id',
  '/settings/notifications',
]

/** The role this rule applies to. `Roles.cs` spells it exactly this way. */
export const RESPONDENT_ROLE = 'employee'

/**
 * May a respondent be sent to `pathname`?
 *
 * Pattern-matched, never prefix-matched: `/surveys/:id/respond` has to admit
 * `/surveys/<guid>/respond` and refuse `/surveys/my`, which a `startsWith('/surveys')`
 * would wave through. `matchesRoute` is the same matcher the link checks use.
 */
export function respondentMayReach(pathname: string): boolean {
  return RESPONDENT_SURFACE.some((pattern) => matchesRoute(pathname, pattern))
}

/**
 * Should this viewer be held to the respondent surface?
 *
 * Takes the role rather than reading the token, so a caller that already has claims does
 * not decode them twice and a test can ask about a role without minting a JWT.
 */
export function isRespondentRole(role: string | undefined): boolean {
  return role === RESPONDENT_ROLE
}

/** Everything the server would authorize for a respondent — what this set narrows. */
export function respondentAuthorizedRoutes(): ReadonlySet<string> {
  return reachableRoutes(RESPONDENT_ROLE, true)
}

/**
 * Is the signed-in viewer held to the respondent surface?
 *
 * Deliberately NOT `useRespondentShell`, which answers a different question: that one is
 * true whenever every nav leaf is a per-user page, so it is true for a `supervisor` too.
 * Hiding `/surveys/my` from a supervisor would remove a link that still works for them --
 * the mismatch this hook exists to avoid. The gate in `RequireAuth` asks `isRespondentRole`
 * and so does this, so a link is hidden exactly when it would bounce.
 */
export function useIsRespondent(): boolean {
  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  return isRespondentRole(typeof claims?.role === 'string' ? claims.role : undefined)
}
