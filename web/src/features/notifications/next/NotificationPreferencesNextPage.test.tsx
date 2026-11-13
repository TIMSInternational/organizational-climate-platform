import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { clearToken, setToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'
import type { NotificationPreferences } from '../api/notificationPreferences'
import NotificationPreferencesNextPage from './NotificationPreferencesNextPage'
import es from '../../../i18n/es.json'

/** `/settings/notifications` (NotificationPreferences artboard) — the saved values, one save. */
const T = es.notifications.next.prefs
const SAVED: NotificationPreferences = {
  emailSurveys: true,
  emailMicroclimates: false,
  emailActionPlans: true,
  emailReminders: true,
  digestFrequency: 'weekly',
}

function routeFetch(options: { failFirst?: number } = {}) {
  let failures = options.failFirst ?? 0
  const calls: { method: string; url: string; body: unknown }[] = []
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.includes('/notifications/preferences')) {
      if (method === 'GET' && failures > 0) {
        failures -= 1
        return Promise.resolve(new Response(JSON.stringify({ message: `fallo ${failures}` }), { status: 500 }))
      }
      if (method === 'PUT') return Promise.resolve(new Response(String(init?.body), { status: 200 }))
      return Promise.resolve(new Response(JSON.stringify(SAVED), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify({ notifications: [] }), { status: 200 }))
  })
  return calls
}

function renderPage() {
  return render(
    <TranslationProvider initialLocale="es">
      <MemoryRouter initialEntries={['/settings/notifications']}>
        <NotificationPreferencesNextPage />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const row = (key: string) => document.querySelector(`li[data-pref="${key}"]`) as HTMLElement
const saveButton = () => screen.getByRole('button', { name: T.save })
const discardButton = () => screen.getByRole('button', { name: T.discard })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  setToken(tokenFor({ sub: 'u-1', role: 'employee', companyId: 'c-1' }))
})

afterEach(() => {
  cleanup()
  clearToken()
  vi.unstubAllGlobals()
})

describe('NotificationPreferencesNextPage', () => {
  it('draws the values the account holds, never a guessed default, and says what they are', async () => {
    routeFetch()
    renderPage()
    await screen.findByRole('heading', { name: T.tableHeading })
    expect(within(row('emailMicroclimates')).getByRole('switch').getAttribute('aria-checked')).toBe('false')
    expect(within(row('emailSurveys')).getByRole('switch').getAttribute('aria-checked')).toBe('true')
    expect((screen.getByLabelText(new RegExp(es.notifications.preferences.digestTitle)) as HTMLSelectElement).value).toBe('weekly')
    const summary = `${T.summary.replace('{emails}', T.someOn.replace('{on}', '3').replace('{total}', '4')).replace('{digest}', T.digestWeekly)}`
    expect(screen.getByText(new RegExp(summary))).toBeTruthy()
  })

  it('offers exactly the four configurable emails and no push or SMS control', async () => {
    routeFetch()
    renderPage()
    await screen.findByRole('heading', { name: T.tableHeading })
    expect(screen.getAllByRole('switch')).toHaveLength(4)
    expect(screen.getByText(T.alwaysSent)).toBeTruthy()
  })

  /**
   * On a phone (G26 follow-up, #624). The page was a 40rem table in a horizontal scroller, and at
   * 390px every switch sat outside the card: readable, not changeable, by the employee who opened
   * it from the footer of a notification email. Since the 11 Nov redesign it is a grouped list.
   * The suite has no layout engine, so this pins the structure that keeps every switch on the
   * card: nothing scrolls sideways, and each row wraps its switch under its text instead of
   * pushing it past the card's clipped edge. Rendered 12 Nov at 390px as an employee
   * (`npm run shot -- /settings/notifications … --role employee --width 390`): each switch sits
   * under its text, inside the card.
   */
  it('keeps every switch on the card at phone width: no sideways scroller, and each row wraps', async () => {
    routeFetch()
    renderPage()
    await screen.findByRole('heading', { name: T.tableHeading })
    expect(document.querySelector('table')).toBeNull()
    expect(document.querySelector('[class*="overflow-x-"]')).toBeNull()
    for (const key of ['emailSurveys', 'emailMicroclimates', 'emailActionPlans', 'emailReminders']) {
      const item = row(key)
      expect(item.className.split(/\s+/)).toContain('flex-wrap')
      expect(within(item).getByRole('switch')).toBeTruthy()
    }
  })

  it('titles the page «Cuenta» like its two sibling tabs and saves from the list’s own footer, not the header', async () => {
    routeFetch()
    renderPage()
    await screen.findByRole('heading', { name: T.tableHeading })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(es.profile.next.tabs.label)
    const header = document.querySelector('[data-slot="page-header"]') as HTMLElement
    expect(within(header).queryByRole('button')).toBeNull()
    const footer = document.querySelector('[data-slot="prefs-actions"]') as HTMLElement
    expect(footer.closest('section')?.getAttribute('aria-labelledby')).toBe('prefs-table')
    expect(within(footer).getByRole('button', { name: T.save })).toBeTruthy()
    expect(within(footer).getByRole('button', { name: T.discard })).toBeTruthy()
  })

  it('draws Guardar and Descartar live on load, as the board does; Descartar puts back what is saved', async () => {
    const calls = routeFetch()
    renderPage()
    await screen.findByRole('heading', { name: T.tableHeading })
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false)
    expect((discardButton() as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(within(row('emailMicroclimates')).getByRole('switch'))
    expect(screen.getByText(new RegExp(T.unsaved))).toBeTruthy()
    fireEvent.click(discardButton())
    expect(within(row('emailMicroclimates')).getByRole('switch').getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(new RegExp(T.nothingChanges))).toBeTruthy()
    // Guardar with nothing moved sends the saved values back unchanged — never a default.
    fireEvent.click(saveButton())
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true))
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual(SAVED)
  })

  it('saves exactly what was set and keeps the values the server returns', async () => {
    const calls = routeFetch()
    renderPage()
    await screen.findByRole('heading', { name: T.tableHeading })
    fireEvent.click(within(row('emailMicroclimates')).getByRole('switch'))
    fireEvent.change(screen.getByLabelText(new RegExp(es.notifications.preferences.digestTitle)), { target: { value: 'daily' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true))
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ ...SAVED, emailMicroclimates: true, digestFrequency: 'daily' })
    expect(await screen.findByText(new RegExp(T.allOn.replace('{count}', '4')))).toBeTruthy()
    await waitFor(() => expect((saveButton() as HTMLButtonElement).disabled).toBe(false))
  })

  it('sets the Privacidad link in the sentence’s own ink, as the board does', async () => {
    routeFetch()
    renderPage()
    await screen.findByRole('heading', { name: T.tableHeading })
    // The account tabs carry a "Privacidad" link too; this is the one in «Cómo se decide».
    const link = within(screen.getByRole('region', { name: T.howHeading })).getByRole('link', { name: es.profile.next.tabs.privacy })
    expect(link.getAttribute('href')).toBe('/settings/privacy')
    expect(link.className).toMatch(/(^|\s)text-fg-secondary(\s|$)/)
  })

  it('shows a load failure instead of an empty table, and recovers without a reload', async () => {
    routeFetch({ failFirst: 1 })
    renderPage()
    expect(await screen.findByText(es.notifications.preferences.loadError)).toBeTruthy()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: es.common.retry }))
    expect(await screen.findByRole('heading', { name: T.tableHeading })).toBeTruthy()
  })
})
