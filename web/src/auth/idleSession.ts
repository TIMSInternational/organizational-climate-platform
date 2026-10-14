import { decodeJwtPayload } from './jwt'

/**
 * The pure rules behind the idle session timeout: no React, no timers, no storage, so the
 * arithmetic that decides when somebody is signed out can be tested directly.
 *
 * ## The server owns the deadline; this only reads it
 *
 * `SystemSettings.SessionTimeoutMinutes` is the lifetime of the token
 * (`SessionWindows.Next` → `JwtTokenService`), so `exp` already *is* the idle deadline and
 * there is nothing for the client to compute or configure. That ordering matters: a
 * client-side screen lock over a 24-hour token would hide an idle session rather than end
 * one, and the bearer token in an unattended browser would still work. The countdown here
 * is only so the deadline does not arrive without warning.
 *
 * ## Why a refresh is tied to interaction and not to requests
 *
 * This is the crux of the whole feature. Several screens poll — notifications, the tracking
 * dashboard — so refreshing on every API call would keep a token alive for as long as the
 * tab is open, which is exactly the session an idle timeout exists to end. An abandoned
 * kiosk would never time out and the feature would be decorative. The window therefore
 * slides on evidence of a *person*: a pointer press, a key, a wheel, a touch.
 */

/** `exp` and `iat` of the held token, in milliseconds. */
export interface SessionClock {
  issuedAtMs: number
  expiresAtMs: number
}

export type IdleSessionPhase = 'active' | 'warning' | 'expired'

/** The longest warning the reader gets, however long the window is. */
export const MAX_WARNING_LEAD_MS = 60_000

/**
 * The shortest gap between two refresh calls.
 *
 * Without it, a `pointerdown` listener on `document` would fire a `POST /auth/refresh` per
 * click — hundreds per session, every one of them a database read and a signature — for no
 * gain, since a refresh already buys a whole idle window.
 */
export const MIN_REFRESH_INTERVAL_MS = 30_000

/**
 * The window to assume when a token carries `exp` but no `iat`.
 *
 * Every token this API mints carries both, asserted in `JwtTokenServiceTests`. A token
 * without `iat` is one the legacy climate-tracking application minted against the shared
 * `TrackingJwtSecret`, and the warning lead has to come from somewhere; the shipped
 * `SessionTimeoutMinutes` default is the honest guess.
 */
export const NOMINAL_WINDOW_MS = 60 * 60_000

/** `exp`/`iat` off the held token, or `null` when there is no deadline to count down to. */
export function readSessionClock(token: string | null): SessionClock | null {
  if (!token) return null

  const claims = decodeJwtPayload(token)
  const exp = claims?.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null

  const iat = claims?.iat
  const expiresAtMs = exp * 1000
  return {
    expiresAtMs,
    issuedAtMs:
      typeof iat === 'number' && Number.isFinite(iat) ? iat * 1000 : expiresAtMs - NOMINAL_WINDOW_MS,
  }
}

/** How long the token was minted for. Never negative. */
export function windowLengthMs(clock: SessionClock): number {
  return Math.max(0, clock.expiresAtMs - clock.issuedAtMs)
}

/**
 * How long before the deadline the warning appears.
 *
 * A minute, unless the window is short enough that a minute would mean warning for most of
 * it: a super admin may set the timeout to 2 minutes, and a warning that is up the whole
 * time is not a warning. A quarter of the window is the floor on that.
 */
export function warningLeadMs(clock: SessionClock): number {
  return Math.min(MAX_WARNING_LEAD_MS, windowLengthMs(clock) / 4)
}

export function sessionPhase(clock: SessionClock, nowMs: number): IdleSessionPhase {
  if (nowMs >= clock.expiresAtMs) return 'expired'
  return clock.expiresAtMs - nowMs <= warningLeadMs(clock) ? 'warning' : 'active'
}

/** Whole seconds left before the session ends, floored at 0. */
export function secondsRemaining(clock: SessionClock, nowMs: number): number {
  return Math.max(0, Math.ceil((clock.expiresAtMs - nowMs) / 1000))
}

export interface RefreshDecision {
  clock: SessionClock
  nowMs: number
  /** When a refresh was last ATTEMPTED, or `null` if none has been. */
  lastAttemptMs: number | null
}

/**
 * Whether an interaction right now should slide the window.
 *
 * Half the window is deliberately not "as late as possible": a refresh has to land before
 * `exp`, and a person who is working steadily should never see the warning at all. Half is
 * also what makes the debounce cheap — at a 60-minute timeout an active session refreshes
 * about twice an hour, not twice a minute.
 */
export function shouldRefreshOnInteraction({ clock, nowMs, lastAttemptMs }: RefreshDecision): boolean {
  // Nothing to extend: the token is already dead, and asking for a new one with it would be
  // a 401 that signs the user out a moment before the countdown would have.
  if (nowMs >= clock.expiresAtMs) return false

  const window = windowLengthMs(clock)
  if (window <= 0) return false

  if (nowMs - clock.issuedAtMs < window / 2) return false

  return lastAttemptMs === null || nowMs - lastAttemptMs >= MIN_REFRESH_INTERVAL_MS
}
