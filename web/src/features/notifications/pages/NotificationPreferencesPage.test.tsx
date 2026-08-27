import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import NotificationPreferencesPage from './NotificationPreferencesPage'
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from '../api/notificationPreferences'

vi.mock('../api/notificationPreferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/notificationPreferences')>()),
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}))

afterEach(cleanup)

const SAVED: NotificationPreferences = {
  emailSurveys: false,
  emailMicroclimates: true,
  emailActionPlans: true,
  emailReminders: false,
  digestFrequency: 'monthly',
}

/**
 * A router, like every other page test in the repo has. This file was the one
 * exception, and only because the page happens to pass `PageTopBar` no
 * breadcrumbs — the `<Link>`s that need a router are inside that block. The page
 * eyebrow reads the current path, so the header now needs one unconditionally,
 * which is what the other 26 page tests were already providing.
 *
 * `initialEntries` is the page's real route, so the eyebrow resolves to the
 * Communication group rather than to nothing.
 */
function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/settings/notifications', element: <NotificationPreferencesPage /> }],
    { initialEntries: ['/settings/notifications'] },
  )
  return render(
    <TranslationProvider>
      <RouterProvider router={router} />
    </TranslationProvider>,
  )
}

describe('NotificationPreferencesPage', () => {
  beforeEach(() => {
    vi.mocked(getNotificationPreferences).mockReset()
    vi.mocked(updateNotificationPreferences).mockReset()
  })

  it('renders the persisted values, never a guessed default, once they arrive', async () => {
    vi.mocked(getNotificationPreferences).mockResolvedValue(SAVED)
    renderPage()

    // Nothing is offered before the real values land: a form rendered against a
    // guess would flash preferences the user never chose.
    expect(screen.queryAllByRole('switch')).toHaveLength(0)

    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(4))
    expect(
      screen.getAllByRole('switch').map((node) => node.getAttribute('aria-checked')),
    ).toEqual(['false', 'true', 'true', 'false'])
    expect(screen.getByLabelText('Monthly').getAttribute('aria-checked')).toBe('true')
  })

  it('has a heading and never mentions push', async () => {
    vi.mocked(getNotificationPreferences).mockResolvedValue(SAVED)
    const { container } = renderPage()

    expect(screen.getByRole('heading', { name: 'Notification preferences' })).toBeTruthy()
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(4))
    expect(container.textContent?.toLowerCase()).not.toContain('push')
  })

  it('saves exactly what was set and keeps the returned values', async () => {
    vi.mocked(getNotificationPreferences).mockResolvedValue(SAVED)
    vi.mocked(updateNotificationPreferences).mockImplementation((_, input) =>
      Promise.resolve(input),
    )
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(4))
    await userEvent.click(screen.getAllByRole('switch')[1])
    await userEvent.click(screen.getByLabelText('Never send a digest'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateNotificationPreferences).toHaveBeenCalledTimes(1))
    expect(vi.mocked(updateNotificationPreferences).mock.calls[0][1]).toEqual({
      emailSurveys: false,
      emailMicroclimates: false,
      emailActionPlans: true,
      emailReminders: false,
      digestFrequency: 'never',
    })
    expect(await screen.findByText('Your notification preferences were saved.')).toBeTruthy()
  })

  it('shows a load failure instead of an empty form', async () => {
    vi.mocked(getNotificationPreferences).mockRejectedValue(new Error('Request failed: 500'))
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Your notification preferences could not be loaded.')
    expect(alert.textContent).toContain('Request failed: 500')
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
  })

  /**
   * The retry, which a merge once dropped: two design lanes wrote this file, and the one
   * that landed was the one without it. The guarantee is that a failed load is
   * RECOVERABLE in place — not that a particular component renders. Asserting the button
   * alone would pass against a button that does nothing, so this drives the click and
   * requires the second call and the form that follows it.
   */
  it('recovers from a failed load without a reload', async () => {
    vi.mocked(getNotificationPreferences)
      .mockRejectedValueOnce(new Error('Request failed: 500'))
      .mockResolvedValueOnce(SAVED)
    renderPage()

    await screen.findByRole('alert')
    expect(getNotificationPreferences).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(4))
    expect(getNotificationPreferences).toHaveBeenCalledTimes(2)
    // The error is gone, not merely covered over by the form beneath it.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  /**
   * The second failure must re-render the error rather than leave the first message
   * standing -- that is why `setLoadError(null)` sits in the effect and not in the click
   * handler. Distinct messages, so a stale render cannot pass.
   */
  it('shows the second failure, not the first one left on screen', async () => {
    vi.mocked(getNotificationPreferences)
      .mockRejectedValueOnce(new Error('Request failed: 500'))
      .mockRejectedValueOnce(new Error('Request failed: 503'))
    renderPage()

    expect((await screen.findByRole('alert')).textContent).toContain('Request failed: 500')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Request failed: 503'),
    )
    expect(screen.getByRole('alert').textContent).not.toContain('500')
  })
})
