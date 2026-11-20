import { useTranslation } from '../../../../i18n'
import { RadioField, TextareaField, TextField } from '../../../../components/ui'
import type {
  RespondentContentByLocale,
  RespondentContentEntry,
  RespondentContentView,
  RespondentTextLocale,
} from '../../api/respondentContent'
import {
  fieldLabelKey,
  groupLabelKey,
  inheritedText,
  screenGroups,
  textAlignEntry,
  unknownPlaceholder,
} from '../../respondentContentEditor'

const K = 'surveys.next.respondentContent'

/** A box longer than one sentence is drawn as a textarea. */
const PARAGRAPH_FROM = 300

/** Where a refused save pointed: the box is marked with the server's reason. */
export interface RefusedField {
  key: string
  locale: string | null
  message: string
}

/**
 * Every screen text of the registry for ONE locale, screen by screen — the body both editors
 * share: the company's («Textos para quien responde» in company settings) and the survey's
 * (`RespondentTextsDialog`). Ruled 2026-11-19, `docs/decisions/editable-respondent-content.md`.
 *
 * Each box shows what an empty box stands for as its placeholder: the product default at the
 * company level, and at the survey level the company's text when it wrote one («De la empresa:
 * …») or the default («Predeterminado: …»), said under the box as well, because a placeholder
 * disappears the moment somebody types. Under it too: the box's limit, the placeholders its
 * default uses (the only ones the server accepts), and, for the four texts that are publish-gate
 * fields at the survey level, that they must be written in every language of the survey.
 */
export function RespondentContentFields({
  view,
  locale,
  draft,
  disabled,
  refused,
  onChange,
}: {
  view: RespondentContentView
  locale: RespondentTextLocale
  draft: RespondentContentByLocale
  disabled: boolean
  refused: RefusedField | null
  onChange: (locale: RespondentTextLocale, key: string, value: string) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-panel-gap" data-slot="respondent-content-fields" data-locale={locale}>
      {screenGroups(view.entries).map(({ group, entries }) => (
        <section key={group} className="flex flex-col gap-3" data-group={group}>
          <h3 className="m-0 border-b border-line-light pb-1.5 font-sans text-lg font-semibold text-fg-primary">
            {t(groupLabelKey(group))}
          </h3>
          {entries.map((entry) => (
            <ContentField
              key={entry.key}
              view={view}
              entry={entry}
              locale={locale}
              value={draft[locale]?.[entry.key] ?? ''}
              disabled={disabled}
              refused={refused !== null && refused.key === entry.key && (refused.locale === null || refused.locale === locale) ? refused.message : null}
              onChange={(value) => onChange(locale, entry.key, value)}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

function ContentField({
  view,
  entry,
  locale,
  value,
  disabled,
  refused,
  onChange,
}: {
  view: RespondentContentView
  entry: RespondentContentEntry
  locale: RespondentTextLocale
  value: string
  disabled: boolean
  refused: string | null
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const inherited = inheritedText(view, locale, entry.key)

  const notes: string[] = []
  if (view.level === 'survey') {
    notes.push(t(inherited.from === 'company' ? `${K}.fromCompany` : `${K}.fromDefault`, { text: inherited.text }))
  }
  notes.push(t(`${K}.limit`, { max: entry.maxLength }))
  if (entry.placeholders.length > 0) {
    notes.push(t(`${K}.placeholders`, { list: entry.placeholders.map((name) => `{${name}}`).join(', ') }))
  }
  if (view.level === 'survey' && entry.requiresEveryLocale === true) notes.push(t(`${K}.everyLocale`))

  const unknown = unknownPlaceholder(entry, value)
  const error =
    unknown !== null
      ? t(entry.placeholders.length > 0 ? `${K}.unknownPlaceholder` : `${K}.noPlaceholders`, { placeholder: unknown })
      : (refused ?? undefined)

  const common = {
    label: t(fieldLabelKey(entry.key)),
    description: notes.join(' '),
    placeholder: inherited.text,
    value,
    maxLength: entry.maxLength,
    disabled,
    error,
    onChange,
    className: 'max-w-none',
  }

  return entry.maxLength > PARAGRAPH_FROM ? (
    <TextareaField {...common} rows={entry.maxLength >= 1000 ? 4 : 3} />
  ) : (
    <TextField {...common} />
  )
}

/** The radio's value for "no choice at this level". */
const INHERIT = 'inherit'

/**
 * `display.textAlign` — justified (the product default, PROCOMER 2026-11-19) or left — for every
 * respondent paragraph and question. Locale-independent (`*`). «Como la empresa» / «Predeterminado»
 * is the empty value: this level makes no choice and the one above it decides.
 */
export function TextAlignField({
  view,
  draft,
  disabled,
  onChange,
}: {
  view: RespondentContentView
  draft: RespondentContentByLocale
  disabled: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const entry = textAlignEntry(view.entries)
  if (entry === null) return null

  const name = (value: string) => t(value === 'start' ? `${K}.alignStart` : `${K}.alignJustify`)
  const company = view.level === 'survey' ? view.companyValues['*']?.[entry.key] : undefined
  const fallback = company && entry.values.includes(company) ? company : (entry.defaultValue ?? 'justify')
  const inheritLabel =
    view.level === 'survey' && company
      ? t(`${K}.alignInherit`, { value: name(fallback) })
      : t(`${K}.alignInheritDefault`, { value: name(fallback) })

  const current = draft['*']?.[entry.key] ?? ''
  return (
    <RadioField
      label={t(`${K}.alignLabel`)}
      description={t(`${K}.alignHelp`)}
      value={entry.values.includes(current) ? current : INHERIT}
      disabled={disabled}
      options={[
        { value: INHERIT, label: inheritLabel },
        ...entry.values.map((value) => ({ value, label: name(value) })),
      ]}
      onChange={(value) => onChange(value === INHERIT ? '' : value)}
    />
  )
}
