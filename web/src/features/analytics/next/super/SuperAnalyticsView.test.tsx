import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import AnalyticsDashboardPage from '../../pages/AnalyticsDashboardPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../../i18n'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { setToken, clearToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import type { BenchmarkListItem } from '../../api/benchmarks'
import type { AIInsightListItem } from '../../api/insights'
import en from '../../../../i18n/en.json'

/**
 * `/admin/companies/:companyId/analytics` for a super administrator — the per-role
 * canvas's Analítica. Rendered through `AnalyticsDashboardPage`, so the role dispatch is
 * pinned with the view: a `super_admin` gets this, and `AnalyticsDashboardPage.test.tsx`
 * keeps pinning the page a `company_admin` still gets.
 */
const copy = en.superadmin.next.analytics

function benchmark(overrides: Partial<BenchmarkListItem> = {}): BenchmarkListItem {
  return {
    id: 'g1',
    name: 'Manufacturing · 500–1000 staff',
    type: 'industry',
    category: 'climate',
    companyId: null,
    isActive: true,
    qualityScore: 0,
    priorPeriodStatus: 'unlinked',
    ...overrides,
  }
}

function insight(overrides: Partial<AIInsightListItem> = {}): AIInsightListItem {
  return { id: 'i1', companyId: 'c1', type: 'trend', category: 'climate', title: 'Participation fell in Sales', priority: 'high', isAcknowledged: false, ...overrides }
}

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

interface Serve {
  own?: BenchmarkListItem[]
  all?: BenchmarkListItem[]
  insights?: AIInsightListItem[]
  aiEnabled?: boolean
}

function serve({ own = [], all = [benchmark()], insights = [], aiEnabled = true }: Serve = {}) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if ((init?.method ?? 'GET') === 'PUT' && url.includes('/settings')) {
      return json({
        companyId: 'c1',
        settings: { surveyFrequency: 'quarterly', microclimateEnabled: true, aiInsightsEnabled: aiEnabled, anonymousSurveys: true, dataRetentionDays: 730, timezone: 'UTC', language: 'es' },
        branding: { logoUrl: null, primaryColor: '#0d9488', secondaryColor: '#0f766e', fontFamily: 'Poppins', customCss: null },
      })
    }
    if (url.includes('/admin/benchmarks')) return json(url.includes('companyId=') ? own : all)
    if (url.includes('/admin/ai-insights')) return json(insights)
    if (url.includes('/surveys')) {
      return json({
        surveys: [
          { id: 's3', title: 'Clima Q3', companyId: 'c1', type: 'periodic', status: 'closed', language: 'es', startDate: '2026-07-16T00:00:00Z', endDate: '2026-08-06T00:00:00Z', responseCount: 24, targetAudienceCount: null, questionCount: 6, createdAt: '2026-07-01T00:00:00Z' },
          { id: 's2', title: 'Clima Q2', companyId: 'c1', type: 'periodic', status: 'closed', language: 'es', startDate: '2026-04-22T00:00:00Z', endDate: '2026-05-13T00:00:00Z', responseCount: 20, targetAudienceCount: null, questionCount: 6, createdAt: '2026-04-01T00:00:00Z' },
        ],
      })
    }
    if (url.includes('/admin/companies')) {
      return json({
        companies: [
          { id: 'c1', name: 'Northwind Logistics', emailDomain: null, industry: 'Services', size: 'medium', country: null, subscriptionTier: 'basic', createdAt: '2025-01-01T00:00:00Z' },
          { id: 'c2', name: 'Contoso', emailDomain: null, industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2025-02-01T00:00:00Z' },
        ],
      })
    }
    return json(null, 404)
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/admin/companies/c1/analytics']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/admin/companies/:companyId/analytics" element={<AnalyticsDashboardPage />} />
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
})

describe('SuperAnalyticsView', () => {
  it('names the tenant it reads and marks it active when it is the header’s company', async () => {
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'c1')
    serve()
    renderPage()
    const context = await screen.findByRole('combobox', { name: en.companyContext.label })
    await waitFor(() => expect((context as HTMLSelectElement).value).toBe('c1'))
    expect(screen.getByText(en.superadmin.next.context.active)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Northwind Logistics' }).getAttribute('href')).toBe('/admin/companies/c1')
  })

  it('names the global reference the filter leaves out as the board writes it: its real score and the tenant it is not compared with', async () => {
    serve({ own: [], all: [benchmark()] })
    renderPage()
    // The payload's own qualityScore (0), printed at two decimals, and the tenant's own
    // sector and size from its record ('Services', 'medium') — never the board's numbers.
    const sentence = copy.refs.emptyGlobalOneCompared
      .replace('{name}', 'Manufacturing · 500–1000 staff')
      .replace('{score}', '0.00')
      .replace('{profile}', `services, ${en.superadmin.next.sizes.medium.toLowerCase()}`)
    expect(await screen.findByText(sentence)).toBeTruthy()
    expect(screen.getByText(copy.tiles.globalOnlyOne)).toBeTruthy()
  })

  it('prints a scored global reference’s score in the reader’s format', async () => {
    serve({ own: [], all: [benchmark({ qualityScore: 72.5 })] })
    renderPage()
    expect(await screen.findByText(/72\.50/)).toBeTruthy()
  })

  it('reads a tenant with AI insights switched off as a sentence, not an empty list', async () => {
    serve({ insights: [], aiEnabled: false })
    renderPage()
    expect(await screen.findByText(copy.insights.disabledTitle)).toBeTruthy()
    expect(screen.getByText(copy.tiles.insightsDisabled)).toBeTruthy()
    expect(screen.queryByText(copy.insights.emptyTitle)).toBeNull()
  })

  it('lists the findings it has, with whether each was reviewed', async () => {
    serve({ insights: [insight(), insight({ id: 'i2', title: 'Recognition rose', isAcknowledged: true })] })
    renderPage()
    expect(await screen.findByText('Participation fell in Sales')).toBeTruthy()
    expect(screen.getByText(copy.insights.pending)).toBeTruthy()
    expect(screen.getByText(copy.insights.reviewed)).toBeTruthy()
    expect(screen.getByText(copy.tiles.insightsOpen.replace('{count}', '1'))).toBeTruthy()
  })

  it('names the last closed wave, not an earlier one', async () => {
    serve()
    renderPage()
    expect(await screen.findByText('Q3')).toBeTruthy()
    expect(screen.getByText(copy.tiles.lastClosedSub.replace('{count}', '24'))).toBeTruthy()
  })

  it('switching the tenant makes it the active company and reads that tenant', async () => {
    serve()
    renderPage()
    const context = await screen.findByRole('combobox', { name: en.companyContext.label })
    await screen.findByText('Q3')
    await userEvent.selectOptions(context, 'c2')
    expect(localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBe('c2')
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('/admin/ai-insights?companyId=c2'))).toBe(true),
    )
  })
})
