import { useTranslation } from '../../../i18n'
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui'
import { languageLabel } from '../surveyVocabulary'

interface ContentFallbackNoticeProps {
  /** The survey's own content language: 'en' | 'es' | 'both'. */
  language: string
  /** The locale the payload is **actually written in**, per the server. */
  resolvedLocale: string
  /** Field paths that reached for the other language, e.g. `questions[0].text`. */
  fallbackFields: readonly string[]
}

/**
 * Says out loud that the content on screen is not in the language the reader asked
 * for.
 *
 * ## Why this component exists at all
 *
 * `resolvedLocale` and `fallbackFields` are shipped on every read specifically so a
 * client can tell the reader. A page that fetches them and renders neither has
 * reintroduced exactly the silent substitution the paired `_en`/`_es` columns were
 * added to prevent (#195) — the reader sees English prose under a Spanish UI with no
 * indication that anything was substituted, and no way to know the Spanish version is
 * simply missing rather than identical.
 *
 * ## The comparison that matters
 *
 * The notice keys off `resolvedLocale !== uiLocale`, **not** off `fallbackFields`
 * being non-empty, and the two are genuinely different conditions:
 *
 * - A Spanish-only survey read with `?lang=en` comes back with
 *   `resolvedLocale: 'es'` and every text field listed in `fallbackFields`. Both
 *   signals fire.
 * - A survey authored in `both` whose *title* exists in Spanish but whose third
 *   question was never translated comes back `resolvedLocale: 'es'` for a Spanish
 *   reader — correct, nothing substituted at the top level — with
 *   `questions[2].text` in `fallbackFields`. Only the second signal fires, and it is
 *   the per-field detail rather than a page-level warning.
 *
 * So both are rendered, and they say different things: a banner when the payload as a
 * whole is in another language, and a count of the individual fields that fell back.
 * Rendering only the banner would hide partial gaps in a bilingual survey; rendering
 * only the count would leave a wholly-substituted survey unexplained.
 *
 * `variant="info"` rather than `warning`: nothing is broken and the admin has done
 * nothing wrong. It is `role="status"` (the `Alert` default) rather than `alert` for
 * the same reason.
 */
export default function ContentFallbackNotice({
  language,
  resolvedLocale,
  fallbackFields,
}: ContentFallbackNoticeProps) {
  const { t, locale } = useTranslation()

  const substituted = resolvedLocale !== locale
  if (!substituted && fallbackFields.length === 0) {
    return null
  }

  return (
    <Alert variant="info" className="mb-panel-gap">
      <AlertTitle>{t('surveys.contentLanguageNotice')}</AlertTitle>
      <AlertDescription>
        <span className="grid gap-1">
          {substituted && (
            <span>
              {t('surveys.showingContentIn', {
                resolved: languageLabel(t, resolvedLocale),
                requested: languageLabel(t, locale),
              })}
            </span>
          )}
          <span>{t('surveys.authoredIn', { language: languageLabel(t, language) })}</span>
          {fallbackFields.length > 0 && (
            <span>{t('surveys.fieldsFellBack', { count: fallbackFields.length })}</span>
          )}
        </span>
      </AlertDescription>
    </Alert>
  )
}
