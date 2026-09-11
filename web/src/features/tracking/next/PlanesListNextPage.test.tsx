import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { clearToken, setToken } from '../../../auth/token'
import { COMPANY_CONTEXT_STORAGE_KEY, CompanyContextProvider } from '../../../company-context'
import { tokenFor } from '../../../test/jwtFixture'
import type { PlanAccion } from '../api/trackingApi'
import { todayIso } from '../planDates'
import PlanesListNextPage from './PlanesListNextPage'
import es from '../../../i18n/es.json'

/**
 * `/tracking/planes` (TrackingPlanesList artboard): the plans the service returned, grouped by
 * its semáforo, named from the directory, and offered per role. Dates are relative to today, so
 * the overdue and on-time readings hold whatever day the suite runs.
 */
const T = es.tracking.next

function shift(days: number): string {
  const date = new Date(`${todayIso()}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function plan(over: Partial<PlanAccion> = {}): PlanAccion {
  return {
    id: 'plan-1',
    planCode: 'PA-2026-00001',
    nodoExternalId: 'nodo-a',
    liderExternalId: '',
    hallazgoExternalId: null,
    descripcionQue: 'Reponer la reunión de handover',
    metodologiaComo: 'Sesión de 20 minutos',
    responsableEjecucionExternalId: 'persona-2',
    fechaCreacion: shift(-30),
    fechaCompromiso: shift(-21),
    porcentajeAvance: 0,
    estadoSemaforo: 'Rojo',
    cicloEncuestaExternalId: null,
    fechaUltimaActualizacion: shift(-30),
    cumplido: false,
    involucradosExternalIds: [],
    ...over,
  }
}

const PLANS = [
  plan(),
  plan({ id: 'plan-3', planCode: 'PA-2026-00003', nodoExternalId: 'nodo-c', estadoSemaforo: 'Verde', fechaCompromiso: shift(60), responsableEjecucionExternalId: 'admin-1' }),
  plan({ id: 'plan-2', planCode: 'PA-2026-00002', nodoExternalId: 'nodo-b', estadoSemaforo: 'Verde', fechaCompromiso: shift(5), porcentajeAvance: 0.4 }),
]
const NODOS = {
  nodos: [
    { id: 'nodo-a', name: 'Finanzas' },
    { id: 'nodo-b', name: 'Ingeniería' },
    { id: 'nodo-c', name: 'Operaciones' },
    { id: 'nodo-d', name: 'Personas' },
  ],
}
const PERSONAS = { personas: [{ id: 'persona-2', name: 'Adriana Marín', email: 'adriana@acme.test' }] }

function routeFetch(plans: PlanAccion[] = PLANS, options: { pickers?: boolean; down?: boolean } = {}) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    if (url.includes('/tracking/picker/nodos')) return options.pickers === false ? Promise.reject(new Error('Forbidden')) : json(NODOS)
    if (url.includes('/tracking/picker/personas')) return options.pickers === false ? Promise.reject(new Error('Forbidden')) : json(PERSONAS)
    if (url.includes('/api/planes-accion')) {
      if (options.down) throw new TypeError('Failed to fetch')
      return json(plans)
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider initialLocale="es">
      <MemoryRouter>
        <CompanyContextProvider>
          <PlanesListNextPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const section = (estado: string) => document.querySelector(`section[data-estado="${estado}"]`) as HTMLElement
const codesIn = (element: HTMLElement) => [...element.querySelectorAll('tr[data-plan-code]')].map((row) => row.getAttribute('data-plan-code'))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  setToken(tokenFor({ sub: 'admin-1', name: 'Ana Rojas', role: 'company_admin', nodoId: '', companyId: 'company-1' }))
  routeFetch()
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  vi.unstubAllGlobals()
})

describe('PlanesListNextPage', () => {
  it('groups what the service returned by its semáforo, nearest compromiso first', async () => {
    renderPage()
    await screen.findByText('PA-2026-00001')
    expect(codesIn(section('Rojo'))).toEqual(['PA-2026-00001'])
    expect(codesIn(section('Verde'))).toEqual(['PA-2026-00002', 'PA-2026-00003'])
    expect(codesIn(section('Amarillo'))).toEqual([])
    expect(within(section('Amarillo')).getByText(T.planesEmptyAmarillo)).toBeTruthy()
  })

  it('prints 40 %, from a stored 0.4', async () => {
    renderPage()
    const row = (await screen.findByText('PA-2026-00002')).closest('tr') as HTMLElement
    expect(within(row).getByText('40 %')).toBeTruthy()
  })

  it('counts the tiles from the set it can see and names the nodos behind each state', async () => {
    renderPage()
    await screen.findByText('PA-2026-00001')
    expect(screen.getByText(`${T.planesTileRojo} · Finanzas`)).toBeTruthy()
    expect(screen.getByText(`${T.planesTileVerde} · Ingeniería y Operaciones`)).toBeTruthy()
    expect(screen.getByText(`${T.planesWithProgress.replace('{count}', '1')} · ${T.planesNoneCumplido}`)).toBeTruthy()
    expect(screen.getByText(/3 planes en 3 de 4 nodos · Personas sin plan/)).toBeTruthy()
  })

  it('names the responsable from the directory, marks the viewer, and links each code to its plan', async () => {
    renderPage()
    const red = (await screen.findByText('PA-2026-00001')).closest('tr') as HTMLElement
    expect(within(red).getByText('Adriana Marín')).toBeTruthy()
    expect(within(red).getByText('Finanzas')).toBeTruthy()
    expect(screen.getByText('PA-2026-00001').closest('a')?.getAttribute('href')).toBe('/tracking/planes/plan-1')
    const mine = screen.getByText('PA-2026-00003').closest('tr') as HTMLElement
    expect(within(mine).getByText('Ana Rojas')).toBeTruthy()
    expect(within(mine).getByText(T.planesYou)).toBeTruthy()
  })

  it('offers "Registrar avance" on a red plan the viewer manages and "Abrir" on the rest', async () => {
    renderPage()
    const red = (await screen.findByText('PA-2026-00001')).closest('tr') as HTMLElement
    expect(within(red).getByRole('link', { name: T.planesOpenNamed.replace('{code}', 'PA-2026-00001') }).textContent).toBe(T.planesRegistrarAvance)
    const green = screen.getByText('PA-2026-00002').closest('tr') as HTMLElement
    expect(within(green).getByRole('link', { name: T.planesOpenNamed.replace('{code}', 'PA-2026-00002') }).textContent).toBe(T.planesAbrir)
  })

  it('filters by state on screen and keeps the tiles on the whole set', async () => {
    renderPage()
    await screen.findByText('PA-2026-00001')
    fireEvent.change(screen.getByLabelText(T.planesEstadoFilter), { target: { value: 'Rojo' } })
    expect(section('Verde')).toBeNull()
    expect(codesIn(section('Rojo'))).toEqual(['PA-2026-00001'])
    expect(screen.getByText(`${T.planesTileVerde} · Ingeniería y Operaciones`)).toBeTruthy()
  })

  it('keeps the list when the picker directory is refused, and names nobody it cannot', async () => {
    routeFetch(PLANS, { pickers: false })
    renderPage()
    const red = (await screen.findByText('PA-2026-00001')).closest('tr') as HTMLElement
    expect(within(red).getByText(T.responsableUnnamed)).toBeTruthy()
    expect(within(red).queryByText('Finanzas')).toBeNull()
  })

  it('offers "Nuevo plan" and "Vista consolidada" to an administrator, and opens the create form', async () => {
    renderPage()
    await screen.findByText('PA-2026-00001')
    expect(screen.getByRole('link', { name: T.planesConsolidado }).getAttribute('href')).toBe('/tracking')
    fireEvent.click(screen.getByRole('button', { name: es.tracking.actions.newPlan }))
    expect(screen.getByRole('heading', { name: es.tracking.actions.createPlan })).toBeTruthy()
  })

  it('offers neither to an employee, whom the service lets create nothing', async () => {
    setToken(tokenFor({ sub: 'persona-2', role: 'employee', nodoId: 'nodo-a', companyId: 'company-1' }))
    renderPage()
    await screen.findByText('PA-2026-00001')
    expect(screen.queryByRole('button', { name: es.tracking.actions.newPlan })).toBeNull()
    expect(screen.queryByRole('link', { name: T.planesConsolidado })).toBeNull()
    const red = screen.getByText('PA-2026-00001').closest('tr') as HTMLElement
    expect(within(red).getByRole('link', { name: T.planesOpenNamed.replace('{code}', 'PA-2026-00001') }).textContent).toBe(T.planesAbrir)
  })

  it('names the service in Spanish, offers a retry, and draws no tile when it is unreachable', async () => {
    routeFetch(PLANS, { down: true })
    renderPage()
    expect(await screen.findByText(/No se pudo contactar el servicio de seguimiento/)).toBeTruthy()
    expect(screen.getByRole('button', { name: es.common.retry })).toBeTruthy()
    expect(screen.queryByText(/Failed to fetch/)).toBeNull()
    expect(screen.queryByText(T.planesTileRojo)).toBeNull()
    expect(screen.queryByText(T.planesNoneCumplido, { exact: false })).toBeNull()
  })
})
