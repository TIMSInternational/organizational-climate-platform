import { useTranslation } from '../../../../i18n'
import type { SharedReportNotes as Notes } from '../../api/sharedReports'
import { noteParagraphs } from '../../api/reportNotes'
import { ReportCard } from './parts'

/**
 * «Notas de TIMS» on the shared report page: the introduction before the readings
 * (`part="opening"`), conclusions and recommendations after them (`part="closing"`) -- the
 * order the PDF prints them in. Each note is in the report's language, which may differ from
 * the reader's chrome, so the text carries its own `lang`.
 */
export default function SharedReportNotes({ notes, part }: { notes: Notes | null; part: 'opening' | 'closing' }) {
  const { t } = useTranslation()
  if (notes === null) return null

  const cards =
    part === 'opening'
      ? [{ key: 'intro', text: notes.introduction }]
      : [
          { key: 'conclusions', text: notes.conclusions },
          { key: 'recommendations', text: notes.recommendations },
        ]

  return (
    <>
      {cards.map(({ key, text }) => {
        const paragraphs = noteParagraphs(text)
        if (paragraphs.length === 0) return null
        return (
          <ReportCard key={key} id={`shared-report-notes-${key}`} heading={t(`reports.notes.${key}`)}>
            <div lang={notes.locale || undefined} className="flex max-w-prose flex-col gap-3" data-slot="report-note">
              {paragraphs.map((paragraph, index) => (
                <p key={index} className="m-0 text-base text-fg-primary">
                  {paragraph}
                </p>
              ))}
            </div>
          </ReportCard>
        )
      })}
    </>
  )
}
