import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import BenchmarksNextPage from './BenchmarksNextPage'

/**
 * `/analytics/benchmarks` — the guarantees the route keeps now that the redesigned page
 * took it over. The payloads are Grupo Meridiano's as the local API returned them on
 * 10 Sep (the same bodies as `scripts/shot-fixtures/reports-benchmarks-meridiano.json`),
 * trimmed to the fields the page reads.
 */

const CID = '16c97c29-07f8-4522-86fc-e6cc56298829'
const OTHER = 'company-2'
const COHORT = 'd8c10838-d47a-413c-9b3b-0cfac7b413e7'
const Q3 = '38b2002f-66da-468d-b136-ec112ba3204b'

const cohortRow = {
  id: COHORT,
  name: 'Manufactura · 500–1000 personas',
  type: 'industry',
  category: 'climate',
  companyId: null,
  isActive: true,
  qualityScore: 0,
  priorPeriodStatus: 'unlinked',
}

function metric(metricName: string, value: number, percentile: number | null = null) {
  return { id: `m-${metricName}`, metricName, value, unit: 'index', percentile, sampleSize: 42 }
}

const cohortDetail = {
  ...cohortRow,
  description: 'Cohorte de industria.',
  source: 'Illustrative cohort, seeded for demonstration',
  industry: null,
  companySize: null,
  region: null,
  validationStatus: 'pending',
  priorPeriodBenchmarkId: null,
  priorPeriod: null,
  fallbackFields: [],
  metrics: [
    metric('belonging', 72),
    metric('growth', 70),
    metric('overall_index', 68, 68),
    metric('recognition', 64),
    metric('safety', 69),
    metric('trust', 68),
    metric('workload', 66),
  ],
}

const closedSurveys = {
  surveys: [
    { id: 'q2', title: 'Encuesta de Clima Q2', companyId: CID, type: 'periodic', status: 'closed', language: 'both', startDate: '2026-04-22T00:00:00Z', endDate: '2026-05-13T02:03:12Z', responseCount: 24, targetAudienceCount: null, questionCount: 6, createdAt: '2026-09-10T02:03:12Z' },
    { id: Q3, title: 'Encuesta de Clima Q3', companyId: CID, type: 'periodic', status: 'closed', language: 'both', startDate: '2026-07-16T00:00:00Z', endDate: '2026-08-06T02:05:22Z', responseCount: 24, targetAudienceCount: null, questionCount: 6, createdAt: '2026-09-10T02:05:22Z' },
  ],
}

function question(order: number, category: string, average: number) {
  return { questionId: `q-${category}`, order, type: 'likert', text: category, category, answeredCount: 24, distribution: [], average, median: 4 }
}

const analytics = {
  surveyId: Q3,
  title: 'Q3 Climate Survey',
  summary: {},
  questions: [
    question(0, 'psychological_safety', 3.75),
    question(1, 'workload', 3.33),
    question(2, 'trust', 3.67),
    question(3, 'recognition', 3.38),
    question(4, 'growth', 3.79),
    question(5, 'belonging', 4),
  ],
  breakdowns: [],
  isSuppressed: false,
  minimumGroupSize: 5,
}

type Handler = [RegExp, () => unknown, number?]

function routeFetch(extra: Handler[] = [], base: { list?: unknown[] } = {}) {
  const handlers: Handler[] = [
    ...extra,
    [new RegExp(`/surveys/${Q3}/analytics`), () => analytics],
    [/\/surveys(\?|$)/, () => closedSurveys],
    [new RegExp(`/admin/benchmarks/${COHORT}(\\?|$)`), () => cohortDetail],
    [/\/admin\/benchmarks(\?|$)/, () => base.list ?? [cohortRow]],
  ]
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    for (const [pattern, body, status] of handlers) {
      if (pattern.test(url)) return Promise.resolve(new Response(JSON.stringify(body()), { status: status ?? 200 }))
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

function requested(fragment: string): URL[] {
  return vi
    .mocked(fetch)
    .mock.calls.map((call) => new URL(String(call[0]), 'http://test.local'))
    .filter((url) => `${url.pathname}${url.search}`.includes(fragment))
}

function renderAs(claims: Record<string, unknown>) {
  setToken(tokenFor({ sub: 'u1', nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/analytics/benchmarks']}>
        <CompanyContextProvider>
          <BenchmarksNextPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

async function readout(): Promise<Element> {
  return waitFor(() => {
    const found = document.querySelector('[data-slot="cohort-readout"]')
    expect(found, 'the read-out never rendered').not.toBeNull()
    return found!
  })
}

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  clearToken()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('BenchmarksNextPage — the read-out', () => {
  it('reads Meridiano against its cohort as the Benchmarks artboard does', async () => {
    routeFetch()
    renderAs({ role: 'company_admin', companyId: CID })

    const tiles = [...(await readout()).querySelectorAll('[data-slot="kpi-tile"]')].map((tile) => tile.textContent)
    expect(tiles[0]).toContain('67')
    expect(tiles[0]).toContain('de 100')
    expect(tiles[0]).toContain('Encuesta de Clima Q3 · 24 respuestas')
    expect(tiles[1]).toContain('68')
    expect(tiles[1]).toContain('42 empresas · Manufactura · 500–1000 personas')
    // "Tu percentil" prints no percentile: the cohort reading's stored 68 is the same for
    // every tenant, and a company's rank needs a distribution no endpoint returns.
    expect(tiles[2]).toContain('Tu percentil')
    expect(tiles[2]).toContain('—')
    expect(tiles[2]).toContain('sin calcular')
    expect(tiles[2]).toContain('1 punto bajo la mediana · sin la distribución del grupo no hay percentil')
    expect(tiles[2]).not.toContain('68')
    expect(tiles[2]).not.toMatch(/tercio/)

    // One bar per dimension the SURVEY scored, in the order it asked them; the cohort
    // carries `safety`, not `psychological_safety`, so that row has no tick and says so.
    const rows = [...document.querySelectorAll('[data-slot="cohort-dimension-row"]')]
    expect(rows.map((row) => row.getAttribute('data-standing'))).toEqual(['none', 'below', 'below', 'below', 'at', 'above'])
    expect(rows[0].textContent).toContain('Seguridad psicológica')
    expect(rows[0].textContent).toContain('sin mediana del grupo')
    expect(rows[1].textContent).toContain('−8')
    expect(rows[1].textContent).toContain('bajo la mediana')
    expect(rows[4].textContent).toContain('±0')
    expect(rows[4].textContent).toContain('en la mediana')
    expect(rows[5].textContent).toContain('+3')
    expect(rows[5].textContent).toContain('sobre la mediana')
    expect(document.querySelectorAll('[data-slot="cohort-median-tick"]').length).toBe(5)
    expect(document.querySelector('[data-slot="cohort-below-summary"]')?.textContent).toBe(
      '3 dimensiones bajo la mediana · la mayor distancia: Carga de trabajo',
    )
    // The cohort names the page: the eyebrow is the data's, not the route's.
    expect(document.querySelector('[data-slot="page-top-bar"]')?.textContent).toContain('Manufactura · 500–1000 personas')
    // Every region is real: no sample chip anywhere on this screen.
    expect(screen.queryByText('Datos de muestra')).toBeNull()
  })

  it('never prints the cohort\'s stored percentile, nor a band, whatever that number is', async () => {
    // A cohort whose stored reading would band the company "tercio inferior" while the
    // company sits seven points ABOVE the median: the retired tile printed both at once.
    routeFetch([
      [
        new RegExp(`/admin/benchmarks/${COHORT}(\\?|$)`),
        () => ({
          ...cohortDetail,
          metrics: cohortDetail.metrics.map((m) => (m.metricName === 'overall_index' ? metric('overall_index', 60, 20) : m)),
        }),
      ],
    ])
    renderAs({ role: 'company_admin', companyId: CID })
    const tiles = [...(await readout()).querySelectorAll('[data-slot="kpi-tile"]')].map((tile) => tile.textContent ?? '')
    expect(tiles[1]).toContain('60')
    expect(tiles[2]).toContain('7 puntos sobre la mediana')
    expect(tiles[2]).toContain('sin calcular')
    expect(tiles[2]).not.toContain('20')
    expect(tiles[2]).not.toMatch(/tercio|encima de|debajo de/)
  })

  it('prints the median at the precision the gap is taken, so the change is the difference on screen', async () => {
    routeFetch([
      [
        new RegExp(`/admin/benchmarks/${COHORT}(\\?|$)`),
        () => ({
          ...cohortDetail,
          metrics: cohortDetail.metrics.map((m) => (m.metricName === 'overall_index' ? metric('overall_index', 67.6, 68) : m)),
        }),
      ],
    ])
    renderAs({ role: 'company_admin', companyId: CID })
    const tiles = [...(await readout()).querySelectorAll('[data-slot="kpi-tile"]')]
    const value = (tile: Element) => tile.querySelector('[data-slot="kpi-value"]')?.textContent
    // 67 and 68 on screen, one point apart — never "67,6" beside "1 punto".
    expect(value(tiles[0])).toBe('67')
    expect(value(tiles[1])).toBe('68')
    expect(tiles[2].textContent).toContain('1 punto bajo la mediana')
  })

  it('draws Nueva referencia as the canvas\'s 34px button', async () => {
    routeFetch()
    renderAs({ role: 'company_admin', companyId: CID })
    await readout()
    const classes = screen.getByRole('button', { name: 'Nueva referencia' }).className
    expect(classes).toContain('h-control-canvas')
    expect(classes).not.toContain('h-control-lg')
  })

  it('asks for the list, the cohort and the surveys in the reader\'s language, the surveys for this company\'s closed ones', async () => {
    routeFetch()
    renderAs({ role: 'company_admin', companyId: CID })
    await readout()

    for (const fragment of ['/admin/benchmarks?', `/admin/benchmarks/${COHORT}`, '/surveys?']) {
      const urls = requested(fragment)
      expect(urls.length, fragment).toBeGreaterThan(0)
      expect(urls.every((url) => url.searchParams.get('lang') === 'es'), fragment).toBe(true)
    }
    const surveys = requested('/surveys?')[0]
    expect(surveys.searchParams.get('companyId')).toBe(CID)
    expect(surveys.searchParams.get('status')).toBe('closed')
    // The latest closed survey is read, whatever order the list came in.
    expect(requested(`/surveys/${Q3}/analytics`).length).toBe(1)
    // The list is never narrowed to a company: a super_admin's is cross-company.
    expect(requested('/admin/benchmarks?').every((url) => !url.searchParams.has('companyId'))).toBe(true)
  })

  it('says the read-out failed without taking the references down', async () => {
    routeFetch([[new RegExp(`/surveys/${Q3}/analytics`), () => ({ message: 'boom' }), 500]])
    renderAs({ role: 'company_admin', companyId: CID })

    expect(await screen.findByText('Todavía no hay un grupo con el que comparar')).toBeTruthy()
    expect(document.querySelector('[data-slot="cohort-readout"]')).toBeNull()
    expect(within(screen.getByRole('table')).getByText('Manufactura · 500–1000 personas')).toBeTruthy()
  })

  it('says the latest closed survey is under the floor: no tiles, no bars, and no "ninguna dimensión bajo la mediana"', async () => {
    // `SurveyAggregate.IsSuppressed`: under the floor the server empties `questions` and
    // still sends the summary. The list's own count is under the floor too.
    routeFetch([
      [
        new RegExp(`/surveys/${Q3}/analytics`),
        () => ({ ...analytics, questions: [], isSuppressed: true, suppressionReason: 'below_minimum_respondents' }),
      ],
      [/\/surveys(\?|$)/, () => ({ surveys: [{ ...closedSurveys.surveys[1], responseCount: 3 }] })],
    ])
    renderAs({ role: 'company_admin', companyId: CID })

    expect(await screen.findByText('La última encuesta cerrada no llega al mínimo de 5 respuestas')).toBeTruthy()
    expect(screen.getByText(/^Encuesta de Clima Q3 queda bajo el umbral de privacidad/)).toBeTruthy()
    expect(document.querySelector('[data-slot="cohort-readout"]')).toBeNull()
    expect(document.querySelector('[data-slot="cohort-dimension-bars"]')).toBeNull()
    expect(screen.queryByText('ninguna dimensión bajo la mediana')).toBeNull()
    expect(document.body.textContent).not.toContain('3 respuestas')
    // The references are still there to read.
    expect(within(screen.getByRole('table')).getByText('Manufactura · 500–1000 personas')).toBeTruthy()
  })

  it('claims nothing about the median when no dimension could be compared with it', async () => {
    // The cohort carries only its overall index: every bar is drawn, none has a tick, and
    // "ninguna dimensión bajo la mediana" would report a comparison nobody made.
    routeFetch([[new RegExp(`/admin/benchmarks/${COHORT}(\\?|$)`), () => ({ ...cohortDetail, metrics: [metric('overall_index', 68, 68)] })]])
    renderAs({ role: 'company_admin', companyId: CID })
    await readout()

    const rows = [...document.querySelectorAll('[data-slot="cohort-dimension-row"]')]
    expect(rows).toHaveLength(6)
    expect(rows.every((row) => row.getAttribute('data-standing') === 'none')).toBe(true)
    expect(document.querySelector('[data-slot="cohort-below-summary"]')).toBeNull()
    expect(screen.queryByText('ninguna dimensión bajo la mediana')).toBeNull()
  })
})

describe('BenchmarksNextPage — the references', () => {
  it('names type and category as words, and says "sin calcular" for the reference nobody scored', async () => {
    routeFetch()
    renderAs({ role: 'company_admin', companyId: CID })
    await readout()

    const row = document.querySelector(`tr[data-benchmark-id="${COHORT}"]`)!
    expect(row.textContent).toContain('Sector')
    expect(row.textContent).toContain('Clima')
    expect(row.textContent).toContain('Toda la plataforma')
    expect(row.textContent).toContain('Sí')
    // `qualityScore: 0` beside `validationStatus: 'pending'` is main's wire for "never
    // scored" until PR #463 sends null: a failing grade must not be printed over it.
    expect(row.querySelector('[data-slot="quality-score"]')?.textContent).toContain('sin calcular')
    expect(row.textContent).not.toContain('0,00')
    expect(row.textContent).not.toContain('industry')
    expect(row.textContent).not.toContain('climate')
  })

  it('keeps a scored reference\'s number and marks a null one unscored', async () => {
    routeFetch([], {
      list: [
        cohortRow,
        { ...cohortRow, id: 'own', name: 'Línea base 2026', type: 'internal', category: 'engagement', companyId: CID, qualityScore: 0.92 },
        { ...cohortRow, id: 'fresh', name: 'Recién creada', companyId: CID, qualityScore: null },
      ],
    })
    renderAs({ role: 'company_admin', companyId: CID })
    await readout()

    const own = document.querySelector('tr[data-benchmark-id="own"]')!
    expect(own.querySelector('[data-slot="quality-score"]')?.textContent).toBe('0,92')
    expect(own.textContent).toContain('Interna')
    expect(own.textContent).toContain('Compromiso')
    expect(own.textContent).toContain('Esta empresa')
    const fresh = document.querySelector('tr[data-benchmark-id="fresh"]')!
    expect(fresh.querySelector('[data-slot="quality-score"]')?.textContent).toContain('sin calcular')
  })

  it('does not render another tenant\'s reference even if the API returns one', async () => {
    routeFetch([], { list: [cohortRow, { ...cohortRow, id: 'rival', name: 'Rival', companyId: OTHER }] })
    renderAs({ role: 'company_admin', companyId: CID })
    await readout()
    expect(screen.queryByText('Rival')).toBeNull()
  })

  it('keeps the references under a disclosure that closes', async () => {
    routeFetch()
    renderAs({ role: 'company_admin', companyId: CID })
    await readout()
    expect(screen.getByRole('table')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Todas las referencias/ }))
    await waitFor(() => expect(screen.queryByRole('table')).toBeNull())
  })

  it('offers no edit on a global reference to a company_admin, and add-metric on their own', async () => {
    routeFetch([[/\/admin\/benchmarks\/own(\?|$)/, () => ({ ...cohortDetail, id: 'own', name: 'Línea base 2026', companyId: CID, validationStatus: 'verified' })]], {
      list: [cohortRow, { ...cohortRow, id: 'own', name: 'Línea base 2026', companyId: CID, qualityScore: 0.9 }],
    })
    renderAs({ role: 'company_admin', companyId: CID })
    await readout()

    await userEvent.click(screen.getByRole('checkbox', { name: /Manufactura/ }))
    await screen.findByRole('heading', { name: 'Manufactura · 500–1000 personas', level: 2 })
    expect(screen.queryByRole('button', { name: 'Agregar métrica' })).toBeNull()
    expect(screen.getByText(/Solo un administrador de la plataforma puede modificarlas/)).toBeTruthy()

    await userEvent.click(screen.getByRole('checkbox', { name: /Manufactura/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Línea base 2026/ }))
    expect(await screen.findByRole('button', { name: 'Agregar métrica' })).toBeTruthy()
  })
})

describe('BenchmarksNextPage — one test per role that matters', () => {
  it('company_admin: reads the company, and creates references that belong to it', async () => {
    routeFetch()
    renderAs({ role: 'company_admin', companyId: CID })
    await readout()
    await userEvent.click(screen.getByRole('button', { name: 'Nueva referencia' }))
    expect(await screen.findByText(/pertenecen únicamente a su empresa/)).toBeTruthy()
  })

  it('super_admin with no company chosen: the references, a global create, and a sentence where the index would be', async () => {
    routeFetch()
    renderAs({ role: 'super_admin', companyId: '' })

    expect(await screen.findByText('Elige una empresa para leerla frente a su grupo')).toBeTruthy()
    expect(document.querySelector('[data-slot="cohort-readout"]')).toBeNull()
    expect(requested('/surveys').length).toBe(0)
    expect(screen.getByRole('table')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Nueva referencia' }))
    expect(await screen.findByText(/son globales y visibles para todas las empresas/)).toBeTruthy()
  })

  it('super_admin with a company chosen: that company is read against the cohort', async () => {
    window.localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, CID)
    routeFetch()
    renderAs({ role: 'super_admin', companyId: '' })
    await readout()
    expect(requested('/surveys?')[0].searchParams.get('companyId')).toBe(CID)
  })

  it.each(['leader', 'supervisor', 'employee'])('%s: no request the server would refuse, and a sentence saying whose screen it is', async (role) => {
    routeFetch()
    renderAs({ role, companyId: CID })
    expect(await screen.findByText('Los puntos de referencia son de la administración')).toBeTruthy()
    expect(vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).includes('/admin/benchmarks'))).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Nueva referencia' })).toBeNull()
  })
})
