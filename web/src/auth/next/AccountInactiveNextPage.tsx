import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { LogOut, Lock, ShieldCheck, Users } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Button } from '../../components/ui'
import { clearToken } from '../token'
import { AuthCanvas, AuthCard, AuthHeadline } from './AuthCanvas'

/**
 * `/auth/inactive` — the AccountInactive artboard, which replaced `AccountInactivePage` on
 * this route.
 *
 * ## Only someone who already had a session can see this
 *
 * `AuthEndpoints.LoginAsync` filters `u.Email == email && u.IsActive`, so a deactivated
 * user's sign-in is answered **401 "Invalid email or password"** — byte-identical to a
 * wrong password. That is a deliberate anti-enumeration choice and this page must not undo
 * it: telling a stranger at the sign-in form that an address exists but is deactivated is
 * exactly the leak the identical response prevents. The board's own annotation records it.
 *
 * So the two real producers are the places the account's state is known *because the
 * caller already holds a token for it*: the `isActive` JWT claim `RequireAuth` reads (a
 * **string** — `JwtTokenService` emits `"true"`/`"false"`, so it is compared to `'false'`
 * and never negated), and `POST /auth/refresh` answering 401 after a deactivation that
 * happened mid-session.
 *
 * ## What the redesign adds
 *
 * The previous page said what happened and offered "back to sign in". The board answers
 * the two questions a person actually has — *who can undo this* and *did I lose anything*
 * — as two rows, and names the button for what it really does: it ends the session in this
 * browser. Signing back in is not something this page can offer, because the account is
 * the thing that is off.
 *
 * ## The token is cleared on the way out, not on arrival
 *
 * Clearing it in an effect on mount would race `RequireAuth`'s redirect and could bounce
 * the reader to `/login` before they read anything. The button does it, which is also the
 * only moment the session is genuinely finished with.
 */
export default function AccountInactiveNextPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <AuthCanvas stage="administration">
      <AuthCard>
        <AuthHeadline
          tile={<Lock aria-hidden="true" />}
          tone="critical"
          eyebrow={t('auth.next.inactiveEyebrow')}
          title={t('auth.accountInactiveTitle')}
          description={t('auth.next.inactiveDetail')}
        />

        <div className="flex flex-col gap-3.5">
          <InactiveRow
            icon={<Users aria-hidden="true" />}
            heading={t('auth.next.inactiveWhoTitle')}
            ruled
          >
            {t('auth.next.inactiveWhoBody')}
          </InactiveRow>
          <InactiveRow icon={<ShieldCheck aria-hidden="true" />} heading={t('auth.next.inactiveKeptTitle')}>
            {t('auth.next.inactiveKeptBody')}
          </InactiveRow>

          <Button
            variant="primary"
            size="canvas"
            className="w-full"
            onClick={() => {
              clearToken()
              navigate('/login', { replace: true })
            }}
          >
            <LogOut aria-hidden="true" />
            {t('auth.next.signOutAndLeave')}
          </Button>

          <p className="m-0 text-center text-sm text-fg-tertiary">{t('auth.next.signOutNote')}</p>
        </div>
      </AuthCard>
    </AuthCanvas>
  )
}

/** One of the two answers: the tile, the question as a heading, and the answer under it. */
function InactiveRow({
  icon,
  heading,
  ruled = false,
  children,
}: {
  icon: ReactNode
  heading: string
  ruled?: boolean
  children: ReactNode
}) {
  return (
    <div
      data-slot="inactive-row"
      className={ruled ? 'flex items-start gap-3 border-b border-line-light pb-3' : 'flex items-start gap-3'}
    >
      <span
        aria-hidden="true"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-icon-box text-fg-secondary [&_svg]:size-4"
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-base font-semibold text-fg-primary">{heading}</span>
        <span className="text-sm text-fg-secondary">{children}</span>
      </span>
    </div>
  )
}
