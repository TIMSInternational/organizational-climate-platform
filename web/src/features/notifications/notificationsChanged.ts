/**
 * A one-event bus so the inbox page and the shell bell stay in agreement.
 *
 * The two live in different subtrees — `NotificationBell` is mounted by
 * `AdminLayout`, `NotificationsInboxPage` by the `<Outlet />` inside it — so
 * marking something read in one cannot update the other through props. Without
 * this the bell keeps its count until the next poll tick, which is up to a minute
 * of the badge contradicting the page the user is looking at, and #99 requires
 * mark-read to update both "without a reload".
 *
 * Deliberately not a React context: a context would have to wrap the shell, own
 * the fetching for both consumers, and re-render every routed page whenever a
 * poll lands. This is one module-scope `Set` and a subscribe function, which is
 * all the coupling the two components actually need.
 */
/**
 * Who announced a change, so a subscriber can ignore its own.
 *
 * Both participants publish *and* subscribe, so without this the inbox's own
 * mark-read wakes the inbox's own listener and it re-fetches a list it has
 * already patched in place — undoing the point of patching it. A plain symbol
 * rather than a string: it cannot collide, and it cannot be spelled wrong.
 */
export type NotificationChangeSource = symbol

type Listener = (source: NotificationChangeSource | undefined) => void

const listeners = new Set<Listener>()

/** Subscribes; returns the unsubscribe, shaped for a `useEffect` cleanup. */
export function subscribeToNotificationChanges(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Announces that the caller's notifications changed server-side.
 *
 * Iterates a copy: a listener that unsubscribes itself while being called would
 * otherwise mutate the set mid-iteration.
 *
 * @param source Identifies the announcer. Every subscriber is still called —
 * filtering is the subscriber's choice, because "ignore my own" is not always
 * what a subscriber wants.
 */
export function notifyNotificationsChanged(source?: NotificationChangeSource): void {
  for (const listener of [...listeners]) {
    listener(source)
  }
}
