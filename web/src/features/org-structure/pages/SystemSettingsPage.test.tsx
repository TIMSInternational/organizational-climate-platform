import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import SystemSettingsPage from './SystemSettingsPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import type { SystemSettingsData } from '../api/systemSettings'

/**
 * `/admin/system-settings` is the one screen that can turn sign-in off for every user, and
 * it had no test (measured 2026-09-03). The page's own doc comment records the guarantee
 * worth pinning: a failed load keeps the title, renders through `ErrorState`, and offers a
 * Retry that re-runs the same fetch — it used to erase the page to a bare sentence.
 */
function settings(overrides: Partial<SystemSettingsData> = {}): SystemSettingsData {
  return {
    loginEnabled: true,
    maintenanceMode: false,
    maintenanceMessage: null,
    maxLoginAttempts: 5,
    sessionTimeoutMinutes: 60,
    passwordPolicy: { minLength: 8, requireUppercase: false, requireLowercase: false, requireNumbers: false, requireSpecialChars: false },
    emailSettings: { smtpEnabled: false, fromEmail: null, smtpHost: null, smtpPort: null },
    updatedAt: '2026-09-01T12:00:00Z',
    ...overrides,
  }
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/admin/system-settings']}>
        <SystemSettingsPage />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  setToken('test-token')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SystemSettingsPage', () => {
  it('loads the settings into the form under the page title', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(settings()), { status: 200 }))
    renderPage()
    expect(screen.getByRole('heading', { name: 'System Settings' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull())
    // The form is on screen and carries the payload: the two switches, and the session
    // timeout the fixture set to 60.
    expect((await screen.findAllByRole('switch')).length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByRole('spinbutton').some((el) => (el as HTMLInputElement).value === '60')).toBe(true)
  })

  it('keeps the title on a failed load, says so in the app’s own words, and Retry re-fetches', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify(settings()), { status: 200 }))
    renderPage()
    expect(await screen.findByText('System settings could not be loaded.')).toBeTruthy()
    expect(screen.getByText('Network error. Please check your connection.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'System Settings' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('System settings could not be loaded.')).toBeNull())
    expect((await screen.findAllByRole('switch')).length).toBeGreaterThanOrEqual(2)
  })
})
