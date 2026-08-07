import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
  DISPATCHABLE_NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  dispatchBulkNotifications,
  dispatchNotification,
  isUnread,
  listCompanyNotifications,
  listMyNotifications,
  markNotificationRead,
  processDueNotifications,
  type NotificationDetail,
} from './notifications'

const baseUrl = 'http://api.test'

const detail: NotificationDetail = {
  id: 'n1',
  userId: 'u1',
  companyId: 'c1',
  type: 'survey_invitation',
  channel: 'in_app',
  priority: 'medium',
  status: 'sent',
  title: 'Survey ready',
  message: 'Please respond',
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

describe('notifications api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists the caller’s own inbox, unwrapping the response envelope', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ notifications: [detail] }), { status: 200 }),
    )
    const result = await listMyNotifications(baseUrl)
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/notifications/mine`, expect.anything())
    expect(result).toEqual([detail])
  })

  it('takes no companyId, because /mine is scoped per user and not per company', async () => {
    // A CompanyAdmin calling this gets their OWN inbox. If a companyId ever
    // appeared in this URL it would mean the client had started asking for
    // someone else's, which the server rejects and which no caller should try.
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ notifications: [] }), { status: 200 }))
    await listMyNotifications(baseUrl)
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).not.toContain('companyId')
  })

  it('pushes the unread filter to the server rather than filtering locally', async () => {
    // The endpoint caps a page at 200 rows, so a client-side filter would drop
    // unread items older than the 200th notification without saying so.
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ notifications: [] }), { status: 200 }))
    await listMyNotifications(baseUrl, { unreadOnly: true })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/notifications/mine?unreadOnly=true`, expect.anything())
  })

  it('omits the filter entirely when it is false, rather than sending unreadOnly=false', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ notifications: [] }), { status: 200 }))
    await listMyNotifications(baseUrl, { unreadOnly: false })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/notifications/mine`, expect.anything())
  })

  it('returns an empty list rather than throwing when the envelope is missing', async () => {
    // This runs inside a poll loop where a throw is invisible; a 200 with an
    // unexpected shape must degrade to "nothing unread", not to a broken bell.
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    await expect(listMyNotifications(baseUrl)).resolves.toEqual([])
  })

  it('marks one notification read and returns the updated row', async () => {
    const opened = { ...detail, openedAt: '2026-08-02T10:00:00Z', status: 'opened' }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(opened), { status: 200 }))
    const result = await markNotificationRead(baseUrl, 'n1')
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/notifications/n1/read`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result).toEqual(opened)
  })

  it('sends the bearer token on every call', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ notifications: [] }), { status: 200 }))
    await listMyNotifications(baseUrl)
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer test-token')
  })

  it('surfaces the server message on a failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Notification not found' }), { status: 404 }),
    )
    await expect(markNotificationRead(baseUrl, 'missing')).rejects.toThrow('Notification not found')
  })

  it('treats a null openedAt as unread and any timestamp as read', () => {
    // There is no `readAt` on the wire -- `openedAt` is the only signal, and it
    // is set once and never moved. Pinning that here so a future DTO change that
    // adds a separate flag does not leave this reading the wrong field.
    expect(isUnread(detail)).toBe(true)
    expect(isUnread({ ...detail, openedAt: '2026-08-02T10:00:00Z' })).toBe(false)
  })
})

describe('notifications admin api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists a company’s notifications, unwrapping the response envelope', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ notifications: [detail] }), { status: 200 }),
    )
    const result = await listCompanyNotifications(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/notifications?companyId=c1`, expect.anything())
    expect(result).toEqual([detail])
  })

  it('requires companyId on the admin list, unlike /mine', async () => {
    // The two lists are scoped differently on purpose: /mine derives the caller from
    // the token, while this one names a tenant and is checked against the claim. A
    // companyId-less admin list would be a cross-tenant read.
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ notifications: [] }), { status: 200 }),
    )
    await listCompanyNotifications(baseUrl, 'c1')
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('companyId=c1')
  })

  it('pushes the status filter to the server rather than filtering the page locally', async () => {
    // The page is capped at 200 rows most-recent-first, so a local filter would drop
    // every match older than the 200th row without saying so.
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ notifications: [] }), { status: 200 }),
    )
    await listCompanyNotifications(baseUrl, 'c1', { status: 'failed' })
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/notifications?companyId=c1&status=failed`,
      expect.anything(),
    )
  })

  it('dispatches to one recipient and returns the created row', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 201 }))
    const result = await dispatchNotification(baseUrl, {
      userId: 'u1',
      companyId: 'c1',
      type: 'survey_invitation',
      channel: 'in_app',
      priority: 'medium',
      title: 'Survey ready',
      message: 'Please respond',
    })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe(`${baseUrl}/notifications`)
    expect(init!.method).toBe('POST')
    expect(result).toEqual(detail)
  })

  it('omits an unset scheduledFor rather than sending null, so the server default applies', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 201 }))
    await dispatchNotification(baseUrl, {
      userId: 'u1',
      companyId: 'c1',
      type: 'survey_invitation',
      channel: 'in_app',
      priority: 'medium',
      title: 'Survey ready',
      message: 'Please respond',
    })
    const [, init] = vi.mocked(fetch).mock.calls[0]
    const sent = JSON.parse(String(init!.body))
    expect('scheduledFor' in sent).toBe(false)
    expect('templateId' in sent).toBe(false)
  })

  it('sends one bulk request for many recipients, not one request per recipient', async () => {
    // One request is what keeps the server's database work bounded: it issues a fixed
    // number of round trips regardless of how many recipients are named.
    const result = {
      requested: 2,
      created: 2,
      sent: 1,
      suppressed: 1,
      failed: 0,
      unknownUserIds: [],
      notifications: [detail],
    }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 201 }))
    const returned = await dispatchBulkNotifications(baseUrl, {
      userIds: ['u1', 'u2'],
      companyId: 'c1',
      type: 'survey_reminder',
      channel: 'email',
      priority: 'high',
      title: 'Reminder',
      message: 'One day left',
    })
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe(`${baseUrl}/notifications/bulk`)
    expect(JSON.parse(String(init!.body)).userIds).toEqual(['u1', 'u2'])
    expect(returned).toEqual(result)
  })

  it('surfaces unknown recipients from a bulk dispatch instead of dropping them', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          requested: 2,
          created: 1,
          sent: 1,
          suppressed: 0,
          failed: 0,
          unknownUserIds: ['u2'],
          notifications: [detail],
        }),
        { status: 201 },
      ),
    )
    const returned = await dispatchBulkNotifications(baseUrl, {
      userIds: ['u1', 'u2'],
      companyId: 'c1',
      type: 'survey_reminder',
      channel: 'email',
      priority: 'high',
      title: 'Reminder',
      message: 'One day left',
    })
    expect(returned.unknownUserIds).toEqual(['u2'])
  })

  it('scopes a process sweep to one company when asked', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ attempted: 3, sent: 2, suppressed: 1, failed: 0 }), {
        status: 200,
      }),
    )
    const result = await processDueNotifications(baseUrl, { companyId: 'c1' })
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/notifications/process?companyId=c1`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.attempted).toBe(3)
  })

  it('omits companyId for a cross-tenant sweep rather than sending a blank one', async () => {
    // No companyId means "every tenant", which the server allows only for a SuperAdmin.
    // `?companyId=` would instead be a filter for the empty guid and match nothing.
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ attempted: 0, sent: 0, suppressed: 0, failed: 0 }), {
        status: 200,
      }),
    )
    await processDueNotifications(baseUrl)
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe(`${baseUrl}/notifications/process`)
  })

  it('derives the dispatchable channels from the full list, excluding push', () => {
    // Two independently written lists is how the question-type vocabularies drifted
    // apart. Push is authorable on a template but not dispatchable, because a dispatch
    // reporting `sent` for it would claim a delivery this repo cannot perform.
    expect([...NOTIFICATION_CHANNELS]).toEqual(['email', 'in_app', 'push', 'sms'])
    expect([...DISPATCHABLE_NOTIFICATION_CHANNELS]).toEqual(['email', 'in_app', 'sms'])
  })

  it('knows all six statuses, including the two the domain plan omits', () => {
    // `cancelled` is what a preference-suppressed notification becomes, and `opened`
    // is what marking one read produces. A four-value list would make both invisible
    // to the admin filter.
    expect([...NOTIFICATION_STATUSES]).toEqual([
      'pending',
      'sent',
      'delivered',
      'opened',
      'failed',
      'cancelled',
    ])
  })
})
