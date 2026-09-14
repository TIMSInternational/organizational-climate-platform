/**
 * "Sign in and come back here."
 *
 * ## Why this exists
 *
 * The MicroclimateInvitationStates artboard (10 Sep) draws one card whose whole action is
 * "Iniciar sesión y volver aquí": an invitation to a pulse that records who takes part,
 * opened by a browser with no session. Until this module, `LoginPage` navigated to
 * `resolveInitialRoute()` unconditionally, so the promise in that label could not be kept
 * — the respondent landed on `/dashboard` and had to go back to their email for the link.
 *
 * ## Why the guard is here and not at the call site
 *
 * A destination handed to `navigate()` after a successful sign-in is an open-redirect
 * shape, and the page that *reads* it is the one that has to be safe, not the page that
 * wrote it. `react-router`'s `location.state` is not attacker-controlled in the way a
 * query parameter is — it lives in the history entry rather than in the URL — but
 * `window.history.pushState` can put any JSON there, so the value is validated as
 * untrusted input rather than trusted for its provenance.
 *
 * Accepted: a single absolute in-app path. Rejected, in order: a non-object state, a
 * non-string `from`, anything not starting with `/`, `//host` (protocol-relative, which
 * IS another origin), and a backslash (which some browsers normalise to `/`, so `/\evil`
 * would otherwise slip through as protocol-relative).
 */

/**
 * The in-app path stored on a `location.state`, or `null` when there is nothing safe to
 * return to.
 */
export function safeReturnPath(state: unknown): string | null {
  if (state === null || typeof state !== 'object') return null
  const raw: unknown = (state as Record<string, unknown>).from
  if (typeof raw !== 'string') return null
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null
  return raw
}

/** The `state` a link passes to `/login` so that signing in returns to `path`. */
export function returnTo(path: string): { from: string } {
  return { from: path }
}
