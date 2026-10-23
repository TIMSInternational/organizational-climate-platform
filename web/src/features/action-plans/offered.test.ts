import { afterEach, describe, expect, it, vi } from 'vitest'
import { actionPlanHref, actionPlansOffered } from './offered'
import { hrefForResult, type SearchResultItem } from '../search/api/search'
import { actionOf } from '../notifications/next/derive'
import type { NotificationDetail } from '../notifications/api/notifications'
import { buildNavSections, leafNavItems } from '../../navigation/navSections'

/**
 * G24: with a tracking service configured the sidebar drops `/action-plans`, and the screens
 * outside the nav have to agree with it. One predicate decides for all of them.
 */
describe('actionPlansOffered — the sidebar’s rule, outside the sidebar', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const hit: SearchResultItem = { type: 'action_plan', id: 'p1', title: 'Plan', subtitle: null, companyId: 'c1', parentId: null }
  const nudge = {
    id: 'n1',
    userId: 'u1',
    companyId: 'c1',
    type: 'action_plan_alert',
    channel: 'email',
    priority: 'medium',
    status: 'sent',
    title: 'Un plan de acción a tu cargo vence pronto',
    message: '…',
    data: JSON.stringify({ actionPlanId: 'p1' }),
    templateId: null,
    scheduledFor: '2026-10-20T00:00:00Z',
    sentAt: null,
    deliveredAt: null,
    openedAt: null,
    failedAt: null,
    failureReason: null,
    retryCount: 0,
    createdAt: '2026-10-20T00:00:00Z',
  } satisfies NotificationDetail

  function sidebarOffersActionPlans(): boolean {
    // The sidebar asks `isTrackingEnabled()` itself (`AdminLayout`); the same env decides both.
    const sections = buildNavSections('company_admin', 'c1', { trackingEnabled: !actionPlansOffered() })
    return leafNavItems(sections).some((item) => item.href === '/action-plans')
  }

  it('offers every entry point where there is no tracking service, exactly as the sidebar does', () => {
    vi.stubEnv('VITE_TRACKING_API_BASE_URL', '')
    expect(actionPlansOffered()).toBe(true)
    expect(sidebarOffersActionPlans()).toBe(true)
    expect(actionPlanHref('p1')).toBe('/action-plans/p1')
    expect(hrefForResult(hit)).toBe('/action-plans/p1')
    expect(actionOf(nudge, () => true)?.href).toBe('/action-plans/p1')
  })

  it('offers none of them where a tracking service replaces Action Plans in the sidebar', () => {
    vi.stubEnv('VITE_TRACKING_API_BASE_URL', 'http://tracking.test')
    expect(actionPlansOffered()).toBe(false)
    expect(sidebarOffersActionPlans()).toBe(false)
    expect(actionPlanHref('p1')).toBeNull()
    // The palette drops a hit it cannot route rather than drawing a dead entry.
    expect(hrefForResult(hit)).toBeNull()
    // The inbox row keeps its text and loses the way out.
    expect(actionOf(nudge, () => true)).toBeNull()
  })
})
