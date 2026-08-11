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
    // BenchmarkList renders the shared analytics.scope* labels rather than a
    // benchmarks-only pair: #94's AnalyticsDashboardPage and this page render the
    // same component, so one vocabulary keeps the two surfaces from disagreeing
    // about what a platform-wide benchmark is called.
    expect(globalRow.textContent).toContain('Platform-wide')
    expect(ownRow.textContent).toContain('This company')
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

describe('BenchmarksPage headline counts', () => {
  /**
   * The four tiles are counted from the list the page already holds, so they can
   * be asserted against the rows on screen. Queried through `data-slot` rather
   * than by label: "This company" and "Platform-wide" are also the scope badges
   * in every row of the table below.
   */
  it('counts the readable, platform-wide, own-company and selected benchmarks', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([
      [
        /\/admin\/benchmarks(\?|$)/,
        () => [
          listRow('g1', 'Industry average', null),
          listRow('g2', 'Regional average', null),
          listRow('o1', 'Our 2026 baseline', OWN),
        ],
      ],
    ])

    const { container } = renderPage()
    await screen.findByText('Our 2026 baseline')

    const tiles = () =>
      [...container.querySelectorAll('[data-slot="kpi-tile"]')].map((tile) => tile.textContent)
    expect(tiles()).toEqual([
      'Benchmarks3',
      'Platform-wide2to compare against',
      'This company1',
      'Selected0',
    ])

    await userEvent.click(screen.getByRole('checkbox', { name: /Our 2026 baseline/ }))
    await waitFor(() => expect(tiles()[3]).toBe('Selected1'))
  })
})

describe('BenchmarksPage comparison and trend', () => {
  /**
   * The comparison is bars-with-a-tick now, not a matrix, so this asserts on the
   * section rather than on a `<table>` inside it. What it asserts is unchanged:
   * both benchmarks' values for the shared metric are on screen and attributed —
   * the subject's reading and the cohort's median — plus the difference the bars
   * exist to make legible.
   */
  it('reads a selected benchmark against the cohort, by metric name', async () => {
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

    const comparison = (await screen.findByRole('heading', { name: 'Comparison', level: 2 }))
      .closest('section')!
    expect(comparison.textContent).toContain('engagement')
    // The subject is the one ticked first, and it is named over the bars.
    expect(comparison.textContent).toContain('Industry average')
    expect(comparison.textContent).toContain('72 %')
    expect(comparison.textContent).toContain('65 %')
    expect(comparison.textContent).toContain('+7')
    expect(comparison.textContent).toContain('above cohort')
  })

  /**
   * The tick is the cohort MEDIAN and it has to sit where the median actually is.
   * happy-dom does no layout, so this reads the inline percentages the component
   * computes rather than rendered pixels.
   *
   * Subject 72 against a cohort of 60, 80 and 200: the median is 80 and the mean is
   * 113.33, so a mean would put the tick past the subject's bar in the other
   * direction and print a different sign. The row's scale tops out at its own
   * largest value, 200 — hence 36% for the bar and 40% for the tick.
   */
  it('places the cohort-median tick at the median, on a track scaled to the row', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    function metricsOf(value: number) {
      return { metrics: [{ id: `m-${value}`, metricName: 'engagement', value, unit: '%', percentile: null, sampleSize: null }] }
    }
    routeFetch([
      [/\/admin\/benchmarks\/subject$/, () => detail('subject', 'Ours', OWN, metricsOf(72))],
      [/\/admin\/benchmarks\/c1$/, () => detail('c1', 'Cohort one', null, metricsOf(60))],
      [/\/admin\/benchmarks\/c2$/, () => detail('c2', 'Cohort two', null, metricsOf(80))],
      [/\/admin\/benchmarks\/c3$/, () => detail('c3', 'Cohort three', null, metricsOf(200))],
      [
        /\/admin\/benchmarks(\?|$)/,
        () => [
          listRow('subject', 'Ours', OWN),
          listRow('c1', 'Cohort one', null),
          listRow('c2', 'Cohort two', null),
          listRow('c3', 'Cohort three', null),
        ],
      ],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Ours/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Cohort one/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Cohort two/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Cohort three/ }))

    const comparison = (await screen.findByRole('heading', { name: 'Comparison', level: 2 }))
      .closest('section')!
    await waitFor(() => {
      const positioned = [...comparison.querySelectorAll('[style]')].map((node) =>
        node.getAttribute('style'),
      )
      expect(positioned).toContain('width: 36%;')
      expect(positioned).toContain('left: 40%;')
    })
    // The same median, printed. The mean would read 113.33 and the change +9.
    expect(comparison.textContent).toContain('80 %')
    expect(comparison.textContent).toContain('−8')
    expect(comparison.textContent).toContain('below cohort')
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

  /**
   * Three rows that cannot produce a change, and three different sentences. The
   * defect this pins was found by rendering: a row whose *subject* had no value
   * said "no cohort value", and a row whose units disagreed printed the cohort's
   * 1200 ms as "1,200 s" with a change of −1,198.8.
   */
  it('says which side is missing, and refuses to compare across units', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([
      [
        /\/admin\/benchmarks\/subject$/,
        () =>
          detail('subject', 'Ours', OWN, {
            metrics: [
              { id: 's-1', metricName: 'engagement', value: 72, unit: '%', percentile: null, sampleSize: null },
              { id: 's-2', metricName: 'responseTime', value: 1.2, unit: 's', percentile: null, sampleSize: null },
            ],
          }),
      ],
      [
        /\/admin\/benchmarks\/cohort$/,
        () =>
          detail('cohort', 'Theirs', null, {
            metrics: [
              { id: 'c-2', metricName: 'responseTime', value: 1200, unit: 'ms', percentile: null, sampleSize: null },
              { id: 'c-3', metricName: 'attrition', value: 12, unit: '%', percentile: null, sampleSize: null },
            ],
          }),
      ],
      [/\/admin\/benchmarks(\?|$)/, () => [listRow('subject', 'Ours', OWN), listRow('cohort', 'Theirs', null)]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Ours/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Theirs/ }))

    const comparison = (await screen.findByRole('heading', { name: 'Comparison', level: 2 }))
      .closest('section')!
    // engagement: only the subject has it.
    expect(comparison.textContent).toContain('no cohort value')
    // attrition: only the cohort has it.
    expect(comparison.textContent).toContain('not recorded here')
    // responseTime: both have it, in different units.
    expect(comparison.textContent).toContain('Units differ')
    expect(comparison.textContent).toContain('not comparable')
    // The cohort's magnitude must never appear wearing the subject's unit.
    expect(comparison.textContent).not.toContain('1,200 s')
    expect(comparison.textContent).not.toContain('1,198.8')
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
