import { useTranslation } from '../../../i18n'
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui'
import { languageLabel } from '../microclimateVocabulary'

interface MicroclimateContentNoticeProps {
  /** The microclimate's own content language: 'en' | 'es' | 'both'. */
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
 * The microclimate twin of `surveys/ContentFallbackNotice`, which carries the full
 * argument. In short: `resolvedLocale` and `fallbackFields` are shipped on every read
 * *so that* a client can tell the reader, and a page that fetches them and renders
 * neither has reintroduced the silent substitution the paired `_en`/`_es` columns
 * exist to prevent (#195).
 *
 * ## Why this is not the surveys component with a different prop
 *
 * Its copy is survey copy — `surveys.authoredIn` is literally "This survey is
 * authored in {language}". Rendering that above a microclimate would be wrong in
 * English and wrong in a second way in Spanish, where *encuesta* is feminine and
 * *microclima* is not. Sharing the component would have meant either an untranslated
 * noun or a `subject` prop threading a word through two catalogues; the keys are
 * cheaper and the Spanish is correct.
 *
 * Both signals are rendered because they say different things. A Spanish-only session
 * read with `?lang=en` fires the banner *and* lists every field; a bilingual session
 * whose third question was never translated fires only the per-field count. Keying
 * off one would hide the other.
 */
export default function MicroclimateContentNotice({
  language,
  resolvedLocale,
  fallbackFields,
}: MicroclimateContentNoticeProps) {
  const { t, locale } = useTranslation()

  const substituted = resolvedLocale !== locale
  if (!substituted && fallbackFields.length === 0) {
    return null
  }

  return (
    <Alert variant="info" className="mb-panel-gap">
      <AlertTitle>{t('microclimates.contentLanguageNotice')}</AlertTitle>
      <AlertDescription>
        <span className="grid gap-1">
          {substituted && (
            <span>
              {t('microclimates.showingContentIn', {
                resolved: languageLabel(t, resolvedLocale),
                requested: languageLabel(t, locale),
              })}
            </span>
          )}
          <span>{t('microclimates.authoredIn', { language: languageLabel(t, language) })}</span>
          {fallbackFields.length > 0 && (
            <span>{t('microclimates.fieldsFellBack', { count: fallbackFields.length })}</span>
          )}
        </span>
      </AlertDescription>
    </Alert>
  )
}
