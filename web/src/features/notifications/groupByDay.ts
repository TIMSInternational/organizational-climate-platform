import { isUnread, type NotificationDetail } from './api/notifications'

/**
 * The three buckets the inbox groups into, in the order they are rendered.
 *
 * Deliberately coarse. The redesign's inbox prints a *relative* recency beside every
 * row ("12 min ago", "Yesterday", "2 days ago") and the group heading is what carries
 * that reading here, so the buckets have to be the ones a reader would name out loud.
 * A per-date heading would produce a heading for every row on a busy week, which is a
 * list with extra furniture rather than a grouped list.
 */
export const NOTIFICATION_GROUP_KEYS = ['today', 'yesterday', 'earlier'] as const

export type NotificationGroupKey = (typeof NOTIFICATION_GROUP_KEYS)[number]

export interface NotificationGroup {
  key: NotificationGroupKey
  items: NotificationDetail[]
  /** How many of `items` the reader has not opened. Rendered as a mono reading. */
  unread: number
}

/**
 * Whole days between two instants, by **local calendar day** rather than by elapsed
 * milliseconds.
 *
 * The distinction is the whole point: 23:50 and 00:10 are fourteen minutes apart and
 * belong under different headings, while 00:10 and 23:50 on the same date are most of
 * a day apart and belong under the same one. Comparing `now - then > 86_400_000` gets
 * both of those backwards.
 *
 * Local, not UTC, because the heading is a claim about the reader's own day.
 */
function calendarDaysBetween(then: Date, now: Date): number {
  const thenMidnight = new Date(then.getFullYear(), then.getMonth(), then.getDate())
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((nowMidnight.getTime() - thenMidnight.getTime()) / 86_400_000)
}

/**
 * Which bucket one timestamp falls in.
 *
 * A future timestamp reads as `today`, not as a fourth bucket: `scheduledFor` can be
 * ahead of now and clock skew between the API host and the browser is real, so a
 * notification that has just arrived must not vanish into a heading nobody expects.
 *
 * An unparseable value also reads as `earlier` rather than throwing — the same rule
 * `formatNotificationTimestamp` follows, for the same reason: whatever the server sent
 * should still be visible to whoever has to debug it.
 */
export function notificationGroupKey(iso: string, now: Date): NotificationGroupKey {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return 'earlier'

  const days = calendarDaysBetween(parsed, now)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return 'earlier'
}

/**
 * Splits the inbox into the three buckets, most recent first.
 *
 * Order **within** a group is the order the API returned — `/notifications/mine` is
 * already most-recent-first and re-sorting here would be a second opinion about
 * recency that could disagree with the server's.
 *
 * An empty group is dropped rather than rendered with a "nothing here" line: three
 * headings over one notification would make an almost-empty inbox look broken.
 */
export function groupNotificationsByDay(
  notifications: NotificationDetail[],
  now: Date,
): NotificationGroup[] {
  return NOTIFICATION_GROUP_KEYS.map((key) => {
    const items = notifications.filter(
      (notification) => notificationGroupKey(notification.createdAt, now) === key,
    )
    // `isUnread` rather than a second `openedAt === null` here: "read" means first-open
    // and that definition lives in one place, beside the wire shape it reads.
    return { key, items, unread: items.filter(isUnread).length }
  }).filter((group) => group.items.length > 0)
}
