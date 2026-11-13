import { useEffect, useState } from 'react'
import { ApiError } from '../../../../api/authFetch'
import { describeKnownRefusal } from '../../../../api/describeApiError'
import { useTranslation } from '../../../../i18n'
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
} from '../../../../components/ui'
import { DateTimeField } from '../../../microclimates/next/create/DateTimeField'
import type { SurveyDetail } from '../../api/surveys'
import { instantOfWallClock, wallClockIn, zoneLabel } from './zonedWindow'

/**
 * "Cambiar fechas" -- a survey's opening and close, moved from the screen (audit G16).
 *
 * Until this, the window could be moved only with `PUT /surveys/{id}` from a script, so a
 * survey duplicated from a closed one kept its source's PAST dates and "Activar" stayed
 * disabled on it for good: the duplicate the product calls "the supported way to run a survey
 * again" could not be run.
 *
 * Offered where the server takes it (`canDistribute`, which is `AllowsScheduleEdit`: draft,
 * scheduled, active). On an ACTIVE survey the opening is a fact the server will not move, so it
 * is shown and not offered, and only `endDate` is sent.
 *
 * Both fields are the COMPANY's wall clock (`timeZone`), converted to instants on save
 * (`zonedWindow.ts`); the zone is printed so nobody has to guess whose 23:59 it is. `DateTimeField`
 * carries a wall-clock string and never an instant, so reusing it here does not drag the
 * browser's zone back in.
 */
export function SurveyWindowDialog({
  survey,
  timeZone,
  open,
  onOpenChange,
  onSave,
  now = () => new Date(),
}: {
  survey: Pick<SurveyDetail, 'status' | 'startDate' | 'endDate'>
  timeZone: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (window: { startDate?: string; endDate: string }) => Promise<void>
  /** Injectable only so a test can pin "now". */
  now?: () => Date
}) {
  const { t } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.detail.window.${key}`, vars)
  const startLocked = survey.status === 'active'
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Each opening starts from the survey as it is now, so an abandoned edit never outlives it.
  useEffect(() => {
    if (!open) return
    setStart(wallClockIn(survey.startDate, timeZone) ?? '')
    setEnd(wallClockIn(survey.endDate, timeZone) ?? '')
    setProblem(null)
  }, [open, survey.startDate, survey.endDate, timeZone])

  async function save() {
    const startAt = startLocked ? new Date(survey.startDate) : instantOfWallClock(start, timeZone)
    const endAt = instantOfWallClock(end, timeZone)
    if (!startAt || !endAt || Number.isNaN(startAt.getTime())) {
      setProblem(copy('errorMissing'))
      return
    }
    if (startAt.getTime() >= endAt.getTime()) {
      setProblem(copy('errorOrder'))
      return
    }
    // A close already behind us would close an active survey on the lifecycle job's next run,
    // and leave a draft's "Activar" disabled -- the very dead end this editor exists to end.
    if (endAt.getTime() <= now().getTime()) {
      setProblem(copy('errorPast'))
      return
    }
    setProblem(null)
    setSaving(true)
    try {
      await onSave(
        startLocked
          ? { endDate: endAt.toISOString() }
          : { startDate: startAt.toISOString(), endDate: endAt.toISOString() },
      )
      onOpenChange(false)
    } catch (cause) {
      setProblem(describeKnownRefusal(cause, t) ?? refusal(cause, copy, t('errors.generic')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent closeLabel={t('common.close')} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy('title')}</DialogTitle>
          <DialogDescription>{copy('zone', { zone: zoneLabel(timeZone) })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <DateTimeField id="survey-window-start" label={copy('start')} value={start} disabled={startLocked || saving} onChange={setStart} />
          <DateTimeField id="survey-window-end" label={copy('end')} value={end} disabled={saving} onChange={setEnd} />
        </div>
        {startLocked && (
          <p className="m-0 text-sm text-fg-secondary" data-testid="window-start-locked">
            {copy('startLocked')}
          </p>
        )}
        {survey.status === 'active' && (
          <p role="note" className="m-0 text-sm text-accent-amber-ink" data-testid="window-live">
            {copy('liveNote')}
          </p>
        )}
        {problem && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? t('common.saving') : copy('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The server's refusal in the reader's language. `PUT /surveys/{id}` answers in English
 * (`SurveyEndpoints.UpdateAsync`), so its message is never shown: the status says which rule
 * refused. A transport failure arrives already translated by `authFetch`.
 */
function refusal(cause: unknown, copy: (key: string) => string, generic: string): string {
  if (cause instanceof ApiError) {
    if (cause.status === 400) return copy('refusedOrder')
    if (cause.status === 409) return copy('refusedStatus')
    if (cause.status === 404) return copy('refusedGone')
    return generic
  }
  return cause instanceof Error && cause.message ? cause.message : generic
}
