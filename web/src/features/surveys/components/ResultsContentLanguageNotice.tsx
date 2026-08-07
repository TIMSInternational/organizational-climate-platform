import { useTranslation } from '../../../i18n'
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui'

interface ResultsContentLanguageNoticeProps {
  /** The survey's own authored content language: `'en' | 'es' | 'both'`. */
  language: string
  /** The locale the payload is **actually written in**, per the server. */
  resolvedLocale: string
  /** Field paths that reached for the other language, e.g. `questions[0].text`. */
  fallbackFields: readonly string[]
}

/**
 * Says out loud that the question text and option labels on this page are not in the
 * language the reader asked for.
 *
 * ## Why a results page needs this at all
 *
 * `resolvedLocale` and `fallbackFields` ship on every survey read precisely so a client
 * can tell the reader (#195). A page that fetches them and renders neither has
 * reintroduced the silent substitution the paired `_en`/`_es` columns were added to
 * prevent. On a *results* page the cost is higher than elsewhere: the reader is about
 * to quote these numbers, and a question they cannot read in their own language is a
 * question they may summarise wrongly.
 *
 * ## Two different conditions, deliberately
 *
 * The banner keys off `resolvedLocale !== locale`, **not** off `fallbackFields` being
 * non-empty:
 *
 * - A Spanish-only survey read with `?lang=en` comes back `resolvedLocale: 'es'` with
 *   every text field listed. Both signals fire.
 * - A survey authored in `both` whose title exists in Spanish but whose third question
 *   was never translated comes back `resolvedLocale: 'es'` for a Spanish reader —
 *   correct, nothing substituted at the top level — with `questions[2].text` listed.
 *   Only the second fires, and it is per-field detail rather than a page-level warning.
 *
 * So both render and they say different things. Only the banner would hide partial gaps
 * in a bilingual survey; only the count would leave a wholly-substituted one unexplained.
 *
 * `variant="info"`, and `Alert`'s default `role="status"`: nothing is broken and the
 * admin has done nothing wrong.
 *
 * **Note for the merge.** #109 introduces an equivalent `ContentFallbackNotice` for the
 * survey list and detail pages. The two should be collapsed into one component once both
 * have landed; they are separate here only because the branches are parallel and a
 * shared file added on both sides is the conflict neither lane can resolve alone.
 */
export default function ResultsContentLanguageNotice({
  language,
  resolvedLocale,
  fallbackFields,
}: ResultsContentLanguageNoticeProps) {
  const { t, locale } = useTranslation()

  const substituted = resolvedLocale !== locale
  if (!substituted && fallbackFields.length === 0) {
    return null
  }

  return (
    <Alert variant="info" className="mb-panel-gap">
      <AlertTitle>{t('surveyResults.languageNoticeTitle')}</AlertTitle>
      <AlertDescription>
        <span className="grid gap-1">
          {substituted && (
            <span>
              {t('surveyResults.showingContentIn', {
                resolved: languageName(t, resolvedLocale),
                requested: languageName(t, locale),
              })}
            </span>
          )}
          <span>{t('surveyResults.authoredIn', { language: languageName(t, language) })}</span>
          {fallbackFields.length > 0 && (
            <span>{t('surveyResults.fieldsFellBack', { count: fallbackFields.length })}</span>
          )}
        </span>
      </AlertDescription>
    </Alert>
  )
}

/**
 * `'en' | 'es' | 'both'` as a name a reader recognises.
 *
 * Falls back to the server's own value rather than to a key path: `Survey.Language` is
 * validated against `ContentLanguages`, but an imported row could still carry something
 * this list has not heard of, and printing `surveyResults.languageXx` at a user is worse
 * than printing the code.
 */
function languageName(t: ReturnType<typeof useTranslation>['t'], value: string): string {
  const keys: Record<string, string> = {
    en: 'language.english',
    es: 'language.spanish',
    both: 'surveyResults.languageBoth',
  }
  const key = keys[value]
  return key ? t(key) : value
}
