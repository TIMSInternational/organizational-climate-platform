import { useState } from 'react'
import { useTranslation } from '../../../i18n'
import { Label, SegmentedControl, Textarea } from '../../../components/ui'
import {
  REPORT_NOTES_MAX_LENGTH,
  REPORT_NOTE_PARTS,
  noteField,
  type ReportNotes,
} from '../api/reportNotes'

interface ReportNotesFieldsProps {
  value: ReportNotes
  onChange: (next: ReportNotes) => void
  /** Prefix for the textarea ids, so the create form and the edit dialog never share one. */
  idPrefix: string
  disabled?: boolean
}

/**
 * «Notas de TIMS» — introduction, conclusions and recommendations, one language at a time.
 *
 * Each note is printed in the report's own language only (`ReportNotes.For`), so a note
 * written in Spanish is never shown to an English reader; the language switch says which of
 * the two is being edited. Plain text: a blank line starts a new paragraph.
 */
export default function ReportNotesFields({ value, onChange, idPrefix, disabled }: ReportNotesFieldsProps) {
  const { t, locale } = useTranslation()
  const [language, setLanguage] = useState<'es' | 'en'>(locale === 'en' ? 'en' : 'es')

  return (
    <div className="grid gap-inline" data-slot="report-notes-fields">
      <p className="m-0 text-xs text-fg-secondary">{t('reports.notes.help', { max: REPORT_NOTES_MAX_LENGTH })}</p>
      <SegmentedControl<'es' | 'en'>
        label={t('reports.notes.languageLabel')}
        value={language}
        disabled={disabled}
        onChange={setLanguage}
        options={[
          { value: 'es', label: t('reports.notes.languageEs') },
          { value: 'en', label: t('reports.notes.languageEn') },
        ]}
      />
      {REPORT_NOTE_PARTS.map((part) => {
        const field = noteField(part, language)
        const id = `${idPrefix}-${field}`
        const text = value[field]
        const over = text.trim().length > REPORT_NOTES_MAX_LENGTH
        return (
          <div key={field}>
            <Label htmlFor={id}>{t(`reports.notes.${part}`)}</Label>
            <Textarea
              id={id}
              lang={language}
              value={text}
              disabled={disabled}
              rows={4}
              aria-invalid={over || undefined}
              aria-describedby={`${id}-count`}
              onChange={(event) => onChange({ ...value, [field]: event.target.value })}
            />
            <p
              id={`${id}-count`}
              className={over ? 'm-0 mt-1 text-xs text-accent-red' : 'm-0 mt-1 text-xs text-fg-tertiary'}
            >
              {t('reports.notes.count', { count: text.trim().length, max: REPORT_NOTES_MAX_LENGTH })}
            </p>
          </div>
        )
      })}
    </div>
  )
}
