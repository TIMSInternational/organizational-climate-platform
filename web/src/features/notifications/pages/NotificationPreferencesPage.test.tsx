import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

function renderPage() {
  return render(
    <TranslationProvider>
      <NotificationPreferencesPage />
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
})
