import { describe, it, expect } from 'vitest'
import { resolvePostAcceptRoute } from './postAcceptRoute'

describe('resolvePostAcceptRoute', () => {
  it('routes a super_admin to the companies list', () => {
    expect(resolvePostAcceptRoute('super_admin', 'company-1')).toBe('/admin/companies')
  })

  it('routes a company_admin to their own company users page', () => {
    expect(resolvePostAcceptRoute('company_admin', 'company-1')).toBe('/admin/companies/company-1/users')
  })

  it.each(['employee', 'supervisor', 'leader'])('routes %s to their own survey listing', (role) => {
    // Was `null` -- "no page they can load yet" -- which was true until #109
    // shipped `/surveys/my`. That endpoint resolves the caller's OWN user row and
    // reads no role claim, so all three load it; `navSections.ts` already gives
    // them MY_SURVEYS_ITEM as their primary destination, and this used to
    // contradict it.
    expect(resolvePostAcceptRoute(role, 'company-1')).toBe('/surveys/my')
  })

  it('returns null for an unknown or missing role', () => {
    // No claim about what an unrecognised role can load, so no destination -- the
    // caller confirms success in place rather than navigating into a 403.
    expect(resolvePostAcceptRoute(undefined, 'company-1')).toBeNull()
    expect(resolvePostAcceptRoute('not_a_real_role', 'company-1')).toBeNull()
  })

  it('returns null for a known role with no company, because /surveys/my scopes by one', () => {
    expect(resolvePostAcceptRoute('employee', undefined)).toBeNull()
  })

  it('returns null when companyId is missing, even for an admin role', () => {
    expect(resolvePostAcceptRoute('company_admin', undefined)).toBeNull()
  })
})
