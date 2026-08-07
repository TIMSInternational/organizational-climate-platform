import { useNavigate } from 'react-router'
import { UserXIcon } from 'lucide-react'
import { AuthShell } from './AuthShell'
import { clearToken } from './token'
import { useTranslation } from '../i18n'
import { Alert, AlertDescription, Button } from '../components/ui'

/**
 * "Your account has been deactivated" (#81).
 *
 * ## Why this hangs off the token and not off login
 *
 * `AuthEndpoints.LoginAsync` filters `u.Email == email && u.IsActive`, so a
 * deactivated user's login is answered **401 "Invalid email or password"** —
 * byte-identical to a wrong password. That is a deliberate anti-enumeration
 * choice on the server's part and this page must not undo it: telling a stranger
 * at the login form that an address exists but is deactivated is exactly the leak
 * the identical response prevents.
 *
 * So the real producers are the two places the account's state is known *because
 * the caller already holds a token for it*:
 *
 * - The **`isActive` JWT claim**, which `RequireAuth` reads. Note it is a
 *   **string** — `JwtTokenService` emits `claims.IsActive ? "true" : "false"` —
 *   so `claims.isActive === 'false'`, never `!claims.isActive`, which would be
 *   false for the string `"false"` and let a deactivated session straight through.
 * - **`POST /auth/refresh`** → 401 `"Account is no longer active"`, for the case
 *   where deactivation happened after the token was minted.
 *
 * ## The token is cleared on the way out, not on arrival
 *
 * Clearing it in an effect on mount would race `RequireAuth`'s redirect and could
 * bounce the user to `/login` before they read anything. The button does it,
 * which is also the only moment the session is genuinely finished with.
 */
export default function AccountInactivePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <AuthShell
      title={t('auth.accountInactiveTitle')}
      description={t('auth.accountInactiveDetail')}
      banner={<UserXIcon aria-hidden="true" className="size-6 text-accent-red" />}
    >
      <Alert variant="warning" role="status">
        <AlertDescription>{t('auth.accountInactiveNextSteps')}</AlertDescription>
      </Alert>

      <Button
        variant="primary"
        onClick={() => {
          clearToken()
          navigate('/login', { replace: true })
        }}
      >
        {t('auth.backToSignIn')}
      </Button>
    </AuthShell>
  )
}
