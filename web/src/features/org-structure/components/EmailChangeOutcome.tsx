import { CheckCircle2, TriangleAlert } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { byCount } from '../../../i18n/plural'
import { Alert, AlertDescription } from '../../../components/ui'
import type { UserEmailChange } from '../api/users'

/**
 * What correcting an address did, said where the admin made the change.
 *
 * The change SENDS NOTHING, so this is the only place the admin learns what is left: survey codes
 * already mailed to the old address and never used are not re-sent by the correction, and the
 * re-send lives on each survey's roster. The API does not say WHICH surveys -- it returns a
 * count -- so the copy is guidance, not a link.
 */
export function EmailChangeOutcome({ change, current }: { change: UserEmailChange; current: string }) {
  const { t } = useTranslation()
  const codes = change.unusedSurveyCodes
  return (
    <Alert variant={codes > 0 ? 'warning' : 'success'} data-slot="email-change-outcome">
      {codes > 0 ? <TriangleAlert aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
      <AlertDescription className="flex flex-col gap-1 text-sm">
        <span>{t('users.next.edit.emailChanged', { previous: change.previousEmail, current })}</span>
        <span>
          {codes === 0
            ? t('users.next.edit.emailCodesNone')
            : t(byCount(codes, 'users.next.edit.emailCodesOne', 'users.next.edit.emailCodes'), { count: codes })}
        </span>
        {change.pendingInvitationsExpired > 0 && (
          <span>
            {t(byCount(change.pendingInvitationsExpired, 'users.next.edit.emailInvitationsExpiredOne', 'users.next.edit.emailInvitationsExpired'), {
              count: change.pendingInvitationsExpired,
            })}
          </span>
        )}
      </AlertDescription>
    </Alert>
  )
}
