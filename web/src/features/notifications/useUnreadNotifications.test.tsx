import { StrictMode } from 'react'
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_POLL_MS } from '../../components/charts/usePolling'
import { setToken } from '../../auth/token'
import { UNREAD_POLL_MS, useUnreadNotifications } from './useUnreadNotifications'
import { notifyNotificationsChanged } from './notificationsChanged'

const baseUrl = 'http://api.test'

/** `document.hidden` is a prototype getter in happy-dom, so it is redefined. */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
}

function row(id: string) {
  return {
    id,
    userId: 'u1',
    companyId: 'c1',
    type: 'survey_invitation',
    channel: 'in_app',
    priority: 'medium',
    status: 'sent',
    title: `Title ${id}`,
    message: `Message ${id}`,
    data: null,
    templateId: null,
    scheduledFor: '2026-08-01T09:00:00Z',
    sentAt: '2026-08-01T09:00:01Z',
    deliveredAt: null,
    openedAt: null,
    failedAt: null,
    failureReason: null,
    retryCount: 0,
    createdAt: '2026-08-01T09:00:00Z',
  }
}

function respondWith(...ids: string[]) {
  return new Response(JSON.stringify({ notifications: ids.map(row) }), { status: 200 })
}

beforeEach(() => {
  setToken('test-token')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respondWith('n1')))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  setHidden(false)
})

describe('useUnreadNotifications', () => {
  it('polls far slower than a live chart, because a bell is glanced at rather than watched', () => {
    // The interval is a decision, not a default: at usePolling's 5s ceiling this
    // would be 720 authenticated round trips per user per hour for a number that
    // changes a handful of times a day, in every open tab.
    expect(UNREAD_POLL_MS).toBe(60_000)
    expect(UNREAD_POLL_MS).toBeGreaterThan(MAX_POLL_MS)
  })

  it('asks only for unread rows', async () => {
    renderHook(() => useUnreadNotifications(baseUrl))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/notifications/mine?unreadOnly=true`, expect.anything())
  })

  it('fetches once immediately rather than waiting out the first interval', async () => {
    const { result } = renderHook(() => useUnreadNotifications(baseUrl))
    await waitFor(() => expect(result.current.count).toBe(1))
    expect(result.current.unread.map((n) => n.id)).toEqual(['n1'])
  })

  /**
   * The regression #80's browser verification found in `usePolling`: an in-flight
   * guard held in a `useRef` is shared across effect runs, so StrictMode's
   * double-mount makes the second run see the first run's outstanding request and
   * skip its own immediate fetch — leaving the bell blank for a whole interval.
   * At 60s that is a badge that is simply missing for the first minute of every
   * session, and no assertion about the *eventual* value would ever catch it.
   */
  it('still fetches immediately under StrictMode, whose double-mount re-runs the effect', async () => {
    vi.useFakeTimers()
    // Never resolves during the window under test: the second effect run has to
    // start its own request while the first one is still outstanding.
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}))

    function Harness() {
      const { count } = useUnreadNotifications(baseUrl)
      return <span>{count}</span>
    }

    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    )

    // Microtasks only -- no interval has elapsed. Both mounts must have fetched.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('re-fetches on each interval', async () => {
    vi.useFakeTimers()
    renderHook(() => useUnreadNotifications(baseUrl, 60_000))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not poll a hidden tab, and catches up at once on return', async () => {
    vi.useFakeTimers()
    setHidden(true)
    renderHook(() => useUnreadNotifications(baseUrl, 60_000))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000)
    })
    expect(fetch).not.toHaveBeenCalled()

    setHidden(false)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('re-fetches when something announces a change, which is what updates the badge without a reload', async () => {
    const { result } = renderHook(() => useUnreadNotifications(baseUrl))
    await waitFor(() => expect(result.current.count).toBe(1))

    vi.mocked(fetch).mockResolvedValue(respondWith())
    await act(async () => {
      notifyNotificationsChanged()
    })

    await waitFor(() => expect(result.current.count).toBe(0))
  })

  it('does not drop a change that lands while a poll is already in flight', async () => {
    // Without the requeue the announcement is swallowed by the in-flight guard
    // and the badge stays wrong until the next tick -- up to a minute of the bell
    // contradicting the page the user just acted on.
    let releaseFirst: (value: Response) => void = () => {}
    vi.mocked(fetch).mockImplementationOnce(
      () => new Promise<Response>((resolve) => (releaseFirst = resolve)),
    )
    const { result } = renderHook(() => useUnreadNotifications(baseUrl))

    await act(async () => {
      notifyNotificationsChanged()
    })
    expect(fetch).toHaveBeenCalledTimes(1)

    vi.mocked(fetch).mockResolvedValue(respondWith('n1', 'n2'))
    await act(async () => {
      releaseFirst(respondWith('n1'))
    })

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.count).toBe(2))
  })

  it('keeps the last good list when a poll fails, rather than blanking the badge', async () => {
    const { result } = renderHook(() => useUnreadNotifications(baseUrl))
    await waitFor(() => expect(result.current.count).toBe(1))

    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    await act(async () => {
      notifyNotificationsChanged()
    })

    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.count).toBe(1)
  })

  it('stops polling once unmounted', async () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useUnreadNotifications(baseUrl, 60_000))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetch).toHaveBeenCalledTimes(1)

    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000)
      notifyNotificationsChanged()
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
