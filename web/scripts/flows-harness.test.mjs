import { describe, it, expect } from 'vitest'
import {
  FIXED_DEPARTMENT_NAME,
  FIXED_PLAN_TITLE,
  MINT_PATH,
  findFixedDepartment,
  findFixedPlan,
  shareFromMint,
  teardownRequests,
  teardownFallback,
  summariseTeardown,
} from './flows-harness.mjs'

/**
 * `flows.mjs` writes to a real tenant — the client-facing demo one, the night before a demo —
 * and cannot be run in CI. These pin the part of it that decides what it creates and what it
 * puts back, which is the part that filled that tenant with six departments, three plans and
 * six public links. Every guarantee here was broken once to prove the test sees it.
 */

const REPORT = '0f6b3a12-9c2e-4c11-8f57-2d1a6e3b9c44'
const SHARE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

describe('the department is found by its fixed name, and reused rather than recreated', () => {
  it('reuses an active one without asking for a reactivation', () => {
    const list = [{ id: 'd1', name: 'Finanzas', isActive: true }, { id: 'd2', name: FIXED_DEPARTMENT_NAME, isActive: true }]
    expect(findFixedDepartment(list)).toEqual({ id: 'd2', reactivate: false })
  })

  it('finds the one the previous teardown deactivated and says it must be reactivated first', () => {
    const list = [{ id: 'd2', name: FIXED_DEPARTMENT_NAME, isActive: false }]
    expect(findFixedDepartment(list)).toEqual({ id: 'd2', reactivate: true })
  })

  it('does not mistake a run-numbered leftover for its own (the old residue must not be adopted)', () => {
    const list = [{ id: 'd9', name: 'Calidad 417', isActive: false }, { id: 'd8', name: `${FIXED_DEPARTMENT_NAME} 2`, isActive: true }]
    expect(findFixedDepartment(list)).toBeNull()
    expect(findFixedDepartment(undefined)).toBeNull()
  })
})

describe('the plan is found by its fixed title, and reopened only when cancelled', () => {
  it('reuses an open one as-is', () => {
    const plans = [{ id: 'p1', title: FIXED_PLAN_TITLE, status: 'in_progress' }]
    expect(findFixedPlan(plans)).toEqual({ id: 'p1', reopen: false })
  })

  it('says a cancelled one has to be reopened before the flow can show it', () => {
    const plans = [{ id: 'p1', title: FIXED_PLAN_TITLE, status: 'cancelled' }]
    expect(findFixedPlan(plans)).toEqual({ id: 'p1', reopen: true })
  })

  it('returns null when absent so the flow walks the create form', () => {
    expect(findFixedPlan([{ id: 'p2', title: 'Plan de prueba 4711', status: 'cancelled' }])).toBeNull()
    expect(findFixedPlan(null)).toBeNull()
  })
})

describe('the share the page minted is read out of the mint response', () => {
  it('pairs the report id from the URL with the share id from the body', () => {
    const url = `http://127.0.0.1:5080/admin/reports/${REPORT}/share`
    expect(shareFromMint(url, { id: SHARE, token: 'never-logged', path: '/shared/reports/x' })).toEqual({ reportId: REPORT, shareId: SHARE })
    expect(MINT_PATH.test(`${url}?lang=es`)).toBe(true)
  })

  it('ignores the list and revoke routes and a body with no id', () => {
    expect(shareFromMint(`http://127.0.0.1:5080/admin/reports/${REPORT}/shares`, { id: SHARE })).toBeNull()
    expect(shareFromMint(`http://127.0.0.1:5080/admin/reports/${REPORT}/shares/${SHARE}`, { id: SHARE })).toBeNull()
    expect(shareFromMint(`http://127.0.0.1:5080/admin/reports/${REPORT}/share`, {})).toBeNull()
    expect(shareFromMint(`http://127.0.0.1:5080/admin/reports/${REPORT}/share`, null)).toBeNull()
  })
})

describe('the teardown revokes every share, and puts the rest back through the endpoints the UI uses', () => {
  const created = { surveys: ['s1'], plans: ['p1'], departments: ['d1'], shares: [{ reportId: REPORT, shareId: SHARE }] }

  it('emits one revoke per minted share, first, at the scoped route reportShares.ts uses', () => {
    const [first] = teardownRequests(created)
    expect(first).toMatchObject({ kind: 'share', method: 'DELETE', path: `/admin/reports/${REPORT}/shares/${SHARE}` })
    expect(teardownRequests({ shares: [{ reportId: REPORT, shareId: SHARE }, { reportId: REPORT, shareId: 'b'.repeat(8) }] })).toHaveLength(2)
  })

  it('deletes the survey, cancels the plan and deactivates the department, and nothing else', () => {
    const requests = teardownRequests(created)
    expect(requests.map((r) => [r.kind, r.method, r.path, r.body ?? null])).toEqual([
      ['share', 'DELETE', `/admin/reports/${REPORT}/shares/${SHARE}`, null],
      ['survey', 'DELETE', '/surveys/s1', null],
      ['plan', 'PUT', '/action-plans/p1', { status: 'cancelled' }],
      ['department', 'PUT', '/admin/departments/d1', { isActive: false }],
    ])
    expect(teardownRequests({})).toEqual([])
    expect(teardownRequests(undefined)).toEqual([])
  })
})

describe('a survey that cannot be deleted because it was answered is closed and archived, not left open', () => {
  const del = teardownRequests({ surveys: ['s1'] })[0]

  it('walks active -> closed -> archived on a 409, the only path the lifecycle table allows', () => {
    expect(teardownFallback(del, 409).map((r) => [r.method, r.path, r.body.status])).toEqual([
      ['PUT', '/surveys/s1/status', 'closed'],
      ['PUT', '/surveys/s1/status', 'archived'],
    ])
  })

  it('has no fallback for any other refusal or any other kind', () => {
    expect(teardownFallback(del, 204)).toEqual([])
    expect(teardownFallback(del, 403)).toEqual([])
    expect(teardownFallback(teardownRequests({ plans: ['p1'] })[0], 409)).toEqual([])
    expect(teardownFallback(undefined, 409)).toEqual([])
  })
})

describe('the summary reports residue and the exit code can see it', () => {
  it('counts what was put back by kind and names every request that was not 2xx', () => {
    const requests = teardownRequests({ surveys: ['s1'], plans: ['p1'], departments: ['d1'], shares: [{ reportId: REPORT, shareId: SHARE }] })
    const outcomes = requests.map((r) => ({ ...r, status: r.kind === 'plan' ? 403 : 204 }))
    const { line, failed } = summariseTeardown(outcomes)
    expect(failed).toHaveLength(1)
    expect(line).toBe('teardown: 1 share revoked, 1 survey deleted, 1 department deactivated; RESIDUE LEFT: PUT /action-plans/p1 -> 403')
  })

  it('says so plainly when every request succeeded, and when there was nothing to do', () => {
    const [archived] = teardownFallback(teardownRequests({ surveys: ['s1'] })[0], 409).slice(-1)
    expect(summariseTeardown([{ ...archived, status: 200 }])).toEqual({ line: 'teardown: 1 survey archived (it had responses)', failed: [] })
    expect(summariseTeardown([])).toEqual({ line: 'teardown: nothing to put back', failed: [] })
  })
})
