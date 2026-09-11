import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import ConsolidadoNextPage from './ConsolidadoNextPage'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { clearCompanyNameCache } from '../../../company-context/useCompanyName'
import { tokenFor } from '../../../test/jwtFixture'
import es from '../../../i18n/es.json'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'

vi.mock('../../../lib/downloadBlobFile', () => ({ downloadBlobFile: vi.fn() }))

/**
 * `/tracking` — the redesigned Vista Consolidada. The payloads are the ones the local
 * tracking service and climate-project answered for the Grupo Meridiano demo tenant on
 * 10 Sep (the same bodies as `scripts/shot-fixtures/plans-tracking-admin.json`).
 */

const API = 'http://api.test'
const TRACKING = 'http://tracking.test'
const COMPANY = '16c97c29-07f8-4522-86fc-e6cc56298829'
const FINANZAS = 'bff21fd0-422b-4f3b-8c89-d6bfbf5f19e9'
const INGENIERIA = '5bfdb04e-8847-4baa-89c8-d4411654a129'
const OPERACIONES = '0a9d7637-814c-4d4a-8407-45cfbca3f4e7'

const CONSOLIDADO = {
  conteos: { rojo: 1, amarillo: 0, verde: 2 },
  porNodo: [
    { nodoExternalId: FINANZAS, conteos: { rojo: 1, amarillo: 0, verde: 0 }, totalPlanes: 1 },
    { nodoExternalId: INGENIERIA, conteos: { rojo: 0, amarillo: 0, verde: 1 }, totalPlanes: 1 },
    { nodoExternalId: OPERACIONES, conteos: { rojo: 0, amarillo: 0, verde: 1 }, totalPlanes: 1 },
  ],
}

function plan(overrides: Record<string, unknown>) {
  return {
    liderExternalId: '',
    hallazgoExternalId: null,
    metodologiaComo: 'Cómo',
    fechaCreacion: '2026-09-10',
    porcentajeAvance: 0,
    cicloEncuestaExternalId: null,
    fechaUltimaActualizacion: '2026-09-10',
    cumplido: false,
    involucradosExternalIds: [],
    ...overrides,
  }
}

const PLANES = [
  plan({ id: 'id-1', planCode: 'PA-2026-00001', nodoExternalId: FINANZAS, descripcionQue: 'Reponer la reunión de handover entre turnos', responsableEjecucionExternalId: 'p-adriana', fechaCompromiso: '2026-08-20', estadoSemaforo: 'Rojo' }),
  plan({ id: 'id-2', planCode: 'PA-2026-00002', nodoExternalId: INGENIERIA, descripcionQue: 'Publicar el rol de fines de semana con dos semanas de antelación', responsableEjecucionExternalId: 'p-alejandro', fechaCompromiso: '2026-09-15', estadoSemaforo: 'Verde' }),
  plan({ id: 'id-3', planCode: 'PA-2026-00003', nodoExternalId: OPERACIONES, descripcionQue: 'Programa de reconocimiento entre pares', responsableEjecucionExternalId: 'p-ana', fechaCompromiso: '2026-11-09', estadoSemaforo: 'Verde' }),
]

const NODOS = {
  nodos: [
    { id: FINANZAS, name: 'Finanzas' },
    { id: INGENIERIA, name: 'Ingeniería' },
    { id: OPERACIONES, name: 'Operaciones' },
    { id: 'n-personas', name: 'Personas' },
    { id: 'n-ventas', name: 'Ventas' },
  ],
}

const PERSONAS = {
  personas: [
    { id: 'p-adriana', name: 'Adriana Marín', email: 'adriana.marin@meridiano.test' },
    { id: 'p-alejandro', name: 'Alejandro Retana', email: 'alejandro.retana@meridiano.test' },
    { id: 'p-ana', name: 'Ana Rojas', email: 'ana.rojas@meridiano.test' },
  ],
}

function urls(): string[] {
  return vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

function routeFetch(options: { consolidado?: number; planes?: number } = {}) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith(`${TRACKING}/api/consolidado`)) return options.consolidado ? json({}, options.consolidado) : json(CONSOLIDADO)
    if (url.startsWith(`${TRACKING}/api/planes-accion`)) return options.planes ? json({}, options.planes) : json(PLANES)
    if (url.includes('/tracking/picker/nodos')) return json(NODOS)
    if (url.includes('/tracking/picker/personas')) return json(PERSONAS)
    if (/\/profile(\?|$)/.test(url)) return json({ companyName: 'Grupo Meridiano S.A.' })
    return json({}, 404)
  })
}

function renderPage() {
  return render(
    <TranslationProvider initialLocale="es">
      <MemoryRouter>
        <CompanyContextProvider>
          <ConsolidadoNextPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const next = es.tracking.next

beforeEach(() => {
  vi.stubEnv('VITE_TRACKING_API_BASE_URL', TRACKING)
  vi.stubEnv('VITE_API_BASE_URL', API)
  vi.stubGlobal('fetch', vi.fn())
  vi.mocked(downloadBlobFile).mockClear()
  clearCompanyNameCache()
  routeFetch()
})

/** The export answers `status` (the sheet's bytes on a 200); every other request as `routeFetch`. */
function routeExport(status: number) {
  const base = vi.mocked(fetch).getMockImplementation() as typeof fetch
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === `${TRACKING}/api/planes-accion/export`
      ? Promise.resolve(new Response(status === 200 ? 'PK-sheet' : '{}', { status }))
      : base(input, init),
  )
}

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('ConsolidadoNextPage — company_admin', () => {
  beforeEach(() => {
    setToken(tokenFor({ sub: 'u-ana', role: 'company_admin', companyId: COMPANY, nodoId: `unassigned-${COMPANY}`, isActive: 'true' }))
  })

  it('names the nodos behind each state in its tile, from the payload counts', async () => {
    renderPage()
    const rojo = await screen.findByText('vencido o sin avance · Finanzas')
    expect(rojo.closest('[data-slot="kpi-tile"]')?.textContent).toContain('1')
    expect(screen.getByText('en tiempo · Ingeniería y Operaciones')).toBeTruthy()
    // En riesgo holds nothing, so it names no nodo.
    expect(screen.getByText('atrasado o sin novedades').closest('[data-slot="kpi-tile"]')?.textContent).toContain('0')
  })

  it('lists each plan under its own nodo with its responsable, and the total names the nodos without a plan', async () => {
    renderPage()
    const finanzas = (await screen.findByRole('link', { name: 'Finanzas' })).closest('tbody') as HTMLElement
    expect(within(finanzas).getByText('Reponer la reunión de handover entre turnos')).toBeTruthy()
    expect(within(finanzas).getByText('responsable Adriana Marín')).toBeTruthy()
    const ingenieria = screen.getByRole('link', { name: 'Ingeniería' }).closest('tbody') as HTMLElement
    expect(within(ingenieria).getByText('responsable Alejandro Retana')).toBeTruthy()
    expect(within(ingenieria).queryByText('Reponer la reunión de handover entre turnos')).toBeNull()
    expect(screen.getByText('3 nodos con plan · 2 nodos sin plan')).toBeTruthy()
  })

  it('links a nodo only to its own aggregate board and a plan only to its own detail — nothing deeper', async () => {
    renderPage()
    await screen.findByRole('link', { name: 'Finanzas' })
    const hrefs = within(screen.getByRole('table')).getAllByRole('link').map((link) => link.getAttribute('href') ?? '')
    expect(hrefs).toContain(`/tracking/tablero?nodoId=${FINANZAS}`)
    expect(hrefs).toContain('/tracking/planes/id-1')
    for (const href of hrefs) {
      expect(href.startsWith('/tracking/tablero?nodoId=') || href.startsWith('/tracking/planes/')).toBe(true)
    }
  })

  it('hides the prior-year column with one sentence naming the period, and never prints it as zero', async () => {
    renderPage()
    expect(await screen.findByText(next.priorYearHidden.replace('{year}', '2025'))).toBeTruthy()
    expect(screen.queryByText(es.tracking.columnPriorYear)).toBeNull()
  })

  it('hands the seguimiento sheet to the browser as a file, fetched with the bearer token', async () => {
    routeExport(200)
    renderPage()
    const button = await screen.findByRole('button', { name: next.exportSheet })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    await userEvent.click(button)
    await waitFor(() => expect(vi.mocked(downloadBlobFile)).toHaveBeenCalledTimes(1))
    const [fileName, blob] = vi.mocked(downloadBlobFile).mock.calls[0]
    expect(fileName).toMatch(/^seguimiento-planes-accion-\d{4}-\d{2}-\d{2}\.xlsx$/)
    expect(await blob.text()).toBe('PK-sheet')
    const request = vi.mocked(fetch).mock.calls.find((call) => String(call[0]) === `${TRACKING}/api/planes-accion/export`)
    expect(new Headers(request?.[1]?.headers).get('Authorization')).toMatch(/^Bearer /)
  })

  it('says so above the page when the sheet cannot be downloaded, and hands the browser nothing', async () => {
    routeExport(500)
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: next.exportSheet }))
    expect(await screen.findByText(next.exportFailed)).toBeTruthy()
    expect(vi.mocked(downloadBlobFile)).not.toHaveBeenCalled()
  })

  it('keeps the counts when only the plans listing fails, and says the plans could not be read', async () => {
    routeFetch({ planes: 500 })
    renderPage()
    expect(await screen.findByText('vencido o sin avance · Finanzas')).toBeTruthy()
    expect(screen.getAllByText(next.plansUnavailable)).toHaveLength(3)
  })

  it('leaves the shell and a retry when the tracking service does not answer', async () => {
    routeFetch({ consolidado: 500 })
    renderPage()
    expect(await screen.findByText(es.tracking.serviceUnavailableTitle)).toBeTruthy()
    expect(screen.getByRole('button', { name: es.common.retry })).toBeTruthy()
  })
})

describe('ConsolidadoNextPage — roles the server refuses', () => {
  for (const role of ['leader', 'supervisor', 'employee']) {
    it(`tells a ${role} whose screen this is and asks the service nothing`, async () => {
      setToken(tokenFor({ sub: 'u-x', role, companyId: COMPANY, nodoId: INGENIERIA, isActive: 'true' }))
      renderPage()
      expect(await screen.findByText(es.tracking.consolidadoRestrictedTitle)).toBeTruthy()
      expect(urls().filter((url) => url.startsWith(TRACKING))).toEqual([])
    })
  }
})
