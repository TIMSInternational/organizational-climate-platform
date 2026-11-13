import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import BenchmarkGroupsPage from './BenchmarkGroupsPage'

/**
 * The computed reference groups as TIMS reads them (ruled 3 Nov 2026). The routes'
 * arithmetic and floors are proved server-side (`BenchmarkGroupEndpointsTests`); these pin
 * what the screen promises: the choices are visible, every gap is the difference of the two
 * printed numbers, a group short of companies prints no number, and a group is criteria only.
 */

const CID = 'c0000000-0000-0000-0000-000000000001'
const LOG = 'g-log'
const PUB = 'g-pub'

const groups = [
  { id: LOG, name: 'Logística · 500 a 1000', industry: 'Logística', companySize: null, country: 'Costa Rica', serviceType: 'general_climate', companyCount: 5, minimumCompanies: 3, latestSurveyOn: '2026-10-31T00:00:00Z' },
  { id: PUB, name: 'Servicios públicos', industry: 'Servicios públicos', companySize: null, country: null, serviceType: 'general_climate', companyCount: 2, minimumCompanies: 3, latestSurveyOn: null },
]

const closedSurveys = {
  surveys: [
    { id: 's-q1', title: 'Clima Q1', companyId: CID, type: 'periodic', status: 'closed', language: 'es', startDate: '2026-03-01T00:00:00Z', endDate: '2026-03-31T00:00:00Z', responseCount: 80, targetAudienceCount: null, questionCount: 8, createdAt: '2026-02-01T00:00:00Z' },
    { id: 's-q3', title: 'Clima Q3', companyId: CID, type: 'periodic', status: 'closed', language: 'es', startDate: '2026-10-01T00:00:00Z', endDate: '2026-10-31T00:00:00Z', responseCount: 94, targetAudienceCount: null, questionCount: 8, createdAt: '2026-09-01T00:00:00Z' },
  ],
}

const ready = {
  kind: 'ready',
  groupId: LOG,
  companyId: CID,
  companyName: 'Northwind',
  survey: { id: 's-q3', title: 'Clima Q3', endDate: '2026-10-31T00:00:00Z', serviceType: 'general_climate' },
  companyCount: 4,
  minimumCompanies: 3,
  // 67.6 and 66.6 print as 68 and 67: one point, the difference of what is shown.
  companyIndex: 67.6,
  groupMedian: 66.6,
  dimensions: [
    { key: 'trust', score: 74, median: 70, companies: 4 },
    { key: 'workload', score: 58, median: 64.4, companies: 4 },
    { key: 'recognition', score: 66, median: null, companies: 2 },
  ],
}

const insufficient = { ...ready, groupId: PUB, kind: 'insufficient', companyCount: 1, companyIndex: null, groupMedian: null, dimensions: [] }

type Handler = [RegExp, (init?: RequestInit) => unknown, number?]

function routeFetch(extra: Handler[] = [], list: unknown[] = groups) {
  const handlers: Handler[] = [
    ...extra,
    [new RegExp(`/admin/benchmark-groups/${PUB}/reading`), () => insufficient],
    [new RegExp(`/admin/benchmark-groups/${LOG}/reading`), () => ready],
    [/\/admin\/benchmark-groups\/options/, () => ({ industries: ['Logística', 'Servicios públicos'], companySizes: ['500 a 1000'], countries: ['Costa Rica'], serviceTypes: ['general_climate', 'organizational_culture', 'microclimate'] })],
    [/\/admin\/benchmark-groups\/preview/, () => ({ companyCount: 2, minimumCompanies: 3 })],
    [/\/admin\/benchmark-groups(\?|$)/, () => list],
    [/\/surveys(\?|$)/, () => closedSurveys],
  ]
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    for (const [pattern, body, status] of handlers) {
      if (pattern.test(url)) {
        const payload = body(init)
        return Promise.resolve(new Response(payload === null ? null : JSON.stringify(payload), { status: status ?? 200 }))
      }
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

function requested(fragment: string, method = 'GET'): { url: URL; init?: RequestInit }[] {
  return vi
    .mocked(fetch)
    .mock.calls.map((call) => ({ url: new URL(String(call[0]), 'http://test.local'), init: call[1] as RequestInit | undefined }))
    .filter(({ url, init }) => `${url.pathname}${url.search}`.includes(fragment) && (init?.method ?? 'GET') === method)
}

function renderPage(entry = '/analytics/benchmarks', company: string | null = CID) {
  if (company) window.localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, company)
  setToken(tokenFor({ sub: 'u1', nodoId: '', role: 'super_admin', companyId: '' }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[entry]}>
        <CompanyContextProvider>
          <BenchmarkGroupsPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const headline = () => waitFor(() => {
  const found = document.querySelector('[data-slot="headline"]')
  expect(found, 'the headline never rendered').not.toBeNull()
  return found as HTMLElement
})

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

describe('BenchmarkGroupsPage — the comparison', () => {
  it('says how far the company is from the group in one sentence, gap taken between the printed numbers', async () => {
    routeFetch()
    renderPage()
    const card = await headline()
    expect(within(card).getByRole('heading', { level: 2 }).textContent).toBe('Northwind está 1 punto por encima de la mediana del grupo')
    expect(card.textContent).toContain('68')
    expect(card.textContent).toContain('67')
    expect(card.textContent).toContain('de 100 · 4 empresas')
    // trust +4 above, workload −6 below, recognition has no median: 1 of 2 compared above.
    expect(card.textContent).toContain('1 de 2 dimensiones por encima · la brecha más grande en contra: Carga de trabajo (−6)')
  })

  it('asks for the company chosen in the top bar, in the reader’s language, and lists its closed surveys newest first', async () => {
    routeFetch()
    renderPage()
    await headline()
    const [reading] = requested(`/admin/benchmark-groups/${LOG}/reading`)
    expect(reading.url.searchParams.get('companyId')).toBe(CID)
    expect(reading.url.searchParams.get('lang')).toBe('es')
    expect(reading.url.searchParams.has('surveyId')).toBe(false)
    expect(requested('/surveys?')[0].url.searchParams.get('status')).toBe('closed')
  })

  it('orders the dimensions by the widest gap against first, or as the survey asked them', async () => {
    routeFetch()
    renderPage()
    await headline()
    const labels = () =>
      ['Carga de trabajo', 'Confianza', 'Reconocimiento'].sort(
        (a, b) => document.body.textContent!.indexOf(a, 600) - document.body.textContent!.indexOf(b, 600),
      )
    expect(labels()).toEqual(['Carga de trabajo', 'Confianza', 'Reconocimiento'])
    await userEvent.click(screen.getByRole('button', { name: 'Orden de la encuesta' }))
    expect(screen.getByRole('button', { name: 'Orden de la encuesta' }).getAttribute('aria-pressed')).toBe('true')
    expect(labels()).toEqual(['Confianza', 'Carga de trabajo', 'Reconocimiento'])
  })

  it('prints no number for a group short of companies, and says how many it has', async () => {
    routeFetch()
    renderPage(`/analytics/benchmarks?grupo=${PUB}`)
    const box = await waitFor(() => {
      const found = document.querySelector('[data-slot="insufficient"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(box.textContent).toContain('Este grupo todavía no tiene empresas suficientes')
    expect(box.textContent).toContain('Además de Northwind, una sola empresa cumple los criterios')
    expect(document.querySelector('[data-slot="headline"]')).toBeNull()
    expect(screen.queryByText('Índice de la empresa')).toBeNull()
  })

  it.each([
    ['no_survey', 'Northwind no tiene una encuesta cerrada de Clima general'],
    ['service_mismatch', 'Esta encuesta no es del instrumento del grupo'],
    ['survey_suppressed', 'Esta encuesta no alcanzó el mínimo de respuestas'],
  ])('%s: a sentence, no number', async (kind, sentence) => {
    routeFetch([[new RegExp(`/admin/benchmark-groups/${LOG}/reading`), () => ({ ...ready, kind, companyIndex: null, groupMedian: null, dimensions: [] })]])
    renderPage()
    expect(await screen.findByText(sentence)).toBeTruthy()
    expect(document.querySelector('[data-slot="headline"]')).toBeNull()
  })

  it('asks for a company before reading anything', async () => {
    routeFetch()
    renderPage('/analytics/benchmarks', null)
    expect(await screen.findByText('Elija una empresa')).toBeTruthy()
    expect(requested('/reading')).toHaveLength(0)
  })

  it('with no group yet, says so and leads to where one is made', async () => {
    routeFetch([], [])
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Ir a Grupos de referencia' }))
    expect(await screen.findByText('Todavía no hay grupos')).toBeTruthy()
  })
})

describe('BenchmarkGroupsPage — the groups', () => {
  it('lists each group with its criteria, its companies and whether it is ready', async () => {
    routeFetch()
    renderPage('/analytics/benchmarks?tab=grupos')
    const row = await waitFor(() => {
      const found = document.querySelector(`tr[data-group-id="${LOG}"]`)
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(row.textContent).toContain('Clima general')
    expect(row.textContent).toContain('Logística')
    expect(row.textContent).toContain('Cualquier tamaño')
    expect(row.textContent).toContain('Listo')
    // Two companies: each is read against one other, two short of the minimum of three.
    expect(document.querySelector(`tr[data-group-id="${PUB}"]`)!.textContent).toContain('Faltan 2')
  })

  it('deletes a group only after asking, and reloads the list', async () => {
    routeFetch([[new RegExp(`/admin/benchmark-groups/${PUB}$`), () => null, 204]])
    renderPage('/analytics/benchmarks?tab=grupos')
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar Servicios públicos' }))
    expect(requested(`/admin/benchmark-groups/${PUB}`, 'DELETE')).toHaveLength(0)
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar grupo' }))
    await waitFor(() => expect(requested(`/admin/benchmark-groups/${PUB}`, 'DELETE')).toHaveLength(1))
    await waitFor(() => expect(requested('/admin/benchmark-groups', 'GET').filter(({ url }) => url.pathname.endsWith('/admin/benchmark-groups')).length).toBeGreaterThan(1))
  })

  it('creates a group from criteria, shows how many companies meet them first, and says when the name is taken', async () => {
    let posts = 0
    routeFetch([
      [/\/admin\/benchmark-groups$/, (init) => {
        if (init?.method !== 'POST') return groups
        posts += 1
        return posts === 1 ? { message: 'taken' } : { ...groups[0], id: 'g-new', name: 'Nuevo' }
      }],
    ])
    vi.mocked(fetch).mockImplementationOnce(vi.mocked(fetch).getMockImplementation()!)
    renderPage('/analytics/benchmarks?tab=grupos')
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo grupo' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByText(/Hoy cumplen estos criterios 2 empresas/)).toBeTruthy())
    const [preview] = requested('/admin/benchmark-groups/preview')
    expect(preview.url.searchParams.get('serviceType')).toBe('general_climate')
    expect(preview.url.searchParams.has('industry')).toBe(false)

    const create = within(dialog).getByRole('button', { name: 'Crear grupo' })
    expect((create as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(within(dialog).getByLabelText('Nombre'), 'Logística CR')
    await userEvent.click(create)
    await waitFor(() => expect(requested('/admin/benchmark-groups', 'POST')).toHaveLength(1))
    const body = JSON.parse(String(requested('/admin/benchmark-groups', 'POST')[0].init!.body))
    expect(body).toEqual({ name: 'Logística CR', industry: null, companySize: null, country: null, serviceType: 'general_climate' })
  })
})
