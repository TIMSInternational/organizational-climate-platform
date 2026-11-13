import { describe, it, expect } from 'vitest'
import { RESPONDENT_SURFACE, isRespondentRole, respondentAuthorizedRoutes, respondentMayReach } from './respondentSurface'
import { canReach } from './roleCapabilities'

const SURVEY = '/surveys/2437d05b-fd0f-47a4-ba67-9d96f1ac4798/respond'

describe('the respondent surface', () => {
  /**
   * The rule that keeps this from drifting into a second, contradictory policy: it may
   * only ever NARROW what `roleCapabilities` already authorizes. Naming a route here that
   * the server would refuse would offer a respondent a page that 403s.
   */
  it('names nothing the server would not already authorize for an employee', () => {
    const authorized = respondentAuthorizedRoutes()
    for (const route of RESPONDENT_SURFACE) {
      expect(authorized.has(route), `${route} is not in roleCapabilities for employee`).toBe(true)
    }
    // And it is strictly narrower, or it would not be doing anything.
    expect(RESPONDENT_SURFACE.length).toBeLessThan(authorized.size)
  })

  it('admits the dashboard and the survey being answered', () => {
    expect(respondentMayReach('/dashboard')).toBe(true)
    expect(respondentMayReach(SURVEY)).toBe(true)
  })

  /**
   * G26. The two destinations the product links an employee to from outside the shell:
   * the preferences link in every notification email's footer, and each Mis tareas row's
   * plan. Before this they bounced to the dashboard.
   */
  it('admits the preferences link from the email footer and the plan behind a task', () => {
    expect(respondentMayReach('/settings/notifications')).toBe(true)
    expect(respondentMayReach('/tracking/planes/7d1c2f7e-3b7a-4f37-9a43-6c9f3c7a1b52')).toBe(true)
  })

  /**
   * `/surveys/my` is the one that a prefix check would wave through, and it is exactly
   * the page the workspace used to link to twice. Pattern matching, not `startsWith`.
   */
  it('refuses the rest of the signed-in product', () => {
    for (const path of [
      '/surveys/my',
      '/profile',
      '/settings/privacy',
      '/notifications',
      '/tracking/planes',
      '/tracking/tablero',
      '/admin/companies',
      '/results',
      '/action-plans',
      '/microclimates',
    ]) {
      expect(respondentMayReach(path), `${path} should be refused`).toBe(false)
    }
  })

  it('applies to employee alone — a leader has a job that needs other pages', () => {
    expect(isRespondentRole('employee')).toBe(true)
    for (const role of ['leader', 'supervisor', 'company_admin', 'super_admin', undefined]) {
      expect(isRespondentRole(role), `${role} must not be locked down`).toBe(false)
    }
    // The measurement behind that scope: the capability table is not a complete gate for
    // the admin roles, so they are deliberately not held to it.
    expect(canReach('leader', '/action-plans')).toBe(true)
  })
})
