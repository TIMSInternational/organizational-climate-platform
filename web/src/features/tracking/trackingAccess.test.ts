import { describe, it, expect, afterEach } from 'vitest'
import { clearToken, setToken } from '../../auth/token'
import {
  canCreatePlan,
  canManagePlan,
  creatableNodos,
  isTrackingAdmin,
  readTrackingClaims,
  type TrackingClaims,
} from './trackingAccess'
import { tokenFor } from '../../test/jwtFixture'

/**
 * These mirror `ClimateTracking.Application.Auth.PlanAccessHandler` case for case.
 *
 * The one that matters most is the third: **an involucrado, and the responsable de
 * ejecución, get READ and nothing else.** It is the natural mistake to make in the
 * other direction — the person doing the work looks like the person who should
 * report on it — and getting it wrong here means drawing a "Registrar avance" form
 * that answers 403 on submit.
 */
function claims(overrides: Partial<TrackingClaims> = {}): TrackingClaims {
  return {
    personaExternalId: 'persona-1',
    role: 'leader',
    nodoExternalId: 'nodo-a',
    ...overrides,
  }
}

afterEach(() => {
  clearToken()
})

describe('reading the tracking claims off the app token', () => {
  it('reads sub, role and nodoId — the three claims GetCurrentUser reads', () => {
    setToken(tokenFor({ sub: 'persona-9', role: 'leader', nodoId: 'nodo-z' }))
    expect(readTrackingClaims()).toEqual({
      personaExternalId: 'persona-9',
      role: 'leader',
      nodoExternalId: 'nodo-z',
    })
  })

  it('treats a token with no sub as no caller', () => {
    // `ClaimsPrincipalExtensions.GetCurrentUser` throws on a missing `sub`, so a
    // holder of such a token is not a tracking caller at either end.
    setToken(tokenFor({ role: 'super_admin' }))
    expect(readTrackingClaims()).toBeNull()
  })

  it('is null with no token at all', () => {
    expect(readTrackingClaims()).toBeNull()
  })

  it('defaults a missing nodoId to the empty string JwtTokenService mints', () => {
    setToken(tokenFor({ sub: 'persona-9', role: 'employee' }))
    expect(readTrackingClaims()?.nodoExternalId).toBe('')
  })
})

describe('who may write to a plan', () => {
  const plan = { nodoExternalId: 'nodo-a' }

  it('lets both admin roles write to any plan', () => {
    expect(canManagePlan(plan, claims({ role: 'company_admin', nodoExternalId: '' }))).toBe(true)
    expect(canManagePlan(plan, claims({ role: 'super_admin', nodoExternalId: 'other' }))).toBe(true)
    expect(isTrackingAdmin(claims({ role: 'super_admin' }))).toBe(true)
  })

  it('lets a leader write to their own node', () => {
    expect(canManagePlan(plan, claims({ role: 'leader', nodoExternalId: 'nodo-a' }))).toBe(true)
  })

  it('refuses a leader on somebody else node', () => {
    expect(canManagePlan(plan, claims({ role: 'leader', nodoExternalId: 'nodo-b' }))).toBe(false)
  })

  it('refuses the responsable de ejecución and every involucrado', () => {
    // The load-bearing case. `PlanAccessHandler` succeeds for these two only when
    // `requirement.Level == AccessLevel.Read`.
    expect(canManagePlan(plan, claims({ role: 'employee', nodoExternalId: '' }))).toBe(false)
    expect(canManagePlan(plan, claims({ role: 'supervisor', nodoExternalId: 'nodo-a' }))).toBe(false)
  })

  it('refuses a blank node rather than matching one blank against another', () => {
    // `nodoId` is minted as `string.Empty` for a user who leads nothing. Comparing
    // two blanks as equal would hand write access to every such leader.
    expect(canManagePlan({ nodoExternalId: '' }, claims({ role: 'leader', nodoExternalId: '' }))).toBe(
      false,
    )
  })

  it('refuses an anonymous caller', () => {
    expect(canManagePlan(plan, null)).toBe(false)
  })
})

describe('who may create a plan, and for which node', () => {
  it('follows Roles.PlanCreator', () => {
    expect(canCreatePlan(claims({ role: 'leader', nodoExternalId: 'nodo-a' }))).toBe(true)
    expect(canCreatePlan(claims({ role: 'company_admin' }))).toBe(true)
    expect(canCreatePlan(claims({ role: 'super_admin' }))).toBe(true)
    expect(canCreatePlan(claims({ role: 'employee' }))).toBe(false)
    expect(canCreatePlan(claims({ role: 'supervisor' }))).toBe(false)
  })

  it('refuses a leader with no node, who would be forbidden on every node they picked', () => {
    expect(canCreatePlan(claims({ role: 'leader', nodoExternalId: '' }))).toBe(false)
  })

  it('offers a leader only their own node', () => {
    const nodos = [{ id: 'nodo-a' }, { id: 'nodo-b' }]
    expect(creatableNodos(nodos, claims({ role: 'leader', nodoExternalId: 'nodo-b' }))).toEqual([
      { id: 'nodo-b' },
    ])
  })

  it('offers an admin every node', () => {
    const nodos = [{ id: 'nodo-a' }, { id: 'nodo-b' }]
    expect(creatableNodos(nodos, claims({ role: 'company_admin' }))).toHaveLength(2)
  })
})
