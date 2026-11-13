import { Info } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { describeKnownRefusal } from '../../../../api/describeApiError'
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
import { excludeSurveyResponse, restoreSurveyResponse, type SurveyRosterRow } from '../../api/surveys'

/** The shortest reason the server accepts (`SurveyResponseExclusionEndpoints.MinReasonLength`). */
export const EXCLUSION_REASON_MIN = 5
/** The longest it keeps (`AuditEntry.MaxChangeValueLength`). */
export const EXCLUSION_REASON_MAX = 200

/**
 * «Excluir de los resultados» / «Volver a incluir» for ONE person who finished (ruled 2026-11-08,
 * super admins only).
 *
 * Says three things before anything changes, because each is a consequence an operator could not
 * see from the button: the answers stay stored and the step can be undone; the results, reports
 * and exports change at once; and anyone who compares results from before and after can work out
 * this person's answers by subtraction. The reason is required -- it is the only record of why the
 * numbers moved -- and the field says the client's administrators can read it in their activity
 * log, so nobody writes the person's name into it.
 */
export function ResponseExclusionDialog({
  surveyId,
  target,
  exclude,
  onOpenChange,
  onDone,
}: {
  surveyId: string
  /** The person, or null when the dialog is closed. */
  target: SurveyRosterRow | null
  /** True to take the response out; false to put it back. */
  exclude: boolean
  onOpenChange: (open: boolean) => void
  /** Called once the server has done it, with the state the response is now in. */
  onDone: (row: SurveyRosterRow, excluded: boolean) => void
}) {
  const { t } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.roster.exclusion.${key}`, vars)
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (target === null) return
    setReason('')
    setProblem(null)
  }, [target])

  const trimmed = reason.trim()
  const reasonOk = !exclude || (trimmed.length >= EXCLUSION_REASON_MIN && trimmed.length <= EXCLUSION_REASON_MAX)

  async function confirm() {
    if (target === null || !reasonOk) return
    setBusy(true)
    setProblem(null)
    try {
      if (exclude) {
        await excludeSurveyResponse(baseUrl, surveyId, target.userId, trimmed)
      } else {
        await restoreSurveyResponse(baseUrl, surveyId, target.userId)
      }
      onDone(target, exclude)
      onOpenChange(false)
    } catch (cause) {
      setProblem(describeKnownRefusal(cause, t) ?? copy('error'))
    } finally {
      setBusy(false)
    }
  }

  const name = target?.name ?? ''
  return (
    <Dialog open={target !== null} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent closeLabel={t('common.close')} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy(exclude ? 'excludeTitle' : 'restoreTitle', { name })}</DialogTitle>
          <DialogDescription>{copy(exclude ? 'excludeBody' : 'restoreBody', { name })}</DialogDescription>
        </DialogHeader>
        {exclude ? (
          <>
            <Note role="note" icon={<Info />} className="px-3 py-2.5 text-sm" data-testid="exclusion-subtraction">
              {copy('subtraction')}
            </Note>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exclusion-reason">{copy('reasonLabel')}</Label>
              <Textarea
                id="exclusion-reason"
                value={reason}
                maxLength={EXCLUSION_REASON_MAX}
                rows={3}
                disabled={busy}
                aria-describedby="exclusion-reason-help"
                onChange={(event) => setReason(event.target.value)}
              />
              <p id="exclusion-reason-help" className="m-0 text-xs text-fg-secondary">
                {copy('reasonHelp', { min: EXCLUSION_REASON_MIN })}
              </p>
            </div>
          </>
        ) : null}
        {problem ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant={exclude ? 'destructive' : 'primary'}
            disabled={busy || !reasonOk}
            onClick={() => void confirm()}
          >
            {busy ? t('common.saving') : copy(exclude ? 'excludeConfirm' : 'restoreConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
