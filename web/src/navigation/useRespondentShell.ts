import { getToken } from '../auth/token'
import { decodeJwtPayload } from '../auth/jwt'
import { isTrackingEnabled } from '../features/tracking/api/config'
import { buildNavSections, isPerUserOnly } from './navSections'

/**
 * Whether the signed-in caller is in the railless respondent shell.
 *
 * ## Why this exists rather than `role === 'employee'` at each call site
 *
 * `AdminLayout` decides the shell with {@link isPerUserOnly}, computed from the role's own
 * navigation. Three screens outside the shell have to agree with that decision, and a second
 * spelling of it would eventually disagree — which here means a respondent reaching, by a
 * link the shell removed, the exact page the shell removed it for.
 *
 * The path that made this necessary, found by walking it rather than by reading: the bell is
 * still in the respondent's strip, it opens `/notifications`, that page offers "Preferencias
 * de notificaciones", and `/settings/notifications` carries `AccountTabs` — so "Tu perfil"
 * and its Nombre and Departamento were three clicks from a control the redesign kept.
 * Removing the two rows from the account menu had closed nothing.
 *
 * Deliberately NOT a route guard. The pages stay reachable by URL, so no right is removed,
 * only the invitation to wander in mid-survey — see `AdminLayout.test.tsx`'s privacy block
 * for the whole of that argument and the 2026-10-18 ruling it records.
 */
export function useRespondentShell(): boolean {
  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const role = typeof claims?.role === 'string' ? claims.role : undefined
  const companyId = typeof claims?.companyId === 'string' ? claims.companyId : undefined

  return isPerUserOnly(buildNavSections(role, companyId, { trackingEnabled: isTrackingEnabled() }))
}
