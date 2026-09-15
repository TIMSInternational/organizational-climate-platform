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

function routeFetch(plans: PlanAccion[] = PLANS, options: { pickers?: boolean; down?: boolean; ownNodo?: { id: string; name: string } } = {}) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    if (url.includes('/tracking/picker/nodos')) return options.pickers === false ? Promise.reject(new Error('Forbidden')) : json(NODOS)
    if (url.includes('/tracking/picker/personas')) return options.pickers === false ? Promise.reject(new Error('Forbidden')) : json(PERSONAS)
    // A non-admin reads exactly one nodo name, their own, from `GET /profile`: the nodo
    // directory is admin-only (`TrackingPickerEndpoints.cs:19-21`).
    if (/\/profile(\?|$)/.test(url)) {
      return options.ownNodo
        ? json({ companyName: 'Acme', departmentId: options.ownNodo.id, departmentName: options.ownNodo.name })
        : json({ companyName: 'Acme', departmentId: null, departmentName: null })
    }
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

  it('draws the list’s thin bar under each printed percentage, with no compromiso mark at its end', async () => {
    renderPage()
    await screen.findByText('PA-2026-00001')
    for (const [code, percent] of [['PA-2026-00001', 0], ['PA-2026-00002', 40], ['PA-2026-00003', 0]] as const) {
      const row = screen.getByText(code).closest('tr') as HTMLElement
      const avance = row.querySelector('[data-slot="avance"]') as HTMLElement
      expect(within(avance).getByText(T.planesPercent.replace('{value}', String(percent)))).toBeTruthy()
      // The detail's `ProgressTrack` is a progressbar with the compromiso tick; the list's bar is not.
      expect(within(row).queryByRole('progressbar')).toBeNull()
      const fill = avance.querySelector('[aria-hidden="true"] > span') as HTMLElement
      expect(fill.style.width).toBe(`${percent}%`)
    }
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

/**
 * TrackingPlanesListLeader (10 Sep) — the board as the leader of a nodo reads it, which
 * nobody had looked at.
 *
 * `nodo-b` is Ingeniería here: PA-2026-00002 is that nodo's own plan, and PA-2026-00001 is a
 * Finanzas plan this leader is merely named on. The two are exactly the two relations the
 * board is built around, and the fixture carries one of each so neither tab can be empty by
 * accident.
 */
describe('PlanesListNextPage — the node leader board', () => {
  const LEADER_PLANS = [
    plan({ involucradosExternalIds: ['luis'] }),
    plan({ id: 'plan-2', planCode: 'PA-2026-00002', nodoExternalId: 'nodo-b', estadoSemaforo: 'Verde', fechaCompromiso: shift(5), porcentajeAvance: 0.4 }),
  ]

  beforeEach(() => {
    setToken(tokenFor({ sub: 'luis', name: 'Luis Mora', role: 'leader', nodoId: 'nodo-b', companyId: 'company-1' }))
    routeFetch(LEADER_PLANS, { pickers: false, ownNodo: { id: 'nodo-b', name: 'Ingeniería' } })
  })

  it('names the nodo in the eyebrow, the description, the create note and both actions', async () => {
    renderPage()
    await screen.findByText('PA-2026-00001')
    expect(await screen.findByText(T.planesEyebrowNodo.replace('{nodo}', 'Ingeniería'))).toBeTruthy()
    expect(screen.getByText(T.planesDescriptionLeader.replace('{nodo}', 'Ingeniería'))).toBeTruthy()
    expect(screen.getByText(T.planesCreateNote.replace('{nodo}', 'Ingeniería'))).toBeTruthy()
    expect(screen.getByRole('link', { name: T.planesTablero.replace('{nodo}', 'Ingeniería') }).getAttribute('href')).toBe('/tracking/tablero')
    expect(screen.getByRole('button', { name: T.planesNewPlanIn.replace('{nodo}', 'Ingeniería') })).toBeTruthy()
    // `ConsolidadoAsync` forbids this role, so the consolidado is not offered.
    expect(screen.queryByRole('link', { name: T.planesConsolidado })).toBeNull()
  })

  it('splits the list by the reader two relations to it, and filters on the chosen one', async () => {
    renderPage()
    await screen.findByText('PA-2026-00001')
    const group = screen.getByRole('group', { name: T.planesScopeLabel })
    const pill = (scope: string) => within(group).getByRole('button', { name: new RegExp(scope) })

    expect(pill(T.planesScopeAll).textContent).toContain('2')
    expect(pill(T.planesScopeMine).textContent).toContain('1')
    expect(pill(T.planesScopeInvolved).textContent).toContain('1')
    expect(pill(T.planesScopeAll).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(pill(T.planesScopeMine))
    expect(codesIn(section('Verde'))).toEqual(['PA-2026-00002'])
    expect(codesIn(section('Rojo'))).toEqual([])

    fireEvent.click(pill(T.planesScopeInvolved))
    expect(codesIn(section('Rojo'))).toEqual(['PA-2026-00001'])
    expect(codesIn(section('Verde'))).toEqual([])
  })

  it('replaces the Nodo column with "Tu papel", and marks each row with what it lets the reader do', async () => {
    renderPage()
    await screen.findByText('PA-2026-00001')
    expect(screen.queryByText(T.planesColNodo)).toBeNull()
    expect(screen.getAllByText(T.planesColPapel).length).toBeGreaterThan(0)

    const mine = (screen.getByText('PA-2026-00002').closest('tr') as HTMLElement).querySelector('[data-slot="papel"]') as HTMLElement
    expect(within(mine).getByText(T.planesPapelTuNodo)).toBeTruthy()
    expect(within(mine).getByText(T.planesPapelRegistras.replace('{nodo}', 'Ingeniería'))).toBeTruthy()

    const theirs = (screen.getByText('PA-2026-00001').closest('tr') as HTMLElement).querySelector('[data-slot="papel"]') as HTMLElement
    expect(within(theirs).getByText(T.planesPapelParticipas)).toBeTruthy()
    expect(within(theirs).getByText(T.planesPapelOtroNodo)).toBeTruthy()
  })

  /**
   * The ruling of 2026-09-14. The artboard's own legend reads "registras avance **y lo marcas
   * cumplido**", and that half stopped being true when `cumplir` moved to `AccessLevel.Approve`
   * — so the board says who does instead, and this pins that it never says the leader does.
   */
  it('never tells the leader they may declare a plan fulfilled', async () => {
    renderPage()
    await screen.findByText('PA-2026-00001')
    expect(await screen.findByText(T.planesRoleLegendMine.replace('{nodo}', 'Ingeniería'))).toBeTruthy()
    expect(screen.getByText(T.planesRoleLegendInvolved)).toBeTruthy()
    expect(screen.getByText(T.planesWhoWritesLeader)).toBeTruthy()
    // The administrator's sentence — "Registran avance la jefatura del nodo y la
    // administración" — describes this reader in the third person.
    expect(screen.queryByText(T.planesWhoWrites)).toBeNull()
  })

  it('counts the tile as "planes que ves", split by where they come from, not as tenant coverage', async () => {
    renderPage()
    await screen.findByText('PA-2026-00001')
    expect(await screen.findByText(`${T.planesFromYourNodo.replace('{nodo}', 'Ingeniería')} · ${T.planesOtherNodos.replace('{count}', '1')}`)).toBeTruthy()
    expect(screen.getByText(T.planesTileYours)).toBeTruthy()
    // Coverage is a statement about the tenant, which this reader cannot see.
    expect(screen.queryByText(/de 4 nodos/)).toBeNull()
    expect(screen.queryByText(T.planesScopeNote)).toBeTruthy()
  })

  it('falls back to the bare wording when GET /profile did not name the nodo', async () => {
    routeFetch(LEADER_PLANS, { pickers: false })
    renderPage()
    await screen.findByText('PA-2026-00001')
    expect(screen.getByText(T.planesDescriptionLeaderBare)).toBeTruthy()
    expect(screen.getByRole('link', { name: T.planesTableroBare })).toBeTruthy()
    expect(screen.getByRole('button', { name: es.tracking.actions.newPlan })).toBeTruthy()
    // Never the external id where a name belongs.
    expect(document.body.textContent).not.toContain('nodo-b')
  })
})
