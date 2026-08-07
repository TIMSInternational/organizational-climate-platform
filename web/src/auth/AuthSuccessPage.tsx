import { Navigate, useNavigate } from 'react-router'
import { CheckCircle2Icon } from 'lucide-react'
import { AuthShell } from './AuthShell'
import { getToken } from './token'
import { decodeJwtPayload } from './jwt'
import { resolveInitialRoute } from '../app/resolveInitialRoute'
import { useTranslation } from '../i18n'
import { Button } from '../components/ui'

/** Reads a claim only when it is a non-empty string; `''` is how the API spells "absent". */
function claimString(claims: Record<string, unknown> | null, key: string): string | undefined {
  const value = claims?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * "Your account is ready" (#81).
 *
 * ## Why an interstitial exists at all rather than dropping straight in
 *
 * `POST /auth/signup` decides two things silently that the new user never sees:
 * it joins them to the company matching their **email domain**, and it mints them
 * as `Roles.Employee`. Landing them on a page with no explanation leaves the one
 * surprising fact about self-registration — *which organisation you just joined*
 * — undisclosed. This page reads it back off the token that was just issued, so
 * it is the account that actually exists rather than what the form was told.
 *
 * ## No token, no page
 *
 * Reached without one, this would be a congratulation with nothing behind it, so
 * it redirects to `/login`. It deliberately sits *outside* `RequireAuth` even so:
 * it is part of the unauthenticated flow's visual language, and being bounced
 * here by the auth guard rather than arriving from signup would be the wrong
 * shape.
 *
 * ## Continue goes wherever the role can actually load
 *
 * Via `resolveInitialRoute`, which since this change routes employee, supervisor
 * and leader to `/surveys/my` instead of the SuperAdmin-only companies list. A
 * freshly signed-up user *is* an employee, so before that fix this button's only
 * possible destination was a 403.
 */
export default function AuthSuccessPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const token = getToken()
  if (!token) {
    return <Navigate to="/login" replace />
  }

  const claims = decodeJwtPayload(token)
  const name = claimString(claims, 'name')
  const email = claimString(claims, 'email')
  const role = claimString(claims, 'role')
  const companyId = claimString(claims, 'companyId')
  const destination = resolveInitialRoute(role, companyId)

  return (
    <AuthShell
      title={t('auth.accountCreated')}
      description={name ? t('auth.accountCreatedFor', { name }) : t('auth.accountCreatedDetail')}
      banner={<CheckCircle2Icon aria-hidden="true" className="size-6 text-accent-green" />}
    >
      <dl className="grid gap-1 text-sm">
        {email && (
          <div className="flex flex-wrap items-baseline gap-inline">
            <dt className="text-fg-tertiary">{t('auth.email')}</dt>
            <dd className="text-fg-primary">{email}</dd>
          </div>
        )}
        {/* The company is named by id, not by name: signup returns only a token,
            and `GET /admin/companies/{id}` is SuperAdmin-only — an employee
            cannot resolve it. Saying which domain decided it is honest and needs
            no call the new account would be refused. */}
        {email?.includes('@') && (
          <div className="flex flex-wrap items-baseline gap-inline">
            <dt className="text-fg-tertiary">{t('auth.joinedOrganization')}</dt>
            <dd className="text-fg-primary">{email.split('@')[1]}</dd>
          </div>
        )}
      </dl>

      <p className="text-sm text-fg-secondary">{t('auth.accountCreatedRoleNote')}</p>

      <Button variant="primary" onClick={() => navigate(destination, { replace: true })}>
        {t('auth.continueToApp')}
      </Button>
    </AuthShell>
  )
}
