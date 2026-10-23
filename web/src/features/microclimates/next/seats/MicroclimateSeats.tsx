import { Ticket } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { NoteBand } from '../../../../components/canvas'
import { Alert, AlertDescription } from '../../../../components/ui'
import { seatsCase, type SeatsState } from './useMicroclimateSeats'

/**
 * The company's microclimate seats, where an administrator creates or launches a session (G23).
 *
 * Before this the only reader was the super-admin licence panel, so a company admin found out the
 * seats were gone when respondents were refused. A seat is one COMPLETED response; when there
 * are none left, the respond page says the session is not accepting responses (the server's
 * 402, worded for the respondent without the commercial reason). This says it plainly, here,
 * before launch — and as an alert when nobody could answer at all.
 */
export function MicroclimateSeatsNote({ state }: { state: SeatsState }) {
  const { t } = useTranslation()
  if (state.status === 'loading') {
    return <p className="m-0 text-sm text-fg-tertiary">{t('microclimates.next.seats.loading')}</p>
  }
  if (state.status === 'failed') {
    return <p className="m-0 text-sm text-fg-tertiary">{t('microclimates.next.seats.failed')}</p>
  }
  const seats = state.value
  const which = seatsCase(seats)
  if (which === 'suspended' || which === 'exhausted') {
    return (
      <Alert variant="destructive" role="status">
        <AlertDescription>
          <span className="flex flex-col gap-1">
            <strong>
              {which === 'suspended'
                ? t('microclimates.next.seats.suspendedTitle')
                : t('microclimates.next.seats.exhaustedTitle', { used: seats.seatsUsed, total: seats.seatsTotal })}
            </strong>
            <span>{which === 'suspended' ? t('microclimates.next.seats.suspendedBody') : t('microclimates.next.seats.exhaustedBody')}</span>
          </span>
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <NoteBand icon={<Ticket />}>
      <span className="flex flex-col gap-0.5">
        <strong className="font-semibold text-fg-primary">
          {which === 'unmetered'
            ? t('microclimates.next.seats.unmeteredTitle')
            : t('microclimates.next.seats.availableTitle', {
                remaining: seats.seatsRemaining,
                total: seats.seatsTotal,
                used: seats.seatsUsed,
              })}
        </strong>
        <span>{which === 'unmetered' ? t('microclimates.next.seats.unmeteredBody') : t('microclimates.next.seats.availableBody')}</span>
      </span>
    </NoteBand>
  )
}
