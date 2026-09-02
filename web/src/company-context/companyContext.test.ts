import { describe, it, expect, afterEach } from 'vitest'
import {
  COMPANY_CONTEXT_STORAGE_KEY,
  readSelectedCompanyId,
  readSessionClaims,
  resolveCompanyScope,
  writeSelectedCompanyId,
} from './companyContext'
import { setToken, clearToken } from '../auth/token'
import { tokenFor } from '../test/jwtFixture'

/** An unsigned JWT carrying just the claims this module reads. */

afterEach(() => {
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
})

describe('resolveCompanyScope', () => {
  describe('a super_admin', () => {
    it('is scoped to the company they selected', () => {
      const scope = resolveCompanyScope({ role: 'super_admin', companyId: undefined }, 'chosen-co')
      expect(scope.status).toBe('ready')
      expect(scope.companyId).toBe('chosen-co')
      expect(scope.isSuperAdmin).toBe(true)
    })

    it('is scoped to NOTHING when they have selected nothing', () => {
      // THE must-get. "No selection" resolves to "choose one", never to a company.
      const scope = resolveCompanyScope({ role: 'super_admin', companyId: undefined }, null)
      expect(scope.status).toBe('needs-selection')
      expect(scope.companyId).toBeUndefined()
    })

    it('never falls back to their own companyId claim', () => {
      // The precise failure `navSections.ts` and `ActionPlansListPage` were written
      // around: a super_admin whose own user row points at a company would have been
      // silently scoped to it, with no picker and no indication anything happened.
      // A claim is present here and is still not used.
      const scope = resolveCompanyScope({ role: 'super_admin', companyId: 'their-own-row' }, null)
      expect(scope.status).toBe('needs-selection')
      expect(scope.companyId).toBeUndefined()
    })

    it('prefers the selection over their own claim when both exist', () => {
      const scope = resolveCompanyScope({ role: 'super_admin', companyId: 'their-own-row' }, 'chosen-co')
      expect(scope.companyId).toBe('chosen-co')
    })

    it('treats an empty selection as no selection', () => {
      expect(resolveCompanyScope({ role: 'super_admin', companyId: undefined }, '').status).toBe(
        'needs-selection',
      )
    })
  })

  describe('every other role', () => {
    it('is scoped to their own claim', () => {
      const scope = resolveCompanyScope({ role: 'company_admin', companyId: 'their-co' }, null)
      expect(scope.status).toBe('ready')
      expect(scope.companyId).toBe('their-co')
      expect(scope.isSuperAdmin).toBe(false)
    })

    it.each(['company_admin', 'employee', 'supervisor', 'leader', undefined])(
      'ignores a stored selection entirely (%s)',
      (role) => {
        // The client half of the privilege boundary. A SuperAdmin-only override that
        // any role can set is an escalation surface; here the value is not merely
        // rejected by the API, it is never read. Writing one by hand into
        // localStorage changes nothing about what this role sees.
        const scope = resolveCompanyScope({ role, companyId: 'their-co' }, 'someone-elses-co')
        expect(scope.companyId).toBe('their-co')
        expect(scope.status).toBe('ready')
      },
    )

    it('reports no-company rather than needs-selection when their token names no tenant', () => {
      // There is nothing to ask a non-SuperAdmin to choose from -- `GET /admin/companies`
      // is SuperAdmin-only -- so the two empty states are deliberately different.
      const scope = resolveCompanyScope({ role: 'company_admin', companyId: undefined }, 'anything')
      expect(scope.status).toBe('no-company')
      expect(scope.companyId).toBeUndefined()
    })
  })
})

describe('readSessionClaims', () => {
  it('normalises the empty-string companyId a company-less super_admin carries', () => {
    // Since #191 `User.CompanyId` is `Guid?` and `AuthEndpoints` emits
    // `user.CompanyId?.ToString() ?? string.Empty`, so the claim is `''`, not absent.
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    expect(readSessionClaims()).toEqual({ role: 'super_admin', companyId: undefined })
  })

  it('reads a real claim through unchanged', () => {
    setToken(tokenFor({ role: 'company_admin', companyId: 'c1' }))
    expect(readSessionClaims()).toEqual({ role: 'company_admin', companyId: 'c1' })
  })

  it('returns undefined claims when there is no token at all', () => {
    expect(readSessionClaims()).toEqual({ role: undefined, companyId: undefined })
  })

  it('returns undefined claims rather than throwing on a malformed token', () => {
    setToken('not-a-jwt')
    expect(readSessionClaims()).toEqual({ role: undefined, companyId: undefined })
  })
})

describe('the stored selection', () => {
  it('round-trips through localStorage, so it survives a reload', () => {
    writeSelectedCompanyId('co-9')
    expect(localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBe('co-9')
    expect(readSelectedCompanyId()).toBe('co-9')
  })

  it('clears rather than storing an empty value', () => {
    writeSelectedCompanyId('co-9')
    writeSelectedCompanyId(null)
    expect(localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBeNull()
    expect(readSelectedCompanyId()).toBeNull()
  })

  it('reads a blank stored value as no selection', () => {
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, '   ')
    expect(readSelectedCompanyId()).toBeNull()
  })
})
