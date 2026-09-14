import { Navigate, useNavigate } from 'react-router'
import { Check } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Button } from '../../components/ui'
import { getToken } from '../token'
import { decodeJwtPayload } from '../jwt'
import { resolveInitialRoute } from '../../app/resolveInitialRoute'
import { AuthCanvas, AuthCard, AuthHeadline } from './AuthCanvas'
import { domainOf } from './derive'

/** A claim, only when it is a non-empty string; `''` is how the API spells "absent". */
function claimString(claims: Record<string, unknown> | null, key: string): string | null {
  const value = claims?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * `/auth/success` — "Su cuenta está lista".
 *
 * ## Why this route is in this lane
 *
 * It has no artboard of its own. It is drawn inside **AuthTransition.dc.html**, as the
 * board's second state ("Otro estado · después de crear una cuenta / La página que sigue al
 * registro"), because it is the other page a person meets between submitting a form and
 * landing in the app. Leaving it on the previous design language would have put a seam in
 * the middle of the one flow this lane redrew: register → this → dashboard.
 *
 * ## What it is for
 *
 * `POST /auth/signup` decides two things silently that the new user never sees: it joins
 * them to the company matching their **email domain**, and it mints them as
 * `Roles.Employee`. This page reads both back off the token that was just issued — so what
 * is on screen is the account that exists, not what the form was told — and names the
 * **domain** rather than the company, because signup returns only a token and
 * `GET /admin/companies/{id}` is SuperAdmin-only: a new employee cannot resolve the
 * company's name, and inventing one would be the page's only untrue line.
 *
 * ## No token, no page
 *
 * Reached without one this would be a congratulation with nothing behind it, so it
 * redirects to `/login` — the board says so. It deliberately sits *outside* `RequireAuth`
 * even so: it is part of the unauthenticated flow's visual language, and being bounced here
 * by the auth guard rather than arriving from signup would be the wrong shape.
 */
export default function AuthSuccessNextPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const token = getToken()
  if (!token) {
    return <Navigate to="/login" replace />
  }

  const claims = decodeJwtPayload(token)
  const email = claimString(claims, 'email')
  const domain = email ? domainOf(email) : null

  return (
    <AuthCanvas>
      <AuthCard>
        <AuthHeadline
          tile={<Check aria-hidden="true" />}
          tone="good"
          eyebrow={t('auth.next.successEyebrow')}
          title={t('auth.next.successTitle')}
          description={t('auth.next.successDetail')}
        />

        <div className="flex flex-col gap-3.5">
          <dl className="m-0 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-sm">
            {email && (
              <>
                <dt className="m-0 text-fg-tertiary">{t('auth.next.successEmail')}</dt>
                <dd className="m-0 min-w-0 break-words text-fg-primary">{email}</dd>
              </>
            )}
            {domain && (
              <>
                <dt className="m-0 text-fg-tertiary">{t('auth.next.successDomain')}</dt>
                <dd className="m-0 min-w-0 break-words text-fg-primary">{domain}</dd>
              </>
            )}
            <dt className="m-0 text-fg-tertiary">{t('auth.next.successRole')}</dt>
            <dd className="m-0 min-w-0 text-fg-primary">{t('users.employee')}</dd>
          </dl>

          <Button
            variant="primary"
            size="canvas"
            className="w-full"
            onClick={() => navigate(resolveInitialRoute(), { replace: true })}
          >
            {t('auth.continueToApp')}
          </Button>
        </div>
      </AuthCard>
    </AuthCanvas>
  )
}
