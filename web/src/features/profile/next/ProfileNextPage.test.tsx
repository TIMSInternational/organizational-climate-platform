import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { clearToken, getToken, setToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'
import ProfileNextPage from './ProfileNextPage'
import es from '../../../i18n/es.json'

/**
 * `/profile` (Profile artboard): four blocks, each saved on its own, through the same calls the
 * old page made. The fixture is the local API's `/profile` for ana.rojas on 11 Sep, trimmed.
 */
const PROFILE = {
  id: '7b34dd6e-3472-4180-9873-ec5cf7d2af65',
  companyId: '16c97c29-07f8-4522-86fc-e6cc56298829',
  companyName: 'Grupo Meridiano S.A.',
  email: 'ana.rojas@meridiano.test',
  name: 'Ana Rojas',
  role: 'company_admin',
  departmentId: null,
  departmentName: null,
  managerId: null,
  isActive: true,
  hasPassword: true,
  lastLoginAt: '2026-09-11T05:14:33Z',
  createdAt: '2026-09-10T01:58:51Z',
  demographics: {},
}
const PREFS = {
  display: { language: 'en', timezone: 'UTC', theme: 'light', dashboardLayout: 'default' },
  notifications: { emailSurveys: true, emailMicroclimates: true, emailActionPlans: true, emailReminders: true, digestFrequency: 'weekly' },
}

interface Options {
  profileFails?: boolean
  activityFails?: boolean
  passwordRejected?: boolean
  hasPassword?: boolean
}

function routeFetch(options: Options = {}) {
  const calls: { method: string; url: string; body: unknown }[] = []
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ method, url, body })
    const json = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status }))
    if (url.includes('/profile/password'))
      return options.passwordRejected ? json({ message: 'La contraseña actual no coincide.' }, 400) : json({ token: 'header.renewed.signature' })
    if (url.includes('/profile/preferences')) return method === 'PUT' ? json({ ...PREFS, display: body }) : json(PREFS)
    if (url.includes('/profile/activity')) return options.activityFails ? json({ message: 'no' }, 500) : json({ activity: [] })
    if (url.endsWith('/profile')) {
      if (options.profileFails) return json({ message: 'Perfil no disponible' }, 500)
      return method === 'PUT' ? json({ ...PROFILE, name: body?.name }) : json({ ...PROFILE, hasPassword: options.hasPassword ?? true })
    }
    return json({ notifications: [] })
  })
  return calls
}

function renderPage() {
  return render(
    <TranslationProvider initialLocale="es">
      <MemoryRouter initialEntries={['/profile']}>
        <ProfileNextPage />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const region = (name: string) => screen.getByRole('region', { name })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  setToken(tokenFor({ sub: PROFILE.id, role: 'company_admin', companyId: PROFILE.companyId, name: 'Ana Rojas' }))
})

afterEach(() => {
  cleanup()
  clearToken()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('ProfileNextPage', () => {
  it('draws the four blocks and marks Tu perfil as the current tab', async () => {
    routeFetch()
    renderPage()
    expect(await screen.findByRole('heading', { name: es.profile.accountTitle })).toBeTruthy()
    for (const heading of [es.profile.preferencesTitle, es.profile.passwordTitle, es.profile.activityTitle]) {
      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy()
    }
    expect(screen.getByRole('link', { name: es.profile.next.tabs.profile }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByText(es.profile.next.activity.empty)).toBeTruthy()
  })

  it('saves the name and refreshes the activity', async () => {
    const calls = routeFetch()
    renderPage()
    await screen.findByRole('heading', { name: es.profile.accountTitle })
    const details = region(es.profile.accountTitle)
    fireEvent.change(within(details).getByLabelText(new RegExp(es.profile.name)), { target: { value: 'Ana María Rojas' } })
    fireEvent.click(within(details).getByRole('button', { name: es.profile.next.save }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT' && call.url.endsWith('/profile'))).toBe(true))
    expect(calls.find((call) => call.method === 'PUT' && call.url.endsWith('/profile'))?.body).toEqual({ name: 'Ana María Rojas' })
    await waitFor(() => expect(calls.filter((call) => call.url.includes('/profile/activity')).length).toBe(2))
  })

  it('refuses a whitespace-only name without calling the API', async () => {
    const calls = routeFetch()
    renderPage()
    await screen.findByRole('heading', { name: es.profile.accountTitle })
    const details = region(es.profile.accountTitle)
    fireEvent.change(within(details).getByLabelText(new RegExp(es.profile.name)), { target: { value: '   ' } })
    fireEvent.click(within(details).getByRole('button', { name: es.profile.next.save }))
    expect(await within(details).findByText(es.profile.nameRequired)).toBeTruthy()
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
  })

  it('refuses a confirmation that does not match, without calling the API', async () => {
    const calls = routeFetch()
    renderPage()
    const password = region(await screen.findByRole('heading', { name: es.profile.passwordTitle }).then(() => es.profile.passwordTitle))
    fireEvent.change(within(password).getByLabelText(new RegExp(es.profile.currentPassword)), { target: { value: 'Demo1234!' } })
    fireEvent.change(within(password).getByLabelText(new RegExp(`^${es.profile.newPassword}`)), { target: { value: 'Nueva1234!' } })
    fireEvent.change(within(password).getByLabelText(new RegExp(es.profile.confirmPassword)), { target: { value: 'Otra1234!' } })
    fireEvent.click(within(password).getByRole('button', { name: es.profile.changePassword }))
    expect(await within(password).findByText(es.profile.passwordMismatch)).toBeTruthy()
    expect(calls.some((call) => call.url.includes('/profile/password'))).toBe(false)
  })

  it('stores the replacement token once the change succeeds, and clears the fields', async () => {
    routeFetch()
    renderPage()
    await screen.findByRole('heading', { name: es.profile.passwordTitle })
    const password = region(es.profile.passwordTitle)
    fireEvent.change(within(password).getByLabelText(new RegExp(es.profile.currentPassword)), { target: { value: 'Demo1234!' } })
    fireEvent.change(within(password).getByLabelText(new RegExp(`^${es.profile.newPassword}`)), { target: { value: 'Nueva1234!' } })
    fireEvent.change(within(password).getByLabelText(new RegExp(es.profile.confirmPassword)), { target: { value: 'Nueva1234!' } })
    fireEvent.click(within(password).getByRole('button', { name: es.profile.changePassword }))
    expect(await within(password).findByText(es.profile.passwordSaved)).toBeTruthy()
    expect(getToken()).toBe('header.renewed.signature')
    expect((within(password).getByLabelText(new RegExp(es.profile.currentPassword)) as HTMLInputElement).value).toBe('')
  })

  it("surfaces the server's own words when it refuses the change", async () => {
    routeFetch({ passwordRejected: true })
    renderPage()
    await screen.findByRole('heading', { name: es.profile.passwordTitle })
    const password = region(es.profile.passwordTitle)
    fireEvent.change(within(password).getByLabelText(new RegExp(es.profile.currentPassword)), { target: { value: 'mal' } })
    fireEvent.change(within(password).getByLabelText(new RegExp(`^${es.profile.newPassword}`)), { target: { value: 'Nueva1234!' } })
    fireEvent.change(within(password).getByLabelText(new RegExp(es.profile.confirmPassword)), { target: { value: 'Nueva1234!' } })
    fireEvent.click(within(password).getByRole('button', { name: es.profile.changePassword }))
    expect(await within(password).findByText('La contraseña actual no coincide.')).toBeTruthy()
  })

  it('hides the password block for an account with no password', async () => {
    routeFetch({ hasPassword: false })
    renderPage()
    await screen.findByRole('heading', { name: es.profile.accountTitle })
    expect(screen.queryByRole('heading', { name: es.profile.passwordTitle })).toBeNull()
  })

  it('saves the display preferences and never a notification preference', async () => {
    const calls = routeFetch()
    renderPage()
    await screen.findByRole('heading', { name: es.profile.preferencesTitle })
    const preferences = region(es.profile.preferencesTitle)
    // The link points at the other page rather than duplicating its switches. Read before the
    // save: the stored language is English, and a successful save applies it to this screen.
    expect(within(preferences).getByRole('link', { name: es.profile.notificationPreferencesLink }).getAttribute('href')).toBe('/settings/notifications')
    fireEvent.change(within(preferences).getByLabelText(es.profile.next.preferences.theme), { target: { value: 'dark' } })
    fireEvent.click(within(preferences).getByRole('button', { name: es.profile.next.save }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT' && call.url.includes('/profile/preferences'))).toBe(true))
    const body = calls.find((call) => call.method === 'PUT' && call.url.includes('/profile/preferences'))?.body
    expect(JSON.stringify(body)).not.toMatch(/email|digest/i)
  })

  it('says when the stored language is not the one this screen is in', async () => {
    routeFetch()
    renderPage()
    await screen.findByRole('heading', { name: es.profile.preferencesTitle })
    const lead = es.profile.next.preferences.storedLead.replace('{language}', es.language.english).replace('{timezone}', 'UTC')
    expect(screen.getByText(lead)).toBeTruthy()
  })

  it('shows a load failure instead of an empty page', async () => {
    routeFetch({ profileFails: true })
    renderPage()
    expect(await screen.findByText(es.profile.loadError)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: es.profile.accountTitle })).toBeNull()
  })

  it('still draws the account when only the activity fails', async () => {
    routeFetch({ activityFails: true })
    renderPage()
    expect(await screen.findByRole('heading', { name: es.profile.accountTitle })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: es.profile.activityTitle })).toBeNull()
  })
})
