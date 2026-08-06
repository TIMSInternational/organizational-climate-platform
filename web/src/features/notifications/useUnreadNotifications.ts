import { useCallback, useEffect, useRef, useState } from 'react'
import { listMyNotifications, type NotificationDetail } from './api/notifications'
import { subscribeToNotificationChanges } from './notificationsChanged'

/**
 * How often the shell asks for the caller's unread notifications.
 *
 * Chosen, not defaulted. The refresh strategy is polling, matching the
 * project-wide choice recorded on `charts/usePolling.ts` (no sockets: no
 * persistent connection per viewer, no second transport to authorise, no
 * reconnect-and-backfill). What differs is the interval, and it differs by more
 * than an order of magnitude:
 *
 * - A live results chart is *being watched* while a microclimate runs, so it is
 *   held to 3–5s and `usePolling` throws outside that window.
 * - A notification bell is glanced at. Sixty seconds late is imperceptible, and
 *   at 5s this would be 720 authenticated round trips per user per hour for a
 *   number that changes a handful of times a day — for every open tab, all day.
 *
 * That is why this is a separate hook rather than a call to `usePolling`:
 * `usePolling` *enforces* MIN 3s / MAX 5s and would throw a `RangeError` at 60s,
 * and widening its range to fit the bell would remove the guard that keeps a live
 * chart live. Two different jobs, two intervals, one deliberately documented each.
 */
export const UNREAD_POLL_MS = 60_000

export interface UnreadNotificationsState {
  /** The caller's unread notifications, most recent first. */
  unread: NotificationDetail[]
  /** `unread.length`, kept as its own field so the bell need not know that. */
  count: number
  /** True when the last attempt failed. The previous list stays on screen. */
  failed: boolean
  /** Re-fetches immediately. */
  refresh: () => void
}

/**
 * Polls the caller's unread notifications for the shell bell.
 *
 * Three behaviours beyond a bare `setInterval`, all carried over from the shape
 * `usePolling` settled on:
 *
 * 1. **The first fetch happens on mount, immediately.** The in-flight guard is a
 *    variable scoped to *this effect run*, deliberately not a `useRef`. As a ref
 *    it is shared across runs, so when React 19 StrictMode re-runs the effect on
 *    mount the second run sees the first run's still-unresolved request and
 *    returns without fetching — leaving the bell blank for a whole interval. At
 *    60s that bug means the badge is simply missing for the first minute of every
 *    session, which is exactly the kind of thing an assertion-only test never
 *    sees. #80's browser verification found this class of defect in `usePolling`;
 *    it is not being reintroduced here.
 * 2. **A hidden tab does not poll**, and polls once immediately on return.
 * 3. **A failure keeps the last good list** and raises `failed`, rather than
 *    blanking the badge — a count that drops to zero because the network blipped
 *    is worse than a stale one.
 *
 * It also re-fetches on `notificationsChanged`, which is what makes marking
 * something read on the inbox page update the badge without a reload.
 */
export function useUnreadNotifications(
  baseUrl: string,
  intervalMs: number = UNREAD_POLL_MS,
): UnreadNotificationsState {
  const [unread, setUnread] = useState<NotificationDetail[]>([])
  const [failed, setFailed] = useState(false)

  // Held so `refresh` can be a stable callback that the effect also drives.
  const pollRef = useRef<() => void>(() => {})

  useEffect(() => {
    let cancelled = false
    // Per-run, not a ref — see the note on this function.
    let inFlight = false
    // Set when a poll is asked for while one is running. Without it, a mark-read
    // that lands mid-poll is dropped and the badge stays wrong until the next
    // tick, which is the one case this hook exists to get right.
    let requeued = false

    async function poll(): Promise<void> {
      if (inFlight) {
        requeued = true
        return
      }
      inFlight = true
      try {
        const result = await listMyNotifications(baseUrl, { unreadOnly: true })
        if (cancelled) return
        setUnread(result)
        setFailed(false)
      } catch {
        if (cancelled) return
        setFailed(true)
      } finally {
        inFlight = false
        if (requeued && !cancelled) {
          requeued = false
          void poll()
        }
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
        void poll()
        start()
      }
    }

    if (!document.hidden) {
      void poll()
      start()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    const unsubscribe = subscribeToNotificationChanges(() => void poll())

    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      unsubscribe()
    }
  }, [baseUrl, intervalMs])

  const refresh = useCallback(() => pollRef.current(), [])

  return { unread, count: unread.length, failed, refresh }
}
