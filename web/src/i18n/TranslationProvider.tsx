import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createTranslator } from './translate'
import type { Locale } from './translate'
import { CATALOGUES, FALLBACK_LOCALE, detectLocale, persistLocale } from './locale'
import { TranslationContext } from './context'
import type { TranslationContextValue } from './context'

export default function TranslationProvider({
  children,
  initialLocale,
}: {
  children: ReactNode
  /** Overrides detection. For tests, and for rendering a known locale. */
  initialLocale?: Locale
}) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? detectLocale())

  const setLocale = useCallback((next: Locale) => {
    persistLocale(next)
    // A state update, not a reload: switching locale re-renders the tree with the
    // other catalogue and nothing else changes.
    setLocaleState(next)
  }, [])

  // Keep `<html lang>` truthful — screen readers and browser translation prompts
  // both key off it.
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const value = useMemo<TranslationContextValue>(
    () => ({
      locale,
      t: createTranslator(CATALOGUES[locale], CATALOGUES[FALLBACK_LOCALE]),
      setLocale,
    }),
    [locale, setLocale],
  )

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>
}
