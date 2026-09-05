import { useEffect, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { calendarDay } from '../../../lib/calendarDay'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '../../../components/ui'
import {
  clearReportSchedule,
  setReportSchedule,
  REPORT_RECURRENCE_PATTERNS,
  type Report,
  type ReportListItem,
  type ReportRecurrencePattern,
} from '../api/reports'

/**
 * Set or stop a report's recurring schedule (#91).
 *
 * ## Why this panel exists at all
 *
 * `ScheduledReportJob` has always filtered on `is_recurring`, `recurrence_pattern` and
 * `next_generation`; `DeliveringScheduledReportRunner` has always regenerated and mailed the
 * document. **Nothing ever wrote those three columns**, and `is_recurring` defaults to false,
 * so the sweep ran every fifteen minutes over a predicate no row could satisfy. This panel and
 * `PUT /admin/reports/{id}/schedule` are the missing writer.
 *
 * ## It does not fetch
 *
 * Unlike `ReportSharePanel`, which must read a list only the server holds, the schedule is
 * already on the row this panel is opened from — `ReportListItem` carries all three columns.
 * Re-fetching to show what the caller just handed over would add a spinner to a dialog that
 * has nothing to wait for.
 *
 * ## The first run is optional, and empty is the safer default
 *
 * Omitting it lets the server compute one period from now **in the company's timezone**, which
 * is the zone the sweep will later advance the schedule in. A date entered here is read in the
 * browser's zone and sent as an instant, so the two cannot disagree about what moment was
 * meant. The server refuses a past instant with a 400 rather than advancing it, so
 * "start on the 1st" cannot quietly become a different date — that message is surfaced
 * verbatim rather than replaced with a generic one.
 */
interface ReportSchedulePanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  baseUrl: string
  report: ReportListItem
  /** Handed the updated report so the list can re-render without a round trip. */
  onSaved: (report: Report) => void
}

const DEFAULT_PATTERN: ReportRecurrencePattern = 'monthly'

function isKnownPattern(value: string | null): value is ReportRecurrencePattern {
  return value !== null && (REPORT_RECURRENCE_PATTERNS as readonly string[]).includes(value)
}

export default function ReportSchedulePanel({
  open,
  onOpenChange,
  baseUrl,
  report,
  onSaved,
}: ReportSchedulePanelProps) {
  const { t, locale } = useTranslation()
  const [pattern, setPattern] = useState<ReportRecurrencePattern>(DEFAULT_PATTERN)
  const [startAt, setStartAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset from the row every time the dialog opens, so a panel closed on one report cannot
  // reopen on another showing the first one's pattern. `report.recurrencePattern` is server
  // data and may hold a value this build does not know -- the job clears the schedule for
  // exactly that case -- so an unknown one falls back rather than being rendered as a
  // `<select>` value with no matching `<option>`, which browsers resolve to a blank box.
  useEffect(() => {
    if (!open) return
    setPattern(isKnownPattern(report.recurrencePattern) ? report.recurrencePattern : DEFAULT_PATTERN)
    setStartAt('')
    setError(null)
  }, [open, report.recurrencePattern])

  async function handleSave() {
    setBusy(true)
    setError(null)
    try {
      const parsed = startAt ? Date.parse(startAt) : Number.NaN
      const saved = await setReportSchedule(baseUrl, report.id, {
        pattern,
        // Sent only when it parses. An unparseable value is dropped rather than forwarded as
        // `Invalid Date`, whose `toISOString()` throws before the request is even made.
        ...(Number.isNaN(parsed) ? {} : { startAt: new Date(parsed).toISOString() }),
      })
      onSaved(saved)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setBusy(false)
    }
  }

  async function handleStop() {
    setBusy(true)
    setError(null)
    try {
      onSaved(await clearReportSchedule(baseUrl, report.id))
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('reports.scheduleTitle')}</DialogTitle>
          <DialogDescription>
            {t('reports.scheduleDescription', { title: report.title })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-panel-gap">
          {report.isRecurring && report.nextGeneration && (
            <Alert variant="info" role="note">
              <AlertDescription data-slot="report-schedule-current">
                {t('reports.scheduleNextRun', {
                  date: calendarDay(Date.parse(report.nextGeneration), locale),
                })}
              </AlertDescription>
            </Alert>
          )}

          {/* The server's own message, not a generic one: the two refusals it can send —
              an unsupported pattern, naming the six accepted words, and a first run in the
              past — are both things the reader can act on from the text alone. */}
          {error && <p role="alert">{error}</p>}

          {/* Native `<select>`, matching `ReportForm` and every other form in `features/`:
              `index.css` styles it in both themes, and unlike the Radix `Select` it is driven
              by a real change event, so a test does not depend on pointer capture that
              happy-dom does not implement. */}
          <div>
            <Label htmlFor="report-schedule-pattern">{t('reports.schedulePattern')}</Label>
            <select
              id="report-schedule-pattern"
              value={pattern}
              onChange={(event) => setPattern(event.target.value as ReportRecurrencePattern)}
            >
              {REPORT_RECURRENCE_PATTERNS.map((value) => (
                <option key={value} value={value}>
                  {t(`reports.recurrence_${value}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="report-schedule-start">{t('reports.scheduleStartAt')}</Label>
            <Input
              id="report-schedule-start"
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
            />
            <p className="text-sm text-fg-secondary">{t('reports.scheduleStartAtHint')}</p>
          </div>

          <p className="text-sm text-fg-secondary">{t('reports.scheduleTimezoneNote')}</p>
        </div>

        <DialogFooter>
          {/* Stop is offered only for a report that is actually recurring. Shown always, it
              would be a button that answers 200 and changes nothing on every report in the
              company — the same reasoning that keeps Share off a non-completed row. */}
          {report.isRecurring && (
            <Button type="button" variant="outline" disabled={busy} onClick={() => void handleStop()}>
              {t('reports.scheduleStop')}
            </Button>
          )}
          <Button type="button" disabled={busy} onClick={() => void handleSave()}>
            {t('reports.scheduleSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
