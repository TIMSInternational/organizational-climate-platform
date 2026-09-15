import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { clearCompanyNameCache } from '../../../company-context/useCompanyName'
import { tokenFor } from '../../../test/jwtFixture'
import type { PlanAccion } from '../api/trackingApi'
import es from '../../../i18n/es.json'
import MisTareasNextPage from './MisTareasNextPage'

/**
 * `/tracking/mis-tareas` — the redesigned Mis tareas (MisTareas and MisTareasAsignadas,
 * 10 Sep).
 *
 * **These guarantees were moved here, not copied**, from `pages/MisTareasPage.test.tsx`: that
 * page is now a wiring reference nothing mounts, and a test that went on naming it would keep
 * reporting these as held on code no user reaches.
 *
 * The acceptance criterion behind the route is "reachable and usable by a non-admin role", so
 * these mount it as one. `MisTareasAsync` reads no role claim at all — it filters on the
 * caller's own `PersonaExternalId` — so an `employee` is a first-class caller here, and the
 * page must neither gate on a role nor ask for a company: doing either would invent a
 * restriction the endpoint does not have.
 *
 * The clock is pinned to 10 Sep 2026 (local noon, so no zone moves it to the 9th or the
 * 11th): "en 5 días" is a count from today, and against the real clock these would pass on
 * one day of the year.
 */

const API = 'http://api.test'
const TRACKING = 'http://tracking.test'
const COMPANY = '16c97c29-07f8-4522-86fc-e6cc56298829'
const INGENIERIA = '5bfdb04e-8847-4baa-89c8-d4411654a129'
/** Alejandro Retana — the one person on the demo tenant named on a plan today. */
const ALEJANDRO = '1553edb1-e100-4bb1-a397-90882b3a3e9e'

const next = es.tracking.next

/**
 * PA-2026-00002 as `GET /api/mis-tareas` answered on the local stack on 10 Sep, field for
 * field (`scripts/shot-fixtures/plans-tracking-leader.json`). `porcentajeAvance` is the
 * FRACTION the service stores, not a percentage.
 */
function tarea(overrides: Partial<PlanAccion> = {}): PlanAccion {
  return {
    id: '01a08b9e-63d1-7f20-8a5d-62a31ac71d53',
    planCode: 'PA-2026-00002',
    nodoExternalId: INGENIERIA,
    liderExternalId: '',
    hallazgoExternalId: null,
    descripcionQue: 'Publicar el rol de fines de semana con dos semanas de antelación',
    metodologiaComo: 'Calendario compartido, actualizado los lunes por la jefatura del nodo.',
    responsableEjecucionExternalId: ALEJANDRO,
    fechaCreacion: '2026-09-10',
    fechaCompromiso: '2026-09-15',
    porcentajeAvance: 0,
    estadoSemaforo: 'Verde',
    cicloEncuestaExternalId: null,
    fechaUltimaActualizacion: '2026-09-10',
    cumplido: false,
    involucradosExternalIds: [ALEJANDRO],
    ...overrides,
  }
}

let profile = { companyName: 'Grupo Meridiano S.A.', departmentId: null as string | null, departmentName: null as string | null }

function answer(tareas: readonly PlanAccion[] | 'reject') {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/mis-tareas')) {
      if (tareas === 'reject') return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve(new Response(JSON.stringify(tareas), { status: 200 }))
    }
    if (/\/profile(\?|$)/.test(url)) return Promise.resolve(new Response(JSON.stringify(profile), { status: 200 }))
    return Promise.resolve(new Response('', { status: 404 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider initialLocale="es">
      <MemoryRouter>
        <CompanyContextProvider>
          <MisTareasNextPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function urls(): string[] {
  return vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 10, 12, 0, 0))
  vi.stubEnv('VITE_TRACKING_API_BASE_URL', TRACKING)
  vi.stubEnv('VITE_API_BASE_URL', API)
  vi.stubGlobal('fetch', vi.fn())
  clearCompanyNameCache()
  profile = { companyName: 'Grupo Meridiano S.A.', departmentId: INGENIERIA, departmentName: 'Ingeniería' }
  // An employee: the role with no node, no company admin rights and no tablero.
  setToken(tokenFor({ sub: ALEJANDRO, name: 'Alejandro Retana', role: 'employee', companyId: COMPANY, nodoId: '', isActive: 'true' }))
  answer([tarea()])
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('MisTareasNextPage — a task on the list (MisTareasAsignadas)', () => {
  it('loads and lists an employee own tasks', async () => {
    renderPage()
    const row = (await screen.findByText('Publicar el rol de fines de semana con dos semanas de antelación')).closest('tr') as HTMLElement
    // The code appears twice on a populated board — in "Lo próximo" and in the row — so this
    // asks for the row's own, which is the one that has to be a link.
    expect(within(row).getByRole('link', { name: next.planesOpenNamed.replace('{code}', 'PA-2026-00002') }).textContent).toBe('PA-2026-00002')
    expect(within(row).getByText('Calendario compartido, actualizado los lunes por la jefatura del nodo.')).toBeTruthy()
  })

  it('asks /api/mis-tareas and sends no company parameter', async () => {
    // The endpoint resolves the caller from their own token and takes no company. A
    // companyId in this URL would be a claim the service does not make.
    renderPage()
    await screen.findByText('Publicar el rol de fines de semana con dos semanas de antelación')
    expect(urls().some((url) => url.includes('/api/mis-tareas'))).toBe(true)
    expect(urls().some((url) => url.includes('/api/mis-tareas') && url.includes('companyId'))).toBe(false)
  })

  it('shows the percentage as 25, from a stored 0.25', async () => {
    answer([tarea({ porcentajeAvance: 0.25 })])
    renderPage()
    // The board prints "25 %" with a hair of space, in the row and in "Lo próximo".
    expect((await screen.findAllByText(next.planesPercent.replace('{value}', '25'))).length).toBeGreaterThan(0)
  })

  it('leads with "Lo próximo": the nearest commitment, its state and the whole tally', async () => {
    answer([tarea()])
    renderPage()
    const card = (await screen.findByText(next.misTareasNext)).closest('section') as HTMLElement
    expect(within(card).getByText('PA-2026-00002')).toBeTruthy()
    expect(within(card).getByText(next.misTareasNextDue.replace('{date}', '15 sept').replace('{days}', '5'))).toBeTruthy()
    expect(within(card).getByText(es.tracking.semaforo.verde)).toBeTruthy()
    expect(within(card).getByText(next.misTareasNoAvance.replace('{percent}', '0'))).toBeTruthy()
    expect(within(card).getByText(next.misTareasCountOne)).toBeTruthy()
    expect(within(card).getByText(next.misTareasTally.replace('{rojo}', '0').replace('{amarillo}', '0').replace('{verde}', '1'))).toBeTruthy()
  })

  it('names the reader part on each task, and who records its avance', async () => {
    renderPage()
    const row = (await screen.findByText('Publicar el rol de fines de semana con dos semanas de antelación')).closest('tr') as HTMLElement
    expect(within(row).getByText(next.misTareasPapelResponsable)).toBeTruthy()
    expect(within(row).getByText('Ingeniería')).toBeTruthy()
    expect(within(row).getByText(next.misTareasJefatura.replace('{nodo}', 'Ingeniería'))).toBeTruthy()
  })

  it('opens the plan from its code and links nowhere else', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: next.planesOpenNamed.replace('{code}', 'PA-2026-00002') })
    expect(link.getAttribute('href')).toBe('/tracking/planes/01a08b9e-63d1-7f20-8a5d-62a31ac71d53')
  })

  it('offers no write control, because an involucrado has read access only', async () => {
    // `PlanAccessHandler` succeeds for an involucrado at `AccessLevel.Read` and at nothing
    // else. A "Registrar avance" button here would 403 on click.
    renderPage()
    await screen.findByText('Publicar el rol de fines de semana con dos semanas de antelación')
    expect(screen.queryByRole('button', { name: es.tracking.actions.registrarAvance })).toBeNull()
    expect(screen.queryByRole('button', { name: es.tracking.actions.marcarCumplido })).toBeNull()
    expect(screen.queryByRole('button', { name: next.marcarCumplido })).toBeNull()
    expect(
      screen.getByText(
        next.misTareasReadOnlyOne
          .replace('{code}', 'PA-2026-00002')
          .replace('{jefatura}', next.misTareasJefatura.replace('{nodo}', 'Ingeniería')),
      ),
    ).toBeTruthy()
  })
})

describe('MisTareasNextPage — nothing assigned (MisTareas)', () => {
  it('says so plainly, and says that an empty list is the answer', async () => {
    answer([])
    renderPage()
    expect(await screen.findByText(next.misTareasEmptyTitle)).toBeTruthy()
    expect(screen.getByText(next.misTareasEmptyBody)).toBeTruthy()
    expect(screen.getByText(next.misTareasReadOnly)).toBeTruthy()
  })

  it('still draws the column headers, so the empty screen says what a task will show', async () => {
    answer([])
    renderPage()
    await screen.findByText(next.misTareasEmptyTitle)
    const table = screen.getByRole('table', { name: next.misTareasListTitle })
    for (const heading of [next.planesColCodigo, next.misTareasColQue, next.misTareasColPapel, next.misTareasColNodo, next.planesColCompromiso, next.planesColAvance]) {
      expect(within(table).getByText(heading), `no "${heading}" column header`).toBeTruthy()
    }
  })

  it('draws no "Lo próximo" card, because a card of zeros is a reading nobody took', async () => {
    answer([])
    renderPage()
    await screen.findByText(next.misTareasEmptyTitle)
    expect(screen.queryByText(next.misTareasNext)).toBeNull()
    expect(document.querySelector('[data-slot="lo-proximo"]')).toBeNull()
  })
})

/**
 * The node leader is in this list too, and the unconditional banner was false for exactly one
 * reader: the one it names.
 *
 * `MisTareasAsync` reads no role claim, so a leader who is responsable or involucrado on a
 * plan of their own jefatura is listed here — and `PlanAccessHandler` gives them write access
 * to that plan, because their `nodoId` claim matches its node. Telling them the avance "lo
 * registra la jefatura del nodo" points at themselves, one click before the detail page hands
 * them the form.
 */
describe('MisTareasNextPage — the node leader is a first-class caller', () => {
  it('does not tell a node leader that recording progress is somebody else job', async () => {
    setToken(tokenFor({ sub: ALEJANDRO, name: 'Luis Mora', role: 'leader', companyId: COMPANY, nodoId: INGENIERIA, isActive: 'true' }))
    renderPage()
    await screen.findByText('Publicar el rol de fines de semana con dos semanas de antelación')

    expect(screen.getByText(next.misTareasManager)).toBeTruthy()
    expect(screen.queryByText(next.misTareasReadOnly)).toBeNull()
    expect(
      screen.queryByText(
        next.misTareasReadOnlyOne
          .replace('{code}', 'PA-2026-00002')
          .replace('{jefatura}', next.misTareasJefatura.replace('{nodo}', 'Ingeniería')),
      ),
    ).toBeNull()
    // The row says it too, in place of naming the jefatura in the third person.
    const row = screen.getByText('Publicar el rol de fines de semana con dos semanas de antelación').closest('tr') as HTMLElement
    expect(within(row).getByText(next.planesPapelRegistrasBare)).toBeTruthy()
    // Still no write control on this page — that half of the notice was never wrong.
    expect(screen.queryByRole('button', { name: es.tracking.actions.registrarAvance })).toBeNull()
  })

  it('keeps the read-only notice for a leader whose listed tasks are all on other nodes', async () => {
    // `canManagePlan` refuses a node that is not the claim's, so the sentence naming the
    // jefatura is the true one again.
    setToken(tokenFor({ sub: ALEJANDRO, name: 'Luis Mora', role: 'leader', companyId: COMPANY, nodoId: 'nodo-otro', isActive: 'true' }))
    profile = { companyName: 'Grupo Meridiano S.A.', departmentId: 'nodo-otro', departmentName: 'Finanzas' }
    renderPage()
    await screen.findByText('Publicar el rol de fines de semana con dos semanas de antelación')
    expect(screen.queryByText(next.misTareasManager)).toBeNull()
    // The nodo of a plan that is not theirs has no name for this reader: the nodo directory
    // is admin-only, so the notice falls back to "la jefatura del nodo" rather than guessing.
    expect(
      screen.getByText(next.misTareasReadOnlyOne.replace('{code}', 'PA-2026-00002').replace('{jefatura}', next.misTareasJefaturaBare)),
    ).toBeTruthy()
  })

  it('takes the manager notice from ANY managed task, not from all of them', async () => {
    // A mixed list: one plan on the leader own nodo, one elsewhere. The sentence denying
    // they may record any progress at all is the one that would be wrong.
    setToken(tokenFor({ sub: ALEJANDRO, name: 'Luis Mora', role: 'leader', companyId: COMPANY, nodoId: INGENIERIA, isActive: 'true' }))
    answer([tarea(), tarea({ id: 'other', planCode: 'PA-2026-00001', nodoExternalId: 'nodo-otro', fechaCompromiso: '2026-10-01' })])
    renderPage()
    await screen.findByText('PA-2026-00001')
    expect(screen.getByText(next.misTareasManager)).toBeTruthy()
  })
})

/**
 * What an unreachable tracking service must NOT look like.
 *
 * A rejected `fetch` is the shape a real outage takes in the browser: the service is a
 * separate deployment, so a stopped container, a DNS failure and an origin the CORS policy is
 * not configured to allow all arrive as a rejection rather than as a status.
 */
describe('MisTareasNextPage when the tracking service is unreachable', () => {
  it('names the service in Spanish instead of showing the browser own words', async () => {
    answer('reject')
    renderPage()
    expect(await screen.findByText(/No se pudo contactar el servicio de seguimiento/)).toBeTruthy()
    expect(screen.getByText(/El módulo de seguimiento no respondió/)).toBeTruthy()
    expect(screen.getByRole('button', { name: es.common.retry })).toBeTruthy()
    // The raw TypeError message, and the English generic that once framed it: this module's
    // copy is Spanish-only and test-enforced, and `errors.generic` follows the reader locale.
    expect(screen.queryByText(/Failed to fetch/)).toBeNull()
    expect(screen.queryByText(es.errors.generic)).toBeNull()
  })

  it('draws no tally and no empty state, because both would be readings nobody took', async () => {
    answer('reject')
    renderPage()
    // The error has to be on screen first, or this asserts on a page still loading and would
    // pass whatever it drew.
    await screen.findByText(/No se pudo contactar el servicio de seguimiento/)
    expect(screen.queryByText(next.misTareasNext)).toBeNull()
    expect(screen.queryByText(next.misTareasEmptyTitle)).toBeNull()
    expect(screen.queryByText(next.misTareasListTitle)).toBeNull()
  })
})
