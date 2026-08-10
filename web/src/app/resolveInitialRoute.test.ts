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
   * `resolvePostAcceptRoute` is deliberately NOT collapsed into this. It answers a
   * different question — where to send someone who has just accepted an invitation, and
   * whose `null` means "nowhere, show an inline message instead". Pinned so a later tidy-up
   * that merges the two has to argue with a test first.
   */
  it('leaves the post-accept destination alone, which still needs a null answer', () => {
    expect(resolvePostAcceptRoute('employee', undefined)).toBeNull()
    expect(resolvePostAcceptRoute('employee', 'company-1')).toBe('/surveys/my')
  })
})
