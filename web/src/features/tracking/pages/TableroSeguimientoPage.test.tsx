import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import TableroSeguimientoPage from './TableroSeguimientoPage'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { clearCompanyNameCache } from '../../../company-context/useCompanyName'
import { SEMAFORO_ORDER, semaforoPresentation } from '../semaforo'
import { CATALOGUES } from '../../../i18n/locale'
import type { MessageNode } from '../../../i18n/translate'

/** An already-translated string from the Spanish catalogue, by dotted path. */
function copy(path: string): string {
  const value = path
    .split('.')
    .reduce<MessageNode | undefined>(
      (node, segment) => (typeof node === 'object' && node !== null ? node[segment] : undefined),
      CATALOGUES.es as MessageNode,
    )
  return typeof value === 'string' ? value : ''
}

const TRACKING = 'http://tracking.test'

function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

/**
 * Three plans, one per semáforo state, with the progress values the domain
 * actually produces: a fraction in `0..1`.
 */
const PLANES = [
  {
    id: 'p1',
    planCode: 'PA-2026-00001',
    nodoExternalId: 'nodo-alpha',
    liderExternalId: 'lider-1',
    hallazgoExternalId: null,
    descripcionQue: 'Reforzar la inducción de nuevo personal',
    metodologiaComo: 'Sesiones quincenales',
    responsableEjecucionExternalId: 'persona-77',
    fechaCreacion: '2026-01-10',
    fechaCompromiso: '2026-09-30',
    porcentajeAvance: 0.87,
    estadoSemaforo: 'Verde',
    cicloEncuestaExternalId: null,
    fechaUltimaActualizacion: '2026-08-14',
    cumplido: false,
    involucradosExternalIds: ['persona-88'],
  },
  {
    id: 'p2',
    planCode: 'PA-2026-00002',
    nodoExternalId: 'nodo-alpha',
    liderExternalId: 'lider-1',
    hallazgoExternalId: null,
    descripcionQue: 'Revisar la carga de trabajo del turno nocturno',
    metodologiaComo: 'Mesa de trabajo mensual',
    responsableEjecucionExternalId: 'persona-91',
    fechaCreacion: '2026-02-01',
    fechaCompromiso: '2026-08-01',
    porcentajeAvance: 0,
    estadoSemaforo: 'Rojo',
    cicloEncuestaExternalId: null,
    fechaUltimaActualizacion: '2026-02-01',
    cumplido: false,
    involucradosExternalIds: [],
  },
  {
    id: 'p3',
    planCode: 'PA-2026-00003',
    nodoExternalId: 'nodo-alpha',
    liderExternalId: 'lider-1',
    hallazgoExternalId: null,
    descripcionQue: 'Publicar el plan de capacitación anual',
    metodologiaComo: 'Comité de formación',
    responsableEjecucionExternalId: 'persona-77',
    fechaCreacion: '2026-03-01',
    fechaCompromiso: '2026-09-05',
    porcentajeAvance: 0.4,
    estadoSemaforo: 'Amarillo',
    cicloEncuestaExternalId: null,
    fechaUltimaActualizacion: '2026-07-02',
    cumplido: false,
    involucradosExternalIds: [],
  },
]

const TABLERO = {
  nodoExternalId: 'nodo-alpha',
  conteos: { rojo: 1, amarillo: 1, verde: 1 },
  planes: PLANES,
}

function requestedUrls(): string[] {
  return vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
}

function trackingRequests(): string[] {
  return requestedUrls().filter((url) => url.startsWith(TRACKING))
}

function routeFetch(options: { tablero?: () => Response } = {}) {
  const { tablero } = options
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith(`${TRACKING}/api/tablero-seguimiento`)) {
      return Promise.resolve(
        tablero ? tablero() : new Response(JSON.stringify(TABLERO), { status: 200 }),
      )
    }
    if (url.includes('/tracking/picker/nodos')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ nodos: [{ id: 'nodo-alpha', name: 'Dirección de Operaciones' }] }),
          { status: 200 },
        ),
      )
    }
    return Promise.resolve(new Response('{}', { status: 404 }))
  })
}

function renderPage(search = '') {
  return render(
    <TranslationProvider initialLocale="es">
      <MemoryRouter initialEntries={[`/tracking/tablero${search}`]}>
        <CompanyContextProvider>
          <TableroSeguimientoPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  vi.stubEnv('VITE_TRACKING_API_BASE_URL', TRACKING)
  vi.stubEnv('VITE_API_BASE_URL', 'http://api.test')
  vi.stubGlobal('fetch', vi.fn())
  routeFetch()
  setToken(tokenFor({ role: 'leader', companyId: 'procomer-co', isActive: 'true' }))
})

afterEach(() => {
  cleanup()
  clearToken()
  clearCompanyNameCache()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('TableroSeguimientoPage', () => {
  it('asks the tracking service for the caller own nodo when no id is in the URL', async () => {
    renderPage()
    await screen.findByText('Reforzar la inducción de nuevo personal')

    // No `?nodoId=`: `TableroAsync` falls back to the caller's own claim, which is
    // the whole reason the route takes a query parameter rather than a path one.
    expect(trackingRequests()).toEqual([`${TRACKING}/api/tablero-seguimiento`])
  })

  it('renders in Spanish', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Tablero de Seguimiento' })).toBeTruthy()
    expect(screen.getByText('Fecha de compromiso')).toBeTruthy()
    expect(screen.getByText('Qué se va a hacer')).toBeTruthy()
    expect(screen.getByText('Semáforo')).toBeTruthy()
  })

  /**
   * The unit rule, at the page level. `porcentajeAvance: 0.87` is 87 per cent —
   * `numeric(5,4)`, `RegistrarAvance` rejects anything outside `0..1`, and
   * `MarcarCumplido` writes `1m`. A page that forgot to multiply would print
   * "0,87 %", which is a plausible-looking number and completely wrong.
   */
  it('renders a stored 0-1 avance as a percentage', async () => {
    renderPage()
    const row = (await screen.findByText('Reforzar la inducción de nuevo personal')).closest('tr')
    expect(row).toBeTruthy()
    expect(within(row as HTMLElement).getByText(/^87\s?%$/)).toBeTruthy()
  })

  it('renders a zero avance as zero rather than as no reading', async () => {
    renderPage()
    const row = (await screen.findByText('Revisar la carga de trabajo del turno nocturno')).closest('tr')
    expect(within(row as HTMLElement).getByText(/^0\s?%$/)).toBeTruthy()
    expect(within(row as HTMLElement).queryByText('Sin dato')).toBeNull()
  })

  /**
   * The client's §7 constraint: colour is never the signal on its own. Each row's
   * state chip carries the word AND a glyph, so the board survives a greyscale
   * print-out.
   */
  it('gives every row a semáforo word and a glyph, not just a colour', async () => {
    renderPage()
    await screen.findByText('Reforzar la inducción de nuevo personal')

    const table = screen.getByRole('table')
    const chips = [...table.querySelectorAll('[data-slot="chip"]')]
    expect(chips).toHaveLength(PLANES.length)
    // The expected words come from the ONE presentation table, not from a literal
    // here: #125 and #126 shipped two vocabularies for these three states, and a
    // hardcoded list passes against a page reading the other one.
    const words = SEMAFORO_ORDER.map((estado) => copy(semaforoPresentation(estado).labelKey))
    for (const chip of chips) {
      expect(words, `"${chip.textContent}" is not one of the three states`).toContain(
        chip.textContent?.trim(),
      )
      expect(chip.querySelector('svg'), `${chip.textContent} has no glyph`).toBeTruthy()
    }
    // And the three glyphs are three different drawings — see `semaforo.ts`.
    const paths = chips.map((chip) => chip.querySelector('svg')?.innerHTML)
    expect(new Set(paths).size).toBe(3)
  })

  it('names no person, because a board is a board and not a roster', async () => {
    // `PlanResponse` carries `responsableEjecucionExternalId` and
    // `involucradosExternalIds`; neither is rendered. See the component note for
    // why (the endpoint that would resolve them 403s for this very role).
    renderPage()
    await screen.findByText('Reforzar la inducción de nuevo personal')

    const body = document.body.textContent ?? ''
    expect(body).not.toContain('persona-77')
    expect(body).not.toContain('persona-88')
    expect(body).not.toContain('lider-1')
  })

  it('sends an administrator to the consolidado to choose, rather than showing them an empty board', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: 'procomer-co', isActive: 'true' }))
    renderPage()

    expect(await screen.findByText('Elija un nodo')).toBeTruthy()
    expect(trackingRequests()).toEqual([])
  })

  it('loads the nodo an administrator drilled into', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: 'procomer-co', isActive: 'true' }))
    renderPage('?nodoId=nodo-alpha')

    await screen.findByText('Reforzar la inducción de nuevo personal')
    expect(trackingRequests()).toEqual([`${TRACKING}/api/tablero-seguimiento?nodoId=nodo-alpha`])
    // And it names the board they landed on, from the picker.
    expect(screen.getByText('Dirección de Operaciones')).toBeTruthy()
  })

  it('treats an empty nodoId as no choice at all', async () => {
    // `?nodoId=` is what a hand-edited URL or a link built from an absent id looks
    // like. Passing "" through would ask the server for the nodo whose id is empty.
    setToken(tokenFor({ role: 'company_admin', companyId: 'procomer-co', isActive: 'true' }))
    renderPage('?nodoId=')
    expect(await screen.findByText('Elija un nodo')).toBeTruthy()
    expect(trackingRequests()).toEqual([])
  })

  it('degrades to a retryable message when the tracking service is unreachable', async () => {
    routeFetch({
      tablero: () => {
        throw new TypeError('Failed to fetch')
      },
    })
    renderPage()

    expect(await screen.findByText('No se pudo contactar el servicio de seguimiento')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Tablero de Seguimiento' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('recovers when the service comes back', async () => {
    let up = false
    routeFetch({
      tablero: () =>
        up
          ? new Response(JSON.stringify(TABLERO), { status: 200 })
          : new Response('{}', { status: 503 }),
    })
    renderPage()

    const retry = await screen.findByRole('button', { name: 'Reintentar' })
    up = true
    await userEvent.click(retry)
    expect(await screen.findByText('Reforzar la inducción de nuevo personal')).toBeTruthy()
  })

  it('says so when the nodo has no plans yet', async () => {
    routeFetch({
      tablero: () =>
        new Response(
          JSON.stringify({ nodoExternalId: 'nodo-alpha', conteos: { rojo: 0, amarillo: 0, verde: 0 }, planes: [] }),
          { status: 200 },
        ),
    })
    renderPage()
    expect(await screen.findByText('Este nodo no tiene planes de acción')).toBeTruthy()
  })

  /**
   * The product rule from §7, and it is only that — see `trackingAccess.ts`.
   * `TableroAsync` would serve these roles their own nodo's full board; the browser
   * cannot close that, and this test is not evidence that it is closed.
   */
  it.each(['employee', 'supervisor'])('points %s at their task view instead of the full board', async (role) => {
    setToken(tokenFor({ role, companyId: 'procomer-co', isActive: 'true' }))
    renderPage()

    expect(await screen.findByText('Este tablero es de la jefatura del nodo')).toBeTruthy()
    expect(trackingRequests()).toEqual([])
  })
})
