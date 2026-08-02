import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from './api'
import { setToken } from './token'
import { decodeJwtPayload } from './jwt'
import { resolveInitialRoute } from '../app/resolveInitialRoute'
import { useTranslation } from '../i18n'

export default function LoginPage() {
  const { t } = useTranslation()
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
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>{t('auth.signIn')}</h1>
      {error && <p role="alert">{error}</p>}
      <label>
        {t('auth.email')}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        {t('auth.password')}
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? t('auth.signingIn') : t('auth.signIn')}
      </button>
    </form>
  )
}
