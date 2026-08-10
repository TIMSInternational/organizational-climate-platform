import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import AnalyticsDashboardPage from './AnalyticsDashboardPage'
import { TranslationProvider } from '../../../i18n'
import { setToken } from '../../../auth/token'
import type { BenchmarkListItem } from '../api/benchmarks'
import type { AIInsightListItem } from '../api/insights'

function benchmarkRow(overrides: Partial<BenchmarkListItem> = {}): BenchmarkListItem {
  return {
    id: 'b1',
    name: 'Industry median',
    type: 'industry',
    category: 'engagement',
    companyId: 'c1',
    isActive: true,
    qualityScore: 70,
    ...overrides,
  }
}

function insightRow(overrides: Partial<AIInsightListItem> = {}): AIInsightListItem {
  return {
    id: 'i1',
    companyId: 'c1',
    type: 'trend',
    category: 'engagement',
    title: 'Engagement is falling in Sales',
    priority: 'high',
    isAcknowledged: false,
    ...overrides,
  }
}

/** A well-formed unsigned JWT, so `decodeJwtPayload` reads the role rather than bailing. */
function tokenFor(role: string): string {
  const payload = btoa(JSON.stringify({ role, companyId: 'other-company' }))
  return `header.${payload}.signature`
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage(locale: 'en' | 'es' = 'en') {
  return render(
    <TranslationProvider initialLocale={locale}>
      <MemoryRouter initialEntries={['/admin/companies/c1/analytics']}>
        <Routes>
          <Route path="/admin/companies/:companyId/analytics" element={<AnalyticsDashboardPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

describe('AnalyticsDashboardPage', () => {
  beforeEach(() => {
    setToken(tokenFor('company_admin'))
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('scopes both requests to the company in the URL, not to the viewer', async () => {
    // The token above deliberately carries `companyId: 'other-company'`. If this page
    // ever read the claim instead of the route param, a SuperAdmin (and this test)
    // would silently see the wrong company -- the exact trap #94 names.
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([benchmarkRow()]))
      .mockResolvedValueOnce(jsonResponse([insightRow()]))
    renderPage()

    await waitFor(() => expect(vi.mocked(fetch).mock.calls).toHaveLength(2))
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
    expect(urls.some((url) => url.includes('/admin/benchmarks?companyId=c1'))).toBe(true)
    expect(urls.some((url) => url.includes('/admin/ai-insights?companyId=c1'))).toBe(true)
    expect(urls.some((url) => url.includes('other-company'))).toBe(false)
  })

  it('still shows benchmarks when AI insights fail, because /admin/ai-insights does not exist yet', async () => {
    // MapAIInsightEndpoints is absent from Program.cs (#86 is open), so this call 404s
    // on every real deployment today. One Promise.all over both would blank the whole
    // page; two independent requests keep the half that works.
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([benchmarkRow({ name: 'Industry median' })]))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    renderPage()

    expect(await screen.findByText('Industry median')).toBeTruthy()
    expect(screen.getByText('AI insights are not available')).toBeTruthy()
  })

  it('does not blame the network for the insights failure', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    renderPage()

    await screen.findByText('AI insights are not available')
    expect(screen.queryByText('An error occurred. Please try again.')).toBeNull()
  })

  it('retries only the failed half', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([benchmarkRow()]))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    renderPage()

    await screen.findByText('AI insights are not available')
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([insightRow()]))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Engagement is falling in Sales')).toBeTruthy()
    // Three calls total: two on mount, one retry. The benchmarks were not refetched.
    expect(vi.mocked(fetch).mock.calls).toHaveLength(3)
  })

  it('marks a global benchmark as platform-wide, so nobody is offered an edit that 403s', async () => {
    // `companyId === null` is readable by every tenant and writable only by a
    // SuperAdmin (BenchmarkEndpoints.CanWriteBenchmark). Collapsing the null would
    // make the two indistinguishable in the table.
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse([
          benchmarkRow({ id: 'b1', name: 'Sector median', companyId: null }),
          benchmarkRow({ id: 'b2', name: 'Acme 2025', companyId: 'c1' }),
        ]),
      )
      .mockResolvedValueOnce(jsonResponse([]))
    renderPage()

    await screen.findByText('Sector median')
    expect(screen.getByText('Platform-wide')).toBeTruthy()
    expect(screen.getByText('This company')).toBeTruthy()
  })

  it('acknowledges an insight and reloads only the insights', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([insightRow()]))
    renderPage()

    await screen.findByText('Engagement is falling in Sales')

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse([insightRow({ isAcknowledged: true })]))
    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }))

    await waitFor(() => expect(screen.getByText('Acknowledged')).toBeTruthy())
    // No un-acknowledge verb exists on the API, so the row offers no button at all.
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull()
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
    expect(urls.some((url) => url.endsWith('/admin/ai-insights/i1/acknowledge'))).toBe(true)
  })

  it('keeps the insights list on screen when one acknowledge fails', async () => {
    // Routing the failure into `insightsError` would replace a table that loaded fine
    // with "AI insights are not available", blaming the endpoint for a single row's
    // failed write and throwing away the rest of the list.
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([insightRow()]))
    renderPage()

    await screen.findByText('Engagement is falling in Sales')

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'Insight not found' }, 404))
    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }))

    expect(await screen.findByText('Insight not found')).toBeTruthy()
    expect(screen.getByText('Engagement is falling in Sales')).toBeTruthy()
    expect(screen.queryByText('AI insights are not available')).toBeNull()
    // And the row is actionable again rather than stuck disabled.
    expect((screen.getByRole('button', { name: 'Acknowledge' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('tells a super_admin that platform-wide benchmarks are excluded from this view', async () => {
    // The backend filter is an exact match for a SuperAdmin, so globals drop out --
    // whereas a CompanyAdmin always gets globals plus their own. Saying so beats
    // letting an admin conclude the platform has no benchmarks.
    setToken(tokenFor('super_admin'))
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([benchmarkRow()]))
      .mockResolvedValueOnce(jsonResponse([]))
    renderPage()

    expect(
      await screen.findByText(/Platform-wide benchmarks are not included/),
    ).toBeTruthy()
  })

  it('shows no such notice to a company_admin, whose list already includes globals', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([benchmarkRow()]))
      .mockResolvedValueOnce(jsonResponse([]))
    renderPage()

    await screen.findByText('Industry median')
    expect(screen.queryByText(/Platform-wide benchmarks are not included/)).toBeNull()
  })

  /**
   * `AIInsightList` is the other consumer of `../insightVocabulary` (#282), and until
   * now nothing here read its priority cell at all: replacing the whole cell with a
   * literal `'ZZZ'` left all 95 analytics tests green. These two cover the split the
   * shared helper makes — the known value that must be translated, and the inherited
   * `Object.prototype` key that must not be.
   */
  it('translates the priority in the dashboard insight table', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([insightRow({ priority: 'high' })]))
    renderPage()

    const row = (await screen.findByText('Engagement is falling in Sales')).closest('tr')!
    expect(row.textContent).toContain('High')
    // The regression itself: the stored value leaking through untranslated.
    expect(row.textContent).not.toContain('high')
  })

  it('translates the priority into Spanish in the dashboard insight table', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([insightRow({ priority: 'high' })]))
    renderPage('es')

    const row = (await screen.findByText('Engagement is falling in Sales')).closest('tr')!
    expect(row.textContent).toContain('Alta')
    expect(row.textContent).not.toContain('high')
  })

  /**
   * `priority` is free-form server text — `AIInsightValidation` bounds it at "non-empty,
   * ≤ 20 characters" and the column has no CHECK — so `'toString'` is reachable on the
   * wire. A bare `keys[priority]` truthiness check would resolve it to
   * `Object.prototype.toString`, a *function*, and hand it to `t()`, whose `.split('.')`
   * would take the whole page down. `Object.hasOwn` is what makes it render verbatim.
   */
  it('does not throw on a priority that names an inherited object property', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([insightRow({ priority: 'toString' })]))
    renderPage()

    const row = (await screen.findByText('Engagement is falling in Sales')).closest('tr')!
    expect(row.textContent).toContain('toString')
    // Still a live row, not a blank cell or a crashed subtree.
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeTruthy()
  })

  it('shows empty states for both sections rather than empty tables', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
    renderPage()

    expect(await screen.findByText('No benchmarks yet')).toBeTruthy()
    expect(screen.getByText('No AI insights yet')).toBeTruthy()
    expect(document.querySelector('table')).toBeNull()
  })
})
