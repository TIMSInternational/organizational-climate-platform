import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import {
  CompanyContextProvider,
  COMPANY_CONTEXT_STORAGE_KEY,
} from '../../../company-context'
import PlanDeAccionDetailPage from './PlanDeAccionDetailPage'
import type { PlanAccion } from '../api/trackingApi'
import { tokenFor } from '../../../test/jwtFixture'

/**
 * The detail page is where `RegistrarAvance`, `MarcarCumplido` and
 * `AgregarInvolucrado` are exercised, so it is where the leader/involucrado split
 * either holds or does not.
 *
 * Two viewers are mounted against the same plan:
 *
 * - a **leader of the plan's node**, who `PlanAccessHandler` grants write, and
 * - an **involucrado**, whom it grants read and refuses write.
 *
 * The second must see no write control at all. A disabled button would be worse
 * than none: it invites a click and returns a 403 that reads as a bug.
 */
function plan(overrides: Partial<PlanAccion> = {}): PlanAccion {
  return {
    id: 'plan-1',
    planCode: 'PA-2026-00012',
    nodoExternalId: 'nodo-a',
    liderExternalId: 'lider-1',
    hallazgoExternalId: 'hallazgo-7',
    descripcionQue: 'Reforzar la comunicación interna',
    metodologiaComo: 'Boletín quincenal y reunión de cierre',
    responsableEjecucionExternalId: 'persona-2',
    fechaCreacion: '2026-02-01',
    fechaCompromiso: '2026-10-15',
    porcentajeAvance: 0.4,
    estadoSemaforo: 'Amarillo',
    cicloEncuestaExternalId: null,
    fechaUltimaActualizacion: '2026-08-01',
    cumplido: false,
    involucradosExternalIds: ['persona-2'],
    ...overrides,
  }
}

const LEADER = { sub: 'lider-1', role: 'leader', nodoId: 'nodo-a', companyId: 'company-1' }
const INVOLUCRADO = { sub: 'persona-2', role: 'employee', nodoId: '', companyId: 'company-1' }

const PERSONAS = {
  personas: [
    { id: 'persona-2', name: 'Beto Solís', email: 'beto@acme.test' },
    { id: 'persona-3', name: 'Carla Mora', email: 'carla@acme.test' },
  ],
}

/**
 * A fresh `Response` per call, routed by path and method. `mockResolvedValue` hands
 * back the same `Response` every time and a body can only be read once, so the
 * reload after a write would throw `body stream already read` and look like a page
 * defect.
 */
function routeFetch(current: PlanAccion = plan(), onWrite?: (url: string, body: unknown) => PlanAccion) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status }))

    if (url.includes('/tracking/picker/personas')) return json(PERSONAS)
    if (url.includes('/tracking/picker/nodos')) return json({ nodos: [{ id: 'nodo-a', name: 'Operaciones' }] })
    if (init?.method === 'POST') {
      const parsed: unknown = init.body ? JSON.parse(String(init.body)) : null
      current = onWrite ? onWrite(url, parsed) : current
      return json(current)
    }
    return json(current)
  })
}

function renderPage() {
  return render(
    // `initialLocale="es"` so the shared copy (`common.confirm`, `common.retry`)
    // resolves the way this module's own copy always does. The tracking namespace is
    // Spanish in BOTH catalogues — see `trackingCopy.test.ts` — but the primitives
    // around it are not, and pinning the locale keeps this file asserting on one
    // language rather than two.
    <TranslationProvider initialLocale="es">
      <MemoryRouter initialEntries={['/tracking/planes/plan-1']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/tracking/planes/:id" element={<PlanDeAccionDetailPage />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  routeFetch()
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  vi.unstubAllGlobals()
})

describe('the node leader view', () => {
  beforeEach(() => {
    setToken(tokenFor(LEADER))
  })

  it('shows the plan and its semáforo in words', async () => {
    renderPage()
    expect(await screen.findByText('Reforzar la comunicación interna')).toBeTruthy()
    expect(screen.getByText('En riesgo')).toBeTruthy()
  })

  it('shows 40%, from a stored 0.4', async () => {
    renderPage()
    expect(await screen.findAllByText('40%')).toBeTruthy()
  })

  /**
   * The FIGURE and the BAR are two renderings of one number and must agree.
   *
   * The test above only reads the figure, and that gap let a real mutation
   * survive: `<Progress value={plan.porcentajeAvance} />` — the raw 0–1 fraction
   * instead of the converted percentage — typechecks (both are `number`), passes
   * every other test on this page, and draws a bar 0.4% along beside a label
   * reading "40%". An apparently-empty bar on a plan that is nearly half done is
   * exactly the reading this screen exists to give, rendered backwards.
   *
   * Radix puts the value on `aria-valuenow`, so the bar's own claim is readable
   * rather than inferred from a CSS transform.
   */
  it('draws the progress bar in percent, matching the figure beside it', async () => {
    renderPage()
    await screen.findByText('Reforzar la comunicación interna')

    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('40')
  })

  it('draws a full bar for a plan MarcarCumplido set to the literal 1', async () => {
    routeFetch(plan({ porcentajeAvance: 1, cumplido: true, estadoSemaforo: 'Verde' }))
    renderPage()
    await screen.findByText('Reforzar la comunicación interna')

    // 100, not 1. `MarcarCumplido` writes `1m`, which as a raw `Progress` value is
    // a bar 1% along on a plan that is finished.
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
  })

  it('posts an avance as a FRACTION, not as the typed percentage', async () => {
    // The trap. `RegistrarAvance` throws outside [0,1]; 75 would be a 400 and 1
    // would silently mean 1%.
    renderPage()
    await screen.findByText('Reforzar la comunicación interna')

    fireEvent.change(screen.getByLabelText(/Avance/), { target: { value: '75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar avance' }))

    await waitFor(() => {
      const call = vi
        .mocked(fetch)
        .mock.calls.find(([url, init]) => String(url).includes('/avance') && init?.method === 'POST')
      expect(call).toBeTruthy()
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ porcentajeAvance: 0.75 })
    })
  })

  it('marks a plan cumplido only after the confirmation is accepted', async () => {
    renderPage()
    await screen.findByText('Reforzar la comunicación interna')

    fireEvent.click(screen.getByRole('button', { name: 'Marcar como cumplido' }))
    // Opening the dialog must not have posted anything on its own.
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/cumplir')),
    ).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => {
      expect(
        vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/cumplir')),
      ).toBe(true)
    })
  })

  it('adds several involucrados with one POST each, because the endpoint takes one', async () => {
    // `AgregarInvolucradoAsync` accepts a single `PersonaExternalId`. The picker is
    // multi-select, so the page has to fan it out.
    renderPage()
    await screen.findByText('Reforzar la comunicación interna')

    fireEvent.click(await screen.findByRole('checkbox', { name: /Carla/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Agregar involucrados' }))

    await waitFor(() => {
      const posts = vi
        .mocked(fetch)
        .mock.calls.filter(([url, init]) => String(url).includes('/involucrados') && init?.method === 'POST')
      expect(posts).toHaveLength(1)
      expect(JSON.parse(String(posts[0][1]?.body))).toEqual({ personaExternalId: 'persona-3' })
    })
  })

  it('does not offer to add someone already on the plan', async () => {
    renderPage()
    await screen.findByText('Reforzar la comunicación interna')

    const beto = (await screen.findByRole('checkbox', { name: /Beto/ })) as HTMLButtonElement
    expect(beto.disabled).toBe(true)
  })
})

describe('the involucrado view', () => {
  beforeEach(() => {
    setToken(tokenFor(INVOLUCRADO))
  })

  it('shows the plan', async () => {
    renderPage()
    expect(await screen.findByText('Reforzar la comunicación interna')).toBeTruthy()
  })

  it('offers NO write control of any kind', async () => {
    renderPage()
    await screen.findByText('Reforzar la comunicación interna')

    expect(screen.queryByRole('button', { name: 'Registrar avance' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Marcar como cumplido' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Agregar involucrados' })).toBeNull()
  })

  it('says who can record progress instead', async () => {
    renderPage()
    expect(
      await screen.findByText(
        'Usted participa en este plan pero no puede modificarlo. El registro de avance corresponde a la jefatura del nodo.',
      ),
    ).toBeTruthy()
  })
})

describe('a leader of a DIFFERENT node', () => {
  it('is read-only, because PlanAccessHandler compares the node', async () => {
    setToken(tokenFor({ sub: 'lider-9', role: 'leader', nodoId: 'nodo-b', companyId: 'company-1' }))
    renderPage()
    await screen.findByText('Reforzar la comunicación interna')

    expect(screen.queryByRole('button', { name: 'Registrar avance' })).toBeNull()
  })
})

describe('anonymity', () => {
  it('renders the hallazgo as an opaque reference and never links to survey responses', async () => {
    // A plan names its responsable. A link from here into per-response survey data
    // would be a link from a named person to answers, which §7 forbids: "nunca
    // respuestas individuales".
    setToken(tokenFor(LEADER))
    renderPage()
    await screen.findByText('Reforzar la comunicación interna')

    expect(screen.getByText('hallazgo-7').tagName).not.toBe('A')
    const hrefs = Array.from(document.querySelectorAll('a')).map((anchor) =>
      anchor.getAttribute('href'),
    )
    expect(hrefs.some((href) => href?.includes('hallazgo'))).toBe(false)
    expect(hrefs.some((href) => href?.includes('/responses'))).toBe(false)
    expect(hrefs.some((href) => href?.includes('/results'))).toBe(false)
  })
})
