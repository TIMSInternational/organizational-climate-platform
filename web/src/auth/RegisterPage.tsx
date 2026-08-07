import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthRequestError, signup } from './api'
import { AuthShell } from './AuthShell'
import { AuthPending } from './AuthPending'
import { pageWorthyReason } from './authReason'
import { setToken } from './token'
import { useTranslation } from '../i18n'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  TextField,
} from '../components/ui'

/** `SystemSettings.PasswordPolicy.MinLength` defaults to 8; the server is authoritative. */
const DEFAULT_MIN_PASSWORD_LENGTH = 8

/**
 * Self-service registration (#81).
 *
 * ## There *is* a register endpoint, and this is what it does
 *
 * `POST /auth/signup` takes `{ name, email, password }` and returns `201
 * { token }`. The company is **derived from the email domain** —
 * `Companies.FirstOrDefault(c => c.EmailDomain == email.split('@')[1])` — the role
 * is hardcoded `Roles.Employee`, and there is no approval step. #81 asks for the
 * company-association rule to be made explicit; it is already decided in code, so
 * what this page adds is *saying so* before the user submits, rather than
 * inventing a company picker the endpoint would ignore.
 *
 * ## The 404 is the invitation-only branch, not an error
 *
 * When no company matches the domain the server answers **404** with "No company
 * found for this email domain. Please contact your administrator for an
 * invitation." That is the product's actual onboarding rule — users are created
 * by invitation (`/accept-invitation/:token`) unless their employer's domain is
 * already registered. Rendering it as a red "request failed" would describe a
 * working system as broken, so it gets its own panel with the invitation route
 * spelled out, and the form stays filled in behind it.
 *
 * ## What stays on the form and what takes the page
 *
 * 400 (validation), 409 (email exists) and the 404 above are about this attempt
 * and stay here. 403 (sign-in disabled) and 503 (maintenance) are platform
 * conditions no amount of retyping fixes, so they route to `/auth/error` —
 * see `authReason.ts`.
 */
export default function RegisterPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Held apart from `error` on purpose: this is a routing outcome ("you need an
  // invitation"), not a failure, and it is rendered as guidance rather than an alert.
  const [needsInvitation, setNeedsInvitation] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const domain = email.includes('@') ? email.split('@')[1] : ''

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNeedsInvitation(null)
    setSubmitting(true)
    try {
      const { token } = await signup(baseUrl, { name, email, password })
      setToken(token)
      // The success state reads the new account's own claims, so it is navigated
      // to rather than passed anything: the token is the source of truth for who
      // was just created and which company they landed in.
      navigate('/auth/success', { replace: true })
    } catch (err) {
      const status = err instanceof AuthRequestError ? err.status : 0
      const message = err instanceof Error && err.message ? err.message : t('errors.generic')

      const reason = pageWorthyReason(status)
      if (reason) {
        navigate(`/auth/error?reason=${reason}`, { state: { message } })
        return
      }

      if (status === 404) {
        setNeedsInvitation(message)
      } else {
        setError(message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (submitting) {
    return <AuthPending label={t('auth.creatingAccount')} />
  }

  return (
    <AuthShell
      title={t('auth.createAccount')}
      description={t('auth.registerDetail')}
      footer={
        <>
          <span className="text-fg-secondary">{t('auth.alreadyHaveAccount')}</span>
          <Link to="/login">{t('auth.signIn')}</Link>
        </>
      }
    >
      {needsInvitation && (
        <Alert variant="info" role="status">
          <AlertTitle>{t('auth.invitationRequiredTitle')}</AlertTitle>
          <AlertDescription>
            {/* The server's own sentence first — it names the rule — then what to
                do about it, which the server has no way to know. */}
            <p>{needsInvitation}</p>
            <p>{t('auth.invitationRequiredDetail')}</p>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form className="grid gap-panel-gap" onSubmit={handleSubmit}>
        <TextField
          label={t('users.name')}
          value={name}
          required
          onChange={setName}
        />
        <TextField
          label={t('auth.email')}
          type="email"
          value={email}
          required
          placeholder={t('auth.emailPlaceholder')}
          description={
            // The one rule about this endpoint a user cannot otherwise see: which
            // company they are about to join, and that they do not get to choose.
            domain ? t('auth.companyFromDomain', { domain }) : t('auth.companyFromDomainHint')
          }
          onChange={setEmail}
        />
        <TextField
          label={t('auth.password')}
          type="password"
          value={password}
          required
          placeholder={t('auth.passwordPlaceholder')}
          description={t('validation.passwordTooShort')}
          onChange={setPassword}
        />

        <Button
          type="submit"
          variant="primary"
          disabled={password.length > 0 && password.length < DEFAULT_MIN_PASSWORD_LENGTH}
        >
          {t('auth.createAccount')}
        </Button>
      </form>
    </AuthShell>
  )
}
