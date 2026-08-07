import { useTranslation } from '../../../i18n'
import { Button } from '../../../components/ui'
import { statusLabel } from '../surveyVocabulary'

interface SurveyStatusActionsProps {
  /**
   * `SurveyDetail.allowedStatusTransitions`, straight off the wire. Not derived,
   * not filtered, not reordered.
   */
  allowedStatusTransitions: readonly string[]
  onTransition: (status: string) => void
  /** The status currently being applied, so its button can show it is in flight. */
  pendingStatus?: string
  disabled?: boolean
}

/**
 * One button per legal next status — and nothing else.
 *
 * ## Why this component holds no rules of its own
 *
 * `SurveyStatuses.Transitions` is computed server-side and returned on the detail DTO
 * precisely so the client does not reimplement it. The matrix's interesting content
 * is its *absences*: `active -> draft` is illegal because a survey with responses is
 * frozen forever, and `closed -> active` is illegal because reopening a survey means
 * answers arriving after its results were analysed. Those two rules read as arbitrary
 * from the client's side, which is exactly why a TypeScript copy of them drifts —
 * and a drifted copy shows an admin a button the server then refuses.
 *
 * So: no transition table here, no "publish" special-case, and no pre-emptive check
 * of the content-i18n publish gate (which is server-side and strict only when the
 * survey's language is `'both'`). An empty array renders no buttons, which is the
 * correct rendering of `archived` — a terminal state with no outgoing edges.
 *
 * The refusal message, when one comes back, is rendered by the page rather than
 * anticipated here.
 */
export default function SurveyStatusActions({
  allowedStatusTransitions,
  onTransition,
  pendingStatus,
  disabled,
}: SurveyStatusActionsProps) {
  const { t } = useTranslation()

  if (allowedStatusTransitions.length === 0) {
    return <p>{t('surveys.noStatusTransitions')}</p>
  }

  return (
    <div className="flex flex-wrap gap-inline">
      {allowedStatusTransitions.map((status) => (
        <Button
          key={status}
          type="button"
          variant="outline"
          disabled={disabled || pendingStatus !== undefined}
          onClick={() => onTransition(status)}
        >
          {t('surveys.moveToStatus', { status: statusLabel(t, status) })}
        </Button>
      ))}
    </div>
  )
}
