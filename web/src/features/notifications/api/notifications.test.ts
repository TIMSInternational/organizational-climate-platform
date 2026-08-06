import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { isUnread, listMyNotifications, markNotificationRead, type NotificationDetail } from './notifications'

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
