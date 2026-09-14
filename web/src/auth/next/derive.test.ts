import { describe, it, expect } from 'vitest'
import { AUTH_ERROR_REASONS, toAuthErrorReason } from '../authReason'
import {
  authStateCopy,
  domainOf,
  loginOutcome,
  meetsPasswordPolicy,
  registerOutcome,
  DEFAULT_PASSWORD_POLICY,
  MAX_PASSWORD_LENGTH,
} from './derive'
import en from '../../i18n/en.json'
import es from '../../i18n/es.json'

/** Resolves a dotted catalogue path, or `undefined` — the same walk the translator does. */
function lookup(catalogue: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, segment) => {
    if (node === null || typeof node !== 'object') return undefined
    return (node as Record<string, unknown>)[segment]
  }, catalogue)
}

describe('authStateCopy', () => {
  it('answers every reason the narrowing function can produce, in both catalogues', () => {
    // The point of the table: a reason with no copy renders a key path on the page, and
    // `toAuthErrorReason` is what decides the set, so the set is read from there rather
    // than retyped here.
    for (const reason of AUTH_ERROR_REASONS) {
      const copy = authStateCopy(reason)
      for (const key of [copy.eyebrowKey, copy.titleKey, copy.bodyKey]) {
        expect(typeof lookup(en, key), `${reason} → ${key} (en)`).toBe('string')
        expect(typeof lookup(es, key), `${reason} → ${key} (es)`).toBe('string')
      }
    }
  })

  it('gives each reason its own sentence rather than one shared apology', () => {
    const titles = AUTH_ERROR_REASONS.map((reason) => authStateCopy(reason).titleKey)
    expect(new Set(titles).size).toBe(AUTH_ERROR_REASONS.length)
  })

  it('falls back to the unknown copy for a query parameter nobody issued', () => {
    // `/auth/error?reason=auth.password` is the shape that used to print a key path.
    expect(authStateCopy(toAuthErrorReason('auth.password'))).toEqual(authStateCopy('unknown'))
    expect(authStateCopy(toAuthErrorReason(null))).toEqual(authStateCopy('unknown'))
  })
})

describe('loginOutcome', () => {
  it('keeps a 401 on the form and refuses to repeat the server sentence', () => {
    // The server answers 401 identically for a wrong password and a deactivated account.
    // Echoing "Invalid email or password" would claim it had told them apart.
    const outcome = loginOutcome(401, 'Invalid email or password')
    expect(outcome.kind).toBe('form')
    expect(JSON.stringify(outcome)).not.toContain('Invalid email or password')
  })

  it('sends 503 to the maintenance page and 403 to the disabled page', () => {
    expect(loginOutcome(503, 'Volvemos a las 14:00.')).toEqual({ kind: 'page', reason: 'maintenance' })
    expect(loginOutcome(403, 'off')).toEqual({ kind: 'page', reason: 'login-disabled' })
  })

  it('keeps every other failure on the form in the server own words', () => {
    expect(loginOutcome(500, 'Boom')).toEqual({ kind: 'form-server', message: 'Boom' })
    // A network failure never reaches a status; the caller has already substituted a
    // translated sentence by then.
    expect(loginOutcome(0, 'translated fallback')).toEqual({ kind: 'form-server', message: 'translated fallback' })
  })
})

describe('registerOutcome', () => {
  it('reads a 404 as the invitation route rather than as a failure', () => {
    const outcome = registerOutcome(404, 'No company found for this email domain.')
    expect(outcome).toEqual({ kind: 'invitation' })
    // And the server's English sentence is dropped on purpose: the page prints the
    // catalogue's, with the domain named.
    expect(JSON.stringify(outcome)).not.toContain('No company found')
  })

  it('keeps 409 and 400 on the form, where the field that was refused is', () => {
    expect(registerOutcome(409, 'User with this email already exists')).toEqual({
      kind: 'form-server',
      message: 'User with this email already exists',
    })
    expect(registerOutcome(400, 'Password must contain a number')).toEqual({
      kind: 'form-server',
      message: 'Password must contain a number',
    })
  })

  it('routes the platform refusals exactly as sign-in does', () => {
    // Same `CheckSystemSettingsGateAsync` on both endpoints, so the same destination.
    expect(registerOutcome(503, '')).toEqual(loginOutcome(503, ''))
    expect(registerOutcome(403, '')).toEqual(loginOutcome(403, ''))
  })
})

describe('meetsPasswordPolicy', () => {
  it('mirrors the shipped default of SystemSettings.PasswordPolicy', () => {
    expect(DEFAULT_PASSWORD_POLICY).toEqual({
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
    })
    expect(meetsPasswordPolicy('Contrasena1')).toBe(true)
  })

  it('rejects each unmet rule on its own', () => {
    expect(meetsPasswordPolicy('Corta1')).toBe(false) // under 8
    expect(meetsPasswordPolicy('minusculas1')).toBe(false) // no uppercase
    expect(meetsPasswordPolicy('MAYUSCULAS1')).toBe(false) // no lowercase
    expect(meetsPasswordPolicy('SinNumeros')).toBe(false) // no digit
  })

  it('refuses a password bcrypt would silently truncate', () => {
    // Past 72 bytes bcrypt hashes a prefix, so two different passwords can match. The
    // server rejects rather than accept one; the form must not offer to send one.
    const long = `A1${'a'.repeat(MAX_PASSWORD_LENGTH)}`
    expect(long.length).toBeGreaterThan(MAX_PASSWORD_LENGTH)
    expect(meetsPasswordPolicy(long)).toBe(false)
    expect(meetsPasswordPolicy(`A1${'a'.repeat(MAX_PASSWORD_LENGTH - 2)}`)).toBe(true)
  })

  it('counts accented letters, which a Spanish-speaking user will type', () => {
    // `/\p{Lu}/u`, not `/[A-Z]/`: "Ñandú" has an uppercase letter and "ñandú" does not.
    expect(meetsPasswordPolicy('Ñandubay1')).toBe(true)
    expect(meetsPasswordPolicy('ñandubay1')).toBe(false)
  })
})

describe('domainOf', () => {
  it('returns what the server matches against Companies.EmailDomain', () => {
    expect(domainOf('ana.rojas@meridiano.test')).toBe('meridiano.test')
    // Case is not part of the identity of a domain, and the address on screen is the
    // reader's own typing.
    expect(domainOf('ANA@Meridiano.TEST')).toBe('meridiano.test')
  })

  it('names nothing when the address cannot decide an organisation', () => {
    expect(domainOf('')).toBeNull()
    expect(domainOf('ana')).toBeNull()
    expect(domainOf('ana@')).toBeNull()
    expect(domainOf('ana@ @')).toBeNull()
  })
})
