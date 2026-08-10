/**
 * Where to land a user right after login, and where the bare `/` route should
 * redirect an already-authenticated visitor.
 *
 * **`/dashboard`, for everybody, since #132.** It used to delegate to
 * `resolvePostAcceptRoute`, which sent each role to whichever admin *list* page it
 * could load without 403ing — `/admin/companies` for a super_admin,
 * `/admin/companies/{id}/users` for a company_admin, `/surveys/my` for everyone
 * else. That was the best available answer at the time and a poor landing page: a
 * user's first screen after signing in was a table of rows, and for a plain employee
 * it was the only page they had.
 *
 * `/dashboard` is safe for every role precisely because it is not one page.
 * `DashboardPage` dispatches on the role claim and each role's endpoint refuses the
 * other three, so there is no role for which this route 403s — including a role this
 * function has never heard of, which falls through to the per-user employee view.
 * That is why the role and companyId arguments are gone rather than defaulted: there
 * is no longer a decision to make here, and keeping the parameters would invite one
 * back.
 *
 * `/dashboard` is behind `RequireAuth`, so an unauthenticated visitor still ends up
 * redirected to `/login` — which is what makes it correct for the `/` case too,
 * where there may be no session at all.
 *
 * `resolvePostAcceptRoute` is deliberately left alone and still points at the list
 * pages: it answers a different question (where to send someone who has just
 * accepted an invitation and may not yet have a usable session), and it is the only
 * caller that needs a `null` "there is nowhere to send them" answer.
 */
export function resolveInitialRoute(): string {
  return '/dashboard'
}
