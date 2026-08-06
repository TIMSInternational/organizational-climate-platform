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

beforeEach(() => {
  setToken('test-token')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(listResponse(unreadRow, readRow)))
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.restoreAllMocks()
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

  it('labels read state in words, not by font weight alone', async () => {
    renderPage()
    const unread = (await screen.findByText('Survey ready')).closest('tr')!
    const read = screen.getByText('Report ready').closest('tr')!
    expect(within(unread).getByText('Unread')).toBeTruthy()
    expect(within(read).getByText('Read')).toBeTruthy()
  })

  it('offers Mark as Read only on the rows that are unread', async () => {
    renderPage()
    const read = (await screen.findByText('Report ready')).closest('tr')!
    expect(within(read).queryByRole('button', { name: 'Mark as Read' })).toBeNull()
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

    const updated = (await screen.findByText('Survey ready')).closest('tr')!
    await waitFor(() => expect(within(updated).getByText('Read')).toBeTruthy())
    expect(within(updated).queryByRole('button', { name: 'Mark as Read' })).toBeNull()
    // Exactly one extra call -- the POST. A refetch would blink the whole table.
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

  it('renders its table through the Table primitive, so a wide row scrolls inside the panel', async () => {
    // #218: `width: 100%` is only safe next to something that scrolls, and the
    // container is what the primitive brings.
    renderPage()
    const table = await screen.findByRole('table')
    expect(table.parentElement?.getAttribute('data-slot')).toBe('table-container')
    expect(table.parentElement?.className).toContain('overflow-x-auto')
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
    expect(screen.getByText('Mensaje')).toBeTruthy()
  })
})
