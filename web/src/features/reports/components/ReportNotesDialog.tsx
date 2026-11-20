import { useEffect, useState } from 'react'
import { useTranslation } from '../../../i18n'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui'
import { describeApiError } from '../../../api/describeApiError'
import { getReport } from '../api/reports'
import {
  EMPTY_REPORT_NOTES,
  firstNoteTooLong,
  notesFromWire,
  setReportNotes,
  type ReportNotes,
} from '../api/reportNotes'
import ReportNotesFields from './ReportNotesFields'

interface ReportNotesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  baseUrl: string
  report: { id: string; title: string }
}

/**
 * Edit a report's «Notas de TIMS» (`PUT /admin/reports/{id}/notes`).
 *
 * The list carries no notes, so the dialog reads the report first and edits what the server
 * holds. Saving replaces all six fields; the PDF prints them at the next download, so nothing
 * is regenerated.
 */
export default function ReportNotesDialog({ open, onOpenChange, baseUrl, report }: ReportNotesDialogProps) {
  const { t, locale } = useTranslation()
  const [notes, setNotes] = useState<ReportNotes>(EMPTY_REPORT_NOTES)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getReport(baseUrl, report.id, locale)
      .then((detail) => {
        if (!cancelled) setNotes(notesFromWire(detail.notes))
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeApiError(err, t))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, report.id, locale, t])

  async function handleSave() {
    if (firstNoteTooLong(notes) !== null) {
      setError(t('errors.api.codes.report_notes_too_long'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await setReportNotes(baseUrl, report.id, notes, locale)
      onOpenChange(false)
    } catch (err) {
      setError(describeApiError(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('reports.notes.title')}</DialogTitle>
          <DialogDescription>{t('reports.notes.description', { title: report.title })}</DialogDescription>
        </DialogHeader>

        {error && <p role="alert">{error}</p>}

        <ReportNotesFields idPrefix="report-notes-edit" value={notes} onChange={setNotes} disabled={loading || busy} />

        <DialogFooter>
          <Button type="button" disabled={loading || busy} onClick={() => void handleSave()}>
            {busy ? t('common.saving') : t('reports.notes.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
