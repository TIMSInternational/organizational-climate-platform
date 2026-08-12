import { describe, it, expect } from 'vitest'
import { groupNotificationsByDay, notificationGroupKey } from './groupByDay'
import type { NotificationDetail } from './api/notifications'

function notification(
  id: string,
  createdAt: string,
  openedAt: string | null = null,
): NotificationDetail {
  return {
    id,
    userId: 'u1',
    companyId: 'c1',
    type: 'survey_invitation',
    channel: 'in_app',
    priority: 'medium',
    status: openedAt ? 'opened' : 'sent',
    title: `Title ${id}`,
    message: `Message ${id}`,
    data: null,
    templateId: null,
    scheduledFor: createdAt,
    sentAt: createdAt,
    deliveredAt: null,
    openedAt,
    failedAt: null,
    failureReason: null,
    retryCount: 0,
    createdAt,
  }
}

/**
 * Local wall-clock strings throughout, never `Z`.
 *
 * The bucketing is a claim about the *reader's* calendar day, so a fixture written in
 * UTC would pass or fail depending on the machine's timezone — which is exactly the bug
 * class these tests exist to catch. `new Date('2026-08-10T23:50:00')` with no offset is
 * parsed as local time by every runtime this app runs in.
 */
const NOW = new Date('2026-08-10T12:00:00')

describe('notificationGroupKey', () => {
  it('puts this calendar day under today', () => {
    expect(notificationGroupKey('2026-08-10T00:01:00', NOW)).toBe('today')
    expect(notificationGroupKey('2026-08-10T23:59:00', NOW)).toBe('today')
  })

  it('puts the previous calendar day under yesterday', () => {
    expect(notificationGroupKey('2026-08-09T00:00:00', NOW)).toBe('yesterday')
    expect(notificationGroupKey('2026-08-09T23:59:00', NOW)).toBe('yesterday')
  })

  it('puts anything older under earlier', () => {
    expect(notificationGroupKey('2026-08-08T23:59:00', NOW)).toBe('earlier')
    expect(notificationGroupKey('2025-01-01T00:00:00', NOW)).toBe('earlier')
  })

  /**
   * The case elapsed-milliseconds arithmetic gets wrong in both directions: fourteen
   * minutes across midnight is a different day, and twenty-three hours within one date
   * is the same day.
   */
  it('splits on the calendar boundary rather than on 24 elapsed hours', () => {
    const justAfterMidnight = new Date('2026-08-10T00:10:00')
    expect(notificationGroupKey('2026-08-09T23:50:00', justAfterMidnight)).toBe('yesterday')

    const lateEvening = new Date('2026-08-10T23:50:00')
    expect(notificationGroupKey('2026-08-10T00:10:00', lateEvening)).toBe('today')
  })

  /**
   * `scheduledFor` can be ahead of now and clock skew between the API host and the
   * browser is real; a notification that has just arrived must not land under a heading
   * nobody is looking at.
   */
  it('reads a future timestamp as today rather than inventing a fourth bucket', () => {
    expect(notificationGroupKey('2026-08-12T09:00:00', NOW)).toBe('today')
  })

  /** Same rule as `formatNotificationTimestamp`: never throw on what the server sent. */
  it('reads an unparseable timestamp as earlier instead of throwing', () => {
    expect(notificationGroupKey('not-a-date', NOW)).toBe('earlier')
  })
})

describe('groupNotificationsByDay', () => {
  it('returns the three buckets in render order, most recent first', () => {
    const groups = groupNotificationsByDay(
      [
        notification('a', '2026-08-01T09:00:00'),
        notification('b', '2026-08-10T09:00:00'),
        notification('c', '2026-08-09T09:00:00'),
      ],
      NOW,
    )
    expect(groups.map((group) => group.key)).toEqual(['today', 'yesterday', 'earlier'])
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([['b'], ['c'], ['a']])
  })

  it('drops an empty bucket rather than rendering a heading over nothing', () => {
    const groups = groupNotificationsByDay([notification('a', '2026-08-10T09:00:00')], NOW)
    expect(groups.map((group) => group.key)).toEqual(['today'])
  })

  it('keeps the order the API returned within a bucket', () => {
    // `/notifications/mine` is already most-recent-first; re-sorting here would be a
    // second opinion about recency that could disagree with the server's.
    const groups = groupNotificationsByDay(
      [
        notification('first', '2026-08-10T09:00:00'),
        notification('second', '2026-08-10T11:00:00'),
        notification('third', '2026-08-10T10:00:00'),
      ],
      NOW,
    )
    expect(groups[0].items.map((item) => item.id)).toEqual(['first', 'second', 'third'])
  })

  it('counts the unread rows in each bucket', () => {
    const groups = groupNotificationsByDay(
      [
        notification('a', '2026-08-10T09:00:00'),
        notification('b', '2026-08-10T10:00:00', '2026-08-10T10:30:00'),
        notification('c', '2026-08-09T10:00:00', '2026-08-09T11:00:00'),
      ],
      NOW,
    )
    expect(groups.map((group) => [group.key, group.unread, group.items.length])).toEqual([
      ['today', 1, 2],
      ['yesterday', 0, 1],
    ])
  })

  it('returns nothing at all for an empty inbox', () => {
    expect(groupNotificationsByDay([], NOW)).toEqual([])
  })
})
