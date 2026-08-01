import { describe, it, expect } from 'vitest'
import { resolveInitialRoute } from './resolveInitialRoute'

describe('resolveInitialRoute', () => {
  it('routes a super_admin to the companies list', () => {
    expect(resolveInitialRoute('super_admin', 'company-1')).toBe('/admin/companies')
  })

  it('routes a company_admin to their own company users page', () => {
    expect(resolveInitialRoute('company_admin', 'company-1')).toBe('/admin/companies/company-1/users')
  })

  it('falls back to /admin/companies for a role with no landing page yet', () => {
    expect(resolveInitialRoute('employee', 'company-1')).toBe('/admin/companies')
  })

  it('falls back to /admin/companies when role/companyId are missing (unauthenticated)', () => {
    expect(resolveInitialRoute(undefined, undefined)).toBe('/admin/companies')
  })
})
