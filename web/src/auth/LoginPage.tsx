import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthRequestError, login } from './api'
import { AuthShell } from './AuthShell'
import { AuthPending } from './AuthPending'
import { pageWorthyReason } from './authReason'
import { beginGoogleSignIn, googleClientId } from './googleOAuth'
import { setToken } from './token'
import { decodeJwtPayload } from './jwt'
import { resolveInitialRoute } from '../app/resolveInitialRoute'
import { useTranslation } from '../i18n'
import { Alert, AlertDescription, Button, Separator, TextField } from '../components/ui'

/**
 * Sign in.
 *
 * ## What changed here with #81
 *
 * The form itself is unchanged in behaviour; what it *shows* is not. It was a
 * bare unstyled `<form>` with a `<p role="alert">`, and it now renders in
 * `AuthShell` alongside the four other auth states, so the pages a demo hits when
 * something goes sideways look like one product.
 *
 * More importantly, a failure is now triaged rather than flattened:
 *
 * - **403 / 503** are platform conditions (`SystemSettings.LoginEnabled`,
 *   `MaintenanceMode`) that no amount of retyping fixes. They take the whole page
 *   — `/auth/error` — and carry the server's own message, which for maintenance
 *   is localized authored content (#195). Before this, `auth/api.ts` discarded
 *   the body and threw `Login failed: 503`.
 * - **401** stays here, next to the fields, because it is about this attempt.
 *   Note the server answers 401 identically for a wrong password and a
 *   deactivated account, on purpose; this page does not try to tell them apart
 *   (see `AccountInactivePage`).
 */
export default function LoginPage() {
  const { t } = useTranslation()
  // Absent unless `VITE_GOOGLE_CLIENT_ID` is configured, and the button is omitted
  // entirely when it is: a "Continue with Google" that can only ever come back as
  // `invalid_client` is worse than no button. See `googleOAuth.ts`.
  const googleClient = googleClientId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL as string
      const { token } = await login(baseUrl, email, password)
      setToken(token)

      // Unconditionally navigating to /admin/companies (SuperAdmin-only) used to
      // 403 every non-SuperAdmin login before they could see anything.
      const claims = decodeJwtPayload(token)
      const role = typeof claims?.role === 'string' ? claims.role : undefined
      const companyId = typeof claims?.companyId === 'string' ? claims.companyId : undefined
      navigate(resolveInitialRoute(role, companyId))
    } catch (err) {
      const status = err instanceof AuthRequestError ? err.status : 0
      const message = err instanceof Error && err.message ? err.message : t('errors.generic')

      const reason = pageWorthyReason(status)
      if (reason) {
        navigate(`/auth/error?reason=${reason}`, { state: { message } })
        return
      }

      // 401's body is "Invalid email or password" — the server's wording, no
      // longer a literal reconstructed on this side.
      setError(status === 401 ? t('auth.loginError') : message)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitting) {
    return <AuthPending label={t('auth.signingIn')} />
  }

  return (
    <AuthShell
      title={t('auth.signIn')}
      description={t('auth.welcome')}
      footer={
        <>
          <span className="text-fg-secondary">{t('auth.dontHaveAccount')}</span>
          <Link to="/register">{t('auth.createAccount')}</Link>
        </>
      }
    >
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form className="grid gap-panel-gap" onSubmit={handleSubmit}>
        <TextField
          label={t('auth.email')}
          type="email"
          value={email}
          required
          placeholder={t('auth.emailPlaceholder')}
          onChange={setEmail}
        />
        <TextField
          label={t('auth.password')}
          type="password"
          value={password}
          required
          placeholder={t('auth.passwordPlaceholder')}
          onChange={setPassword}
        />
        <Button type="submit" variant="primary">
          {t('auth.signIn')}
        </Button>
      </form>

      {googleClient && (
        <>
          <div className="flex items-center gap-inline text-sm text-fg-tertiary">
            <Separator className="flex-1" />
            <span>{t('auth.or')}</span>
            <Separator className="flex-1" />
          </div>

          {/* A full-page navigation, not a react-router one: this leaves the app
              for accounts.google.com and comes back to /auth/loading as a fresh
              document. `beginGoogleSignIn` stores the state/nonce handshake that
              the return trip is checked against. */}
          <Button
            type="button"
            variant="secondary"
            onClick={() => window.location.assign(beginGoogleSignIn(googleClient, window.location.origin))}
          >
            {t('auth.continueWithGoogle')}
          </Button>
        </>
      )}
    </AuthShell>
  )
}
