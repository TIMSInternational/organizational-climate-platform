import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_POLL_MS, MIN_POLL_MS, usePolling } from './usePolling'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/**
 * `document.hidden` is a getter on the happy-dom Document prototype, so it is
 * overridden rather than assigned — probed rather than assumed, per the project's
 * habit of dumping what the library actually does before writing the assertion.
 */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
}

afterEach(() => setHidden(false))

describe('usePolling', () => {
  describe('the interval contract', () => {
    /**
     * Loud rather than clamped, following `seriesColor`: a 200ms poll interval is a
     * production incident, and silently correcting it hides that the caller believed
     * something false about how often this runs.
     */
    it('refuses an interval faster than the floor', () => {
      expect(() => renderHook(() => usePolling(async () => 1, { intervalMs: 200 }))).toThrow(
        RangeError,
      )
    })

    it('refuses an interval slower than the ceiling', () => {
      expect(() => renderHook(() => usePolling(async () => 1, { intervalMs: 60_000 }))).toThrow(
        RangeError,
      )
    })

    it('accepts both ends of the permitted range', () => {
      expect(() =>
        renderHook(() => usePolling(async () => 1, { intervalMs: MIN_POLL_MS })),
      ).not.toThrow()
      expect(() =>
        renderHook(() => usePolling(async () => 1, { intervalMs: MAX_POLL_MS })),
      ).not.toThrow()
    })
  })

  it('fetches once immediately rather than waiting out the first interval', async () => {
    const fetcher = vi.fn(async () => 'first')
    const { result } = renderHook(() => usePolling(fetcher))

    await waitFor(() => expect(result.current.data).toBe('first'))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.lastUpdatedAt).toBeInstanceOf(Date)
  })

  it('re-fetches on each interval', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(async () => 'value')
    renderHook(() => usePolling(fetcher, { intervalMs: 3000 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(fetcher).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('does not poll at all when disabled', async () => {
    const fetcher = vi.fn(async () => 'value')
    const { result } = renderHook(() => usePolling(fetcher, { enabled: false }))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('stops polling when unmounted', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(async () => 'value')
    const { unmount } = renderHook(() => usePolling(fetcher, { intervalMs: 3000 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetcher).toHaveBeenCalledTimes(1)

    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  /**
   * Without this, a backend slower than the interval accumulates requests forever,
   * and out-of-order responses can settle the view on an *older* value than it
   * already had.
   */
  it('skips a tick while a request is still in flight', async () => {
    vi.useFakeTimers()
    let release: (value: string) => void = () => {}
    const fetcher = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        }),
    )

    renderHook(() => usePolling(fetcher, { intervalMs: 3000 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetcher).toHaveBeenCalledTimes(1)

    // Three intervals pass with the first request unresolved.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000)
    })
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(async () => {
      release('late')
      await vi.advanceTimersByTimeAsync(0)
    })
    // Once it lands, the next tick proceeds normally.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  describe('failure', () => {
    /**
     * `LiveResultsPanel` swallows poll errors entirely, so a reader watching a dead
     * endpoint sees a plausible figure with no sign it stopped updating. That is the
     * worse failure for a live view, because the number is still *there*.
     */
    it('keeps the last good value and raises isStale', async () => {
      vi.useFakeTimers()
      let attempt = 0
      const fetcher = vi.fn(async () => {
        attempt += 1
        if (attempt === 1) return 'good'
        throw new Error('endpoint down')
      })

      const { result } = renderHook(() => usePolling(fetcher, { intervalMs: 3000 }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.data).toBe('good')
      expect(result.current.isStale).toBe(false)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(result.current.data).toBe('good')
      expect(result.current.isStale).toBe(true)
      expect(result.current.consecutiveFailures).toBe(1)
    })

    it('recovers and clears the stale flag on the next success', async () => {
      vi.useFakeTimers()
      let attempt = 0
      const fetcher = vi.fn(async () => {
        attempt += 1
        if (attempt === 2) throw new Error('blip')
        return `value-${attempt}`
      })

      const { result } = renderHook(() => usePolling(fetcher, { intervalMs: 3000 }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(result.current.isStale).toBe(true)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(result.current.isStale).toBe(false)
      expect(result.current.consecutiveFailures).toBe(0)
      expect(result.current.data).toBe('value-3')
    })

    /** Before the first success the state is "loading", not "stale". */
    it('is not stale when the very first fetch fails', async () => {
      const fetcher = vi.fn(async () => {
        throw new Error('down')
      })
      const { result } = renderHook(() => usePolling(fetcher, { intervalMs: 3000 }))

      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(result.current.data).toBeNull()
      expect(result.current.isStale).toBe(false)
      expect(result.current.consecutiveFailures).toBe(1)
    })
  })

  describe('a hidden tab', () => {
    /**
     * A background tab otherwise hits the API every few seconds forever, for every
     * abandoned tab, fetching data nobody will see.
     */
    it('does not start polling while the tab is hidden', async () => {
      vi.useFakeTimers()
      setHidden(true)
      const fetcher = vi.fn(async () => 'value')
      renderHook(() => usePolling(fetcher, { intervalMs: 3000 }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })
      expect(fetcher).not.toHaveBeenCalled()
    })

    it('pauses when the tab is hidden and resumes at once when it returns', async () => {
      vi.useFakeTimers()
      const fetcher = vi.fn(async () => 'value')
      renderHook(() => usePolling(fetcher, { intervalMs: 3000 }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(fetcher).toHaveBeenCalledTimes(1)

      await act(async () => {
        setHidden(true)
        document.dispatchEvent(new Event('visibilitychange'))
        await vi.advanceTimersByTimeAsync(30_000)
      })
      expect(fetcher).toHaveBeenCalledTimes(1)

      // Fires immediately on return: after a pause the on-screen number is already
      // older than the interval, and that is exactly when the reader is looking.
      await act(async () => {
        setHidden(false)
        document.dispatchEvent(new Event('visibilitychange'))
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(fetcher).toHaveBeenCalledTimes(2)
    })
  })

  /**
   * Regression: the in-flight guard used to be a `useRef`, shared across effect
   * runs. When the effect restarted while a request was still outstanding, the new
   * run saw the flag set and skipped its own immediate fetch, then waited a whole
   * interval. React 19 StrictMode re-runs every effect on mount, so in development
   * that delayed the first paint of every live chart by 3-5s — visible on the chart
   * gallery as "Not updated yet" sitting there for a full interval.
   */
  describe('restarting the effect', () => {
    it('fetches at once when enabled flips on, rather than waiting an interval', async () => {
      vi.useFakeTimers()
      const fetcher = vi.fn(async () => 'value')

      function Harness({ enabled }: { enabled: boolean }) {
        const { data } = usePolling(fetcher, { intervalMs: 3000, enabled })
        return <span>{data ?? 'none'}</span>
      }

      const { rerender } = render(<Harness enabled={false} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(fetcher).not.toHaveBeenCalled()

      rerender(<Harness enabled />)
      // No timer advance beyond flushing microtasks: the fetch must be immediate.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('fetches at once after a restart even with a request still outstanding', async () => {
      vi.useFakeTimers()
      const resolvers: ((value: string) => void)[] = []
      const fetcher = vi.fn(
        () => new Promise<string>((resolve) => resolvers.push(resolve)),
      )

      function Harness({ intervalMs }: { intervalMs: number }) {
        usePolling(fetcher, { intervalMs })
        return null
      }

      const { rerender } = render(<Harness intervalMs={3000} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(fetcher).toHaveBeenCalledTimes(1)

      // Restart with the first request deliberately left hanging.
      rerender(<Harness intervalMs={4000} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      // The shared-ref version returned early here and left this at 1.
      expect(fetcher).toHaveBeenCalledTimes(2)

      // The abandoned request landing late must not write state.
      await act(async () => {
        resolvers[0]('stale')
        await vi.advanceTimersByTimeAsync(0)
      })
    })
  })

  it('polls on demand via refresh', async () => {
    const fetcher = vi.fn(async () => 'value')
    const { result } = renderHook(() => usePolling(fetcher, { intervalMs: 5000 }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await act(async () => {
      result.current.refresh()
    })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  })

  /**
   * The reason `fetcher` is held in a ref. Callers pass inline closures, and if the
   * effect depended on the function's identity it would tear down and restart the
   * interval on every render — polling on render rather than on schedule.
   */
  it('does not restart the interval when given a new closure each render', async () => {
    vi.useFakeTimers()
    const calls = vi.fn()

    function Harness({ token }: { token: number }) {
      usePolling(
        async () => {
          calls()
          return token
        },
        { intervalMs: 3000 },
      )
      return null
    }

    const { rerender } = render(<Harness token={1} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(calls).toHaveBeenCalledTimes(1)

    // Ten re-renders, each with a brand-new closure.
    for (let index = 2; index <= 11; index += 1) {
      rerender(<Harness token={index} />)
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // Still one call: re-rendering is not a reason to fetch.
    expect(calls).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(calls).toHaveBeenCalledTimes(2)
  })
})
