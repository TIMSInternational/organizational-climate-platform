import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { AuthRequestError, googleLogin } from '../api'
import { pageWorthyReason } from '../authReason'
import { clearGoogleHandshake, peekGoogleHandshake, readGoogleCallback } from '../googleOAuth'
import { setToken } from '../token'
import { resolveInitialRoute } from '../../app/resolveInitialRoute'
import { useTranslation } from '../../i18n'
import { AuthTransitionCard } from './AuthTransitionCard'

/**
 * `/auth/loading` — the AuthTransition artboard, which replaced `AuthLoadingPage` on this
 * route.
 *
 * ## What lands here
 *
 * This is the `redirect_uri` handed to Google by `beginGoogleSignIn`. The browser arrives
 * from `accounts.google.com` with the ID token in the URL fragment, and the page's whole
 * job is the part of sign-in that happens after the person is done: validate the callback,
 * exchange the token at `POST /auth/google`, and route by role. The card is on screen
 * throughout, so the gap between Google and our own API is a stated state rather than a
 * blank page.
 *
 * ## Every exit, and why
 *
 * - **ok** → `resolveInitialRoute()`, `/dashboard` for every role since #132. This page
 *   does not read the role claim to decide that, which matters because a Google user is
 *   minted `Roles.Employee` — the narrowest role there is, and the one an unconditional
 *   admin landing page would have 403'd.
 * - **absent** → `/login`. No token and no error means nobody came back from anywhere;
 *   somebody typed the URL. An error page for that would be a lie.
 * - **denied** → `/auth/error?reason=google-signin`, worded as a cancellation.
 * - **mismatch** → the same page, worded as a request this browser did not make. This is
 *   the security-relevant branch: a `state` or `nonce` that does not match the stored
 *   handshake is someone else's token and must never be exchanged.
 * - **403 / 503 from the exchange** → the platform reasons, identical to the sign-in form,
 *   because it is the same `CheckSystemSettingsGateAsync` refusing.
 * - **anything else from the exchange** → `google-signin`, carrying the server's own
 *   message. Since #280 `/auth/google` answers 404 for an address whose domain no company
 *   has registered; that is not a platform condition and not something a retry fixes, but
 *   the message has to survive because it is the only thing that says *why*.
 *
 * ## Why the effect is fenced with a ref, and why the handshake is peeked
 *
 * The handshake is consumed only after the callback parses as something other than
 * `absent`. React 19 StrictMode mounts effects twice in development, and a second run that
 * found storage empty would report a mismatch on a sign-in that was working. The ref makes
 * the exchange happen once per mount, which is also what stops a re-render mid-flight from
 * issuing a second `POST /auth/google`. Peek rather than take, so a bare visit to this
 * route — a bookmark, the back button — does not destroy a handshake still waiting for its
 * real redirect.
 */
export default function AuthTransitionNextPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const callback = readGoogleCallback(location.hash, location.search, peekGoogleHandshake())

    if (callback.status === 'absent') {
      navigate('/login', { replace: true })
      return
    }

    clearGoogleHandshake()

    if (callback.status !== 'ok') {
      const message = callback.status === 'denied' ? t('auth.googleCancelled') : t('auth.googleMismatch')
      navigate('/auth/error?reason=google-signin', { replace: true, state: { message } })
      return
    }

    async function exchange(idToken: string) {
      try {
        const baseUrl = import.meta.env.VITE_API_BASE_URL as string
        const { token } = await googleLogin(baseUrl, idToken)
        setToken(token)
        navigate(resolveInitialRoute(), { replace: true })
      } catch (err) {
        const status = err instanceof AuthRequestError ? err.status : 0
        const message = err instanceof Error && err.message ? err.message : t('errors.generic')
        const reason = pageWorthyReason(status) ?? 'google-signin'
        navigate(`/auth/error?reason=${reason}`, { replace: true, state: { message } })
      }
    }

    void exchange(callback.idToken)

    // No cleanup that cancels the in-flight exchange: under StrictMode the ref fence means
    // the second mount does NOT restart it, so a cleanup flipping a `cancelled` flag would
    // abandon the only attempt and leave the page waiting forever. `navigate` after an
    // unmount is a no-op on the router. The dependency list is honest rather than empty —
    // `started` is what makes this run once, not `[]`.
  }, [location.hash, location.search, navigate, t])

  return <AuthTransitionCard detail={t('auth.next.transitionGoogle')} />
}
