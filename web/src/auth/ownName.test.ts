import { describe, it, expect } from 'vitest'
import { showsOwnName, ROLES_SHOWN_THEIR_OWN_NAME } from './ownName'

/**
 * The predicate behind "no name reaches a respondent" (ruled 2026-10-16, Federico).
 *
 * The two shells that read it have their own tests — `SidebarUserMenu.test.tsx` and
 * `ShellControls.test.tsx` — because a shared rule's real failure mode is a caller that
 * stops calling it, which no test of the rule alone can see. This file pins the rule itself,
 * and in particular that it fails closed.
 */
describe('showsOwnName', () => {
  it('is true for exactly the two administrator roles', () => {
    expect(showsOwnName('super_admin')).toBe(true)
    expect(showsOwnName('company_admin')).toBe(true)
    expect([...ROLES_SHOWN_THEIR_OWN_NAME].sort()).toEqual(['company_admin', 'super_admin'])
  })

  it('is false for every role that answers a survey', () => {
    // All 640 of ESPH's people import as `employee` — the workbook has no role column, so
    // everyone defaults to Colaborador. `leader` and `supervisor` answer their own company's
    // survey too, which is why neither is on the list.
    for (const role of ['employee', 'leader', 'supervisor']) {
      expect(showsOwnName(role)).toBe(false)
    }
  })

  it('fails closed on a role it does not recognise, and on no role at all', () => {
    // The two directions do not cost the same. Wrong towards silence is a rail that reads
    // "Cuenta"; wrong towards the name puts one in front of somebody who was told it would
    // not be there. So anything unrecognised is a respondent.
    expect(showsOwnName(undefined)).toBe(false)
    expect(showsOwnName('')).toBe(false)
    expect(showsOwnName('auditor_externo')).toBe(false)
    expect(showsOwnName('SUPER_ADMIN')).toBe(false)
    expect(showsOwnName('superAdmin')).toBe(false)
  })

  it('matches the wire vocabulary, which is snake_case', () => {
    // The roles arrive in a JWT claim written by the API (`super_admin`), not in the
    // catalogue's camelCase (`users.superAdmin`). A set written in the wrong vocabulary
    // would be false for everybody and would look, from the outside, exactly like the
    // ruling working.
    for (const role of ROLES_SHOWN_THEIR_OWN_NAME) {
      expect(role).toMatch(/^[a-z]+(_[a-z]+)*$/)
    }
  })
})
