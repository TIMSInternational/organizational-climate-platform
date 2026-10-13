import { describe, it, expect } from 'vitest'
import { tokenFor } from '../test/jwtFixture'
import {
  MAX_WARNING_LEAD_MS,
  MIN_REFRESH_INTERVAL_MS,
  NOMINAL_WINDOW_MS,
  readSessionClock,
  secondsRemaining,
  sessionPhase,
  shouldRefreshOnInteraction,
  warningLeadMs,
  windowLengthMs,
} from './idleSession'

const SECOND = 1_000
const MINUTE = 60 * SECOND

/** A token minted `windowMinutes` ago-to-now, as the API mints it: whole epoch seconds. */
function clockFor(nowMs: number, windowMs: number, elapsedMs = 0) {
  const issuedAtMs = nowMs - elapsedMs
  return { issuedAtMs, expiresAtMs: issuedAtMs + windowMs }
}

describe('readSessionClock', () => {
  const now = 1_760_000_000_000

  it('reads exp and iat off the token in milliseconds', () => {
    const token = tokenFor({ iat: now / 1000, exp: now / 1000 + 3600 })

    expect(readSessionClock(token)).toEqual({ issuedAtMs: now, expiresAtMs: now + 60 * MINUTE })
  })

  it('is null when there is no token or no exp to count down to', () => {
    // Not an expiry — the app must not invent a deadline for a token that declares none.
    // Every token this API mints carries exp (JwtTokenServiceTests asserts it), so this is
    // the legacy climate-tracking shape and a malformed value.
    expect(readSessionClock(null)).toBeNull()
    expect(readSessionClock(tokenFor({ role: 'employee' }))).toBeNull()
    expect(readSessionClock(tokenFor({ exp: 'soon' }))).toBeNull()
    expect(readSessionClock('not-a-jwt')).toBeNull()
  })

  it('assumes the shipped default window when a token carries exp but no iat', () => {
    const clock = readSessionClock(tokenFor({ exp: now / 1000 }))

    expect(clock).toEqual({ issuedAtMs: now - NOMINAL_WINDOW_MS, expiresAtMs: now })
    expect(windowLengthMs(clock!)).toBe(NOMINAL_WINDOW_MS)
  })
})

describe('the warning lead', () => {
  it('is a minute on the shipped 60-minute window', () => {
    expect(warningLeadMs(clockFor(0, 60 * MINUTE))).toBe(MAX_WARNING_LEAD_MS)
    expect(MAX_WARNING_LEAD_MS).toBe(MINUTE)
  })

  it('is a quarter of a short window rather than most of it', () => {
    // A super admin may set the timeout to two minutes. A one-minute warning would then be
    // up for half the session, which is not a warning.
    expect(warningLeadMs(clockFor(0, 2 * MINUTE))).toBe(30 * SECOND)
    expect(warningLeadMs(clockFor(0, 20 * SECOND))).toBe(5 * SECOND)
  })
})

describe('sessionPhase', () => {
  const now = 1_760_000_000_000

  it('is active for most of the window and warning only at the end', () => {
    const clock = clockFor(now, 60 * MINUTE)

    expect(sessionPhase(clock, now)).toBe('active')
    expect(sessionPhase(clock, now + 58 * MINUTE)).toBe('active')
    expect(sessionPhase(clock, now + 59 * MINUTE)).toBe('warning')
    expect(sessionPhase(clock, now + 60 * MINUTE - SECOND)).toBe('warning')
  })

  it('is expired at the deadline, not a tick after it', () => {
    const clock = clockFor(now, 60 * MINUTE)

    expect(sessionPhase(clock, now + 60 * MINUTE)).toBe('expired')
    expect(sessionPhase(clock, now + 90 * MINUTE)).toBe('expired')
  })

  it('counts down in whole seconds and never below zero', () => {
    const clock = clockFor(now, 60 * MINUTE)

    expect(secondsRemaining(clock, now + 59 * MINUTE + 30 * SECOND)).toBe(30)
    expect(secondsRemaining(clock, now + 61 * MINUTE)).toBe(0)
  })
})

describe('shouldRefreshOnInteraction', () => {
  const now = 1_760_000_000_000

  it('ignores an interaction in the first half of the window', () => {
    // The debounce that matters least and costs most: a refresh buys a whole window, so
    // sliding one that is 29 minutes from expiry is a request for nothing.
    expect(
      shouldRefreshOnInteraction({
        clock: clockFor(now, 60 * MINUTE, 29 * MINUTE),
        nowMs: now,
        lastAttemptMs: null,
      }),
    ).toBe(false)
  })

  it('slides the window once half of it has been consumed', () => {
    expect(
      shouldRefreshOnInteraction({
        clock: clockFor(now, 60 * MINUTE, 31 * MINUTE),
        nowMs: now,
        lastAttemptMs: null,
      }),
    ).toBe(true)
  })

  it('does not fire twice within the minimum interval', () => {
    const clock = clockFor(now, 60 * MINUTE, 31 * MINUTE)

    expect(
      shouldRefreshOnInteraction({ clock, nowMs: now, lastAttemptMs: now - MIN_REFRESH_INTERVAL_MS + SECOND }),
    ).toBe(false)
    expect(
      shouldRefreshOnInteraction({ clock, nowMs: now, lastAttemptMs: now - MIN_REFRESH_INTERVAL_MS }),
    ).toBe(true)
  })

  it('refuses to refresh a token that is already dead', () => {
    // Presenting it would be a 401, which signs the reader out a moment before the
    // countdown would have — the same destination, reached by a worse route.
    expect(
      shouldRefreshOnInteraction({
        clock: clockFor(now, 60 * MINUTE, 61 * MINUTE),
        nowMs: now,
        lastAttemptMs: null,
      }),
    ).toBe(false)
  })
})
