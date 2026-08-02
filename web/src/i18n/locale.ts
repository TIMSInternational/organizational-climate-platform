import type { Locale, Messages } from './translate'
import en from './en.json'
import es from './es.json'

/**
 * Catalogues are imported statically, not `await import()`ed per locale as the
 * legacy `TranslationContext` did. Both together are ~80 KB of JSON, and the async
 * version had to render `null` until the first catalogue arrived — a blank screen
 * on every cold load. Static import removes that state entirely.
 */
export const CATALOGUES: Record<Locale, Messages> = {
  en: en as Messages,
  es: es as Messages,
}

export const LOCALES: readonly Locale[] = ['en', 'es']

/** The fallback catalogue for keys missing from the active locale. */
export const FALLBACK_LOCALE: Locale = 'en'

/** Unchanged from the legacy app, so a user's stored choice carries over. */
export const LOCALE_STORAGE_KEY = 'preferredLocale'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * The locale to start in: an explicit stored choice wins, otherwise the browser's
 * preference, otherwise English.
 *
 * The legacy app defaulted flatly to `en`, which is the wrong default for a
 * Spanish-facing Procomer deployment — but honouring the browser rather than
 * hardcoding `es` keeps English users working too.
 */
export function detectLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isLocale(stored)) return stored
  } catch {
    // Storage throws outright in private-browsing / blocked-cookie modes.
  }

  const languages = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])
  for (const language of languages) {
    const tag = language?.split('-')[0]
    if (isLocale(tag)) return tag
  }

  return FALLBACK_LOCALE
}

export function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Not being able to remember the choice is no reason not to apply it.
  }
}
