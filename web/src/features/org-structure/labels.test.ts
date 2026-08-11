import { describe, it, expect } from 'vitest'
import {
  ROLES,
  invitationStatusLabelKey,
  invitationTypeLabelKey,
  roleLabelKey,
} from './labels'
import en from '../../i18n/en.json'
import es from '../../i18n/es.json'

/** Resolves an `a.b.c` path against a catalogue, or `undefined`. */
function lookup(catalogue: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, segment) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      catalogue,
    )
}

describe('org-structure wire-token labels', () => {
  it('covers exactly the five backend roles', () => {
    // Roles.All in src/ClimateProject.Application/Auth/Roles.cs. Five, not the
    // six of the legacy UserRole enum -- there is no department_admin.
    expect([...ROLES].sort()).toEqual(
      ['company_admin', 'employee', 'leader', 'super_admin', 'supervisor'].sort(),
    )
  })

  it('maps every role to a key that resolves in BOTH catalogues', () => {
    // A key that exists in en and not in es is the exact defect the catalogue
    // parity guard exists for, arrived at from the caller's side: this fails if
    // the mapping points anywhere the catalogues do not go.
    for (const role of ROLES) {
      const key = roleLabelKey(role)
      expect(key, `no key for ${role}`).toBeTruthy()
      expect(typeof lookup(en, key!), `${key} missing from en`).toBe('string')
      expect(typeof lookup(es, key!), `${key} missing from es`).toBe('string')
    }
  })

  it('maps the three invitation statuses and the three invitation types', () => {
    // InvitationValidation.Status* / Type* in
    // src/ClimateProject.Application/OrgStructure/InvitationValidation.cs.
    for (const status of ['pending', 'sent', 'accepted']) {
      const key = invitationStatusLabelKey(status)
      expect(key, `no key for ${status}`).toBeTruthy()
      expect(typeof lookup(en, key!)).toBe('string')
      expect(typeof lookup(es, key!)).toBe('string')
    }
    for (const type of ['employee_direct', 'company_admin_setup', 'employee_self_signup']) {
      const key = invitationTypeLabelKey(type)
      expect(key, `no key for ${type}`).toBeTruthy()
      expect(typeof lookup(en, key!)).toBe('string')
      expect(typeof lookup(es, key!)).toBe('string')
    }
  })

  it('returns null for a token it has never heard of, rather than inventing prose', () => {
    // The caller prints the server's own word in that case. Returning a made-up
    // English string here would put untranslatable English on a Spanish page.
    expect(roleLabelKey('department_admin')).toBeNull()
    expect(invitationStatusLabelKey('expired')).toBeNull()
    expect(invitationTypeLabelKey('shareable_link')).toBeNull()
  })

  it('does not resolve keys by prototype lookup', () => {
    // A bare object literal inherits `toString`, `constructor` and friends, so
    // `ROLE_KEYS['toString']` is truthy unless the lookup guards for it. That
    // would return a function where a key is expected.
    expect(roleLabelKey('toString')).toBeNull()
    expect(roleLabelKey('constructor')).toBeNull()
  })
})
