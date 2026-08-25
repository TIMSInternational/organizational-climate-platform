import { describe, it, expect } from 'vitest'
import { resolveInitialRoute } from './resolveInitialRoute'
import { buildNavSections, leafNavItems } from '../navigation/navSections'
import { resolvePostAcceptRoute } from '../features/org-structure/pages/postAcceptRoute'

describe('resolveInitialRoute', () => {
  /**
   * This used to be four assertions, one per role, each naming a different list page —
   * `/admin/companies`, `/admin/companies/{id}/users`, `/surveys/my`. #132 replaced all of
   * them with a dashboard, so the interesting property is no longer "which page" but
   * "every role gets one, and it is reachable".
   */
  it('lands every user on the dashboard', () => {
    expect(resolveInitialRoute()).toBe('/dashboard')
  })

  /**
   * The reason the per-role branching could be deleted, asserted rather than assumed.
   *
   * The old function existed to keep each role off a page it would be 403d on. That
   * requirement has not gone away — it is satisfied differently, by `/dashboard` being a
   * route every role's nav offers and `DashboardPage` dispatching to an endpoint that role
   * is allowed to call. If a future change made the dashboard role-gated, this fails.
   */
  it('sends users somewhere their own nav actually offers them', () => {
    for (const role of ['super_admin', 'company_admin', 'leader', 'supervisor', 'employee', undefined]) {
      const hrefs = leafNavItems(buildNavSections(role, 'company-1')).map((item) => item.href)
      expect(hrefs, `${role} has no nav entry for the landing route`).toContain(resolveInitialRoute())
    }
  })

  /**
   * `resolvePostAcceptRoute` is deliberately NOT collapsed into this, and the reason has
   * narrowed rather than gone away.
   *
   * It used to answer a *different destination* for the same person — `/surveys/my` for an
   * employee where this said `/dashboard` — which was two answers to one question and is
   * what #138 removed. What still separates the two functions is the shape of the answer:
   * only the post-accept one can say **null**, meaning "there is nowhere to send them, show
   * an inline message instead", for a token whose claims carry no company at all. This one
   * is a constant and has no such case.
   *
   * Pinned so a later tidy-up that merges the two has to argue with a test first: merging
   * them would silently navigate a company-less user into a page scoped by a company they
   * do not have.
   */
  it('leaves the post-accept destination alone, which still needs a null answer', () => {
    expect(resolvePostAcceptRoute('employee', undefined)).toBeNull()
    // With a company, the two now agree — deliberately, since #138.
    expect(resolvePostAcceptRoute('employee', 'company-1')).toBe(resolveInitialRoute())
  })
})
