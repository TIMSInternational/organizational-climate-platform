import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { capabilitiesFor, readViewerClaims, useViewerCapabilities, type ViewerClaims } from './viewerCapabilities'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY, resolveCompanyScope } from '../company-context'
import { setToken, clearToken } from './token'
import { tokenFor } from '../test/jwtFixture'

/**
 * Every capability × every role, as a table, so a flipped rule fails on the row that
 * names the role it widened or narrowed. The expected values are the server's, cited
 * per capability in `viewerCapabilities.ts`; nothing here is a preference.
 */

function claimsFor(role: string | undefined, overrides: Partial<ViewerClaims> = {}): ViewerClaims {
  return { role, companyId: 'c1', personaExternalId: 'u1', nodoExternalId: '', ...overrides }
}

function scopeFor(claims: ViewerClaims, selectedCompanyId: string | null = null) {
  return resolveCompanyScope({ role: claims.role, companyId: claims.companyId }, selectedCompanyId)
}

const BOOLEANS = [
  'seesWholeCompany',
  'seesTeam',
  'seesOnlySelf',
  'canAuthorSurveys',
  'canLaunchMicroclimate',
  'canCreateActionPlan',
  'canShareReports',
  'canExport',
  'canManageOrg',
  'canUseDirectoryPickers',
] as const

type Row = Record<(typeof BOOLEANS)[number], boolean>

const ALL_ADMIN: Row = {
  seesWholeCompany: true,
  seesTeam: false,
  seesOnlySelf: false,
  canAuthorSurveys: true,
  canLaunchMicroclimate: true,
  canCreateActionPlan: true,
  canShareReports: true,
  canExport: true,
  canManageOrg: true,
  canUseDirectoryPickers: true,
}

const NOTHING: Row = {
  seesWholeCompany: false,
  seesTeam: false,
  seesOnlySelf: false,
  canAuthorSurveys: false,
  canLaunchMicroclimate: false,
  canCreateActionPlan: false,
  canShareReports: false,
  canExport: false,
  canManageOrg: false,
  canUseDirectoryPickers: false,
}

const TEAM: Row = { ...NOTHING, seesTeam: true, canExport: true }
const SELF: Row = { ...NOTHING, seesOnlySelf: true }

const TABLE: Array<{ name: string; claims: ViewerClaims; selected?: string | null; expected: Row }> = [
  { name: 'super_admin with a company selected', claims: claimsFor('super_admin', { companyId: undefined }), selected: 'c9', expected: ALL_ADMIN },
  // A SuperAdmin's own claim is never their scope (companyContext.ts); with nothing
  // selected there is no companyId to put in any request, so every admin write is off.
  { name: 'super_admin with nothing selected', claims: claimsFor('super_admin'), selected: null, expected: NOTHING },
  { name: 'company_admin', claims: claimsFor('company_admin'), expected: ALL_ADMIN },
  // A stored selection is ignored for this role, so it changes nothing.
  { name: 'company_admin with a stray selection', claims: claimsFor('company_admin'), selected: 'c9', expected: ALL_ADMIN },
  // `CanAccessCompany` compares the claim to the request; an empty claim never matches.
  { name: 'company_admin with no tenant claim', claims: claimsFor('company_admin', { companyId: undefined }), expected: NOTHING },
  { name: 'leader', claims: claimsFor('leader', { nodoExternalId: 'n1' }), expected: TEAM },
  { name: 'supervisor', claims: claimsFor('supervisor'), expected: TEAM },
  { name: 'employee', claims: claimsFor('employee'), expected: SELF },
  { name: 'no role claim', claims: claimsFor(undefined), expected: SELF },
  { name: 'an unrecognised role', claims: claimsFor('department_admin'), expected: SELF },
]

describe('capabilitiesFor', () => {
  describe('the boolean capabilities, by role', () => {
    for (const row of TABLE) {
      it(row.name, () => {
        const capabilities = capabilitiesFor(row.claims, scopeFor(row.claims, row.selected ?? null))
        const actual = Object.fromEntries(BOOLEANS.map((key) => [key, capabilities[key]]))
        expect(actual).toEqual(row.expected)
      })
    }
  })

  describe('canRecordProgress(plan) mirrors PlanAccessHandler through canManagePlan', () => {
    const plan = { nodoExternalId: 'n1' }
    const cases: Array<{ name: string; claims: ViewerClaims; selected?: string; expected: boolean }> = [
      { name: 'super_admin, any plan', claims: claimsFor('super_admin', { companyId: undefined }), selected: 'c9', expected: true },
      { name: 'company_admin, any plan', claims: claimsFor('company_admin'), expected: true },
      { name: 'leader of the plan node', claims: claimsFor('leader', { nodoExternalId: 'n1' }), expected: true },
      { name: 'leader of another node', claims: claimsFor('leader', { nodoExternalId: 'n2' }), expected: false },
      { name: 'leader with no node claim', claims: claimsFor('leader', { nodoExternalId: '' }), expected: false },
      { name: 'supervisor of the same node', claims: claimsFor('supervisor', { nodoExternalId: 'n1' }), expected: false },
      { name: 'employee', claims: claimsFor('employee', { nodoExternalId: 'n1' }), expected: false },
      // A token with no `sub` is not a tracking caller at all (`readTrackingClaims`).
      { name: 'admin whose token has no sub', claims: claimsFor('company_admin', { personaExternalId: '' }), expected: false },
    ]
    for (const c of cases) {
      it(c.name, () => {
        const capabilities = capabilitiesFor(c.claims, scopeFor(c.claims, c.selected ?? null))
        expect(capabilities.canRecordProgress(plan)).toBe(c.expected)
      })
    }

    it('refuses the blank-node equality rather than trusting it', () => {
      const claims = claimsFor('leader', { nodoExternalId: '' })
      expect(capabilitiesFor(claims, scopeFor(claims)).canRecordProgress({ nodoExternalId: '' })).toBe(false)
    })
  })

  describe('canOpenResults(survey) mirrors CanAdminister on the claim', () => {
    const own = { companyId: 'c1' }
    const other = { companyId: 'c2' }

    it('super_admin opens any survey, selection or not', () => {
      const claims = claimsFor('super_admin', { companyId: undefined })
      const capabilities = capabilitiesFor(claims, scopeFor(claims, null))
      expect(capabilities.canOpenResults(own)).toBe(true)
      expect(capabilities.canOpenResults(other)).toBe(true)
    })

    it("company_admin opens only their claim's tenant, whatever is selected", () => {
      const claims = claimsFor('company_admin')
      const capabilities = capabilitiesFor(claims, scopeFor(claims, 'c2'))
      expect(capabilities.canOpenResults(own)).toBe(true)
      expect(capabilities.canOpenResults(other)).toBe(false)
    })

    it('company_admin with no tenant claim opens nothing', () => {
      const claims = claimsFor('company_admin', { companyId: undefined })
      expect(capabilitiesFor(claims, scopeFor(claims)).canOpenResults(own)).toBe(false)
    })

    for (const role of ['leader', 'supervisor', 'employee', undefined]) {
      it(`${role ?? 'no role'} cannot open results, even of their own tenant`, () => {
        const claims = claimsFor(role, { nodoExternalId: 'n1' })
        expect(capabilitiesFor(claims, scopeFor(claims)).canOpenResults(own)).toBe(false)
      })
    }
  })
})

describe('readViewerClaims and useViewerCapabilities', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    clearToken()
    window.localStorage.clear()
  })

  it('reads role, companyId, sub and nodoId off the stored token, normalising the empty tenant', () => {
    setToken(tokenFor({ sub: 'u7', role: 'leader', companyId: '', nodoId: 'n3' }))
    expect(readViewerClaims()).toEqual({
      role: 'leader',
      companyId: undefined,
      personaExternalId: 'u7',
      nodoExternalId: 'n3',
    })
  })

  it('yields no role and empty tracking claims when there is no token', () => {
    expect(readViewerClaims()).toEqual({
      role: undefined,
      companyId: undefined,
      personaExternalId: '',
      nodoExternalId: '',
    })
  })

  function wrapper({ children }: { children: ReactNode }) {
    return createElement(CompanyContextProvider, null, children)
  }

  it('gives a company_admin the admin capabilities through the provider scope', () => {
    setToken(tokenFor({ sub: 'u1', role: 'company_admin', companyId: 'c1', nodoId: '' }))
    const { result } = renderHook(() => useViewerCapabilities(), { wrapper })
    expect(result.current.canAuthorSurveys).toBe(true)
    expect(result.current.canOpenResults({ companyId: 'c1' })).toBe(true)
    expect(result.current.canOpenResults({ companyId: 'c2' })).toBe(false)
  })

  it('gives a super_admin nothing to author until a company is selected', () => {
    setToken(tokenFor({ sub: 'u1', role: 'super_admin', companyId: '', nodoId: '' }))
    const { result: unselected } = renderHook(() => useViewerCapabilities(), { wrapper })
    expect(unselected.current.canAuthorSurveys).toBe(false)
    window.localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'c9')
    const { result: selected } = renderHook(() => useViewerCapabilities(), { wrapper })
    expect(selected.current.canAuthorSurveys).toBe(true)
  })

  it('gives an employee only their own surface', () => {
    setToken(tokenFor({ sub: 'u1', role: 'employee', companyId: 'c1', nodoId: '' }))
    const { result } = renderHook(() => useViewerCapabilities(), { wrapper })
    expect(result.current.seesOnlySelf).toBe(true)
    expect(result.current.canExport).toBe(false)
    expect(result.current.canRecordProgress({ nodoExternalId: 'n1' })).toBe(false)
  })
})
