import { useCallback, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { AuthRequestError, login } from '../api'
import { setToken } from '../token'
import { resolveInitialRoute } from '../../app/resolveInitialRoute'
import { useTranslation } from '../../i18n'
import { loginOutcome, type LoginOutcome } from './derive'

/** What the sign-in card shows above its first field, or `null` while nothing has failed. */
export type SignInError = Extract<LoginOutcome, { kind: 'form' } | { kind: 'form-server' }>

export interface SignInModel {
  email: string
  password: string
  setEmail: (value: string) => void
  setPassword: (value: string) => void
  error: SignInError | null
  submitting: boolean
  submit: (event: FormEvent) => void
}

/**
 * The wiring seam of the Login artboard: `POST /auth/login`, the token, and where a
 * failure goes.
 *
 * ## Why the triage lives in `derive.ts` and the navigation lives here
 *
 * Deciding *whether* a status belongs beside the field or on its own page is a pure
 * function of the status, and it is the thing worth a unit test. Acting on that decision
 * needs the router and the token store, which is this hook. Keeping the two apart is what
 * lets `derive.test.ts` pin every branch without a DOM.
 *
 * ## The typed email survives every failure
 *
 * `email` and `password` are held here rather than in the page, so the "your credentials
 * did not match" state re-renders the same form with what was typed still in it — the
 * artboard's own note ("el correo escrito se conserva"). A page-worthy failure navigates
 * away and takes the state with it, which is correct: nothing on that page can be fixed by
 * retyping.
 */
export function useSignInModel(): SignInModel {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<SignInError | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      setError(null)
      setSubmitting(true)

      async function run() {
        try {
          const baseUrl = import.meta.env.VITE_API_BASE_URL as string
          const { token } = await login(baseUrl, email, password)
          setToken(token)
          // `/dashboard` for every role since #132 — the page dispatches on the claim, so
          // nothing has to be decoded here to pick a destination.
          navigate(resolveInitialRoute())
        } catch (err) {
          const status = err instanceof AuthRequestError ? err.status : 0
          const message = err instanceof Error && err.message ? err.message : t('errors.generic')
          const outcome = loginOutcome(status, message)
          if (outcome.kind === 'page') {
            navigate(`/auth/error?reason=${outcome.reason}`, { state: { message } })
            return
          }
          setError(outcome)
        } finally {
          setSubmitting(false)
        }
      }

      void run()
    },
    [email, navigate, password, t],
  )

  return { email, password, setEmail, setPassword, error, submitting, submit }
}
