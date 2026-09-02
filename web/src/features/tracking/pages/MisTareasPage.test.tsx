import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import MisTareasPage from './MisTareasPage'
import type { PlanAccion } from '../api/trackingApi'
import { tokenFor } from '../../../test/jwtFixture'

/**
 * `/tracking/mis-tareas` is the acceptance criterion "reachable and usable by a
 * non-admin role", so these mount it as one.
 *
 * `MisTareasAsync` reads no role claim at all — it filters on the caller's own
 * `PersonaExternalId` — so an `employee` is a first-class caller here. The page
 * must therefore neither gate on a role nor ask for a company: doing either would
 * be inventing a restriction the endpoint does not have.
 */
function tarea(overrides: Partial<PlanAccion> = {}): PlanAccion {
  return {
    id: 'p1',
    planCode: 'PA-2026-00007',
    nodoExternalId: 'nodo-a',
    liderExternalId: 'lider-1',
    hallazgoExternalId: null,
    descripcionQue: 'Reunión mensual de seguimiento',
    metodologiaComo: 'Sesiones de 30 minutos',
    responsableEjecucionExternalId: 'persona-1',
    fechaCreacion: '2026-01-10',
    fechaCompromiso: '2026-09-30',
    porcentajeAvance: 0.25,
    estadoSemaforo: 'Amarillo',
    cicloEncuestaExternalId: null,
    fechaUltimaActualizacion: '2026-08-01',
    cumplido: false,
    involucradosExternalIds: ['persona-1'],
    ...overrides,
  }
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <MisTareasPage />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  // An employee: the role with no node, no company admin rights and no tablero.
  setToken(tokenFor({ sub: 'persona-1', role: 'employee', nodoId: '' }))
})

afterEach(() => {
  cleanup()
  clearToken()
  vi.unstubAllGlobals()
})

describe('MisTareasPage', () => {
  it('loads and lists an employee own tasks', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([tarea()]), { status: 200 })),
    )
    renderPage()

    expect(await screen.findByText('Reunión mensual de seguimiento')).toBeTruthy()
    expect(screen.getByText('PA-2026-00007')).toBeTruthy()
  })

  it('asks /api/mis-tareas and sends no company parameter', async () => {
    // The endpoint resolves the caller from their own token and takes no company.
    // A companyId in this URL would be a claim the service does not make.
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([tarea()]), { status: 200 })),
    )
    renderPage()
    await screen.findByText('Reunión mensual de seguimiento')

    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('/api/mis-tareas'))).toBe(true)
    expect(urls.some((url) => url.includes('companyId'))).toBe(false)
  })

  it('shows the percentage as 25, from a stored 0.25', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([tarea({ porcentajeAvance: 0.25 })]), { status: 200 })),
    )
    renderPage()

    expect(await screen.findByText('25%')).toBeTruthy()
  })

  it('offers no write control, because an involucrado has read access only', async () => {
    // `PlanAccessHandler` succeeds for an involucrado at `AccessLevel.Read` and at
    // nothing else. A "Registrar avance" button here would 403 on click.
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([tarea()]), { status: 200 })),
    )
    renderPage()
    await screen.findByText('Reunión mensual de seguimiento')

    expect(screen.queryByRole('button', { name: 'Registrar avance' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Marcar como cumplido' })).toBeNull()
    expect(
      screen.getByText(
        'Esta vista es de consulta. El registro de avance lo realiza la jefatura del nodo.',
      ),
    ).toBeTruthy()
  })

  /**
   * The node leader is in this list too, and the unconditional banner was false for
   * exactly one reader: the one it names.
   *
   * `MisTareasAsync` reads no role claim, so a leader who is responsable or involucrado
   * on a plan of their own jefatura is listed here — and `PlanAccessHandler` gives them
   * write access to that plan, because their `nodoId` claim matches its node. Telling
   * them the registro de avance "lo realiza la jefatura del nodo" points at themselves,
   * one click before the detail page hands them the form.
   */
  it('does not tell a node leader that recording progress is somebody else job', async () => {
    setToken(tokenFor({ sub: 'persona-1', role: 'leader', nodoId: 'nodo-a' }))
    vi.mocked(fetch).mockImplementation(() =>
      // `nodo-a` is the fixture task's own node, so `canManagePlan` is true here.
      Promise.resolve(new Response(JSON.stringify([tarea()]), { status: 200 })),
    )
    renderPage()
    await screen.findByText('Reunión mensual de seguimiento')

    expect(
      screen.queryByText(
        'Esta vista es de consulta. El registro de avance lo realiza la jefatura del nodo.',
      ),
    ).toBeNull()
    expect(
      screen.getByText(
        'Este listado es de consulta. Abra un plan de su nodo para registrar el avance.',
      ),
    ).toBeTruthy()
    // Still no write control on this page — that half of the notice was never wrong.
    expect(screen.queryByRole('button', { name: 'Registrar avance' })).toBeNull()
  })

  it('keeps the original notice for a leader whose listed tasks are all on other nodes', async () => {
    // A leader is an involucrado somewhere else: `canManagePlan` refuses a node that is
    // not their own, so the sentence naming the jefatura is the true one again.
    setToken(tokenFor({ sub: 'persona-1', role: 'leader', nodoId: 'nodo-b' }))
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([tarea()]), { status: 200 })),
    )
    renderPage()
    await screen.findByText('Reunión mensual de seguimiento')

    expect(
      screen.getByText(
        'Esta vista es de consulta. El registro de avance lo realiza la jefatura del nodo.',
      ),
    ).toBeTruthy()
  })

  it('says so plainly when there is nothing assigned', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([]), { status: 200 })),
    )
    renderPage()

    expect(await screen.findByText('No tiene tareas asignadas.')).toBeTruthy()
  })

  it('offers a retry rather than a blank page when the service is unreachable', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network down'))
    renderPage()

    // The retry affordance and a sentence the reader can act on — which is what this
    // test was always named for. It used to prove that by asserting the EXCEPTION text
    // was on screen, which quietly made "show the user err.message" a guarantee: a
    // browser TypeError then put the literal words "Failed to fetch" in front of an
    // end user, and the assertion defended it. The intent is unchanged; the evidence
    // is no longer the defect.
    expect(await screen.findByText(/No se pudo contactar el servicio de seguimiento/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reintentar|Retry/ })).toBeTruthy()
    expect(screen.queryByText('network down')).toBeNull()
  })
})

/**
 * What an unreachable tracking service must NOT look like.
 *
 * A rejected `fetch` is the shape a real outage takes in the browser: the service is a
 * separate deployment, so a stopped container, a DNS failure and an origin the CORS
 * policy is not configured to allow all arrive as a rejection rather than as a status.
 *
 * Both assertions below were false before this was fixed, and each fails on its own.
 */
describe('MisTareasPage when the tracking service is unreachable', () => {
  function outage() {
    vi.mocked(fetch).mockImplementation(() => {
      throw new TypeError('Failed to fetch')
    })
  }

  it('draws no semáforo strip, because a strip of zeros is a reading nobody took', async () => {
    outage()
    renderPage()

    // The error has to be on screen first, or this asserts on a page that has not
    // finished loading and would pass whatever the strip did.
    await screen.findByText(/No se pudo contactar el servicio de seguimiento/)

    expect(screen.queryByLabelText('Resumen del semáforo')).toBeNull()
    // The four confident zeros the strip used to print, by their own sub-labels.
    expect(screen.queryByText('En total')).toBeNull()
    expect(screen.queryByText('Vencido o sin avance')).toBeNull()
    expect(screen.queryByText('En tiempo y con avance')).toBeNull()
  })

  it('names the service in Spanish instead of showing the browser\'s own words', async () => {
    outage()
    renderPage()

    expect(await screen.findByText(/No se pudo contactar el servicio de seguimiento/)).toBeTruthy()
    expect(screen.getByText(/El módulo de seguimiento no respondió/)).toBeTruthy()

    // The raw TypeError message, and the English generic that framed it. This module's
    // copy is Spanish-only and test-enforced; `errors.generic` follows the reader's
    // locale, so the old pair printed an English sentence inside a Spanish page.
    expect(screen.queryByText(/Failed to fetch/)).toBeNull()
    expect(screen.queryByText(/An error occurred/)).toBeNull()
  })
})
