import { useTranslation } from '../../i18n'
import { calendarDay } from '../../lib/calendarDay'
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui'
import { formatParticipationDay } from '../../features/surveys/next/authoring/participationDay'
import {
  isKnownInvitationStatus,
  type SurveyAnonymityGuarantee,
  type SurveyInvitationDetail,
} from '../../features/surveys/api/surveyDistribution'

/**
 * Who was invited and where each of them got to.
 *
 * ## Two rules this table is built around
 *
 * **1. No token, ever.** An invitation token is a bearer credential for an
 * unauthenticated route — whoever reads it can open the survey *as that employee*. The
 * API omits it from `SurveyInvitationDetail`, and this component reads named fields off
 * the row rather than iterating its keys, so a token that ever reappeared in the payload
 * (a server regression, a mocked fixture, a hand-rolled response) still could not reach
 * the DOM, a screenshot, or a copied table. `InvitationTable.test.tsx` proves that by
 * rendering a row that *does* carry one.
 *
 * **2. Columns that cannot hold data are not rendered.** No survey records when anyone
 * started (ruled 2026-10-12), so there is no Started column at all. A named survey records
 * only the DAY an invitee finished (`completedOn`), shown as a day. For an anonymous survey
 * even that is never written, so the column would be permanently empty — and an empty cell
 * reads as "this person has not finished", which is a claim about a person the survey has
 * promised not to make. The column is dropped and the promise is stated instead.
 *
 * Status uses the `secondary` and `outline` badge variants only. Measured against
 * `tokens.css`, they are the two that clear WCAG AA 4.5:1 in **both** themes — the four
 * soft/solid variants fail in one theme or the other (see
 * `styles/badgeVariantContrast.test.ts`). The word carries the meaning, which 1.4.1 wants
 * regardless.
 */
export interface InvitationTableProps {
  invitations: readonly SurveyInvitationDetail[]
  anonymity: SurveyAnonymityGuarantee
  onResend: (invitationId: string) => void
  onRevoke: (invitationId: string) => void
  /** The row currently mid-request, so its buttons can be disabled. */
  busyInvitationId?: string | null
}

/**
 * The day an invitee finished. `completedOn` is a calendar day and is printed as one, never
 * through `Date` (which would shift it a day west of UTC); `completedAt` is read only from an
 * API older than `completedOn`.
 */
function formatCompletion(invitation: SurveyInvitationDetail, locale: string): string {
  if (invitation.completedOn) return formatParticipationDay(invitation.completedOn, locale)
  return formatMoment(invitation.completedAt, locale)
}

function formatMoment(value: string | null, locale: string): string {
  if (value === null) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : calendarDay(parsed, locale)
}

export default function InvitationTable({
  invitations,
  anonymity,
  onResend,
  onRevoke,
  busyInvitationId = null,
}: InvitationTableProps) {
  const { t, locale } = useTranslation()
  const tracksCompletion = !anonymity.suppressedStates.includes('completed')
  const columnCount = tracksCompletion ? 7 : 6

  return (
    // The `<Table>` primitive, never a bare `<table>`: it owns `w-full` and the
    // `overflow-x-auto` container that pairing requires (#218). This table is wide.
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('surveys.distribution.recipient')}</TableHead>
          <TableHead>{t('common.status')}</TableHead>
          <TableHead>{t('surveys.distribution.sentAt')}</TableHead>
          {tracksCompletion && <TableHead>{t('surveys.distribution.completedAt')}</TableHead>}
          {/* The derived "Expired" badge says THAT an invitation lapsed and never
              when, which is the fact an admin needs to decide whether to re-invite. */}
          <TableHead>{t('surveys.distribution.expiresAt')}</TableHead>
          <TableHead>{t('surveys.distribution.reminders')}</TableHead>
          <TableHead>{t('common.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invitations.length === 0 ? (
          <TableEmpty colSpan={columnCount}>{t('surveys.distribution.noInvitations')}</TableEmpty>
        ) : (
          invitations.map((invitation) => {
            const busy = busyInvitationId === invitation.id
            // Expired is derived from `expiresAt`, not stored, so it is a property of the
            // row rather than a status — it can be true of an invitation whose status
            // still says `sent`, and saying only `sent` there would be misleading.
            const expired = invitation.isExpired && invitation.status !== 'completed'
            return (
              <TableRow key={invitation.id}>
                <TableCell>{invitation.email}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-inline">
                    <Badge variant="secondary">
                      {/* Never `t()` on an unvalidated wire value — an unknown status
                          would render its own key path at the user (#78). */}
                      {isKnownInvitationStatus(invitation.status)
                        ? t(`surveys.distribution.status.${invitation.status}`)
                        : invitation.status}
                    </Badge>
                    {expired && (
                      <Badge variant="outline">{t('surveys.distribution.status.expired')}</Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell>{formatMoment(invitation.sentAt, locale)}</TableCell>
                {tracksCompletion && (
                  <TableCell>{formatCompletion(invitation, locale)}</TableCell>
                )}
                <TableCell>{formatMoment(invitation.expiresAt, locale)}</TableCell>
                <TableCell>{invitation.reminderCount}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-inline">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => onResend(invitation.id)}
                    >
                      {t('surveys.distribution.resend')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || invitation.status === 'revoked'}
                      onClick={() => onRevoke(invitation.id)}
                    >
                      {t('surveys.distribution.revoke')}
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            )
          })
        )}
      </TableBody>
    </Table>
  )
}
