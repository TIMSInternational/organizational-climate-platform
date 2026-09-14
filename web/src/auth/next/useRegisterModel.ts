import { useCallback, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { AuthRequestError, signup } from '../api'
import { setToken } from '../token'
import { useTranslation } from '../../i18n'
import { domainOf, meetsPasswordPolicy, registerOutcome } from './derive'

export interface RegisterModel {
  name: string
  email: string
  password: string
  setName: (value: string) => void
  setEmail: (value: string) => void
  setPassword: (value: string) => void
  /** The part after the `@`, which is what decides the organisation. `null` until there is one. */
  domain: string | null
  /** False while the password cannot satisfy the shipped policy, so the button is not offered. */
  passwordOk: boolean
  /** The 404 branch: no company has registered this domain, so an invitation is the way in. */
  needsInvitation: boolean
  /** The server's own sentence for a 400/409, which names the field it refused. */
  serverError: string | null
  submitting: boolean
  submit: (event: FormEvent) => void
}

/**
 * The wiring seam of the Register artboard: `POST /auth/signup` and the three ways it can
 * answer.
 *
 * ## The 404 is not an error and is not held in the same slot
 *
 * "No company found for this email domain" is the product's onboarding rule, not a
 * failure, so it is `needsInvitation` rather than `serverError` — a boolean, because the
 * page prints the catalogue's sentence with the typed domain named in it and never the
 * server's English one. That is the defect the artboard's annotation records ("Hoy aquí se
 * imprime la frase del servidor en inglés; la propuesta es esta frase del catálogo").
 *
 * Everything typed stays in state through all three outcomes, so none of them costs the
 * user the form.
 *
 * ## Success goes to `/auth/success`, not to the dashboard
 *
 * Signup decides two things silently — which organisation the address joined, and that the
 * new account is an Employee — and `/auth/success` is the only screen that says so. It
 * reads them back off the freshly minted token rather than being passed anything, so what
 * it shows is the account that exists rather than what the form was told.
 */
export function useRegisterModel(): RegisterModel {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [needsInvitation, setNeedsInvitation] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      setNeedsInvitation(false)
      setServerError(null)
      setSubmitting(true)

      async function run() {
        try {
          const baseUrl = import.meta.env.VITE_API_BASE_URL as string
          const { token } = await signup(baseUrl, { name, email, password })
          setToken(token)
          navigate('/auth/success', { replace: true })
        } catch (err) {
          const status = err instanceof AuthRequestError ? err.status : 0
          const message = err instanceof Error && err.message ? err.message : t('errors.generic')
          const outcome = registerOutcome(status, message)
          if (outcome.kind === 'page') {
            navigate(`/auth/error?reason=${outcome.reason}`, { state: { message } })
            return
          }
          if (outcome.kind === 'invitation') {
            setNeedsInvitation(true)
            return
          }
          setServerError(outcome.message)
        } finally {
          setSubmitting(false)
        }
      }

      void run()
    },
    [email, name, navigate, password, t],
  )

  return {
    name,
    email,
    password,
    setName,
    setEmail,
    setPassword,
    domain: domainOf(email),
    passwordOk: password.length === 0 || meetsPasswordPolicy(password),
    needsInvitation,
    serverError,
    submitting,
    submit,
  }
}
