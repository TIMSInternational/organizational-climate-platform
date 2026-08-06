import { describe, it, expect, vi } from 'vitest'
import { notifyNotificationsChanged, subscribeToNotificationChanges } from './notificationsChanged'

describe('notificationsChanged', () => {
  it('calls every current subscriber', () => {
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = subscribeToNotificationChanges(first)
    const stopSecond = subscribeToNotificationChanges(second)

    notifyNotificationsChanged()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    stopFirst()
    stopSecond()
  })

  it('stops calling a subscriber that unsubscribed', () => {
    const listener = vi.fn()
    subscribeToNotificationChanges(listener)()
    notifyNotificationsChanged()
    expect(listener).not.toHaveBeenCalled()
  })

  it('does not skip a subscriber when another unsubscribes mid-notify', () => {
    // React cleanup can run while the bus is iterating -- unmounting the bell in
    // response to a change is exactly that. Mutating the set during iteration
    // would silently skip whichever listener came next.
    // Subscribed FIRST, so it unsubscribes before `later` would be reached.
    const stopSelf = subscribeToNotificationChanges(() => stopSelf())
    const later = vi.fn()
    const stopLater = subscribeToNotificationChanges(later)

    notifyNotificationsChanged()

    expect(later).toHaveBeenCalledTimes(1)
    stopLater()
  })

  it('passes the announcer through, so a subscriber can ignore its own change', () => {
    // Both participants publish and subscribe. Without this the inbox's own
    // mark-read wakes the inbox's own listener, which re-fetches the list it just
    // patched in place.
    const source = Symbol('inbox')
    const listener = vi.fn()
    const stop = subscribeToNotificationChanges(listener)

    notifyNotificationsChanged(source)
    expect(listener).toHaveBeenCalledWith(source)

    notifyNotificationsChanged()
    expect(listener).toHaveBeenLastCalledWith(undefined)
    stop()
  })

  it('is a no-op with nobody listening', () => {
    expect(() => notifyNotificationsChanged()).not.toThrow()
  })
})
