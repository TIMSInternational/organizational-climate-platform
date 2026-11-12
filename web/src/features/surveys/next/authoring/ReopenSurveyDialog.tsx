import { Info } from 'lucide-react'
import { useEffect, useState } from 'react'
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
  Label,
  Note,
  Textarea,
} from '../../../../components/ui'
import { DateTimeField } from '../../../microclimates/next/create/DateTimeField'
import { instantOfWallClock, zoneLabel } from './zonedWindow'

/** The soonest the new close may be, from now (`SurveyEndpoints.ReopenMinimumWindow`). */
export const REOPEN_MINIMUM_MINUTES = 30
/** The reason's bounds on the server (`ReopenReasonMinLength`, `AuditEntry.MaxChangeValueLength`). */
export const REOPEN_REASON_MIN = 5
export const REOPEN_REASON_MAX = 200

/**
 * «Reabrir» -- a closed survey takes answers again until a new close (ruled 2026-11-08, super
 * admins only). Reopening Eagle on 27 Oct 2026 took a developer and a hand-written UPDATE.
 *
 * Before anything changes it says what the server's state machine has always said about this
 * step: answers that arrive now change results that may already have been delivered, exported or
 * compared. The new close is the COMPANY's wall clock, like "Cambiar fechas", and the reason is
 * required because it is the only record of why a closed measurement moved.
 */
export function ReopenSurveyDialog({
  timeZone,
  open,
  onOpenChange,
  onReopen,
  now = () => new Date(),
}: {
  timeZone: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onReopen: (body: { endDate: string; reason: string }) => Promise<void>
  /** Injectable only so a test can pin "now". */
  now?: () => Date
}) {
  const { t } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.detail.reopen.${key}`, vars)
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setEnd('')
    setReason('')
    setProblem(null)
  }, [open])

  async function save() {
    const endAt = instantOfWallClock(end, timeZone)
    if (!endAt || Number.isNaN(endAt.getTime())) {
      setProblem(copy('errorMissing'))
      return
    }
    if (endAt.getTime() < now().getTime() + REOPEN_MINIMUM_MINUTES * 60_000) {
      setProblem(copy('errorTooSoon', { minutes: REOPEN_MINIMUM_MINUTES }))
      return
    }
    const trimmed = reason.trim()
    if (trimmed.length < REOPEN_REASON_MIN) {
      setProblem(copy('errorReason', { min: REOPEN_REASON_MIN }))
      return
    }
    setProblem(null)
    setSaving(true)
    try {
      await onReopen({ endDate: endAt.toISOString(), reason: trimmed })
      onOpenChange(false)
    } catch (cause) {
      setProblem(describeKnownRefusal(cause, t) ?? t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent closeLabel={t('common.close')} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy('title')}</DialogTitle>
          <DialogDescription>{copy('body')}</DialogDescription>
        </DialogHeader>
        <Note role="note" icon={<Info />} className="px-3 py-2.5 text-sm" data-testid="reopen-cost">
          {copy('cost')}
        </Note>
        <DateTimeField
          id="survey-reopen-end"
          label={copy('end', { zone: zoneLabel(timeZone) })}
          value={end}
          disabled={saving}
          onChange={setEnd}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="survey-reopen-reason">{copy('reasonLabel')}</Label>
          <Textarea
            id="survey-reopen-reason"
            value={reason}
            maxLength={REOPEN_REASON_MAX}
            rows={3}
            disabled={saving}
            aria-describedby="survey-reopen-reason-help"
            onChange={(event) => setReason(event.target.value)}
          />
          <p id="survey-reopen-reason-help" className="m-0 text-xs text-fg-secondary">
            {copy('reasonHelp')}
          </p>
        </div>
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
            {saving ? t('common.saving') : copy('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
