import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import { NotificationBell } from './NotificationBell'
import { notifyNotificationsChanged } from '../notificationsChanged'

function row(id: string, title: string) {
  return {
    id,
    userId: 'u1',
    companyId: 'c1',
    type: 'survey_invitation',
    channel: 'in_app',
    priority: 'medium',
    status: 'sent',
    title,
    message: `Message for ${title}`,
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
}

function unreadResponse(...rows: ReturnType<typeof row>[]) {
  return new Response(JSON.stringify({ notifications: rows }), { status: 200 })
}

function renderBell() {
  const router = createMemoryRouter(
    [
      { path: '/action-plans', element: <NotificationBell /> },
      { path: '/notifications', element: <p>inbox page</p> },
    ],
    { initialEntries: ['/action-plans'] },
  )
  return render(
    <TranslationProvider>
      <RouterProvider router={router} />
    </TranslationProvider>,
  )
}

beforeEach(() => {
  setToken('test-token')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(unreadResponse(row('n1', 'Survey ready'))))
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.restoreAllMocks()
})

describe('NotificationBell', () => {
  it('names its trigger with the unread count, not with the badge alone', async () => {
    // The primitive marks the count badge `aria-hidden`, so a screen-reader user
    // hears only what the trigger's accessible name carries.
    renderBell()
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeTruthy()
  })

  it('drops the count from the name when there is nothing unread', async () => {
    vi.mocked(fetch).mockResolvedValue(unreadResponse())
    renderBell()
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy()
  })

  it('renders a keyboard-reachable control', async () => {
    // #80 shipped a nav row whose chevron was unreachable by keyboard entirely.
    // A bell that can only be clicked is that defect again.
    renderBell()
    const trigger = await screen.findByRole('button', { name: /Notifications/ })
    await userEvent.tab()
    expect(document.activeElement).toBe(trigger)
  })

  it('opens with the keyboard and lists the unread notifications', async () => {
    renderBell()
    const trigger = await screen.findByRole('button', { name: /Notifications/ })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByText('Survey ready')).toBeTruthy()
    expect(screen.getByText('Message for Survey ready')).toBeTruthy()
  })

  it('offers a "view all" row inside the menu, so it takes part in the menu’s focus order', async () => {
    renderBell()
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }))
    const viewAll = await screen.findByRole('menuitem', { name: 'View all notifications' })
    expect(viewAll.querySelector('a')?.getAttribute('href') ?? viewAll.getAttribute('href')).toBe(
      '/notifications',
    )
  })

  it('marks a selected notification read and goes to the inbox', async () => {
    renderBell()
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }))
    vi.mocked(fetch).mockResolvedValue(unreadResponse())
    await userEvent.click(await screen.findByText('Survey ready'))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/notifications/n1/read'),
        expect.objectContaining({ method: 'POST' }),
      ),
    )
    expect(await screen.findByText('inbox page')).toBeTruthy()
  })

  it('drops the badge when the inbox announces a change, without waiting out the poll interval', async () => {
    renderBell()
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeTruthy()

    vi.mocked(fetch).mockResolvedValue(unreadResponse())
    notifyNotificationsChanged()

    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy()
  })

  it('renders its copy in Spanish, so the bell is not an English island in the shell', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    renderBell()
    expect(await screen.findByRole('button', { name: 'Notificaciones, 1 sin leer' })).toBeTruthy()
  })
})
