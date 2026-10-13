import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '../i18n'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui'
import { AuthRequestError, refreshSession } from './api'
import { clearToken, getToken, setToken } from './token'
import {
  readSessionClock,
  secondsRemaining,
  sessionPhase,
  shouldRefreshOnInteraction,
  type IdleSessionPhase,
  type SessionClock,
} from './idleSession'

/** Where a timed-out session lands. */
export const SESSION_EXPIRED_PATH = '/auth/error?reason=session-expired'

/**
 * The events that count as a person being present.
 *
 * `mousemove` is deliberately absent. A nudged desk, a cat, or a page that animates under
 * the cursor all produce it, and on a shared terminal — the case this feature was asked
 * for — "the mouse moved" is not evidence that the person who signed in is still there.
 * These four all require an intentional act.
 */
const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

/** How often the countdown is re-evaluated. */
const TICK_MS = 1_000

/**
 * The idle session timeout's client half: the countdown, the warning, and the sliding.
 *
 * ## What is server-enforced and what is not
 *
 * The timeout itself is **not** here. `SystemSettings.SessionTimeoutMinutes` is the
 * lifetime of the token (`SessionWindows` → `JwtTokenService`), so an idle session dies
 * whether or not this component ever runs — close the laptop, come back tomorrow, and the
 * token in `localStorage` is refused. That ordering is the point: a client-side timer over
 * a long-lived token hides an idle session instead of ending one, and the bearer token
 * would still work from anywhere.
 *
 * What this component owes the reader is that the deadline does not arrive unannounced, and
 * that a session in use does not die under them. So it does three things:
 *
 * 1. **Slides the window on real interaction**, debounced, through `POST /auth/refresh`.
 *    Not on API calls — several screens poll, and a token refreshed by a poller would keep
 *    an abandoned kiosk signed in forever, which is the whole of what this feature is for.
 * 2. **Warns** before the deadline, with a way to stay.
 * 3. **Ends it** by clearing the token and going to `/auth/error?reason=session-expired` —
 *    a reason `authReason.ts` has declared since the auth redesign with nothing in the
 *    codebase producing it.
 *
 * ## Interaction does not dismiss the warning
 *
 * While the warning is up, interaction stops sliding the window and the two buttons are the
 * only way out. Two reasons. It makes the warning an actual decision rather than something
 * a stray click dismisses before it is read — and the reader has to be able to choose *to
 * end* the session, which a click-anywhere-to-stay rule takes away by racing the button's
 * own handler.
 *
 * ## Re-read from `localStorage` on every tick
 *
 * The token is the shared state and another tab may have replaced it. Reading it each tick
 * — rather than holding the first decode — is what makes two open tabs agree: a refresh in
 * one extends the countdown in the other within a second.
 */
export default function IdleSessionGuard() {
  const { t } = useTranslation()
  const [clock, setClock] = useState<SessionClock | null>(() => readSessionClock(getToken()))
  const [phase, setPhase] = useState<IdleSessionPhase>('active')
  const [secondsLeft, setSecondsLeft] = useState(0)

  // Refs, not state: changing either must never re-render, and the interaction listener has
  // to see the current value without being re-bound on every change.
  const lastAttemptRef = useRef<number | null>(null)
  const refreshingRef = useRef(false)
  const endedRef = useRef(false)

  const endSession = useCallback(() => {
    // Once, however many ticks and listeners arrive at the same conclusion at the same
    // moment: a second navigation would cancel the first and the reader would see nothing.
    if (endedRef.current) return
    endedRef.current = true
    clearToken()
    window.location.assign(SESSION_EXPIRED_PATH)
  }, [])

  const refresh = useCallback(async () => {
    if (refreshingRef.current || endedRef.current) return
    const token = getToken()
    if (!token) return

    refreshingRef.current = true
    lastAttemptRef.current = Date.now()
    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL as string
      const { token: refreshed } = await refreshSession(baseUrl, token)
      setToken(refreshed)
      setClock(readSessionClock(refreshed))
    } catch (error) {
      // A refusal the server ANSWERED with 401 is the session being over — the window ran
      // out in flight, the 24-hour ceiling was reached, or the account was deactivated — and
      // there is no recovering from any of them.
      //
      // Anything else is not. A dropped connection, a 502 from a proxy, a CORS failure: the
      // held token is still valid and still has time on it, so signing the reader out over
      // a failed request would be this feature inventing an expiry the server never
      // declared. The countdown carries on and the next interaction tries again.
      if (error instanceof AuthRequestError && error.status === 401) {
        endSession()
      }
    } finally {
      refreshingRef.current = false
    }
  }, [endSession])

  // The countdown. Re-reads the token each tick so another tab's refresh is picked up, and
  // so a token cleared elsewhere stops the clock rather than expiring here.
  useEffect(() => {
    function tick() {
      const current = readSessionClock(getToken())
      setClock(current)
      if (!current) {
        // No deadline to count down to. Not an expiry: a signed-out-elsewhere session is
        // `RequireAuth`'s to redirect, and a token with no `exp` is one this app must not
        // claim to know the lifetime of.
        setPhase('active')
        return
      }

      const now = Date.now()
      const next = sessionPhase(current, now)
      setPhase(next)
      setSecondsLeft(secondsRemaining(current, now))
      if (next === 'expired') {
        endSession()
      }
    }

    tick()
    const timer = window.setInterval(tick, TICK_MS)
    return () => window.clearInterval(timer)
  }, [endSession])

  // The sliding half. `phase` is read through a ref-free closure on purpose: the effect
  // re-binds when it changes, which is exactly how interaction stops extending the session
  // once the warning is up.
  useEffect(() => {
    if (!clock || phase === 'warning' || phase === 'expired') return

    function onInteraction() {
      const token = getToken()
      if (!token) return
      const current = readSessionClock(token)
      if (!current) return
      if (
        shouldRefreshOnInteraction({ clock: current, nowMs: Date.now(), lastAttemptMs: lastAttemptRef.current })
      ) {
        void refresh()
      }
    }

    for (const event of INTERACTION_EVENTS) {
      // Capture, so a handler that calls `stopPropagation` on its own subtree cannot make a
      // whole region of the app stop counting as activity. Passive, because this never
      // calls `preventDefault` and a non-passive `wheel` listener on `document` would make
      // every scroll in the app wait on it.
      document.addEventListener(event, onInteraction, { capture: true, passive: true })
    }
    return () => {
      for (const event of INTERACTION_EVENTS) {
        document.removeEventListener(event, onInteraction, { capture: true })
      }
    }
  }, [clock, phase, refresh])

  return (
    <AlertDialog
      open={phase === 'warning'}
      // Escape means "I am here", not "sign me out". An `AlertDialog` does not close on an
      // outside click, so this is the only close this dialog can receive that is not one of
      // the two buttons, and the non-destructive reading of it is the right one. The Cancel
      // button routes through here too, but `endSession` has already run by then and
      // `refresh` refuses to act on an ended session.
      onOpenChange={(open) => {
        if (!open) void refresh()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('session.idleWarningTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('session.idleWarningBody', { seconds: secondsLeft })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* Sign out is the CANCEL slot and staying is the ACTION one, which is the way
              round the reader expects: the dialog is asking to keep them signed in, so the
              affirmative answer is the one that does. */}
          <AlertDialogCancel onClick={endSession}>{t('session.signOutNow')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // The dialog closes itself on this click; the refresh has to outlive that, so
              // the default close is prevented and the phase change does the closing once a
              // new token is in hand. Otherwise a failed refresh would leave the reader on a
              // dismissed warning with a dying session and nothing said.
              event.preventDefault()
              void refresh()
            }}
          >
            {t('session.staySignedIn')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
