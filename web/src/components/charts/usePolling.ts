import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Repeatedly re-fetches a value on an interval.
 *
 * ## Polling, not WebSockets
 *
 * This is a deliberate choice carried over from the microclimates design, not a
 * shortcut. A live dashboard needs to be a few seconds fresh, not
 * frame-accurate — and a socket costs a persistent connection per viewer, a
 * server-side fan-out, reconnect-and-backfill logic, and a second transport to
 * authorise and to keep working through whatever proxy sits in front of App
 * Runner. A `GET` every few seconds gets the same answer, reuses the exact
 * authorisation and error handling every other request has, and recovers from a
 * dropped network by simply succeeding next time.
 *
 * `features/microclimates/components/LiveResultsPanel.tsx` already polls at 5s;
 * this generalises that loop and fixes the three things it does not handle.
 */

/**
 * The permitted interval range.
 *
 * "Real time" in this product means the number on screen is a few seconds old.
 * Below 3s the poll is faster than a human reads and multiplies load for no
 * perceptible gain; above 5s it stops being live and the reader starts trusting a
 * stale figure.
 */
export const MIN_POLL_MS = 3000
export const MAX_POLL_MS = 5000

export interface PollingOptions {
  /** Milliseconds between polls. Must be within [MIN_POLL_MS, MAX_POLL_MS]. */
  intervalMs?: number
  /** Stops polling when false, e.g. a survey that is not open yet. */
  enabled?: boolean
}

export interface PollingState<T> {
  /** The most recent successful value, kept across failures. `null` until the first. */
  data: T | null
  /** True only before the first result. A refresh is not a load. */
  isLoading: boolean
  /** When `data` was fetched. */
  lastUpdatedAt: Date | null
  /** Failures since the last success. */
  consecutiveFailures: number
  /** True when the displayed data is no longer known to be current. */
  isStale: boolean
  /** Polls immediately, e.g. from a manual refresh control. */
  refresh: () => void
}

/**
 * @param fetcher Called on each tick. Re-created closures are fine — see below.
 *
 * Three things this handles that a bare `setInterval` does not:
 *
 * 1. **Overlapping requests.** If a poll is still in flight when the next tick
 *    arrives, the tick is skipped. Without that, a backend slower than the
 *    interval accumulates requests forever, and responses can land out of order
 *    so the view settles on an *older* value than it already had.
 *
 * 2. **A hidden tab.** Polling pauses on `visibilitychange` and fires once
 *    immediately on return. A background tab otherwise hits the API every few
 *    seconds indefinitely — for every abandoned tab, for every user — and the
 *    data it fetches is by definition never seen.
 *
 * 3. **Failure without lying.** A failed poll keeps the last good value and raises
 *    `isStale`, rather than blanking the view or leaving a frozen number looking
 *    live. `LiveResultsPanel` swallows poll errors entirely, so a reader watching
 *    a dead endpoint sees a plausible figure with no indication it stopped
 *    updating — which is the worse failure for a live view, because the number is
 *    still *there*.
 *
 * `fetcher` is held in a ref, so an inline arrow function does not restart the
 * interval on every render. The effect depends only on the interval and the
 * enabled flag, which are values rather than identities.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  { intervalMs = MAX_POLL_MS, enabled = true }: PollingOptions = {},
): PollingState<T> {
  if (!Number.isFinite(intervalMs) || intervalMs < MIN_POLL_MS || intervalMs > MAX_POLL_MS) {
    // Loud rather than clamped, following `seriesColor`: a 200ms poll interval is
    // a production incident, and silently correcting it to 3s hides the fact that
    // the caller believed something false about how often this runs.
    throw new RangeError(
      `polling interval ${intervalMs}ms is outside the permitted ${MIN_POLL_MS}-${MAX_POLL_MS}ms range.`,
    )
  }

  const [data, setData] = useState<T | null>(null)
  const [isLoading, setIsLoading] = useState(enabled)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const [consecutiveFailures, setConsecutiveFailures] = useState(0)

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // Held so `refresh` can be a stable callback that the effect also drives.
  const pollRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      return
    }

    let cancelled = false

    /**
     * Scoped to this effect run, deliberately **not** a `useRef`.
     *
     * As a ref it is shared across runs, and that loses the first fetch every
     * time the effect restarts: the outgoing run's request is still in flight
     * (its `finally` has not run), so the incoming run sees the flag set and
     * returns without fetching — then waits a full interval before its first
     * tick. React 19 StrictMode re-runs every effect on mount, so in
     * development that made *every* live chart 3–5 seconds late on first paint,
     * and in production it happened on any change to `intervalMs` or `enabled`.
     * Observed on the chart gallery: the panel sat on "Not updated yet" for one
     * whole interval before the first number appeared.
     *
     * Per-run scope is also what the guard actually means: it prevents this
     * loop from overlapping itself. A discarded run's late response cannot
     * corrupt anything, because `cancelled` already blocks its state writes.
     */
    let inFlight = false

    async function poll(): Promise<void> {
      if (inFlight) return
      inFlight = true
      try {
        const result = await fetcherRef.current()
        if (cancelled) return
        setData(result)
        setLastUpdatedAt(new Date())
        setConsecutiveFailures(0)
      } catch {
        if (cancelled) return
        // The previous value stays on screen; `isStale` is what tells the reader
        // it is no longer known to be current.
        setConsecutiveFailures((count) => count + 1)
      } finally {
        inFlight = false
        // `cancelled` covers unmount as well as a restart -- the cleanup below
        // runs in both cases -- so no separate mounted flag is needed.
        if (!cancelled) setIsLoading(false)
      }
    }

    pollRef.current = () => void poll()

    let timer: ReturnType<typeof setInterval> | undefined

    function start(): void {
      if (timer !== undefined) return
      timer = setInterval(() => void poll(), intervalMs)
    }

    function stop(): void {
      if (timer === undefined) return
      clearInterval(timer)
      timer = undefined
    }

    function onVisibilityChange(): void {
      if (document.hidden) {
        stop()
      } else {
        // Fire at once: after a pause the on-screen number is by definition older
        // than the interval, and waiting up to another 5s to correct it is exactly
        // the moment the reader is looking.
        void poll()
        start()
      }
    }

    const hidden = typeof document !== 'undefined' && document.hidden
    if (!hidden) {
      void poll()
      start()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [intervalMs, enabled])

  const refresh = useCallback(() => pollRef.current(), [])

  return {
    data,
    isLoading,
    lastUpdatedAt,
    consecutiveFailures,
    // Only meaningful once something has been displayed. Before the first success
    // the state is "loading", not "stale".
    isStale: consecutiveFailures > 0 && data !== null,
    refresh,
  }
}
