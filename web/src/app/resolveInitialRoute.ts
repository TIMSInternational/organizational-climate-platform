import { resolvePostAcceptRoute } from '../features/org-structure/pages/postAcceptRoute'

// Where to land a user right after login, and where the bare `/` route should
// redirect an already-authenticated visitor. Reuses resolvePostAcceptRoute's
// per-role landing page (it already encodes which admin pages each role can
// actually load without 403ing), falling back to /admin/companies for a role
// with no landing page yet (or an unauthenticated visitor, whose token/claims
// will be absent) -- that route is itself behind RequireAuth, so an
// unauthenticated visitor still ends up redirected to /login.
export function resolveInitialRoute(role: string | undefined, companyId: string | undefined): string {
  return resolvePostAcceptRoute(role, companyId) ?? '/admin/companies'
}
