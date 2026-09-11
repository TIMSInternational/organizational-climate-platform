import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import CompaniesListNextPage from './CompaniesListNextPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../../i18n'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { setToken, clearToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import type { Company } from '../../api/companies'
import en from '../../../../i18n/en.json'

/**
 * `/admin/companies` — the per-role canvas's Empresas, which replaced `CompaniesListPage`
 * on this route. This file took over the old page's tests (loaded, filtered, failed, the
 * create form) and adds what the redesign owns: the joined columns, the language read
 * per tenant, "Abrir" as the active company, and the refusal every other role gets.
 */
const copy = en.superadmin.next.companies

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: 'c1',
    name: 'Northwind Logistics',
    emailDomain: 'northwind.example',
    industry: 'Transportation',
    size: 'large',
    country: 'Colombia',
    subscriptionTier: 'enterprise',
    createdAt: '2025-03-14T09:12:00Z',
    ...overrides,
  }
}

const TENANTS = [
  company(),
  company({ id: 'c2', name: 'Contoso', emailDomain: 'contoso.example', industry: 'Groceries', subscriptionTier: null }),
]

const DASHBOARD = {
  companyCount: 2,
  userCount: 15,
  activeUserCount: 15,
  surveyCount: 1,
  activeSurveyCount: 1,
  responseCount: 30,
  completedResponseCount: 30,
  companies: [
    { id: 'c2', name: 'Contoso', userCount: 3, activeSurveyCount: 0, completedResponseCount: 0, createdAt: '2025-05-01T00:00:00Z' },
    { id: 'c1', name: 'Northwind Logistics', userCount: 12, activeSurveyCount: 1, completedResponseCount: 30, createdAt: '2025-03-14T09:12:00Z' },
  ],
}

const OPEN_WAVE = {
  id: 's1',
  title: 'Clima Q4',
  companyId: 'c1',
  type: 'periodic',
  status: 'active',
  language: 'es',
  startDate: '2026-09-03T00:00:00Z',
  endDate: '2026-10-10T00:00:00Z',
  responseCount: 3,
  targetAudienceCount: 24,
  questionCount: 6,
  createdAt: '2026-09-01T00:00:00Z',
}

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

function serve({ companies = TENANTS as Company[] | 'fail', settings = 'ok' as 'ok' | 'forbidden' } = {}) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method === 'PUT' && url.includes('/settings')) {
      return settings === 'ok'
        ? json({
            companyId: 'c1',
            settings: { surveyFrequency: 'quarterly', microclimateEnabled: true, aiInsightsEnabled: true, anonymousSurveys: true, dataRetentionDays: 730, timezone: 'UTC', language: 'es' },
            branding: { logoUrl: null, primaryColor: '#0d9488', secondaryColor: '#0f766e', fontFamily: 'Poppins', customCss: null },
          })
        : json({ message: 'no' }, 403)
    }
    if (url.includes('/dashboard/super-admin')) return json(DASHBOARD)
    if (url.includes('/surveys')) return json({ surveys: [OPEN_WAVE] })
    if (url.includes('/admin/companies')) {
      return companies === 'fail' ? Promise.reject(new TypeError('Failed to fetch')) : json({ companies })
    }
    return json(null, 404)
  })
}

function DetailStub() {
  const { id } = useParams<{ id: string }>()
  return <p>detail {id}</p>
}

function renderPage(entry = '/admin/companies') {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[entry]}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/admin/companies" element={<CompaniesListNextPage />} />
            <Route path="/admin/companies/:id" element={<DetailStub />} />
          </Routes>
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
  vi.restoreAllMocks()
})

describe('CompaniesListNextPage', () => {
  it('lists every tenant by activity, with sector, plan, headcount and open wave; the language is read in the detail', async () => {
    serve()
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Companies' })).toBeTruthy()
    const rows = await screen.findAllByRole('row')
    // Header, then Northwind (an open survey) before Contoso, though the platform read listed Contoso first.
    expect(rows[1].textContent).toContain('Northwind Logistics')
    expect(rows[1].textContent).toContain('Transportation')
    expect(rows[1].textContent).toContain('Enterprise')
    expect(rows[1].textContent).toContain('12')
    expect(rows[1].textContent).toContain('Q4')
    expect(rows[2].textContent).toContain(copy.noPlan)
    expect(rows[2].textContent).toContain(copy.noSurveys)
    expect(screen.getAllByText(copy.languageInDetail)).toHaveLength(2)
  })

  it('marks its three notes with the board’s glyphs: an open book, a circle alert, a plus', async () => {
    serve()
    renderPage()
    await screen.findAllByRole('row')
    const notes = [...document.querySelectorAll('[data-slot="canvas-note"]')]
    expect(notes).toHaveLength(3)
    expect(notes[0].querySelector('.lucide-book-open')).not.toBeNull()
    expect(notes[1].querySelector('.lucide-circle-alert')).not.toBeNull()
    expect(notes[2].querySelector('.lucide-plus')).not.toBeNull()
  })

  it('searches the name, the domain and the sector as the operator types', async () => {
    // Each term lives in exactly ONE field of ONE company, so a filter that stopped reading a
    // field fails here rather than being rescued by another match.
    serve()
    renderPage()
    await screen.findByText('Northwind Logistics')
    const box = screen.getByRole('searchbox')
    await userEvent.type(box, 'grocer')
    await waitFor(() => expect(screen.queryByText('Northwind Logistics')).toBeNull())
    expect(screen.getByText('Contoso')).toBeTruthy()
    await userEvent.clear(box)
    await userEvent.type(box, 'northwind.example')
    await waitFor(() => expect(screen.queryByText('Contoso')).toBeNull())
    expect(screen.getByText('Northwind Logistics')).toBeTruthy()
  })

  it('filters by plan, and "no plan" is an option of its own', async () => {
    serve()
    renderPage()
    await screen.findByText('Northwind Logistics')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: copy.planFilterLabel }), '__none')
    await waitFor(() => expect(screen.queryByText('Northwind Logistics')).toBeNull())
    expect(screen.getByText('Contoso')).toBeTruthy()
  })

  it('sends no request that writes: the language is never read through the audited settings PUT', async () => {
    // The stub still ANSWERS the settings PUT, so a list that went back to reading each
    // tenant's language that way would render "Spanish" here as well as send the PUT.
    serve()
    renderPage()
    await screen.findByText('Northwind Logistics')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const methods = vi.mocked(fetch).mock.calls.map(([, init]) => (init?.method ?? 'GET').toUpperCase())
    expect(methods.length).toBeGreaterThan(0)
    expect(methods.filter((method) => method !== 'GET')).toEqual([])
    expect(screen.queryByText('Spanish')).toBeNull()
  })

  it('makes a tenant the active company when it is opened, and goes to its detail', async () => {
    serve()
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: copy.openNamed.replace('{name}', 'Northwind Logistics') }))
    expect(await screen.findByText('detail c1')).toBeTruthy()
    expect(localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBe('c1')
  })

  it('opens the create form from the platform overview’s link, and toggles it from its own button', async () => {
    serve()
    renderPage('/admin/companies?new=1')
    expect(await screen.findByRole('heading', { level: 2, name: copy.createHeading })).toBeTruthy()
    expect(screen.getByRole('button', { name: copy.create })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: copy.create })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: copy.newCompany }))
    expect(screen.getByRole('button', { name: copy.create })).toBeTruthy()
  })

  it('keeps its title and primary action when the list cannot load, and says why', async () => {
    serve({ companies: 'fail' })
    renderPage()
    expect(await screen.findByText(copy.loadFailed)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Companies' })).toBeTruthy()
    expect(screen.getByRole('button', { name: copy.newCompany })).toBeTruthy()
  })

  it('tells a company administrator the list is not theirs, and requests nothing the server would refuse', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: 'c1' }))
    serve()
    renderPage()
    expect(await screen.findByText(copy.superOnly)).toBeTruthy()
    expect(screen.queryByRole('button', { name: copy.newCompany })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
