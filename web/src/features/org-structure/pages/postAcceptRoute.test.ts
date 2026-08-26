import { describe, it, expect } from 'vitest'
import { resolvePostAcceptRoute } from './postAcceptRoute'
import { resolveInitialRoute } from '../../../app/resolveInitialRoute'
import { canReach, PLATFORM_ROLES } from '../../../navigation/roleCapabilities'

describe('resolvePostAcceptRoute', () => {
  it('routes a super_admin to the companies list', () => {
    expect(resolvePostAcceptRoute('super_admin', 'company-1')).toBe('/admin/companies')
  })

  it('routes a company_admin to their own company users page', () => {
    expect(resolvePostAcceptRoute('company_admin', 'company-1')).toBe('/admin/companies/company-1/users')
  })

  it.each(['employee', 'supervisor', 'leader'])(
    'routes %s to the same page logging in would (#138)',
    (role) => {
      // Was `/surveys/my` (#109), which they can load — but "where does a signed-in
      // person start" then had two different answers depending on how they got there.
      // Accepting an invitation put them on a list; the next morning's login put them on
      // a summary. One answer now, and it is the summary.
      expect(resolvePostAcceptRoute(role, 'company-1')).toBe(resolveInitialRoute())
    },
  )

  /**
   * The case that used to have no answer at all.
   *
   * An invitation minted with a role string this client does not recognise ended on
   * "your account was created" and nowhere to go. `/dashboard` is safe for it precisely
   * because `DashboardPage` falls through to the per-user employee view, whose endpoint
   * reads no role claim.
   */
  it('routes an unknown role somewhere real instead of refusing to guess', () => {
    expect(resolvePostAcceptRoute('auditor', 'company-1')).toBe(resolveInitialRoute())
    expect(resolvePostAcceptRoute(undefined, 'company-1')).toBe(resolveInitialRoute())
  })

  /**
   * The property, rather than the four destinations.
   *
   * A destination is only correct if the role that is sent there can load it, and that is
   * a question `roleCapabilities` answers for every role at once — including the two admin
   * ones, whose destinations this issue deliberately left alone.
   */
  it.each([...PLATFORM_ROLES])('sends %s somewhere that role can load', (role) => {
    const destination = resolvePostAcceptRoute(role, 'company-1')
    expect(destination).not.toBeNull()
    expect(canReach(role, destination as string, true), `${role} → ${destination}`).toBe(true)
  })

  it('returns null when companyId is missing, whatever the role', () => {
    // Still genuinely destination-less: a user who belongs to no tenant. The caller
    // confirms success in place rather than navigating.
    expect(resolvePostAcceptRoute('employee', undefined)).toBeNull()
    expect(resolvePostAcceptRoute('company_admin', undefined)).toBeNull()
    expect(resolvePostAcceptRoute(undefined, undefined)).toBeNull()
  })
})
