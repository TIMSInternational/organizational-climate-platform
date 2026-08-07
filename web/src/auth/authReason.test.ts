import { describe, it, expect } from 'vitest'
import { AUTH_ERROR_REASONS, authErrorCopy, pageWorthyReason, toAuthErrorReason } from './authReason'
import { CATALOGUES, createTranslator } from '../i18n'

describe('toAuthErrorReason', () => {
  it.each(AUTH_ERROR_REASONS)('passes %s through', (reason) => {
    expect(toAuthErrorReason(reason)).toBe(reason)
  })

  it('falls back to unknown for anything else', () => {
    // The value arrives from a query string, so it is whatever anyone typed.
    // Narrowing here is what stops the page rendering a key path it was handed.
    expect(toAuthErrorReason('constructor')).toBe('unknown')
    expect(toAuthErrorReason('auth.password')).toBe('unknown')
    expect(toAuthErrorReason('')).toBe('unknown')
    expect(toAuthErrorReason(null)).toBe('unknown')
    expect(toAuthErrorReason(undefined)).toBe('unknown')
  })
})

describe('authErrorCopy', () => {
  it.each(AUTH_ERROR_REASONS)('resolves both keys for %s in every locale', (reason) => {
    const copy = authErrorCopy(reason)
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      const t = createTranslator(catalogue)
      for (const key of [copy.titleKey, copy.descriptionKey]) {
        // The translator returns the key itself on a miss, so an equal value
        // means the catalogue is missing it rather than that it matched.
        expect(t(key), `${key} is unresolved in ${locale}`).not.toBe(key)
        expect(t(key).trim(), `${key} is blank in ${locale}`).not.toBe('')
      }
    }
  })

  it('really is translated, not an English copy in both files', () => {
    const en = createTranslator(CATALOGUES.en)
    const es = createTranslator(CATALOGUES.es)
    expect(es('auth.maintenanceTitle')).not.toBe(en('auth.maintenanceTitle'))
    expect(es('auth.accountInactiveTitle')).not.toBe(en('auth.accountInactiveTitle'))
  })
})

describe('pageWorthyReason', () => {
  it('sends the two platform kill switches to a whole page', () => {
    // CheckSystemSettingsGateAsync is the only producer of either, and neither is
    // about the credentials that were typed.
    expect(pageWorthyReason(503)).toBe('maintenance')
    expect(pageWorthyReason(403)).toBe('login-disabled')
  })

  it('keeps everything about this attempt on the form', () => {
    // 401 wrong password, 409 email taken, 400 validation, 404 no company for the
    // domain -- all of them have a field the user can act on, and a full-page
    // error would throw away what they typed.
    for (const status of [400, 401, 404, 409, 500, 0]) {
      expect(pageWorthyReason(status)).toBeNull()
    }
  })
})
