import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import SystemSettingsNextPage from './SystemSettingsNextPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import type { SystemSettingsData } from '../../api/systemSettings'
import { tokenFor } from '../../../../test/jwtFixture'
import en from '../../../../i18n/en.json'

const next = en.settings.next

/**
 * `/admin/system-settings` is the one screen that can turn sign-in off for every user. The old
 * page's guarantees (a failed load keeps the title and offers a Retry that re-runs the fetch),
 * moved onto the redesigned page, plus the redesign's own: Guardar writes the same five fields
 * the old form wrote and nothing else, Descartar returns the draft, and the lock-out warning
 * shows while the operator is deciding.
 */
function settings(overrides: Partial<SystemSettingsData> = {}): SystemSettingsData {
  return {
    loginEnabled: true,
    maintenanceMode: false,
    maintenanceMessage: null,
    maxLoginAttempts: 5,
    sessionTimeoutMinutes: 60,
    passwordPolicy: { minLength: 8, requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: false },
    emailSettings: { smtpEnabled: false, fromEmail: null, smtpHost: null, smtpPort: null },
    updatedAt: '2026-08-12T02:47:06Z',
    ...overrides,
  }
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/admin/system-settings']}>
        <SystemSettingsNextPage />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function serve(read: () => Response) {
  vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(init?.method === 'PUT' ? new Response(JSON.stringify(settings()), { status: 200 }) : read()),
  )
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  setToken(tokenFor({ role: 'super_admin' }))
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SystemSettingsNextPage', () => {
  it('loads the settings into the form under the page title', async () => {
    serve(() => new Response(JSON.stringify(settings({ maintenanceMessage: 'Back soon' })), { status: 200 }))
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: en.navigation.systemSettings })).toBeTruthy()
    expect(await screen.findByDisplayValue('Back soon')).toBeTruthy()
    expect(screen.getByRole('switch', { name: next.loginEnabled }).getAttribute('aria-checked')).toBe('true')
  })

  it('keeps the title on a failed load, says so in the app’s own words, and Retry re-fetches', async () => {
    serve(() => new Response(null, { status: 500 }))
    renderPage()
    expect(await screen.findByText(en.settings.loadError)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: en.navigation.systemSettings })).toBeTruthy()
    serve(() => new Response(JSON.stringify(settings()), { status: 200 }))
    await userEvent.click(screen.getByRole('button', { name: en.common.retry }))
    expect(await screen.findByRole('switch', { name: next.loginEnabled })).toBeTruthy()
  })

  it('writes exactly the five availability and session fields — never the password policy or the mail settings', async () => {
    serve(() => new Response(JSON.stringify(settings()), { status: 200 }))
    renderPage()
    const timeout = await screen.findByLabelText(next.timeout)
    await userEvent.clear(timeout)
    await userEvent.type(timeout, '30')
    await userEvent.click(screen.getByRole('button', { name: en.common.save }))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true))
    const put = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')
    const body = JSON.parse(String(put?.[1]?.body)) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['loginEnabled', 'maintenanceMessage', 'maintenanceMode', 'maxLoginAttempts', 'sessionTimeoutMinutes'])
    expect(body.sessionTimeoutMinutes).toBe(30)
  })

  it('returns the draft to what the server holds on Discard', async () => {
    serve(() => new Response(JSON.stringify(settings()), { status: 200 }))
    renderPage()
    const message = await screen.findByLabelText(next.maintenanceMessage)
    await userEvent.type(message, 'Maintenance tonight')
    expect(screen.getByDisplayValue('Maintenance tonight')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: next.discard }))
    expect(screen.queryByDisplayValue('Maintenance tonight')).toBeNull()
  })

  it('warns before a save that locks everyone but a super administrator out', async () => {
    serve(() => new Response(JSON.stringify(settings()), { status: 200 }))
    renderPage()
    const login = await screen.findByRole('switch', { name: next.loginEnabled })
    expect(screen.queryByText(en.settings.lockoutWarningTitle)).toBeNull()
    await userEvent.click(login)
    expect(screen.getByText(en.settings.lockoutWarningTitle)).toBeTruthy()
  })

  it('states the password policy and the stored mail settings read-only, with where they are really decided', async () => {
    serve(() => new Response(JSON.stringify(settings()), { status: 200 }))
    renderPage()
    expect(await screen.findByText(next.passwordNote)).toBeTruthy()
    expect(screen.getByText(next.mailNote)).toBeTruthy()
    // An operator screen names where mail is decided, never the raw configuration key.
    expect(document.body.textContent).not.toMatch(/Email:Provider/)
    expect(screen.getByText(next.minLengthValue.replace('{count}', '8'))).toBeTruthy()
    // Read-only: no control edits either block.
    expect(screen.queryByRole('textbox', { name: next.fromAddress })).toBeNull()
    expect(screen.queryByRole('spinbutton', { name: next.minLength })).toBeNull()
  })
})

// SystemSettings artboard: "60 minutos" on the left of the field, the unit after the digits.
// happy-dom lays nothing out, so the placement is pinned as the offset the page computes.
describe('SystemSettingsNextPage — the session timeout reads "60 minutos"', () => {
  it('sets the unit right after the digits, one digit-width past them', async () => {
    serve(() => new Response(JSON.stringify(settings({ sessionTimeoutMinutes: 60 })), { status: 200 }))
    renderPage()
    const unit = await waitFor(() => {
      const found = document.querySelector('[data-slot="timeout-unit"]') as HTMLElement | null
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(unit.textContent).toBe(next.minutesUnit)
    expect(unit.style.getPropertyValue('--unit-offset')).toBe('3ch')
    expect(unit.className).toMatch(/left-\[calc\(var\(--admin-space-12\)_\+_1px_\+_var\(--unit-offset\)\)\]/)
    expect(unit.className).not.toMatch(/right-/)
  })
})
