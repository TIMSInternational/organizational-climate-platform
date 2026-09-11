import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { clearToken, setToken } from '../../../auth/token'
import { CompanyContextProvider } from '../../../company-context'
import { tokenFor } from '../../../test/jwtFixture'
import { downloadTextFile } from '../../../lib/downloadTextFile'
import PrivacyNextPage from './PrivacyNextPage'
import es from '../../../i18n/es.json'

vi.mock('../../../lib/downloadTextFile', () => ({ downloadTextFile: vi.fn() }))

/**
 * `/settings/privacy` (PrivacySettings artboard): nothing read from `GET /gdpr/access` until the
 * reader asks — every read of it is audited — and then the whole export as a JSON file.
 */
const T = es.privacy.next
const ME = '7b34dd6e-3472-4180-9873-ec5cf7d2af65'
const PROFILE = { id: ME, companyId: 'c-1', companyName: 'Grupo Meridiano S.A.', email: 'ana.rojas@meridiano.test', name: 'Ana Rojas', role: 'company_admin', departmentId: null, departmentName: null, managerId: null, isActive: true, hasPassword: true, lastLoginAt: null, createdAt: '2026-09-10T01:58:51Z', demographics: {} }
const EXPORT = { subject: { userId: ME, email: PROFILE.email, name: PROFILE.name }, generatedAt: '2026-09-11T05:14:34Z', complete: false, sources: [], limitations: [], sections: [] }
const PLANS = [
  { id: 'p3', planCode: 'PA-2026-00003', responsableEjecucionExternalId: ME, nodoExternalId: 'n', estadoSemaforo: 'Verde' },
  { id: 'p1', planCode: 'PA-2026-00001', responsableEjecucionExternalId: 'someone-else', nodoExternalId: 'n', estadoSemaforo: 'Rojo' },
]

function routeFetch(options: { exportFails?: boolean } = {}) {
  const calls: { method: string; url: string }[] = []
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ method, url })
    const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
    if (url.includes('/gdpr/access')) return options.exportFails ? json({ message: 'El servicio no respondió' }, 500) : json(EXPORT)
    if (url.includes('/notifications/preferences'))
      return json({ emailSurveys: true, emailMicroclimates: true, emailActionPlans: true, emailReminders: true, digestFrequency: 'weekly' })
    if (url.includes('/api/planes-accion')) return json(PLANS)
    if (url.endsWith('/profile')) return json(PROFILE)
    return json({ notifications: [] })
  })
  return calls
}

function renderPage() {
  return render(
    <TranslationProvider initialLocale="es">
      <MemoryRouter initialEntries={['/settings/privacy']}>
        <CompanyContextProvider>
          <PrivacyNextPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.mocked(downloadTextFile).mockClear()
  setToken(tokenFor({ sub: ME, role: 'company_admin', companyId: 'c-1', name: 'Ana Rojas' }))
})

afterEach(() => {
  cleanup()
  clearToken()
  vi.unstubAllGlobals()
})

describe('PrivacyNextPage', () => {
  it('reads nothing from the audited export until the reader asks for it', async () => {
    const calls = routeFetch()
    renderPage()
    expect(await screen.findByText(PROFILE.email)).toBeTruthy()
    expect(calls.some((call) => call.url.includes('/gdpr/access'))).toBe(false)
    expect(screen.getAllByText(T.consent.inFile)).toHaveLength(6)
  })

  it('spells the consent count in the card’s meta, as the board writes it: «seis consentimientos»', async () => {
    routeFetch()
    renderPage()
    expect(await screen.findByText(PROFILE.email)).toBeTruthy()
    const rows = screen.getAllByText(T.consent.inFile).length
    expect(screen.getByText(T.consent.meta.replace('{count}', es.dashboard.next.countWord[String(rows) as '6']))).toBeTruthy()
    expect(screen.queryByText(T.consent.meta.replace('{count}', String(rows)))).toBeNull()
  })

  it('downloads the whole export as parseable JSON when asked', async () => {
    routeFetch()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: T.download }))
    await waitFor(() => expect(vi.mocked(downloadTextFile)).toHaveBeenCalledTimes(1))
    const [fileName, mime, contents] = vi.mocked(downloadTextFile).mock.calls[0]
    expect(fileName).toBe(es.privacy.downloadFileName.replace('{date}', '2026-09-11'))
    expect(mime).toBe('application/json')
    expect(JSON.parse(contents)).toEqual(EXPORT)
  })

  it('reports a failed request with the API message and keeps the page usable', async () => {
    routeFetch({ exportFails: true })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: T.download }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(vi.mocked(downloadTextFile)).not.toHaveBeenCalled()
    await waitFor(() => expect((screen.getByRole('button', { name: T.download }) as HTMLButtonElement).disabled).toBe(false))
  })

  it('offers no control that would try to erase the reader', async () => {
    const calls = routeFetch()
    renderPage()
    await screen.findByText(PROFILE.email)
    expect(screen.queryByRole('button', { name: /borr|elimin/i })).toBeNull()
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
  })

  it('names the tracking plans the reader answers for, and only those', async () => {
    routeFetch()
    renderPage()
    expect(await screen.findByText(new RegExp(T.tracking.responsible.replace('{codes}', 'PA-2026-00003')))).toBeTruthy()
    expect(screen.queryByText(/PA-2026-00001/)).toBeNull()
  })

  it('reads the one consent the reader changes from their saved emails', async () => {
    routeFetch()
    renderPage()
    const expected = T.consent.emailsValue.replace('{on}', '4').replace('{total}', '4').replace('{digest}', es.notifications.next.prefs.digestWeekly)
    expect(await screen.findByText(expected)).toBeTruthy()
  })

  it('does not claim a copy succeeded when the clipboard refused', async () => {
    routeFetch()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    renderPage()
    await screen.findByText(PROFILE.email)
    fireEvent.click(screen.getByRole('button', { name: T.request.copy }))
    expect(await screen.findByText(T.request.copyRefused)).toBeTruthy()
    expect(screen.queryByText(T.request.copied)).toBeNull()
  })
})
