import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
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
  return { id, name, type: 'industry', category: 'engagement', companyId, isActive: true, qualityScore: 0.9, priorPeriodStatus: 'unlinked' }
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
    priorPeriodStatus: 'unlinked',
    priorPeriod: null,
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

    const table = await screen.findByRole('table')
    const globalRow = within(table).getByText('Industry average').closest('tr')!
    const ownRow = within(table).getByText('Our 2026 baseline').closest('tr')!
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

    await within(await screen.findByRole('table')).findByText('Our 2026 baseline')
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
  /**
   * The strip that used to sit here counted benchmark RECORDS -- how many exist, how many
   * are platform-wide, how many are selected. Every number was true and none of them was
   * why anyone opens this screen, so the approved design replaced it with the read-out
   * below: this company against its cohort. What is asserted is that the three tiles carry
   * the company's index, the cohort's median and the percentile, in that order.
   */
  it('reads this company against its cohort rather than counting benchmark records', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([
      [/\/surveys\/s1\/analytics/, () => ({
        surveyId: 's1',
        summary: {},
        questions: [
          { questionId: 'q1', order: 0, type: 'likert', text: 'a', category: 'safety', answeredCount: 24, distribution: [], average: 3.75, median: 4 },
          { questionId: 'q2', order: 1, type: 'likert', text: 'b', category: 'workload', answeredCount: 24, distribution: [], average: 3.0, median: 3 },
        ],
        breakdowns: [],
        isSuppressed: false,
        minimumGroupSize: 5,
      })],
      [/\/surveys(\?|$)/, () => ({ surveys: [{ id: 's1', title: 'Q3 Climate Survey', status: 'closed', endDate: '2026-08-05T00:00:00Z' }] })],
      [/\/admin\/benchmarks\/g1$/, () => ({
        ...detail('g1', 'Manufacturing cohort', null),
        metrics: [
          { id: 'm1', benchmarkId: 'g1', metricName: 'safety', value: 69, unit: 'index', percentile: null, sampleSize: 42 },
          { id: 'm2', benchmarkId: 'g1', metricName: 'workload', value: 66, unit: 'index', percentile: null, sampleSize: 42 },
          { id: 'm3', benchmarkId: 'g1', metricName: 'overall_index', value: 68, unit: 'index', percentile: 68, sampleSize: 42 },
        ],
      })],
      [/\/admin\/benchmarks(\?|$)/, () => [listRow('g1', 'Manufacturing cohort', null)]],
    ])

    const { container } = renderPage()

    const readout = await waitFor(() => {
      const found = container.querySelector('[data-slot="cohort-readout"]')
      expect(found, 'the cohort read-out never rendered').not.toBeNull()
      return found!
    })

    const tiles = [...readout.querySelectorAll('[data-slot="kpi-tile"]')].map((t) => t.textContent)
    // safety 3.75 -> 69, workload 3.0 -> 50, so the index is 60 against a cohort median 68.
    expect(tiles[0]).toContain('60')
    expect(tiles[1]).toContain('68')
    expect(tiles[2]).toContain('68')

    // One bar per dimension the SURVEY scored, each carrying the cohort's median as a tick.
    const rows = container.querySelectorAll('[data-slot="cohort-dimension-row"]')
    expect(rows.length).toBe(2)
    expect(container.querySelectorAll('[data-slot="cohort-median-tick"]').length).toBe(2)
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

  /**
   * The criterion #89 turns on: a first-year company and a data-entry backlog are not the
   * same claim, and the page must not print one over the other.
   *
   * Both benchmarks below have `priorPeriodBenchmarkId: null` — which is the whole of what
   * this page used to have to go on, and why both used to render "This benchmark does not
   * link to a prior period." The assertion is on the two rendered sentences and on their
   * being different from each other, not on a status attribute, because the status arriving
   * and the reader being told apart are separate claims.
   */
  it('distinguishes a benchmark with no prior period from one nobody has linked yet', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([
      [/\/prior-period\/candidates$/, () => []],
      [/\/admin\/benchmarks\/first$/, () => detail('first', 'Our first measurement', OWN, { priorPeriodStatus: 'none' })],
      [/\/admin\/benchmarks\/backlog$/, () => detail('backlog', 'Our 2026 baseline', OWN)],
      [
        /\/admin\/benchmarks(\?|$)/,
        () => [listRow('first', 'Our first measurement', OWN), listRow('backlog', 'Our 2026 baseline', OWN)],
      ],
    ])

    renderPage()

    await userEvent.click(await screen.findByRole('checkbox', { name: /Our first measurement/ }))
    const none = await screen.findByText(/There is no prior period\./)
    expect(none.textContent).toContain('first measurement')

    await userEvent.click(await screen.findByRole('checkbox', { name: /Our first measurement/ }))
    await userEvent.click(await screen.findByRole('checkbox', { name: /Our 2026 baseline/ }))
    const unlinked = await screen.findByText(/No prior period has been chosen yet\./)

    expect(unlinked.textContent).not.toEqual(none.textContent)
  })

  /**
   * `linked` with no comparison attached is a fourth state, not a loading one: the link
   * points at a row this caller may not read, and `LoadPriorPeriodAsync` omits the numbers
   * rather than handing them over. Falling back to "not linked" here would be a lie about
   * the data.
   */
  it('says a prior period exists but is unreadable rather than calling it unlinked', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([
      [/\/prior-period\/candidates$/, () => []],
      [
        /\/admin\/benchmarks\/o$/,
        () => detail('o', 'Our 2026 baseline', OWN, { priorPeriodStatus: 'linked', priorPeriodBenchmarkId: 'hidden', priorPeriod: null }),
      ],
      [/\/admin\/benchmarks(\?|$)/, () => [listRow('o', 'Our 2026 baseline', OWN)]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Our 2026 baseline/ }))

    expect(await screen.findByText(/not allowed to read/)).toBeTruthy()
    expect(screen.queryByText(/No prior period has been chosen yet\./)).toBeNull()
  })

  /**
   * The year-over-year figures, on a screen at last.
   *
   * `priorPeriod.metrics` is what the whole feature computes — this period against the last,
   * differenced once on the server so that #88's report section and the tracking module's
   * `resultado_anio_anterior_pct` cannot disagree with the page. Until this table it reached
   * no screen at all: the panel printed the prior period's *name* and stopped, and the only
   * numbers a reader saw came from the browser's own chain derivation.
   *
   * Asserted on the rendered cells, including the two shapes of missing: a metric only one
   * period recorded, and a change the server declined to compute.
   */
  it('shows the year-over-year figures the API computed', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([
      [/\/prior-period\/candidates$/, () => []],
      [
        /\/admin\/benchmarks\/o$/,
        () =>
          detail('o', 'Our 2026 baseline', OWN, {
            priorPeriodStatus: 'linked',
            priorPeriodBenchmarkId: 'p',
            metrics: [{ id: 'o-m', metricName: 'engagement', value: 74, unit: '%', percentile: null, sampleSize: null }],
            priorPeriod: {
              id: 'p',
              name: 'Our 2025 baseline',
              metrics: [
                { metricName: 'engagement', value: 74, unit: '%', priorValue: 70, priorUnit: '%', delta: 4, changeRatio: 4 / 70 },
                // Recorded last year, not this year: the row still appears, because a
                // measurement that stopped is itself worth seeing.
                { metricName: 'absence', value: null, unit: null, priorValue: 3, priorUnit: 'days', delta: null, changeRatio: null },
                // Both periods recorded it, in units that do not agree, so the server
                // withheld the change and the cell has to say which kind of missing it is.
                { metricName: 'responseTime', value: 1200, unit: 'ms', priorValue: 1.2, priorUnit: 's', delta: null, changeRatio: null },
              ],
            },
          }),
      ],
      [
        /\/admin\/benchmarks\/p$/,
        () =>
          detail('p', 'Our 2025 baseline', OWN, {
            metrics: [{ id: 'p-m', metricName: 'engagement', value: 70, unit: '%', percentile: null, sampleSize: null }],
          }),
      ],
      [/\/admin\/benchmarks(\?|$)/, () => [listRow('o', 'Our 2026 baseline', OWN)]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Our 2026 baseline/ }))

    const panel = (await screen.findByRole('heading', { name: 'Prior period', level: 2 })).closest('section')!
    expect(within(panel).getByText('Compared against Our 2025 baseline.')).toBeTruthy()

    const rows = [...panel.querySelectorAll('tbody tr')].map((row) => row.textContent)
    // 74 % this period, 70 % last, +4, and +5.7% of what it was.
    expect(rows[0]).toContain('70 %')
    expect(rows[0]).toContain('+4')
    expect(rows[0]).toContain('+5.7%')
    // The metric this period did not record: last year's reading, and no invented zero.
    expect(rows[1]).toContain('3 days')
    expect(rows[1]).toContain('Not recorded')
    // 1200 ms against 1.2 s is the same reading twice; the change must not appear at all.
    expect(rows[2]).toContain('Units differ')
    expect(rows[2]).not.toContain('1,198.8')
  })

  /**
   * The delta the server refuses to compute must not turn up on the page under a different
   * name. `buildTrend` walks the chain the browser assembles itself, so it is a second
   * implementation of "current minus prior" — and it did the subtraction blind, printing a
   * −69.3 collapse directly beneath an API response that had correctly withheld it.
   */
  it('refuses to difference the trend across a change of unit', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([
      [/\/prior-period\/candidates$/, () => []],
      [
        /\/admin\/benchmarks\/q2$/,
        () =>
          detail('q2', 'Q2 2026', OWN, {
            priorPeriodStatus: 'linked',
            priorPeriodBenchmarkId: 'q1',
            priorPeriod: { id: 'q1', name: 'Q1 2026', metrics: [] },
            metrics: [{ id: 'q2-m', metricName: 'engagement', value: 0.74, unit: 'fraction', percentile: null, sampleSize: null }],
          }),
      ],
      [
        /\/admin\/benchmarks\/q1$/,
        () =>
          detail('q1', 'Q1 2026', OWN, {
            metrics: [{ id: 'q1-m', metricName: 'engagement', value: 70, unit: 'percent', percentile: null, sampleSize: null }],
          }),
      ],
      [/\/admin\/benchmarks(\?|$)/, () => [listRow('q2', 'Q2 2026', OWN)]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Q2 2026/ }))

    const trend = await screen.findByRole('heading', { name: 'Trend over prior periods', level: 2 })
    const table = trend.parentElement!.querySelector('table')!
    expect(table.textContent).toContain('Units differ')
    // −69.3 is what a blind subtraction prints, and it is a collapse that never happened.
    expect(table.textContent).not.toMatch(/[+−-]\s?69/)
  })

  /**
   * Linking is a human act, all the way to the button. The page offers the shortlist the
   * API suggests and sends nothing until somebody picks one — an unambiguous candidate is
   * still not applied on its own.
   */
  it('links a prior period only once an administrator picks one', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    const sent: Array<{ url: string; body: unknown }> = []
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT' && /\/prior-period$/.test(url)) {
        sent.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(
          new Response(JSON.stringify(detail('o', 'Our 2026 baseline', OWN, { priorPeriodStatus: 'linked', priorPeriodBenchmarkId: 'p' })), { status: 200 }),
        )
      }
      if (/\/prior-period\/candidates$/.test(url)) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'p', name: 'Our 2025 baseline', category: 'engagement', type: 'industry', createdAt: '2025-01-01T00:00:00Z', metricCount: 1, unambiguous: true },
            ]),
            { status: 200 },
          ),
        )
      }
      if (/\/admin\/benchmarks\/o$/.test(url)) {
        return Promise.resolve(new Response(JSON.stringify(detail('o', 'Our 2026 baseline', OWN)), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([listRow('o', 'Our 2026 baseline', OWN)]), { status: 200 }))
    })

    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Our 2026 baseline/ }))
    await screen.findByRole('option', { name: 'Our 2025 baseline' })

    // Nothing sent yet, even though the one candidate is unambiguous.
    expect(sent).toHaveLength(0)

    await userEvent.selectOptions(screen.getByLabelText('Prior period'), 'p')
    await userEvent.click(screen.getByRole('button', { name: 'Link prior period' }))

    expect(sent).toHaveLength(1)
    expect(sent[0].body).toEqual({ status: 'linked', priorPeriodBenchmarkId: 'p' })
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

/**
 * Ticking ONE row is the likeliest thing anyone does on this page, and it opens
 * the detail panel and the trend rather than the cohort bars. Both of those used
 * to render every one of their ~30 numbers in the sans face, directly under a
 * comparison that sets all of its readings in mono. These pin the rule per
 * surface, because it was per surface that it was broken.
 */
describe('BenchmarksPage single-selection readings', () => {
  const withMetrics = (id: string, name: string, extra: Partial<Benchmark> = {}) =>
    detail(id, name, OWN, {
      qualityScore: 0.9,
      metrics: [
        { id: `${id}-a`, metricName: 'engagement', value: 74, unit: 'pts', percentile: 62, sampleSize: 1200 },
      ],
      ...extra,
    })

  it('sets the detail panel readings in mono with tabular figures, and only the readings', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([
      [/\/admin\/benchmarks\/o$/, () => withMetrics('o', 'Our 2026 baseline')],
      [/\/admin\/benchmarks(\?|$)/, () => [listRow('o', 'Our 2026 baseline', OWN)]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Our 2026 baseline/ }))

    const panel = (await screen.findByRole('heading', { name: 'Our 2026 baseline', level: 2 }))
      .closest('section')!
    const mono = (text: string) =>
      [...panel.querySelectorAll('.font-mono.tabular-nums')].some(
        (node) => node.textContent?.trim() === text,
      )

    // The value, the percentile and the sample size: three readings, three monos.
    expect(mono('74')).toBe(true)
    expect(mono('62')).toBe(true)
    expect(mono('1,200')).toBe(true)
    // The quality score, at the two decimals it is stored with.
    expect(mono('0.90')).toBe(true)
    // The metric NAME and the unit are words, not readings, and stay sans.
    const sans = (text: string) =>
      [...panel.querySelectorAll('td')].some(
        (cell) => cell.textContent?.trim() === text && !cell.className.includes('font-mono'),
      )
    expect(sans('engagement')).toBe(true)
    expect(sans('pts')).toBe(true)
  })

  /**
   * `formatMetric`'s default precision is "however many this number needs, capped
   * at ONE", so the panel printed a stored 0.92 as "0.9" — a digit dropped off the
   * figure it exists to report — while the list beside it printed the raw JS
   * number and so never localised at all.
   */
  it('prints the quality score at two decimals in both the list and the panel, and localises it', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([
      [/\/admin\/benchmarks\/o$/, () => withMetrics('o', 'Our 2026 baseline', { qualityScore: 0.92 })],
      [
        /\/admin\/benchmarks(\?|$)/,
        () => [
          { ...listRow('o', 'Our 2026 baseline', OWN), qualityScore: 0.92 },
          { ...listRow('p', 'Prior baseline', OWN), qualityScore: 0.9 },
        ],
      ],
    ])

    renderPage()

    const table = await screen.findByRole('table')
    // Same digit count on both rows, which is the only way tabular figures line a
    // column up. `0.9` next to `0.92` does not.
    expect(table.textContent).toContain('0.92')
    expect(table.textContent).toContain('0.90')

    await userEvent.click(screen.getByRole('checkbox', { name: /Our 2026 baseline/ }))
    const panel = (await screen.findByRole('heading', { name: 'Our 2026 baseline', level: 2 }))
      .closest('section')!
    // Never "0.9": that is the panel disagreeing with the row above it.
    expect(panel.textContent).toContain('0.92')
  })

  it('sets the trend readings in mono with tabular figures', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    routeFetch([
      [
        /\/admin\/benchmarks\/q2$/,
        () =>
          detail('q2', 'Q2 2026', OWN, {
            priorPeriodBenchmarkId: 'q1',
            metrics: [{ id: 'q2-m', metricName: 'engagement', value: 74, unit: 'pts', percentile: null, sampleSize: null }],
          }),
      ],
      [
        /\/admin\/benchmarks\/q1$/,
        () =>
          detail('q1', 'Q1 2026', OWN, {
            metrics: [{ id: 'q1-m', metricName: 'engagement', value: 70, unit: 'pts', percentile: null, sampleSize: null }],
          }),
      ],
      [/\/admin\/benchmarks(\?|$)/, () => [listRow('q2', 'Q2 2026', OWN)]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Q2 2026/ }))

    const trend = (await screen.findByRole('heading', { name: 'Trend over prior periods', level: 2 }))
      .closest('section')!
    const mono = [...trend.querySelectorAll('.font-mono.tabular-nums')].map((node) =>
      node.textContent?.trim(),
    )
    expect(mono).toContain('70 pts')
    expect(mono).toContain('74 pts')
    // The change is a reading too, and it is the one a reader differences by eye.
    expect(mono).toContain('+4')
    // The metric name is a word and must not be dragged into the mono face.
    expect(mono).not.toContain('engagement')
  })
})
