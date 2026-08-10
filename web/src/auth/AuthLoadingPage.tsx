import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { AuthRequestError, googleLogin } from './api'
import { AuthPending } from './AuthPending'
import { pageWorthyReason } from './authReason'
import { clearGoogleHandshake, peekGoogleHandshake, readGoogleCallback } from './googleOAuth'
import { setToken } from './token'
import { resolveInitialRoute } from '../app/resolveInitialRoute'
import { useTranslation } from '../i18n'

/**
 * `/auth/loading` — the OAuth round-trip interstitial (#81).
 *
 * ## What actually lands here
 *
 * This is the `redirect_uri` handed to Google by `beginGoogleSignIn`. The browser
 * arrives from `accounts.google.com` with the ID token in the URL fragment, and
 * this page's whole job is the part of sign-in that happens after the user is
 * done: validate the callback, exchange the token at `POST /auth/google`, and
 * route by role. It renders `AuthPending` throughout, so the wait between Google
 * and our own API is a stated state rather than a blank page.
 *
 * Until this existed the loading state was a component with nothing routed in
 * front of it, and `#81`'s "Google sign-in shows the loading interstitial" had no
 * producer at all — see `googleOAuth.ts`.
 *
 * ## Every exit, and why
 *
 * - **ok** → `resolveInitialRoute()`, which is `/dashboard` for every role since
 *   #132. This page does not read the role claim to decide that: `DashboardPage`
 *   dispatches on the role itself and no role 403s there, which matters here
 *   because a Google user is minted `Roles.Employee` — the narrowest role there is,
 *   and the one an unconditional admin landing page would have 403'd.
 * - **absent** → `/login`. No token and no error means nobody came back from
 *   anywhere; somebody typed the URL. An error page for that would be a lie, and
 *   the same shape as `AuthSuccessPage`'s no-token redirect.
 * - **denied** → `/auth/error?reason=google-signin`, worded as a cancellation.
 * - **mismatch** → the same page, worded as a request this browser did not make.
 *   This is the security-relevant branch: a `state` or `nonce` that does not match
 *   the stored handshake is someone else's token, and it must never be exchanged.
 * - **403 / 503 from the exchange** → the platform reasons, identical to
 *   `LoginPage`, because it is the same `CheckSystemSettingsGateAsync` refusing.
 * - **404 from the exchange** → `google-signin`, carrying the server's own message.
 *   Since #280 `/auth/google` no longer provisions a company for an unknown email
 *   domain; it answers 404 with the same "no company for this domain" text
 *   `SignupAsync` uses. That is not a platform condition and not something a retry
 *   fixes, so it stays a Google-sign-in failure rather than becoming a page-worthy
 *   platform reason — but the message has to survive, because it is the only thing
 *   that tells the user *why*.
 *
 * ## Why the effect is fenced with a ref, and why the handshake is peeked
 *
 * The handshake is consumed only after the callback parses as something other than
 * `absent` — see `peekGoogleHandshake`. React 19 StrictMode mounts effects twice in
 * development, and a second run that found storage empty would report a mismatch on
 * a sign-in that was working. The ref makes the exchange happen once per mount,
 * which is also what stops a re-render mid-flight from issuing a second
 * `POST /auth/google`.
 */
export default function AuthLoadingPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    // Read from the router's location rather than `window.location` so the page is
    // driven by the same URL the router resolved, and so a test can mount it at a
    // callback URL without touching globals.
    // Peek rather than take: a bare visit to this route (bookmark, back button, a
    // link someone shared) must not destroy a handshake that is still waiting for
    // its real redirect. The handshake is consumed only once we know something
    // actually came back to judge.
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

    // No cleanup that cancels the in-flight exchange: under StrictMode the ref
    // fence means the second mount does NOT restart it, so a cleanup that flipped
    // a `cancelled` flag would abandon the only attempt and leave the page
    // spinning forever. `navigate` after an unmount is a no-op on the router.
    //
    // The dependency list is honest rather than empty — `started` is what makes
    // this run once, not `[]`. The URL cannot change while this page is mounted,
    // and a `t` identity change (someone switching language mid-flight) hits the
    // fence rather than re-exchanging a handshake that is already consumed.
  }, [location.hash, location.search, navigate, t])

  return <AuthPending label={t('auth.completingSignIn')} />
}
