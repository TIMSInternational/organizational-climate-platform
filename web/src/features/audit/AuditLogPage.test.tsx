import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import AuditLogPage from './AuditLogPage'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../i18n'
import { CompanyContextProvider } from '../../company-context'
import { clearToken, setToken } from '../../auth/token'
import { tokenFor } from '../../test/jwtFixture'
import es from '../../i18n/es.json'
import type { AuditLogItem, AuditLogPage as Page } from './api'

const T = es.audit
const COMPANY = '11111111-1111-1111-1111-111111111111'

function item(over: Partial<AuditLogItem> & { id: string }): AuditLogItem {
  return {
    source: 'audit_logs',
    userId: 'u1',
    userName: 'Irene Solano',
    userEmail: 'irene@esph.test',
    action: 'surveys.status.update',
    resource: 'surveys.status',
    resourceId: '21031c47-6548-468c-87d6-4b5df1ff824d',
    success: true,
    errorMessage: null,
    ipAddress: '10.0.0.1',
    timestamp: '2026-10-22T19:05:00Z',
    ...over,
  }
}

const PAGE: Page = {
  items: [
    item({ id: 'a1' }),
    item({ id: 'a2', action: 'a.route.this.bundle.never.heard.of.create', success: false }),
    item({ id: 'a3', userId: null, userName: null, userEmail: null, action: 'surveys.status.closed' }),
  ],
  total: 3,
  page: 1,
  pageSize: 50,
}

function fetchWith(audit: () => Response) {
  const urls: URL[] = []
  const mock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://api.test')
    urls.push(url)
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
    if (url.pathname.endsWith(`/admin/companies/${COMPANY}/settings`)) {
      return json({ companyId: COMPANY, settings: { timezone: 'America/Costa_Rica', language: 'es' }, branding: {} })
    }
    if (url.pathname.endsWith('/audit/logs')) return Promise.resolve(audit())
    if (url.pathname.endsWith('/profile')) return json({ companyName: 'ESPH' })
    return json({})
  })
  return { mock, urls }
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/admin/audit']}>
        <CompanyContextProvider>
          <AuditLogPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('AuditLogPage', () => {
  beforeEach(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  })

  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('shows who did what to which record, on the company’s clock and in Spanish', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: COMPANY }))
    const { mock, urls } = fetchWith(() => ok(PAGE))
    vi.stubGlobal('fetch', mock)
    renderPage()

    const first = (await screen.findAllByText('Irene Solano'))[0]!.closest('tr')!
    // 19:05 UTC is 13:05 in Costa Rica: the company's zone, not the browser's.
    expect(within(first).getByText(/13:05/)).toBeTruthy()
    expect(within(first).getByText(es.audit.actions.surveys__status__update)).toBeTruthy()
    expect(within(first).getByText('21031c47-6548-468c-87d6-4b5df1ff824d')).toBeTruthy()

    // An action this bundle has no label for reads as the generic label, never as its code.
    const unknown = document.querySelector('[data-audit-id="a2"]')!
    expect(within(unknown as HTMLElement).getByText(T.unknownAction)).toBeTruthy()
    expect(unknown.textContent).not.toContain('never.heard')
    expect(within(unknown as HTMLElement).getByText(T.failed)).toBeTruthy()

    // A row no person wrote is the system's.
    const job = document.querySelector('[data-audit-id="a3"]') as HTMLElement
    expect(within(job).getByText(T.actorSystem)).toBeTruthy()
    expect(within(job).getByText(es.audit.actions.surveys__status__closed)).toBeTruthy()

    const asked = urls.find((url) => url.pathname.endsWith('/audit/logs'))!
    expect(asked.searchParams.get('companyId')).toBe(COMPANY)
    expect(asked.searchParams.get('page')).toBe('1')
    expect(screen.getByText(T.pageOf.replace('{page}', '1').replace('{pages}', '1').replace('{total}', '3'))).toBeTruthy()
  })

  it('a day filter asks for the company’s day, and goes back to page one', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: COMPANY }))
    const { mock, urls } = fetchWith(() => ok(PAGE))
    vi.stubGlobal('fetch', mock)
    renderPage()
    await screen.findAllByText('Irene Solano')

    fireEvent.change(screen.getByLabelText(T.filterFrom), { target: { value: '2026-10-21' } })

    await waitFor(() =>
      expect(urls.some((url) => url.searchParams.get('from') === '2026-10-21T06:00:00.000Z')).toBe(true),
    )
    const filtered = urls.filter((url) => url.searchParams.get('from') !== null).at(-1)!
    expect(filtered.searchParams.get('page')).toBe('1')
  })

  it('says, in Spanish, that the log is not theirs when the server refuses', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: COMPANY }))
    const { mock } = fetchWith(() => new Response(JSON.stringify({}), { status: 403 }))
    vi.stubGlobal('fetch', mock)
    renderPage()

    expect(await screen.findByText(T.notAllowedTitle)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('asks a super administrator to choose a company rather than mixing every tenant', async () => {
    setToken(tokenFor({ role: 'super_admin' }))
    const { mock, urls } = fetchWith(() => ok(PAGE))
    vi.stubGlobal('fetch', mock)
    renderPage()

    expect(await screen.findByText(es.companyContext.chooseACompany)).toBeTruthy()
    expect(urls.some((url) => url.pathname.endsWith('/audit/logs'))).toBe(false)
  })
})
