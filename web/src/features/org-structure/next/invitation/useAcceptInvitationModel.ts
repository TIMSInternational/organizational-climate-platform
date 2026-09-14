import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from '../../../../i18n'
import { setToken } from '../../../../auth/token'
import { decodeJwtPayload } from '../../../../auth/jwt'
import { acceptInvitation } from '../../api/acceptInvitation'
import { resolvePostAcceptRoute } from '../../pages/postAcceptRoute'
import { acceptInvitationFailure, type AcceptInvitationFailure } from './derive'

export interface AcceptInvitationModel {
  email: string
  name: string
  password: string
  setEmail: (value: string) => void
  setName: (value: string) => void
  setPassword: (value: string) => void
  /** True while the accept request is in flight; the page shows the interstitial. */
  submitting: boolean
  /**
   * The server's own words for the last refusal, or `null`. Only ever rendered on the
   * unresolved branch — every named failure has a sentence in both catalogues.
   */
  serverMessage: string | null
  /** How the last refusal should be drawn, or `null` when nothing has been refused. */
  failure: AcceptInvitationFailure | null
  /**
   * Set when the account was created but the token names no company at all, so there is
   * no page to navigate to.
   */
  accountCreated: boolean
  submit: () => Promise<void>
}

/**
 * The wiring seam of `/accept-invitation/:token`.
 *
 * ## The success branch, and why it is still here
 *
 * `resolvePostAcceptRoute` has a destination for every role — `/dashboard`, the same page
 * a login lands on, including for a role string this client does not recognise. So the
 * only thing left in that branch is the token whose claims carry **no company at all**,
 * and for that, confirming success in place still beats navigating into a page that will
 * 403 on its first fetch.
 *
 * ## The refusal branch
 *
 * The server's message is kept and classified rather than rendered directly
 * (`derive.ts`). The three refusals the artboard names replace the form; everything else
 * leaves it standing, which is what the page did for every refusal before.
 */
export function useAcceptInvitationModel(token: string | undefined): AcceptInvitationModel {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [serverMessage, setServerMessage] = useState<string | null>(null)
  const [failure, setFailure] = useState<AcceptInvitationFailure | null>(null)
  const [accountCreated, setAccountCreated] = useState(false)

  const submit = useCallback(async () => {
    if (!token) return
    setServerMessage(null)
    setFailure(null)
    setSubmitting(true)
    try {
      const jwt = await acceptInvitation(baseUrl, token, {
        email: email || undefined,
        name,
        password,
      })
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
      const message = err instanceof Error ? err.message : t('errors.generic')
      setServerMessage(message)
      setFailure(acceptInvitationFailure(message))
    } finally {
      setSubmitting(false)
    }
  }, [baseUrl, email, name, navigate, password, t, token])

  return {
    email,
    name,
    password,
    setEmail,
    setName,
    setPassword,
    submitting,
    serverMessage,
    failure,
    accountCreated,
    submit,
  }
}
