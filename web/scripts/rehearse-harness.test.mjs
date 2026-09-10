import { describe, it, expect } from 'vitest'
import { NAMES, READ_METHODS, allowRequest, matchesOnly, exitCode } from './rehearse-harness.mjs'

describe('a read-only rehearsal lets the browser read and nothing else', () => {
  it('passes GET, HEAD and OPTIONS whatever the case', () => {
    for (const method of ['GET', 'get', 'HEAD', 'OPTIONS']) expect(allowRequest(method), method).toBe(true)
    expect([...READ_METHODS]).toEqual(['GET', 'HEAD', 'OPTIONS'])
  })

  it('blocks the writes the pages make on their own: the invitation page\'s POST and the draft DELETE', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', undefined, '']) expect(allowRequest(method), String(method)).toBe(false)
  })

  it('lets everything through only for the step that opted in, and only with a literal true', () => {
    expect(allowRequest('POST', { allowWrites: true })).toBe(true)
    expect(allowRequest('DELETE', { allowWrites: true })).toBe(true)
    expect(allowRequest('POST', { allowWrites: 'yes' })).toBe(false)
    expect(allowRequest('POST', {})).toBe(false)
  })
})

/**
 * `rehearse.mjs` walks the demo runbook on a real stack and cannot run in CI. These pin the
 * three things it decides on its own: which steps a `--only` prefix selects, whether a
 * failed or empty run exits non-zero, and that the names it clicks by do not depend on the
 * capitalisation the button renders — the rehearsal's only two failures were its own
 * `Iniciar sesión` and `Vista previa` selectors against `Iniciar Sesión` and `Vista Previa`.
 */

describe('the accessible names match the button whatever case it renders in', () => {
  it('signs in through "Iniciar Sesión" as well as "Iniciar sesión"', () => {
    expect(NAMES.signIn.test('Iniciar Sesión')).toBe(true)
    expect(NAMES.signIn.test('Iniciar sesión')).toBe(true)
    expect(NAMES.signIn.test('INICIAR SESIÓN')).toBe(true)
    expect(NAMES.signIn.test('Registrarse')).toBe(false)
  })

  it('opens "Vista Previa" as well as "Vista previa"', () => {
    expect(NAMES.preview.test('Vista Previa')).toBe(true)
    expect(NAMES.preview.test('Vista previa')).toBe(true)
    expect(NAMES.preview.test('Editar')).toBe(false)
  })

  it('carries the i flag on every name, so the next title-cased button does not fail a rehearsal', () => {
    for (const [key, pattern] of Object.entries(NAMES)) {
      expect(pattern, key).toBeInstanceOf(RegExp)
      expect(pattern.flags, key).toContain('i')
    }
  })
})

describe('--only selects steps by a case-insensitive prefix', () => {
  it('selects everything when no prefix is given', () => {
    expect(matchesOnly('04 results Q3 and drill-in', undefined)).toBe(true)
    expect(matchesOnly('04 results Q3 and drill-in', '')).toBe(true)
    expect(matchesOnly('04 results Q3 and drill-in', '   ')).toBe(true)
  })

  it('matches the step number, the number and words, and ignores case and padding', () => {
    expect(matchesOnly('04 results Q3 and drill-in', '04')).toBe(true)
    expect(matchesOnly('04 results Q3 and drill-in', '04 RESULTS')).toBe(true)
    expect(matchesOnly('04 results Q3 and drill-in', ' 04 results q3 ')).toBe(true)
    expect(matchesOnly('10a employee dashboard', '10')).toBe(true)
  })

  it('is a prefix, not a substring, so "results" does not pick every step that mentions results', () => {
    expect(matchesOnly('04 results Q3 and drill-in', 'results')).toBe(false)
    expect(matchesOnly('14 microclimate live page', '04')).toBe(false)
    expect(matchesOnly('01 login', '010')).toBe(false)
  })
})

describe('the exit code is non-zero on any failure and when nothing ran', () => {
  it('is 0 only when every step that ran passed', () => {
    expect(exitCode([{ status: 'PASS' }, { status: 'PASS' }])).toBe(0)
  })

  it('is 1 when any step failed, wherever it sits', () => {
    expect(exitCode([{ status: 'PASS' }, { status: 'FAIL' }, { status: 'PASS' }])).toBe(1)
    expect(exitCode([{ status: 'FAIL' }])).toBe(1)
  })

  it('is 2 when --only matched nothing, so a typo cannot read as a green rehearsal', () => {
    expect(exitCode([])).toBe(2)
    expect(exitCode(undefined)).toBe(2)
  })
})
