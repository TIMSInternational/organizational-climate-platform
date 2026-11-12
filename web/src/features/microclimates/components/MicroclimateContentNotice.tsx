import { Info } from 'lucide-react'
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
 * ## One sentence, on the neutral card
 *
 * Drawn as the survey respond page draws its own language notice: the neutral `warning`
 * card (the gray fill, an info glyph) under "No todo está disponible en su idioma", not
 * the blue `info` box — blue is action, selection and live, never information. It says
 * one thing once. When the payload as a whole was served in another language, the
 * sentence names that language; when only some fields reached for the other language,
 * it says so. The first case already covers every field, so the field count is not
 * repeated beneath it.
 *
 * Both signals are still read, because either alone hides a real case: a Spanish-only
 * session read with `?lang=en` is substituted as a whole, and a bilingual session whose
 * third question was never translated fires only `fallbackFields`.
 */
export default function MicroclimateContentNotice({
  resolvedLocale,
  fallbackFields,
}: MicroclimateContentNoticeProps) {
  const { t, locale } = useTranslation()

  const substituted = resolvedLocale !== locale
  if (!substituted && fallbackFields.length === 0) {
    return null
  }

  // Mid-sentence a Spanish language name is lower case ("en inglés"); English keeps it.
  const resolved = languageLabel(t, resolvedLocale)
  const named = locale === 'es' ? resolved.toLocaleLowerCase('es') : resolved

  return (
    <Alert variant="warning" className="mb-panel-gap">
      <Info aria-hidden="true" />
      <AlertTitle>{t('microclimates.contentFallbackTitle')}</AlertTitle>
      <AlertDescription>
        {substituted
          ? t('microclimates.contentFallbackBody', { language: named })
          : t('microclimates.contentFallbackFields')}
      </AlertDescription>
    </Alert>
  )
}
