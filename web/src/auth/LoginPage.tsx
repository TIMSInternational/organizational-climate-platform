import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ShieldCheck } from 'lucide-react'
import { AuthRequestError, login } from './api'
import { AuthShell } from './AuthShell'
import { AuthPending } from './AuthPending'
import { pageWorthyReason } from './authReason'
import { beginGoogleSignIn, googleClientId } from './googleOAuth'
import { setToken } from './token'
import { resolveInitialRoute } from '../app/resolveInitialRoute'
import { useTranslation } from '../i18n'
import { Alert, AlertDescription, Button, TextField } from '../components/ui'
import { BrandLockup } from '../components/layout'

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
 *
 * ## What the employee redesign changed, and why each was a link to nowhere
 *
 * **"Create an account" is gone.** Employees arrive by bulk import or by
 * `/accept-invitation/:token`. `POST /auth/signup` derives the company from the
 * email domain and 400s when no company is registered for it, so for the
 * overwhelming majority of the people who reach this page that link led to a form
 * that could only refuse them. `/register` still exists and is still routed — this
 * page simply stops advertising it as the way in.
 *
 * **Password help is copy, not a control.** There is no password-reset endpoint
 * anywhere in this API: `/auth` is login, signup, google, refresh and the
 * admin-only reset-credentials. A "Forgot your password?" link — which the
 * prototype drew, and which `auth.forgotPassword` has been sitting in the
 * catalogue waiting for — would have to point at a route that cannot exist. So the
 * page says the true thing instead, in plain text, and `auth.forgotPassword` stays
 * orphaned on purpose.
 *
 * **The brand lockup and the assurance line.** `BrandLockup` is the same mark and
 * wordmark the signed-in rail and the respond header wear, so the screen every
 * role shares is recognisably this product before anyone types anything; the line
 * under the card answers the question an employee about to answer an anonymous
 * survey is actually asking, which is what signing in has to do with their answers.
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
      // 403 every non-SuperAdmin login before they could see anything. Since #132
      // the destination is `/dashboard` for every role — the page itself dispatches
      // on the claim, so nothing needs decoding here.
      navigate(resolveInitialRoute())
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
      variant="storefront"
      title={t('auth.signIn')}
      description={t('auth.signInDetail')}
      brand={<BrandLockup />}
      footer={
        /* One row, not a wrapping pair: `max-w-prose` on the span was pushing
           the icon onto its own line above the text. */
        <span className="inline-flex max-w-prose items-start gap-2 text-left">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-icon shrink-0 text-store-ramp-1-text" />
          <span>{t('auth.signInAssurance')}</span>
        </span>
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
        {/* Static copy, and it must stay static: see the note above this component
            about the reset endpoint that does not exist. Rendered inside the form,
            under the field it is about, where the prototype put the link it
            replaces. */}
        <p className="text-[0.8rem] leading-relaxed text-store-body">{t('auth.passwordHelp')}</p>
        {/* Overrides ride on `cn`'s tailwind-merge, so these win over the
            variant's own utilities deterministically. `outline` is deliberately
            untouched: `index.css` gives every `<button>` its focus ring in
            `@layer base`, and setting `outline` here would silently remove it. */}
        <Button
          type="submit"
          variant="primary"
          className="mt-1 h-12 rounded-full bg-store-accent text-[0.95rem] font-bold text-store-on-accent hover:bg-store-accent-hover"
        >
          {t('auth.signIn')}
        </Button>
      </form>

      {googleClient && (
        <>
          <div className="flex items-center gap-inline text-sm text-store-faint">
            {/* The storefront hairline, not the admin Separator: its colour is
                an admin token this page no longer speaks. */}
            <div aria-hidden className="h-px flex-1 bg-store-rule" />
            <span>{t('auth.or')}</span>
            <div aria-hidden className="h-px flex-1 bg-store-rule" />
          </div>

          {/* A full-page navigation, not a react-router one: this leaves the app
              for accounts.google.com and comes back to /auth/loading as a fresh
              document. `beginGoogleSignIn` stores the state/nonce handshake that
              the return trip is checked against. */}
          <Button
            type="button"
            variant="secondary"
            className="h-12 rounded-full border-store-control bg-store-surface text-[0.9rem] font-bold text-store-fg"
            onClick={() => window.location.assign(beginGoogleSignIn(googleClient, window.location.origin))}
          >
            {t('auth.continueWithGoogle')}
          </Button>
        </>
      )}
    </AuthShell>
  )
}
