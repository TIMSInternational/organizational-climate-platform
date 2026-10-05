import { useEffect, useRef, useState } from 'react'
import { HEARTBEAT_MS, TAB_ID, claimLock, heldElsewhere, refreshLock, releaseLock } from './respondLock'

/**
 * Whether this tab may answer, or the survey is open in another one.
 *
 * `'held'` is the ordinary state and the one a tab starts in unless another tab is
 * demonstrably in the middle of the survey right now.
 */
export type RespondLockState = 'held' | 'blocked'

/**
 * Hold `respondLock`'s lock for as long as this screen is mounted.
 *
 * ## The first paint is a plain read, not a claim
 *
 * The initial state comes from `heldElsewhere`, which only reads. Claiming during
 * render would be a side effect in a render function — run twice under StrictMode and
 * at React's discretion — and the effect below has to claim anyway, so doing it in
 * both places buys nothing. The read is accurate at the instant it happens, so the
 * blocked screen paints first rather than flashing the form.
 *
 * ## Why the effect re-claims on every run
 *
 * The cleanup releases the lock, and StrictMode mounts, cleans up, and mounts again.
 * An effect that claimed only when it believed itself unlocked would come out of that
 * sequence convinced it held a lock it had just released, and would then answer
 * without one. So the effect's first act is always to claim, and `settle` makes the
 * no-change case free.
 *
 * ## Losing the lock is not something to fight
 *
 * `refreshLock` returning false means another tab took it, which can only happen after
 * this one went quiet past `STALE_MS`. The response to that is to stop, not to take it
 * back: two tabs taking it in turns is exactly the interleaved write the lock exists
 * to prevent, and it would be worse than no lock because both screens would look fine.
 */
export function useRespondLock(surveyId: string): RespondLockState {
  const [state, setState] = useState<RespondLockState>(() =>
    heldElsewhere(surveyId) ? 'blocked' : 'held',
  )
  // The effect's own view of the state. Reading `state` inside the listeners would
  // close over the value from the render that installed them, and re-installing them
  // on every change would restart the heartbeat each time.
  const held = useRef(state === 'held')

  useEffect(() => {
    let stopped = false
    const channel = openChannel(surveyId)

    const post = (type: 'claimed' | 'released') => {
      try {
        channel?.postMessage({ type, tab: TAB_ID })
      } catch {
        // A closed or unsupported channel costs the other tab its instant hand-off,
        // which the heartbeat then covers within STALE_MS. Not worth failing over.
      }
    }

    const settle = (next: RespondLockState) => {
      if (stopped || held.current === (next === 'held')) return
      held.current = next === 'held'
      setState(next)
    }

    const take = () => {
      if (claimLock(surveyId)) {
        settle('held')
        // Announce it so a tab that went stale while backgrounded finds out it lost
        // the lock now, rather than on its next beat.
        post('claimed')
        return
      }
      settle('blocked')
    }

    const beat = () => {
      if (held.current) {
        if (!refreshLock(surveyId)) settle('blocked')
        return
      }
      // Blocked tabs keep asking: the holder may have been killed rather than closed,
      // in which case there is no `released` message coming and the stale window is
      // the only way back in.
      if (claimLock(surveyId)) {
        settle('held')
        post('claimed')
      }
    }

    take()
    const timer = window.setInterval(beat, HEARTBEAT_MS)

    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data
      if (typeof data !== 'object' || data === null) return
      const { type, tab } = data as { type?: unknown; tab?: unknown }
      if (tab === TAB_ID) return
      if (type === 'released' && !held.current) take()
      // Another tab claims only when ours had gone stale, so believe the storage
      // rather than the message: if we still hold it, the claim was not against us.
      if (type === 'claimed' && held.current && heldElsewhere(surveyId)) settle('blocked')
    }

    // A backgrounded tab's timers are throttled to roughly one a minute, so coming
    // back to the foreground is the moment to find out where things stand — either
    // the lock is still ours and wants a beat, or it was taken while we were away.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') beat()
    }

    // `pagehide` rather than `beforeunload`: it fires on mobile Safari's back-forward
    // cache path, where `beforeunload` does not, and a survey answered on a phone is
    // the case this lock is for.
    const onHide = () => {
      if (!held.current) return
      releaseLock(surveyId)
      post('released')
    }

    channel?.addEventListener('message', onMessage)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onHide)

    return () => {
      stopped = true
      window.clearInterval(timer)
      channel?.removeEventListener('message', onMessage)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onHide)
      if (held.current) {
        releaseLock(surveyId)
        post('released')
      }
      channel?.close()
    }
  }, [surveyId])

  return state
}

/**
 * A `BroadcastChannel` for this survey, or null where there is none.
 *
 * Guarded because the API is absent in older Safari and need not exist in a test
 * environment: without it the lock still works, it simply waits out `STALE_MS`
 * instead of handing over the instant a tab closes.
 */
function openChannel(surveyId: string): BroadcastChannel | null {
  try {
    if (typeof BroadcastChannel !== 'function') return null
    return new BroadcastChannel(`surveyOpen:${surveyId}`)
  } catch {
    return null
  }
}
