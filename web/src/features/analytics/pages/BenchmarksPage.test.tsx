import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import BenchmarksPage from './BenchmarksPage'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import type { Benchmark, BenchmarkListItem } from '../api/benchmarks'

/** An unsigned JWT carrying just the claims the page reads. */
function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

const OWN = 'company-1'
const OTHER = 'company-2'

function listRow(id: string, name: string, companyId: string | null): BenchmarkListItem {
  return { id, name, type: 'industry', category: 'engagement', companyId, isActive: true, qualityScore: 0.9 }
}

function detail(id: string, name: string, companyId: string | null, overrides: Partial<Benchmark> = {}): Benchmark {
  return {
    id,
    name,
    description: 'A benchmark',
    type: 'industry',
    category: 'engagement',
    source: 'survey',
    industry: null,
    companySize: null,
    region: null,
    companyId,
    isActive: true,
    validationStatus: 'validated',
    qualityScore: 0.9,
    priorPeriodBenchmarkId: null,
    metrics: [{ id: `${id}-m`, metricName: 'engagement', value: 72, unit: '%', percentile: null, sampleSize: null }],
    ...overrides,
  }
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <BenchmarksPage />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/**
 * Routes a request by URL rather than by call order.
 *
 * The page fires the list, the selected details and the prior-period walk from
 * three separate effects, so call ORDER is not stable — `mockResolvedValueOnce`
 * chains would be asserting on the scheduler.
 */
function routeFetch(handlers: Array<[RegExp, () => unknown]>) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    for (const [pattern, body] of handlers) {
      if (pattern.test(url)) return Promise.resolve(new Response(JSON.stringify(body()), { status: 200 }))
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  // No `globals: true` in vite.config.ts, so RTL's auto-cleanup never registers.
  cleanup()
  clearToken()
  vi.unstubAllGlobals()
})

describe('BenchmarksPage scope handling', () => {
  it('marks a global benchmark and a company benchmark differently in the list', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([[/\/admin\/benchmarks(\?|$)/, () => [listRow('g', 'Industry average', null), listRow('o', 'Our 2026 baseline', OWN)]]])

    renderPage()

    const globalRow = (await screen.findByText('Industry average')).closest('tr')!
    const ownRow = screen.getByText('Our 2026 baseline').closest('tr')!
    expect(globalRow.textContent).toContain('Global')
    expect(ownRow.textContent).toContain('Company')
  })

  /**
   * The #207 rule, at the UI. A CompanyAdmin can read a global benchmark and must
   * not be shown an Edit button for it, because `CanWriteBenchmark` will refuse.
   */
  it('offers no edit affordance to a company_admin on a global benchmark, and says why', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([
      [/\/admin\/benchmarks\/g$/, () => detail('g', 'Industry average', null)],
      [/\/admin\/benchmarks(\?|$)/, () => [listRow('g', 'Industry average', null)]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Industry average/ }))

    await screen.findByRole('heading', { name: 'Industry average', level: 2 })
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.getByText(/only a platform administrator can change them/i)).toBeTruthy()
  })

  it('offers edit and add-metric on a company_admin\'s own benchmark', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([
      [/\/admin\/benchmarks\/o$/, () => detail('o', 'Our 2026 baseline', OWN)],
      [/\/admin\/benchmarks(\?|$)/, () => [listRow('o', 'Our 2026 baseline', OWN)]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Our 2026 baseline/ }))

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add metric' })).toBeTruthy()
  })

  /**
   * Defence in depth. The API scopes the list, but the comparison matrix is where
   * a leaked row would be quietly folded into a tenant's picture of itself rather
   * than looking obviously foreign.
   */
  it('does not render another tenant\'s benchmark even if the API returns one', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([[/\/admin\/benchmarks(\?|$)/, () => [listRow('o', 'Our 2026 baseline', OWN), listRow('x', 'Rival baseline', OTHER)]]])

    renderPage()

    await screen.findByText('Our 2026 baseline')
    expect(screen.queryByText('Rival baseline')).toBeNull()
  })

  it('tells a super_admin that what they create is global', async () => {
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    routeFetch([[/\/admin\/benchmarks(\?|$)/, () => []]])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'New benchmark' }))

    expect(screen.getByText(/global and visible to every company/i)).toBeTruthy()
  })

  it('tells a company_admin that what they create belongs to their company', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([[/\/admin\/benchmarks(\?|$)/, () => []]])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'New benchmark' }))

    expect(screen.getByText(/belong to your company only/i)).toBeTruthy()
  })

  it('creates a company-scoped benchmark from a company_admin\'s own claim, never from a form field', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([[/\/admin\/benchmarks(\?|$)/, () => []]])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'New benchmark' }))
    await userEvent.type(screen.getByLabelText('Name'), 'Our 2026 baseline')
    await userEvent.type(screen.getByLabelText('Description'), 'Baseline')
    await userEvent.type(screen.getByLabelText('Type'), 'internal')
    await userEvent.type(screen.getByLabelText('Category'), 'engagement')
    await userEvent.type(screen.getByLabelText('Source'), 'survey')
    await userEvent.click(screen.getByRole('button', { name: 'Create benchmark' }))

    await waitFor(() => {
      const post = vi.mocked(fetch).mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'POST')
      expect(post).toBeTruthy()
      expect(JSON.parse(String((post![1] as RequestInit).body))).toMatchObject({ companyId: OWN })
    })
  })
})

describe('BenchmarksPage comparison and trend', () => {
  it('compares two selected benchmarks by metric name', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([
      [/\/admin\/benchmarks\/g$/, () => detail('g', 'Industry average', null)],
      [
        /\/admin\/benchmarks\/o$/,
        () =>
          detail('o', 'Our 2026 baseline', OWN, {
            metrics: [{ id: 'o-m', metricName: 'engagement', value: 65, unit: '%', percentile: null, sampleSize: null }],
          }),
      ],
      [/\/admin\/benchmarks(\?|$)/, () => [listRow('g', 'Industry average', null), listRow('o', 'Our 2026 baseline', OWN)]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Industry average/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Our 2026 baseline/ }))

    const comparison = await screen.findByRole('heading', { name: 'Comparison', level: 2 })
    const table = comparison.parentElement!.querySelector('table')!
    expect(table.textContent).toContain('72 %')
    expect(table.textContent).toContain('65 %')
  })

  it('warns when the compared benchmarks record a metric in different units', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([
      [
        /\/admin\/benchmarks\/g$/,
        () =>
          detail('g', 'Industry average', null, {
            metrics: [{ id: 'g-m', metricName: 'responseTime', value: 1.2, unit: 's', percentile: null, sampleSize: null }],
          }),
      ],
      [
        /\/admin\/benchmarks\/o$/,
        () =>
          detail('o', 'Our 2026 baseline', OWN, {
            metrics: [{ id: 'o-m', metricName: 'responseTime', value: 1200, unit: 'ms', percentile: null, sampleSize: null }],
          }),
      ],
      [/\/admin\/benchmarks(\?|$)/, () => [listRow('g', 'Industry average', null), listRow('o', 'Our 2026 baseline', OWN)]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Industry average/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Our 2026 baseline/ }))

    expect(await screen.findByText('Units differ')).toBeTruthy()
  })

  it('walks the prior-period chain and shows the movement', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([
      [
        /\/admin\/benchmarks\/q2$/,
        () =>
          detail('q2', 'Q2 2026', OWN, {
            priorPeriodBenchmarkId: 'q1',
            metrics: [{ id: 'q2-m', metricName: 'engagement', value: 74, unit: '%', percentile: null, sampleSize: null }],
          }),
      ],
      [
        /\/admin\/benchmarks\/q1$/,
        () =>
          detail('q1', 'Q1 2026', OWN, {
            metrics: [{ id: 'q1-m', metricName: 'engagement', value: 70, unit: '%', percentile: null, sampleSize: null }],
          }),
      ],
      [/\/admin\/benchmarks(\?|$)/, () => [listRow('q2', 'Q2 2026', OWN)]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Q2 2026/ }))

    const trend = await screen.findByRole('heading', { name: 'Trend over prior periods', level: 2 })
    const table = trend.parentElement!.querySelector('table')!
    expect(table.textContent).toContain('Q1 2026')
    expect(table.textContent).toContain('+4')
  })

  it('says so plainly when a benchmark has no prior period', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([
      [/\/admin\/benchmarks\/o$/, () => detail('o', 'Our 2026 baseline', OWN)],
      [/\/admin\/benchmarks(\?|$)/, () => [listRow('o', 'Our 2026 baseline', OWN)]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Our 2026 baseline/ }))

    expect(await screen.findByText('This benchmark does not link to a prior period.')).toBeTruthy()
  })
})

describe('BenchmarksPage empty and error states', () => {
  it('shows an empty state, not an error, when there are no benchmarks', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([[/\/admin\/benchmarks(\?|$)/, () => []]])

    renderPage()

    expect(await screen.findByText('No benchmarks yet')).toBeTruthy()
  })

  it('shows an error state when the list cannot be loaded', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ message: 'boom' }), { status: 500 }))

    renderPage()

    expect(await screen.findByText('The benchmarks could not be loaded.')).toBeTruthy()
  })
})
