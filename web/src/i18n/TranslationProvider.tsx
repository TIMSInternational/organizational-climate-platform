import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createTranslator } from './translate'
import type { Locale } from './translate'
import { CATALOGUES, FALLBACK_LOCALE, detectLocale, persistLocale, storedLocale } from './locale'
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

  /**
   * Adopt the locale the CONTENT came back in.
   *
   * The respond flow asks the server for a survey in the reader's current locale and is
   * told, in `resolvedLocale`, which language the payload actually came back in. For a
   * survey authored only in Spanish that is Spanish however the device is configured — so
   * a respondent on an English laptop was reading Spanish questions inside English chrome,
   * because `detectLocale()` consults the browser and never the survey.
   *
   * Two properties, both deliberate:
   *
   * - **It does not persist.** The language a survey is written in is a fact about that
   *   survey, not a preference of whoever opened it. Writing it to `localStorage` would
   *   silently re-language the entire app for every later visit — including, for an
   *   employee who also administers, their admin screens.
   * - **An explicit choice wins.** If the reader has ever used `LanguageSwitcher` their
   *   choice is stored, and this is then a no-op. `RespondShell` carries that picker
   *   precisely so somebody on a mis-configured or shared machine can fix the language,
   *   and that is the one page where being unable to means being unable to answer at all;
   *   re-asserting the content language over it would make the control inert. When the
   *   two still disagree, `ContentLanguageNotice` on the form is what says so.
   */
  const adoptContentLocale = useCallback((next: Locale) => {
    if (storedLocale() !== null) return
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
      adoptContentLocale,
    }),
    [locale, setLocale, adoptContentLocale],
  )

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>
}
