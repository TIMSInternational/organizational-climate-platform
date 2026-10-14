import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { TranslationProvider } from '../i18n'
import { tokenFor } from '../test/jwtFixture'
import { clearToken, getToken, setToken } from './token'
import IdleSessionGuard, { SESSION_EXPIRED_PATH } from './IdleSessionGuard'
import { MIN_REFRESH_INTERVAL_MS } from './idleSession'

const SECOND = 1_000
const MINUTE = 60 * SECOND

/**
 * The idle session timeout as the reader meets it: a warning, a way to stay, and an end
 * that says why.
 *
 * ## The one that is easy to get wrong
 *
 * `A_poll_does_not_keep_an_idle_session_alive` is the test this feature lives or dies by.
 * Refreshing the token on API traffic would be the obvious implementation and it would make
 * the timeout decorative: notifications and the tracking dashboard poll on a timer, so an
 * abandoned kiosk would stay signed in for as long as the tab was open. The guard therefore
 * listens for a *person*, and nothing in `authFetch` touches it.
 */
function renderGuard() {
  return render(
    <TranslationProvider initialLocale="en">
      <IdleSessionGuard />
    </TranslationProvider>,
  )
}

/** A token shaped like the API's: whole epoch seconds for both claims. */
function sessionToken(issuedAtMs: number, windowMs: number) {
  return tokenFor({
    role: 'employee',
    iat: Math.floor(issuedAtMs / 1000),
    exp: Math.floor((issuedAtMs + windowMs) / 1000),
  })
}

describe('IdleSessionGuard', () => {
  let assign: ReturnType<typeof vi.spyOn>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-13T08:00:00.000Z'))
    assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    clearToken()
  })

  afterEach(() => {
    cleanup()
    // `mockRestore` on the spy itself, not `restoreAllMocks`: the latter does not undo a spy
    // installed on an instance, which this codebase has been bitten by before.
    assign.mockRestore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    clearToken()
  })

  function okRefresh(windowMs: number) {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ token: sessionToken(Date.now(), windowMs) }), { status: 200 }),
      ),
    )
  }

  it('says nothing for most of the window', () => {
    setToken(sessionToken(Date.now(), 60 * MINUTE))
    renderGuard()

    act(() => {
      vi.advanceTimersByTime(30 * MINUTE)
    })

    expect(screen.queryByText('Are you still there?')).toBeNull()
    expect(assign).not.toHaveBeenCalled()
  })

  it('warns before the session ends, with the seconds left', () => {
    setToken(sessionToken(Date.now(), 60 * MINUTE))
    renderGuard()

    act(() => {
      vi.advanceTimersByTime(59 * MINUTE + 30 * SECOND)
    })

    expect(screen.getByText('Are you still there?')).toBeTruthy()
    expect(screen.getByText(/this session will end in 30 seconds/)).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
  })

  it('clears the token and lands on the declared session-expired reason', async () => {
    setToken(sessionToken(Date.now(), 2 * MINUTE))
    renderGuard()

    act(() => {
      vi.advanceTimersByTime(2 * MINUTE)
    })

    expect(assign).toHaveBeenCalledWith(SESSION_EXPIRED_PATH)
    expect(SESSION_EXPIRED_PATH).toContain('reason=session-expired')

    // The token is gone, not merely unused: it is a bearer credential and the session is
    // over, so leaving it in localStorage would leave a signed-out browser holding one.
    expect(getToken()).toBeNull()
  })

  it('stays signed in when the reader says so, and the warning goes away', async () => {
    setToken(sessionToken(Date.now(), 2 * MINUTE))
    renderGuard()

    act(() => {
      vi.advanceTimersByTime(100 * SECOND)
    })
    expect(screen.getByText('Are you still there?')).toBeTruthy()

    okRefresh(2 * MINUTE)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/auth/refresh')

    // One tick, so the countdown re-reads the token the refresh just stored. `waitFor` is
    // deliberately not used anywhere in this file: it polls on timers, and under
    // `vi.useFakeTimers` those only move when the test moves them, so it waits forever.
    await act(async () => {
      vi.advanceTimersByTime(SECOND)
    })
    expect(screen.queryByText('Are you still there?')).toBeNull()
    expect(assign).not.toHaveBeenCalled()
  })

  it('ends the session immediately when the reader says so', async () => {
    setToken(sessionToken(Date.now(), 2 * MINUTE))
    renderGuard()

    act(() => {
      vi.advanceTimersByTime(100 * SECOND)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign out now' }))
    })

    expect(assign).toHaveBeenCalledWith(SESSION_EXPIRED_PATH)
    expect(getToken()).toBeNull()
    // Signing out does not ask the server for a token on the way out.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('slides the window on a real interaction', async () => {
    setToken(sessionToken(Date.now(), 60 * MINUTE))
    renderGuard()
    okRefresh(60 * MINUTE)

    act(() => {
      vi.advanceTimersByTime(40 * MINUTE)
    })
    await act(async () => {
      document.dispatchEvent(new Event('pointerdown'))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    // And the new token is held, so the countdown restarts from it rather than from the one
    // that was about to expire.
    await act(async () => {
      vi.advanceTimersByTime(30 * MINUTE)
    })
    expect(screen.queryByText('Are you still there?')).toBeNull()
    expect(assign).not.toHaveBeenCalled()
  })

  it('A_poll_does_not_keep_an_idle_session_alive', async () => {
    // The crux. Nothing but a person's own action may slide the window: an idle tab that
    // polls must still time out, or the feature is decorative.
    setToken(sessionToken(Date.now(), 2 * MINUTE))
    renderGuard()

    for (let i = 0; i < 24; i += 1) {
      // What a poller does: a request every five seconds, through the app's own fetch.
      await act(async () => {
        void fetch('https://api.test/notifications')
        vi.advanceTimersByTime(5 * SECOND)
      })
    }

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/refresh'))
    expect(refreshCalls).toHaveLength(0)
    expect(assign).toHaveBeenCalledWith(SESSION_EXPIRED_PATH)
  })

  it('a burst of clicks costs one request, not one each', async () => {
    // Note what carries this: the FIRST refresh stores a token issued now, so the later
    // clicks are in the first half of a fresh window and are not candidates at all. The
    // interval floor is what covers the case where the refresh did NOT land — the test
    // below — and `idleSession.test.ts` owns it directly.
    setToken(sessionToken(Date.now(), 60 * MINUTE))
    renderGuard()
    okRefresh(60 * MINUTE)

    act(() => {
      vi.advanceTimersByTime(40 * MINUTE)
    })

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        document.dispatchEvent(new Event('pointerdown'))
      })
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not hammer a refresh that is failing', async () => {
    // No new token lands, so every click is still a candidate on the half-window rule and
    // only the interval floor stands between a down service and a click-rate retry storm.
    setToken(sessionToken(Date.now(), 60 * MINUTE))
    renderGuard()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    act(() => {
      vi.advanceTimersByTime(40 * MINUTE)
    })
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        document.dispatchEvent(new Event('pointerdown'))
      })
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(MIN_REFRESH_INTERVAL_MS).toBeGreaterThan(0)
  })

  it('does not sign anyone out because a refresh request failed in transit', async () => {
    // A dropped connection is not an expiry. The held token is still valid and still has
    // time on it, so ending the session here would be the client inventing a refusal the
    // server never made.
    setToken(sessionToken(Date.now(), 60 * MINUTE))
    renderGuard()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    act(() => {
      vi.advanceTimersByTime(40 * MINUTE)
    })
    await act(async () => {
      document.dispatchEvent(new Event('pointerdown'))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(assign).not.toHaveBeenCalled()
    expect(getToken()).not.toBeNull()
  })

  it('ends the session when the server refuses the refresh', async () => {
    // The 401 the ceiling produces: `IssueTokenForAsync` refuses to re-mint a session more
    // than 24 hours old however active it is.
    setToken(sessionToken(Date.now(), 60 * MINUTE))
    renderGuard()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'This session has reached its maximum length.' }), {
        status: 401,
      }),
    )

    act(() => {
      vi.advanceTimersByTime(40 * MINUTE)
    })
    await act(async () => {
      document.dispatchEvent(new Event('pointerdown'))
    })

    expect(assign).toHaveBeenCalledWith(SESSION_EXPIRED_PATH)
    expect(getToken()).toBeNull()
  })

  it('does nothing at all for a token that declares no expiry', () => {
    // The legacy climate-tracking shape. Counting down to a deadline the token does not
    // state would sign people out on a guess.
    setToken(tokenFor({ role: 'employee' }))
    renderGuard()

    act(() => {
      vi.advanceTimersByTime(4 * 60 * MINUTE)
    })

    expect(assign).not.toHaveBeenCalled()
    expect(getToken()).not.toBeNull()
  })
})
