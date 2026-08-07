import { describe, it, expect } from 'vitest'
import { resolveInitialRoute } from './resolveInitialRoute'

describe('resolveInitialRoute', () => {
  it('routes a super_admin to the companies list', () => {
    expect(resolveInitialRoute('super_admin', 'company-1')).toBe('/admin/companies')
  })

  it('routes a company_admin to their own company users page', () => {
    expect(resolveInitialRoute('company_admin', 'company-1')).toBe('/admin/companies/company-1/users')
  })

  it('routes an employee to their own survey listing rather than a page they would be 403d on', () => {
    // This used to assert '/admin/companies', which is SuperAdmin-only: an
    // employee's very first navigation after logging in was into a 403. #109's
    // `/surveys/my` is scoped per user, so all three non-admin roles can load it.
    expect(resolveInitialRoute('employee', 'company-1')).toBe('/surveys/my')
  })

  it('falls back to /admin/companies when role/companyId are missing (unauthenticated)', () => {
    expect(resolveInitialRoute(undefined, undefined)).toBe('/admin/companies')
  })
})
