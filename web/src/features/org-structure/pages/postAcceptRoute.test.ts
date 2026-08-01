import { describe, it, expect } from 'vitest'
import { resolvePostAcceptRoute } from './postAcceptRoute'

describe('resolvePostAcceptRoute', () => {
  it('routes a super_admin to the companies list', () => {
    expect(resolvePostAcceptRoute('super_admin', 'company-1')).toBe('/admin/companies')
  })

  it('routes a company_admin to their own company users page', () => {
    expect(resolvePostAcceptRoute('company_admin', 'company-1')).toBe('/admin/companies/company-1/users')
  })

  it.each(['employee', 'supervisor', 'leader'])('returns null for %s (no page they can load yet)', (role) => {
    expect(resolvePostAcceptRoute(role, 'company-1')).toBeNull()
  })

  it('returns null for an unknown or missing role', () => {
    expect(resolvePostAcceptRoute(undefined, 'company-1')).toBeNull()
    expect(resolvePostAcceptRoute('not_a_real_role', 'company-1')).toBeNull()
  })

  it('returns null when companyId is missing, even for an admin role', () => {
    expect(resolvePostAcceptRoute('company_admin', undefined)).toBeNull()
  })
})
