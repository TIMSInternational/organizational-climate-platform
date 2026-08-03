import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { acceptInvitation } from '../api/acceptInvitation'
import { setToken } from '../../../auth/token'
import { decodeJwtPayload } from '../../../auth/jwt'
import { resolvePostAcceptRoute } from './postAcceptRoute'
import { useTranslation } from '../../../i18n'

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
        // No admin page this role can load yet -- stay put and confirm success
        // instead of navigating into a route that will 403 on its first fetch.
        setAccountCreated(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  if (accountCreated) {
    return (
      <div>
        <h1>{t('auth.accountCreated')}</h1>
        <p>{t('auth.accountCreatedDetail')}</p>
      </div>
    )
  }

  return (
    <div>
      <h1>{t('auth.acceptInvitation')}</h1>
      <form onSubmit={handleSubmit}>
        {error && <p role="alert">{error}</p>}
        <label>
          {t('auth.emailForShareableLink')}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {t('users.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {t('auth.password')}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        <button type="submit" disabled={submitting}>{submitting ? t('auth.creatingAccount') : t('auth.createAccount')}</button>
      </form>
    </div>
  )
}
