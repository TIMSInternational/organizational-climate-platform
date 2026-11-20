import { useTranslation, type Locale } from '../../../../i18n'
import { Chip, type ChipTone } from '../../../../components/ui'
import { SUMMARISED_TEXTS, textSourceOf, type RespondentContentView, type TextSource } from '../../api/respondentContentSources'

const TONE: Record<TextSource, ChipTone> = { survey: 'accent', company: 'good', default: 'neutral' }

/**
 * «Textos y correo», as a list: each text a respondent or a recipient reads, and which level
 * speaks it -- «De esta encuesta», «De la empresa» or «Predeterminado» -- per language the
 * survey is written in. Says where a text comes from, never the text, so it can stand beside the
 * editor that holds the words.
 *
 * `view` is a survey's view (all three sources possible) or, before the survey exists, its
 * company's (only the company's or the default).
 */
export function TextsAndEmailSources({ view, locales }: { view: RespondentContentView; locales: readonly Locale[] }) {
  const { t } = useTranslation()
  const copy = (key: string) => t(`surveys.next.builder.texts.${key}`)
  const groups = [
    { id: 'screens', title: copy('groupScreens'), rows: SUMMARISED_TEXTS.screens },
    { id: 'emails', title: copy('groupEmails'), rows: SUMMARISED_TEXTS.emails },
  ] as const

  return (
    <div className="flex flex-col gap-3" data-testid="texts-sources">
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-1.5">
          <h3 className="m-0 text-sm font-medium text-fg-primary">{group.title}</h3>
          <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 text-sm">
            {group.rows.map((row) => (
              <div key={row.key} className="contents" data-testid={`texts-source-${row.key}`}>
                <dt className="min-w-0 text-fg-secondary">{copy(`label.${row.labelKey}`)}</dt>
                <dd className="m-0 flex flex-wrap justify-end gap-1.5">
                  {locales.map((locale) => {
                    const source = textSourceOf(view, row.key, locale)
                    const word = copy(`source.${source}`)
                    return (
                      <Chip
                        key={locale}
                        tone={TONE[source]}
                        data-source={source}
                        label={locales.length > 1 ? `${locale.toUpperCase()} · ${word}` : word}
                      />
                    )
                  })}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}
