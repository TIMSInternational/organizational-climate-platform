import { useEffect } from 'react'
import { useTranslation, type Locale } from '../../i18n'

/**
 * The interface language a survey's OWN language decides, or `null` when it decides none.
 *
 * A survey written in one language (`es` or `en`) is answered in that language: its buttons,
 * its start page and its thank-you are in it too. A bilingual survey (`both`) decides nothing --
 * the visitor's browser, or their own choice, does, as before.
 */
export function singleLanguageOf(language: string | null | undefined): Locale | null {
  return language === 'es' || language === 'en' ? language : null
}

/**
 * A single-language survey sets the respondent interface to its language (audit
 * 2026-11-19, gap #9: the PROCOMER link, opened by a browser set to English, said «Start
 * answering» over a Spanish-only survey -- the landing card read the browser's language from
 * `detectLocale` and nothing about the survey).
 *
 * Built on `adoptContentLocale`, so the two rules that protect the visitor still hold:
 *
 * - **An explicit choice wins.** A visitor who used the picker has a stored choice, and
 *   adopting is then a no-op. Their choice persists exactly as it did.
 * - **Nothing is persisted.** The survey's language is a fact about this survey, not the
 *   visitor's preference; the next page they open starts from their own language again.
 *
 * Called by the respondent's landings -- `/s/:token` (`usePublicEntryModel`) and
 * `/survey-invitations/:token` -- which draw the survey before the form mounts. The form itself
 * already follows the payload's `resolvedLocale`, which for a single-language survey IS its
 * language, so the start page, the questions and the thank-you agree. Because the payload is
 * re-read in the adopted locale, its `resolvedLocale` then equals the interface locale, which is
 * the condition `effectiveText` needs to show the client's own words.
 *
 * Never call it on an administrator's screen: there the reader's language is the reader's.
 */
export function useSurveyInterfaceLocale(language: string | null | undefined): void {
  const { locale, adoptContentLocale } = useTranslation()
  const target = singleLanguageOf(language)

  useEffect(() => {
    if (target === null || target === locale) return
    adoptContentLocale(target)
  }, [target, locale, adoptContentLocale])
}
