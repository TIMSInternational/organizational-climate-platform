import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
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
/**
 * The token `POST /profile/password` hands back.
 *
 * It used to be the literal `'header.renewed.signature'`, which is not a token: the endpoint
 * ends in `AuthEndpoints.IssueTokenForAsync`, so what really arrives is a signed JWT carrying
 * the caller's own claims. That only became visible when `/profile` started reading the token
 * to decide whether the caller is a respondent — an undecodable one reads as "no role", which
 * is the per-user nav, which redirected a company_admin off the page mid-password-change.
 * A fixture that cannot be decoded was asserting a flow production does not have.
 *
 * `stamp` only makes the string differ from the one `beforeEach` sets, so "the REPLACEMENT
 * token is stored" is still what is being tested.
 */
const RENEWED_TOKEN = tokenFor({
  sub: '7b34dd6e-3472-4180-9873-ec5cf7d2af65',
  role: 'company_admin',
  companyId: '16c97c29-07f8-4522-86fc-e6cc56298829',
  name: 'Ana Rojas',
  stamp: 'renewed',
})

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
      return options.passwordRejected ? json({ message: 'La contraseña actual no coincide.' }, 400) : json({ token: RENEWED_TOKEN })
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

/**
 * ESPH finding 3: *"se ven los datos demográficos como Nombre, Departamento y esa información
 * es imprescindible ocultarla del evaluado (por temas de anonimato por ello los usuarios deben
 * ser códigos y no nombres)"*.
 *
 * Ruled by Federico 2026-10-18, superseding the earlier ruling the same day that the account
 * pages stay reachable by URL: *"the action button … should not be there. All this should be
 * inaccessible for them."* Removing the links closed the doors a respondent can see; this
 * closes the address.
 */
describe('ProfileNextPage — the respondent is not shown their own name', () => {
  function renderAsRespondent(role: string) {
    setToken(tokenFor({ sub: PROFILE.id, role, companyId: PROFILE.companyId, name: 'Ana Rojas' }))
    routeFetch()
    return render(
      <TranslationProvider initialLocale="es">
        <MemoryRouter initialEntries={['/profile']}>
          <Routes>
            <Route path="/profile" element={<ProfileNextPage />} />
            <Route path="/dashboard" element={<p>panel</p>} />
          </Routes>
        </MemoryRouter>
      </TranslationProvider>,
    )
  }

  it('sends an employee to their own home instead of rendering the page', async () => {
    renderAsRespondent('employee')
    expect(await screen.findByText('panel')).toBeTruthy()
  })

  it('never puts the name or the department in the DOM, not even for a frame', async () => {
    renderAsRespondent('employee')
    await screen.findByText('panel')
    // The two the reviewer named. `Ana Rojas` is in the token as well as the payload, so a
    // render that reached the eyebrow would print it before any fetch resolved.
    expect(screen.queryByText('Ana Rojas')).toBeNull()
    expect(screen.queryByDisplayValue('Ana Rojas')).toBeNull()
    expect(screen.queryByRole('heading', { name: es.profile.accountTitle })).toBeNull()
  })

  it('redirects a role this build does not recognise, which takes the per-user nav', () => {
    // Not the `isPerUserOnly([]) === false` case: an unknown role falls to the dispatch's
    // DEFAULT navigation, which IS the per-user set — so it is a respondent here, and the
    // safe answer is the same one.
    renderAsRespondent('auditor')
    expect(screen.getByText('panel')).toBeTruthy()
  })

  it('redirects a supervisor too, whose every page is also their own', () => {
    // Measured, not assumed: `navSections.test.ts:712` and `AdminLayout.test.tsx`'s
    // `PER_USER_ROLES = ['supervisor', 'employee']` both already say so, and the nav note
    // gives the reason -- "no admin page exists for this role yet". A supervisor in this
    // build has no admin surface, so #594 already gives them the railless shell; this
    // follows that decision rather than inventing a second one.
    renderAsRespondent('supervisor')
    expect(screen.getByText('panel')).toBeTruthy()
  })

  it('still lets every role that administers anything in', async () => {
    // The guard is the shell's own predicate, not a role list. A company_admin's navigation
    // is not per-user, so nothing changes for them -- the control for all of the above.
    for (const role of ['company_admin', 'leader', 'super_admin']) {
      renderAsRespondent(role)
      expect(await screen.findByRole('heading', { name: es.profile.accountTitle })).toBeTruthy()
      cleanup()
    }
  })
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
    expect(getToken()).toBe(RENEWED_TOKEN)
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
    const link = within(preferences).getByRole('link', { name: es.profile.notificationPreferencesLink })
    expect(link.getAttribute('href')).toBe('/settings/notifications')
    // The board sets it in the sentence's own ink, not the app's blue link colour.
    expect(link.className).toMatch(/(^|\s)text-fg-secondary(\s|$)/)
    fireEvent.change(within(preferences).getByLabelText(es.profile.next.preferences.theme), { target: { value: 'dark' } })
    fireEvent.click(within(preferences).getByRole('button', { name: es.profile.next.save }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT' && call.url.includes('/profile/preferences'))).toBe(true))
    const body = calls.find((call) => call.method === 'PUT' && call.url.includes('/profile/preferences'))?.body
    expect(JSON.stringify(body)).not.toMatch(/email|digest/i)
  })

  it('says when the stored language is not the one this screen is in, naming each language as the board does', async () => {
    routeFetch()
    renderPage()
    await screen.findByRole('heading', { name: es.profile.preferencesTitle })
    const P = es.profile.next.preferences
    // The lead names the stored language by its own name, as the board's «Guardado en tu cuenta: English y UTC».
    expect(screen.getByText(P.storedLead.replace('{language}', 'English').replace('{timezone}', 'UTC'))).toBeTruthy()
    // Mid-sentence, Spanish writes a language in lower case: «está en español, pero tus correos salen en inglés».
    expect(screen.getByText(P.storedDiffers.replace('{screen}', 'español').replace('{language}', 'inglés'))).toBeTruthy()
    // The picker offers each language by its own name, never the Spanish exonym «Inglés».
    const picker = within(region(es.profile.preferencesTitle)).getByLabelText(es.profile.language)
    expect([...picker.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['English', 'Español'])
    expect(screen.queryByText(new RegExp(es.language.english))).toBeNull()
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
