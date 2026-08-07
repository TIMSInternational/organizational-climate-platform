import { Link, useLocation, useSearchParams } from 'react-router'
import { AlertTriangleIcon } from 'lucide-react'
import { AuthShell } from './AuthShell'
import { authErrorCopy, toAuthErrorReason } from './authReason'
import { useTranslation } from '../i18n'
import { Alert, AlertDescription, Button } from '../components/ui'

/**
 * The page a sign-in attempt lands on when the platform, rather than the
 * credentials, is what refused (#81).
 *
 * ## Its two real producers
 *
 * `AuthEndpoints.CheckSystemSettingsGateAsync` gates `/auth/login`,
 * `/auth/signup` and `/auth/google`:
 *
 * - **503** `SystemSettings.MaintenanceMode` — with a message an administrator
 *   authored, resolved per-locale by the server since #195.
 * - **403** `SystemSettings.LoginEnabled == false`.
 *
 * Both used to be swallowed by `auth/api.ts`, which threw `Login failed: 403`
 * and dropped the body — so the deliberate kill switch and the authored
 * maintenance notice both surfaced as a status code next to the password field.
 * That fix is what makes this page have anything to show.
 *
 * ## The server's message wins over the catalogue's
 *
 * `location.state.message` is the server's own sentence. For maintenance it is
 * authored, localized content and the catalogue cannot do better than paraphrase
 * it; for a disabled login it is the administrator's wording. The catalogue text
 * is the fallback for a direct visit to this URL with no state — which is the
 * case the `reason` query parameter exists for, and why it is narrowed through
 * `toAuthErrorReason` rather than used as a key path.
 */
export default function AuthErrorPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const location = useLocation()

  const reason = toAuthErrorReason(searchParams.get('reason'))
  const copy = authErrorCopy(reason)

  const state = location.state as { message?: unknown } | null
  const serverMessage = typeof state?.message === 'string' && state.message.trim() !== '' ? state.message : null

  return (
    <AuthShell
      title={t(copy.titleKey)}
      description={t(copy.descriptionKey)}
      banner={<AlertTriangleIcon aria-hidden="true" className="size-6 text-accent-amber" />}
      footer={<Link to="/login">{t('auth.backToSignIn')}</Link>}
    >
      {serverMessage && (
        <Alert variant="warning" role="alert">
          <AlertDescription>{serverMessage}</AlertDescription>
        </Alert>
      )}

      {/* A reload rather than a react-router navigation: the condition being
          reported lives on the server, so the only thing that can change the
          answer is asking it again. */}
      <Button variant="primary" onClick={() => window.location.assign('/login')}>
        {t('common.retry')}
      </Button>
    </AuthShell>
  )
}
