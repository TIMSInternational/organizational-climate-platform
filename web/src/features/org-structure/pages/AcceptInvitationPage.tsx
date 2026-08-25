import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { CheckCircle2Icon } from 'lucide-react'
import { acceptInvitation } from '../api/acceptInvitation'
import { setToken } from '../../../auth/token'
import { decodeJwtPayload } from '../../../auth/jwt'
import { AuthShell } from '../../../auth/AuthShell'
import { AuthPending } from '../../../auth/AuthPending'
import { resolvePostAcceptRoute } from './postAcceptRoute'
import { useTranslation } from '../../../i18n'
import { Alert, AlertDescription, Button, TextField } from '../../../components/ui'

/** `SystemSettings.PasswordPolicy.MinLength` defaults to 8; the server is authoritative. */
const DEFAULT_MIN_PASSWORD_LENGTH = 8

/**
 * Accept an invitation and set a password.
 *
 * ## Why it moved into `AuthShell` (#81)
 *
 * This is an unauthenticated page in the same flow as sign-in and registration,
 * and it looked nothing like either of them. It is also the *only* way most users
 * of this product are created — the self-service `/register` path works solely
 * for email domains a company has already registered — so it is the page a demo
 * is most likely to walk through.
 *
 * ## The success branch, and why it is still here
 *
 * `resolvePostAcceptRoute` has a destination for every role since #138 —
 * `/dashboard`, the same page a login lands on, including for a role string this
 * client does not recognise. So the only thing left in this branch is the token
 * whose claims carry **no company at all**, and for that, confirming success in
 * place still beats navigating into a page that will 403 on its first fetch.
 */
export default function AcceptInvitationPage() {
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [accountCreated, setAccountCreated] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!token) return
    setError(null)
    setSubmitting(true)
    try {
      const jwt = await acceptInvitation(baseUrl, token, { email: email || undefined, name, password })
      setToken(jwt)

      const claims = decodeJwtPayload(jwt)
      const role = typeof claims?.role === 'string' ? claims.role : undefined
      const companyId = typeof claims?.companyId === 'string' ? claims.companyId : undefined
      const destination = resolvePostAcceptRoute(role, companyId)

      if (destination) {
        navigate(destination)
      } else {
        // No page this role can load -- stay put and confirm success instead of
        // navigating into a route that will 403 on its first fetch.
        setAccountCreated(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  if (submitting) {
    return <AuthPending label={t('auth.creatingAccount')} />
  }

  if (accountCreated) {
    return (
      <AuthShell
        title={t('auth.accountCreated')}
        description={t('auth.accountCreatedDetail')}
        banner={<CheckCircle2Icon aria-hidden="true" className="size-6 text-accent-green" />}
        footer={<Link to="/login">{t('auth.backToSignIn')}</Link>}
      >
        <p className="text-sm text-fg-secondary">{t('auth.accountCreatedRoleNote')}</p>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title={t('auth.acceptInvitation')}
      description={t('auth.acceptInvitationDetail')}
      footer={
        <>
          <span className="text-fg-secondary">{t('auth.alreadyHaveAccount')}</span>
          <Link to="/login">{t('auth.signIn')}</Link>
        </>
      }
    >
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form className="grid gap-panel-gap" onSubmit={handleSubmit}>
        {/* Optional: a personal invitation already carries the address, and only
            a shareable link needs one supplied. */}
        <TextField
          label={t('auth.emailForShareableLink')}
          type="email"
          value={email}
          onChange={setEmail}
        />
        <TextField label={t('users.name')} value={name} required onChange={setName} />
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
