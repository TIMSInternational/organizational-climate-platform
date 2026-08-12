import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import NotificationsInboxPage from './NotificationsInboxPage'
import { subscribeToNotificationChanges } from '../notificationsChanged'

function row(id: string, title: string, openedAt: string | null = null) {
  return {
    id,
    userId: 'u1',
    companyId: 'c1',
    type: 'survey_invitation',
    channel: 'in_app',
    priority: 'medium',
    status: openedAt ? 'opened' : 'sent',
    title,
    message: `Message for ${title}`,
    data: null,
    templateId: null,
    scheduledFor: '2026-08-01T09:00:00Z',
    sentAt: '2026-08-01T09:00:01Z',
    deliveredAt: null,
    openedAt,
    failedAt: null,
    failureReason: null,
    retryCount: 0,
    createdAt: '2026-08-01T09:00:00Z',
  }
}

function listResponse(...rows: ReturnType<typeof row>[]) {
  return new Response(JSON.stringify({ notifications: rows }), { status: 200 })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <NotificationsInboxPage />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const unreadRow = row('n1', 'Survey ready')
const readRow = row('n2', 'Report ready', '2026-08-02T10:00:00Z')

/**
 * The list item one notification renders into.
 *
 * The inbox is a grouped list rather than a table now, so there is no `<tr>` to climb
 * to. `data-slot` is the same handle the `ui/` primitives expose and it survives a
 * change of element, which `closest('li')` would not.
 */
function rowFor(title: string): HTMLElement {
  const found = screen.getByText(title).closest('[data-slot="notification-row"]')
  if (!found) throw new Error(`no notification row around "${title}"`)
  return found as HTMLElement
}

beforeEach(() => {
  setToken('test-token')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(listResponse(unreadRow, readRow)))
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.restoreAllMocks()
  // The grouping test pins the clock; `restoreAllMocks` does not put it back.
  vi.useRealTimers()
})

describe('NotificationsInboxPage', () => {
  it('lists the caller’s own notifications, read and unread', async () => {
    renderPage()
    expect(await screen.findByText('Survey ready')).toBeTruthy()
    expect(screen.getByText('Report ready')).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/notifications/mine'),
      expect.anything(),
    )
  })

  it('sends no companyId, because the inbox is scoped per user rather than per tenant', async () => {
    // Unlike every other list page in the app this one reads nothing off the JWT
    // claims: a CompanyAdmin loading it gets their own inbox, not their tenant's.
    renderPage()
    await screen.findByText('Survey ready')
    expect(String(vi.mocked(fetch).mock.calls[0][0])).not.toContain('companyId')
  })

  it('labels read state in words, not by font weight or a coloured dot alone', async () => {
    renderPage()
    await screen.findByText('Survey ready')
    expect(within(rowFor('Survey ready')).getByText('Unread')).toBeTruthy()
    expect(within(rowFor('Report ready')).getByText('Read')).toBeTruthy()
  })

  it('names what kind of notification each row is, from the wire type', async () => {
    renderPage()
    await screen.findByText('Survey ready')
    // `type: 'survey_invitation'` on both fixture rows.
    expect(within(rowFor('Survey ready')).getByText('Survey invitation')).toBeTruthy()
  })

  it('falls back to the raw wire type rather than an empty chip', async () => {
    // `audit_logs`-style forward compatibility: a type this build has never heard of
    // must stay legible rather than render as a blank badge.
    vi.mocked(fetch).mockResolvedValue(
      listResponse({ ...unreadRow, type: 'quantum_entanglement_alert' }),
    )
    renderPage()
    await screen.findByText('Survey ready')
    expect(within(rowFor('Survey ready')).getByText('quantum_entanglement_alert')).toBeTruthy()
  })

  it('offers Mark as Read only on the rows that are unread', async () => {
    renderPage()
    await screen.findByText('Report ready')
    expect(within(rowFor('Report ready')).queryByRole('button', { name: 'Mark as Read' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Mark as Read' })).toHaveLength(1)
  })

  it('updates the row in place on mark-read, with no second list request', async () => {
    renderPage()
    const button = await screen.findByRole('button', { name: 'Mark as Read' })
    const listCallsBefore = vi.mocked(fetch).mock.calls.length

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(row('n1', 'Survey ready', '2026-08-03T08:00:00Z')), { status: 200 }),
    )
    await userEvent.click(button)

    await waitFor(() => expect(within(rowFor('Survey ready')).getByText('Read')).toBeTruthy())
    expect(within(rowFor('Survey ready')).queryByRole('button', { name: 'Mark as Read' })).toBeNull()
    // Exactly one extra call -- the POST. A refetch would blink the whole list.
    expect(vi.mocked(fetch).mock.calls.length).toBe(listCallsBefore + 1)
  })

  it('announces the change so the shell bell can drop its badge', async () => {
    const listener = vi.fn()
    const stop = subscribeToNotificationChanges(listener)
    renderPage()

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(row('n1', 'Survey ready', '2026-08-03T08:00:00Z')), { status: 200 }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as Read' }))

    await waitFor(() => expect(listener).toHaveBeenCalled())
    stop()
  })

  it('re-fetches quietly when the bell marks something read, without flashing the loading state', async () => {
    renderPage()
    await screen.findByText('Survey ready')

    vi.mocked(fetch).mockResolvedValue(listResponse(readRow))
    // Someone else on the page announced a change -- the bell dropdown.
    const { notifyNotificationsChanged } = await import('../notificationsChanged')
    notifyNotificationsChanged()

    await waitFor(() => expect(screen.queryByText('Survey ready')).toBeNull())
    expect(screen.queryByText('Loading...')).toBeNull()
    expect(screen.getByText('Report ready')).toBeTruthy()
  })

  it('pushes the unread filter to the server rather than filtering the fetched page', async () => {
    // The endpoint caps a page at 200 rows, so filtering locally would silently
    // hide unread items older than the 200th notification.
    renderPage()
    await screen.findByText('Survey ready')

    vi.mocked(fetch).mockResolvedValue(listResponse(unreadRow))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Unread only' }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('unreadOnly=true'),
        expect.anything(),
      ),
    )
    await waitFor(() => expect(screen.queryByText('Report ready')).toBeNull())
  })

  it('removes a row from the filtered view once it is read, rather than leaving it contradicting the filter', async () => {
    vi.mocked(fetch).mockResolvedValue(listResponse(unreadRow))
    renderPage()
    await screen.findByText('Survey ready')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Unread only' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(row('n1', 'Survey ready', '2026-08-03T08:00:00Z')), { status: 200 }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as Read' }))

    await waitFor(() => expect(screen.queryByText('Survey ready')).toBeNull())
  })

  it('removes every row from the filtered view after Mark All as Read, not just one', async () => {
    // The bulk path has its own branch for this — `unreadOnly ? filter : map` in
    // `handleMarkAllRead` — and nothing exercised it. Replacing that ternary with an
    // unconditional `map` left all 109 notifications tests green, because the bulk
    // test below never turns the filter on. Under that mutant, pressing Mark All as
    // Read while "Unread only" is active leaves every row on screen with its badge
    // flipped to Read: a list contradicting its own filter, which is exactly what
    // the single-row path has a dedicated test for directly above.
    vi.mocked(fetch).mockResolvedValue(listResponse(unreadRow, row('n3', 'Plan due')))
    renderPage()
    await screen.findByText('Survey ready')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Unread only' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(row('n1', 'Survey ready', '2026-08-03T08:00:00Z')), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(row('n3', 'Plan due', '2026-08-03T08:00:00Z')), { status: 200 }),
      )
    await userEvent.click(screen.getByRole('button', { name: 'Mark All as Read' }))

    // Both rows leave the view, rather than staying and reading "Read" beneath a
    // filter that says unread.
    await waitFor(() => expect(screen.queryByText('Survey ready')).toBeNull())
    expect(screen.queryByText('Plan due')).toBeNull()
  })

  it('groups the inbox by recency, with a heading and a mono count per group', async () => {
    const now = new Date('2026-08-10T12:00:00Z')
    vi.setSystemTime(now)
    vi.mocked(fetch).mockResolvedValue(
      listResponse(
        { ...row('n1', 'Today unread'), createdAt: now.toISOString() },
        {
          ...row('n2', 'Yesterday read', '2026-08-09T12:00:00Z'),
          createdAt: '2026-08-09T09:00:00Z',
        },
      ),
    )
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Yesterday' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Earlier' })).toBeNull()
    expect(screen.getByText('1 unread of 1')).toBeTruthy()
    expect(screen.getByText('0 unread of 1')).toBeTruthy()
  })

  it('marks every loaded unread notification read in one gesture, one request each', async () => {
    // There is no bulk endpoint -- NotificationEndpoints.cs maps only
    // POST /notifications/{id}/read -- so the button issues one request per unread row.
    vi.mocked(fetch).mockResolvedValue(
      listResponse(unreadRow, row('n3', 'Plan due'), readRow),
    )
    renderPage()
    await screen.findByText('Survey ready')

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(row('n1', 'Survey ready', '2026-08-03T08:00:00Z')), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(row('n3', 'Plan due', '2026-08-03T08:00:00Z')), { status: 200 }),
      )
    await userEvent.click(screen.getByRole('button', { name: 'Mark All as Read' }))

    await waitFor(() =>
      expect(screen.queryAllByRole('button', { name: 'Mark as Read' })).toHaveLength(0),
    )
    expect(within(rowFor('Survey ready')).getByText('Read')).toBeTruthy()
    expect(within(rowFor('Plan due')).getByText('Read')).toBeTruthy()
    // Two POSTs for the two unread rows -- the read one is not re-marked.
    const posts = vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(posts).toHaveLength(2)
  })

  it('disables Mark All as Read when there is nothing unread', async () => {
    vi.mocked(fetch).mockResolvedValue(listResponse(readRow))
    renderPage()
    await screen.findByText('Report ready')
    expect(
      screen.getByRole('button', { name: 'Mark All as Read' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('links to the notification preferences page rather than restating the switches', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: 'Preferences' })
    expect(link.getAttribute('href')).toBe('/settings/notifications')
  })

  it('says so when the inbox is empty, differently for the filtered view', async () => {
    vi.mocked(fetch).mockResolvedValue(listResponse())
    renderPage()
    expect(await screen.findByText('No notifications')).toBeTruthy()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Unread only' }))
    expect(await screen.findByText('You have no unread notifications')).toBeTruthy()
  })

  it('reports a failed load instead of showing an empty inbox', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Backend exploded' }), { status: 500 }),
    )
    renderPage()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Backend exploded')
  })

  it('renders entirely in Spanish', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Notificaciones' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Solo no leídas' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Marcar como Leído' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Preferencias' })).toBeTruthy()
    expect(within(rowFor('Survey ready')).getByText('Invitación a encuesta')).toBeTruthy()
    expect(within(rowFor('Survey ready')).getByText('No leída')).toBeTruthy()
  })
})
