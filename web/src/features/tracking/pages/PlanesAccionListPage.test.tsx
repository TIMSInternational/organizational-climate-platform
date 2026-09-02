import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import {
  CompanyContextProvider,
  COMPANY_CONTEXT_STORAGE_KEY,
} from '../../../company-context'
import PlanesAccionListPage from './PlanesAccionListPage'
import type { PlanAccion } from '../api/trackingApi'
import { tokenFor } from '../../../test/jwtFixture'

function plan(overrides: Partial<PlanAccion> = {}): PlanAccion {
  return {
    id: 'plan-1',
    planCode: 'PA-2026-00001',
    nodoExternalId: 'nodo-a',
    liderExternalId: 'lider-1',
    hallazgoExternalId: null,
    descripcionQue: 'Reforzar la comunicación interna',
    metodologiaComo: 'Boletín quincenal',
    responsableEjecucionExternalId: 'persona-2',
    fechaCreacion: '2026-02-01',
    fechaCompromiso: '2026-10-15',
    porcentajeAvance: 0.4,
    estadoSemaforo: 'Amarillo',
    cicloEncuestaExternalId: null,
    fechaUltimaActualizacion: '2026-08-01',
    cumplido: false,
    involucradosExternalIds: [],
    ...overrides,
  }
}

const NODOS = { nodos: [{ id: 'nodo-a', name: 'Operaciones' }, { id: 'nodo-b', name: 'Finanzas' }] }
const PERSONAS = { personas: [{ id: 'persona-2', name: 'Beto Solís', email: 'beto@acme.test' }] }

function routeFetch(plans: PlanAccion[] = [plan()], options: { pickers?: boolean } = {}) {
  const withPickers = options.pickers ?? true
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status }))

    if (url.includes('/tracking/picker/nodos')) {
      return withPickers ? json(NODOS) : Promise.reject(new Error('Forbidden'))
    }
    if (url.includes('/tracking/picker/personas')) {
      return withPickers ? json(PERSONAS) : Promise.reject(new Error('Forbidden'))
    }
    if (init?.method === 'POST') return json(plan({ id: 'plan-new', planCode: 'PA-2026-00099' }), 201)
    return json(plans)
  })
}

function renderPage() {
  return render(
    <TranslationProvider initialLocale="es">
      <MemoryRouter>
        <CompanyContextProvider>
          <PlanesAccionListPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  setToken(tokenFor({ sub: 'admin-1', role: 'company_admin', nodoId: '', companyId: 'company-1' }))
  routeFetch()
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  vi.unstubAllGlobals()
})

describe('PlanesAccionListPage', () => {
  it('lists the plans the service returned, without filtering them itself', async () => {
    // `ListAsync` scopes the query server-side. A client-side filter here would be a
    // second, disagreeing opinion about who may see what.
    renderPage()
    expect(await screen.findByText('Reforzar la comunicación interna')).toBeTruthy()
    expect(screen.getByText('PA-2026-00001')).toBeTruthy()
  })

  it('shows 40%, from a stored 0.4', async () => {
    renderPage()
    expect(await screen.findByText('40%')).toBeTruthy()
  })

  it('counts the semáforo states from the set it can actually see', async () => {
    // Deliberately NOT `GET /api/tablero-seguimiento`: that endpoint answers for one
    // node and forbids a non-admin asking about any other, so its counts would not
    // match this table.
    routeFetch([
      plan({ id: 'a', estadoSemaforo: 'Rojo' }),
      plan({ id: 'b', estadoSemaforo: 'Rojo' }),
      plan({ id: 'c', estadoSemaforo: 'Verde' }),
    ])
    renderPage()
    await screen.findAllByText('PA-2026-00001')

    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('tablero-seguimiento'))).toBe(false)

    const summary = within(screen.getByRole('list', { name: 'Resumen del semáforo' }))
    expect(summary.getByText('Atrasado').closest('li')?.textContent).toContain('2')
    expect(summary.getByText('Al día').closest('li')?.textContent).toContain('1')
  })

  it('asks the service for a filtered estado rather than filtering in the page', async () => {
    renderPage()
    await screen.findByText('Reforzar la comunicación interna')

    fireEvent.click(screen.getByRole('combobox', { name: /Filtrar por semáforo/ }))
    fireEvent.click(await screen.findByRole('option', { name: 'Atrasado' }))

    await waitFor(() => {
      const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
      expect(urls.some((url) => url.includes('estado=Rojo'))).toBe(true)
    })
  })

  it('shows the unfiltered option as chosen, and sends no estado for it', async () => {
    // Caught by a screenshot, not by a test: written as `value: ''` the "all states"
    // option rendered a BLANK trigger, because Radix's `Select` reserves the empty
    // string for "nothing selected" and refuses it as an item value.
    renderPage()
    await screen.findByText('Reforzar la comunicación interna')

    expect(screen.getByRole('combobox', { name: /Filtrar por semáforo/ }).textContent).toContain(
      'Todos los estados',
    )
    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('estado='))).toBe(false)
  })

  it('creates a plan from the listing, since no create ROUTE exists yet', async () => {
    // The sibling slice registers `/tracking/planes`, `/tracking/planes/:id` and
    // `/tracking/mis-tareas` and no create path, so this is what makes creation
    // reachable. `PlanDeAccionCreatePage` renders the same form.
    renderPage()
    await screen.findByText('Reforzar la comunicación interna')

    fireEvent.click(screen.getByRole('button', { name: 'Nuevo plan' }))
    expect(await screen.findByRole('button', { name: 'Crear plan de acción' })).toBeTruthy()
  })

  it('offers no create button to a role Roles.PlanCreator excludes', async () => {
    setToken(tokenFor({ sub: 'persona-2', role: 'employee', nodoId: '', companyId: 'company-1' }))
    renderPage()
    await screen.findByText('Reforzar la comunicación interna')

    expect(screen.queryByRole('button', { name: 'Nuevo plan' })).toBeNull()
  })

  it('keeps the listing when the picker directory is refused', async () => {
    // `TrackingPickerEndpoints.CanAccessCompany` refuses every role but the two
    // admin ones, so a leader gets a 403 there as a matter of course. Blanking the
    // page over it would take down the screen the role most needs.
    routeFetch([plan()], { pickers: false })
    setToken(tokenFor({ sub: 'lider-1', role: 'leader', nodoId: 'nodo-a', companyId: 'company-1' }))
    renderPage()

    expect(await screen.findByText('Reforzar la comunicación interna')).toBeTruthy()
  })

  it('offers a retry rather than a blank page when the service is unreachable', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('tracking is down'))
    renderPage()

    // The retry affordance and a sentence the reader can act on — which is what this
    // test was always named for. It used to prove that by asserting the EXCEPTION text
    // was on screen, which quietly made "show the user err.message" a guarantee: a
    // browser TypeError then put the literal words "Failed to fetch" in front of an
    // end user, and the assertion defended it. The intent is unchanged; the evidence
    // is no longer the defect.
    expect(await screen.findByText(/No se pudo contactar el servicio de seguimiento/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reintentar|Retry/ })).toBeTruthy()
    expect(screen.queryByText('tracking is down')).toBeNull()
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
describe('PlanesAccionListPage when the tracking service is unreachable', () => {
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
