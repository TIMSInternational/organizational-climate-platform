import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import PlatformDashboardView from './PlatformDashboardView'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../../i18n'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { setToken, clearToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import en from '../../../../i18n/en.json'

/**
 * The super administrator's no-tenant `/dashboard` — the per-role canvas's Panel de la
 * plataforma. `DashboardPage.test.tsx` pins that this role, with nothing selected, is sent
 * here; this file pins what the view makes of the five reads, and what it says when one
 * of them fails.
 */
const copy = en.superadmin.next.dashboard
const M = '16c97c29-07f8-4522-86fc-e6cc56298829'
const A = '22cc8ed9-2e02-401a-8d52-52068ff5e6c0'
const V = '5e98bdaa-16d3-4b4a-86cc-254c23b7ca95'

const DASHBOARD = {
  companyCount: 3,
  userCount: 92,
  activeUserCount: 91,
  surveyCount: 12,
  activeSurveyCount: 2,
  responseCount: 149,
  completedResponseCount: 149,
  companies: [
    { id: M, name: 'Grupo Meridiano S.A.', userCount: 42, activeSurveyCount: 1, completedResponseCount: 76, createdAt: '2026-09-10T01:58:51Z' },
    { id: A, name: 'Acme Corporation', userCount: 45, activeSurveyCount: 1, completedResponseCount: 73, createdAt: '2026-08-07T15:44:32Z' },
    { id: V, name: 'Verify Co', userCount: 1, activeSurveyCount: 0, completedResponseCount: 0, createdAt: '2026-07-31T20:42:50Z' },
  ],
}

const COMPANIES = {
  companies: [
    { id: M, name: 'Grupo Meridiano S.A.', emailDomain: 'meridiano.test', industry: 'Servicios', size: 'medium', country: 'Costa Rica', subscriptionTier: 'basic', createdAt: '2026-09-10T01:58:51Z' },
    { id: A, name: 'Acme Corporation', emailDomain: 'acme.test', industry: 'Manufacturing', size: '500-1000', country: 'Colombia', subscriptionTier: 'enterprise', createdAt: '2026-08-07T15:44:32Z' },
    { id: V, name: 'Verify Co', emailDomain: 'verifyco.test', industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-07-31T20:42:50Z' },
  ],
}

function survey(id: string, companyId: string, status: string, title: string, startDate: string, endDate: string, extra: object = {}) {
  return { id, title, companyId, type: 'periodic', status, language: 'both', startDate, endDate, responseCount: 24, targetAudienceCount: null, questionCount: 6, createdAt: '2026-08-08T04:04:24Z', ...extra }
}

// The open waves close well after any clock this suite runs on, so "behind pace" must be
// decided by the shares alone: Acme has none of its 24 in, which is behind on any day of
// its window; Meridiano's 3 of 24 is ahead of a window that long.
const SURVEYS = {
  surveys: [
    survey('s1', M, 'active', 'Encuesta de Clima Q4 (abierta)', '2026-09-03T02:03:39Z', '2099-10-10T02:03:39Z', { responseCount: 3, targetAudienceCount: 24 }),
    survey('s2', M, 'closed', 'Encuesta de Clima Q3', '2026-07-16T02:05:22Z', '2026-08-06T02:05:22Z'),
    survey('s3', A, 'active', 'Encuesta de Clima Q4 (abierta)', '2020-08-20T18:21:20Z', '2099-09-26T18:21:20Z', { responseCount: 0, targetAudienceCount: 24 }),
    survey('s4', A, 'draft', 'Engagement Check', '2026-09-01T14:00:00Z', '2026-09-15T22:00:00Z', { responseCount: 0, questionCount: 1, language: 'en' }),
  ],
}

const STATUS = {
  service: 'climate-project-api',
  status: 'ok',
  checkedAt: '2026-09-10T19:20:37Z',
  environment: 'Development',
  build: { commit: 'unknown', builtAt: 'unknown', runtime: '10.0.10' },
  database: { status: 'ok', latencyMs: 1, port: 5432, usesTransactionPoolerPort: false, maxPoolSize: 10, maxPoolSizeDefaulted: true },
  notificationQueue: { status: 'ok', pending: 0, due: 0, deadLettered: 0, oldestDueAgeSeconds: null },
  dispatcher: { status: 'never-run', lastDispatchAt: null },
  jobs: [
    { jobName: 'digests', intervalSeconds: 900, lastAttemptAt: '2026-09-10T19:15:46Z', lastSuccessAt: '2026-09-10T19:15:46Z', consecutiveFailures: 0, status: 'ok' },
    { jobName: 'notification-dispatch', intervalSeconds: 60, lastAttemptAt: '2026-09-10T19:20:09Z', lastSuccessAt: '2026-09-10T19:20:09Z', consecutiveFailures: 0, status: 'ok' },
  ],
}

const SETTINGS = {
  loginEnabled: true,
  maintenanceMode: false,
  maintenanceMessage: null,
  maxLoginAttempts: 5,
  sessionTimeoutMinutes: 60,
  passwordPolicy: { minLength: 8, requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: false },
  emailSettings: { smtpEnabled: false, fromEmail: null, smtpHost: null, smtpPort: null },
  updatedAt: '2026-08-12T02:47:06Z',
}

type Region = 'dashboard' | 'surveys' | 'system'

function serve(failing: Region[] = []) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    const answer = (region: Region | null, body: unknown) =>
      Promise.resolve(
        region && failing.includes(region)
          ? new Response(JSON.stringify({ message: 'down' }), { status: 500 })
          : new Response(JSON.stringify(body), { status: 200 }),
      )
    if (url.includes('/dashboard/super-admin')) return answer('dashboard', DASHBOARD)
    if (url.includes('/admin/system/status')) return answer('system', STATUS)
    if (url.includes('/admin/system-settings')) return answer(null, SETTINGS)
    if (url.includes('/admin/companies')) return answer(null, COMPANIES)
    if (url.includes('/surveys')) return answer('surveys', SURVEYS)
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

function renderView() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <CompanyContextProvider>
          <PlatformDashboardView />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  setToken(tokenFor({ role: 'super_admin', companyId: '' }))
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('PlatformDashboardView', () => {
  it('lays out the canvas’s regions from the five reads, with its one primary action', async () => {
    serve()
    renderView()
    expect(await screen.findByRole('heading', { level: 1, name: copy.title })).toBeTruthy()
    await screen.findByRole('heading', { level: 2, name: copy.companies.heading })
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      copy.companies.heading,
      copy.attention.heading,
      copy.system.heading,
      copy.mix.heading,
      copy.people.heading,
    ])
    expect(screen.getByRole('link', { name: copy.newCompany }).getAttribute('href')).toBe('/admin/companies?new=1')
    expect(screen.getByText(copy.tiles.peopleSub.replace('{active}', '91').replace('{orphans}', '4'))).toBeTruthy()
  })

  it('orders the tenants by activity and gives each a link to its detail', async () => {
    serve()
    renderView()
    await screen.findByRole('heading', { level: 2, name: copy.companies.heading })
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.map((row) => row.getAttribute('data-company-id'))).toEqual([M, A, V])
    expect(screen.getByRole('link', { name: 'Verify Co' }).getAttribute('href')).toBe(`/admin/companies/${V}`)
  })

  it('raises the attention items in the canvas’s order', async () => {
    serve()
    const { container } = renderView()
    await screen.findByRole('heading', { level: 2, name: copy.attention.heading })
    await waitFor(() =>
      expect([...container.querySelectorAll('[data-attention]')].map((item) => item.getAttribute('data-attention'))).toEqual([
        'behind-pace',
        'mail-off',
        'drafts',
        'unconfigured',
      ]),
    )
  })

  it('makes a tenant the active company when it is opened', async () => {
    serve()
    renderView()
    await userEvent.click(await screen.findByRole('button', { name: copy.companies.openNamed.replace('{name}', 'Acme Corporation') }))
    expect(localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBe(A)
  })

  it('says the system read failed rather than drawing a blank card, and keeps every other region', async () => {
    serve(['system'])
    renderView()
    expect(await screen.findByText(copy.system.failed)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: copy.people.heading })).toBeTruthy()
  })

  it('reads a survey list it could not fetch as unknown, and says so where it would have been used', async () => {
    serve(['surveys'])
    const { container } = renderView()
    expect(await screen.findByText(copy.companies.surveysUnavailable)).toBeTruthy()
    expect(screen.getByText(copy.mix.unavailable)).toBeTruthy()
    expect(container.querySelector('[data-attention="drafts"]')).toBeNull()
    expect(container.querySelector('[data-attention="behind-pace"]')).toBeNull()
  })

  it('makes the platform read’s failure the page’s error, with a retry', async () => {
    serve(['dashboard'])
    renderView()
    expect(await screen.findByText(copy.loadFailed)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('PlatformDashboardView sentences', () => {
  it('names the company by its short name mid-sentence: "con Acme como empresa activa", as the canvas writes it', async () => {
    serve()
    renderView()
    const tail = copy.attention.behindPaceSub.split('{company}')[1]
    await waitFor(() => expect(document.body.textContent).toContain(`Acme${tail}`))
    expect(document.body.textContent).not.toContain(`Acme Corporation${tail}`)
  })
})
