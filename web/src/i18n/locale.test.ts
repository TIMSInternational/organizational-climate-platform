import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LOCALE_STORAGE_KEY, detectLocale, isLocale, persistLocale } from './locale'

describe('locale detection', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('recognises supported locales only', () => {
    expect(isLocale('en')).toBe(true)
    expect(isLocale('es')).toBe(true)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale('')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    expect(isLocale(null)).toBe(false)
  })

  it('prefers an explicitly stored choice over the browser', () => {
    vi.stubGlobal('navigator', { languages: ['es-CR'], language: 'es-CR' })
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    expect(detectLocale()).toBe('en')
  })

  it('reads the legacy storage key so a stored preference carries over', () => {
    expect(LOCALE_STORAGE_KEY).toBe('preferredLocale')
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    expect(detectLocale()).toBe('es')
  })

  it('ignores a stored value that is not a supported locale', () => {
    vi.stubGlobal('navigator', { languages: ['en-US'], language: 'en-US' })
    localStorage.setItem(LOCALE_STORAGE_KEY, 'pt')
    expect(detectLocale()).toBe('en')
  })

  it('falls back to the browser preference, matching on the base tag', () => {
    // Procomer is Costa Rican, so es-CR must resolve to es.
    vi.stubGlobal('navigator', { languages: ['es-CR'], language: 'es-CR' })
    expect(detectLocale()).toBe('es')
  })

  it('walks the browser language list to find a supported locale', () => {
    vi.stubGlobal('navigator', { languages: ['fr-FR', 'de', 'es-MX'], language: 'fr-FR' })
    expect(detectLocale()).toBe('es')
  })

  it('falls back to English when the browser asks for nothing supported', () => {
    vi.stubGlobal('navigator', { languages: ['fr-FR', 'de'], language: 'fr-FR' })
    expect(detectLocale()).toBe('en')
  })

  it('survives storage that throws', () => {
    vi.stubGlobal('navigator', { languages: ['es'], language: 'es' })
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    // Private browsing must degrade to detection, not crash the app.
    expect(detectLocale()).toBe('es')
    expect(() => persistLocale('en')).not.toThrow()
  })

  it('persists a choice under the legacy key', () => {
    persistLocale('es')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es')
  })
})
