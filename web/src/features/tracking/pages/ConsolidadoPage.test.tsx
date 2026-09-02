import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import ConsolidadoPage from './ConsolidadoPage'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { clearCompanyNameCache } from '../../../company-context/useCompanyName'
import { SEMAFORO_ORDER, semaforoPresentation } from '../semaforo'
import { CATALOGUES } from '../../../i18n/locale'
import type { MessageNode } from '../../../i18n/translate'
import { tokenFor } from '../../../test/jwtFixture'

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

const CONSOLIDADO = {
  conteos: { rojo: 2, amarillo: 3, verde: 7 },
  porNodo: [
    { nodoExternalId: 'nodo-alpha', conteos: { rojo: 2, amarillo: 1, verde: 3 }, totalPlanes: 6 },
    { nodoExternalId: 'nodo-beta', conteos: { rojo: 0, amarillo: 2, verde: 4 }, totalPlanes: 6 },
  ],
}

/** Every URL the page asked for, in order. */
function requestedUrls(): string[] {
  return vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
}

function trackingRequests(): string[] {
  return requestedUrls().filter((url) => url.startsWith(TRACKING))
}

/**
 * The happy path: the tracking service answers, the picker names the nodos, and
 * the caller's own profile feeds the company eyebrow.
 */
function routeFetch(options: { consolidado?: () => Response; pickerOk?: boolean } = {}) {
  const { consolidado, pickerOk = true } = options
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith(`${TRACKING}/api/consolidado`)) {
      return Promise.resolve(
        consolidado ? consolidado() : new Response(JSON.stringify(CONSOLIDADO), { status: 200 }),
      )
    }
    if (url.includes('/tracking/picker/nodos')) {
      return pickerOk
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                nodos: [
                  { id: 'nodo-alpha', name: 'Dirección de Operaciones' },
                  { id: 'nodo-beta', name: 'Dirección Comercial' },
                ],
              }),
              { status: 200 },
            ),
          )
        : Promise.resolve(new Response('{}', { status: 403 }))
    }
    if (/\/profile(\?|$)/.test(url)) {
      return Promise.resolve(new Response(JSON.stringify({ companyName: 'PROCOMER' }), { status: 200 }))
    }
    return Promise.resolve(new Response('{}', { status: 404 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider initialLocale="es">
      <MemoryRouter>
        <CompanyContextProvider>
          <ConsolidadoPage />
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
  setToken(tokenFor({ role: 'company_admin', companyId: 'procomer-co', isActive: 'true' }))
})

afterEach(() => {
  cleanup()
  clearToken()
  clearCompanyNameCache()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('ConsolidadoPage', () => {
  it('consumes the existing trackingApi client rather than a URL of its own', async () => {
    renderPage()
    await screen.findByText('Dirección de Operaciones')

    // `getConsolidado` builds exactly this, defaulting `baseUrl` to
    // VITE_TRACKING_API_BASE_URL. A page that reimplemented the call would almost
    // certainly not land on the same string.
    expect(trackingRequests()).toEqual([`${TRACKING}/api/consolidado`])
  })

  it('renders in Spanish', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Vista Consolidada' })).toBeTruthy()
    expect(screen.getByText('Nodo')).toBeTruthy()
    expect(screen.getByText('Resultado año anterior')).toBeTruthy()
    expect(screen.getByText('Planes de acción')).toBeTruthy()
  })

  it('names each semáforo state in words as well as in colour', async () => {
    renderPage()
    await screen.findByText('Dirección de Operaciones')

    // The words come from the ONE presentation table rather than being spelled out
    // here. #125 and #126 shipped two different vocabularies for these three states
    // — "Rojo/Amarillo/Verde" against "Atrasado/En riesgo/Al día" — and a test that
    // hardcodes either one passes against a page reading the other table, which is
    // exactly the drift this assertion is supposed to catch.
    //
    // Each word appears in the summary strip AND as a column header, so
    // `getAllByText`, and the count is what proves the word is not decorative.
    for (const estado of SEMAFORO_ORDER) {
      const word = copy(semaforoPresentation(estado).labelKey)
      expect(word, `no catalogue entry for ${estado}`).not.toBe('')
      expect(screen.getAllByText(word).length, `"${word}" is not on the page`).toBeGreaterThan(0)
    }
  })

  /**
   * #125's fourth acceptance criterion, at the page level.
   *
   * `NodoConsolidado` carries no `resultadoAnioAnteriorPct` at all today — the
   * field lives on `HallazgoDto` and #89 is what makes it resolve — so every cell
   * in this column is the absent case, and it must not read `0 %`.
   */
  it('renders the missing prior-year result as unavailable, never as a zero', async () => {
    renderPage()
    const rows = await screen.findAllByText('No disponible')
    expect(rows).toHaveLength(CONSOLIDADO.porNodo.length)

    const table = screen.getByRole('table')
    const alpha = within(table).getByText('Dirección de Operaciones').closest('tr')
    expect(alpha).toBeTruthy()
    // The row does carry real zeros — nodo-beta has 0 rojo — so "no 0 anywhere"
    // would be the wrong assertion. What matters is that the prior-year CELL is
    // the words and not a figure.
    const priorYearCell = alpha?.querySelectorAll('td')[alpha.querySelectorAll('td').length - 1]
    expect(priorYearCell?.textContent).toBe('No disponible')
  })

  it('says why the prior-year column is empty, in the reader own words', async () => {
    renderPage()
    await screen.findByText('Dirección de Operaciones')
    expect(screen.getByText(/No disponible.*no quiere decir cero/)).toBeTruthy()
  })

  /**
   * And STOPS saying it once the figure arrives.
   *
   * The note asserts a fact about the data — "the prior-year result is not
   * available yet". Rendered unconditionally it keeps asserting that underneath a
   * column of real percentages the moment #89 lands and the service starts
   * populating `resultadoAnioAnteriorPct`: the page contradicting itself, in the
   * one place a reader would go to resolve the contradiction.
   *
   * This is the forward-looking half of the criterion and the half nothing else
   * covers — every other fixture on this page has the field absent, which is
   * exactly why an unconditional caption looked correct.
   */
  it('drops the note once every nodo HAS a prior-year result', async () => {
    routeFetch({
      consolidado: () =>
        new Response(
          JSON.stringify({
            ...CONSOLIDADO,
            porNodo: CONSOLIDADO.porNodo.map((nodo) => ({
              ...nodo,
              // 0.55 and 0.07, chosen because BOTH carry IEEE-754 float dust:
              // `0.55 * 100` is 55.00000000000001 and `0.07 * 100` is
              // 7.000000000000001. Exactly 8 of the 101 whole percentages do this
              // (7, 14, 28, 29, 55, 56, 57, 58), so a fixture picking a round
              // number like 0.62 — which multiplies cleanly — would exercise this
              // column without ever touching the defect the column had.
              resultadoAnioAnteriorPct: nodo.nodoExternalId === 'nodo-alpha' ? 0.55 : 0.07,
            })),
          }),
          { status: 200 },
        ),
    })
    renderPage()
    await screen.findByText('Dirección de Operaciones')

    // The figures are on screen, as WHOLE percentages. Unrounded, `0.55 * 100`
    // renders "55,0 %" beside "7,0 %" — the same readings dressed as a precision
    // this data does not have — and `formatMetric` picks that decimal on its own
    // because the product is not an integer.
    expect(screen.getByText('55 %')).toBeTruthy()
    expect(screen.getByText('7 %')).toBeTruthy()
    // ...so the "not available" explanation must not be.
    expect(screen.queryByText(/no quiere decir cero/)).toBeNull()
    expect(screen.queryByText('No disponible')).toBeNull()
  })

  /**
   * A partially-populated column still needs the note: the cells that ARE absent
   * are still absent, and "No disponible" beside a real percentage is precisely
   * the reading the sentence exists to disambiguate.
   */
  it('keeps the note while ANY nodo is still missing its result', async () => {
    routeFetch({
      consolidado: () =>
        new Response(
          JSON.stringify({
            ...CONSOLIDADO,
            porNodo: [
              { ...CONSOLIDADO.porNodo[0], resultadoAnioAnteriorPct: 0.55 },
              { ...CONSOLIDADO.porNodo[1], resultadoAnioAnteriorPct: null },
            ],
          }),
          { status: 200 },
        ),
    })
    renderPage()
    await screen.findByText('Dirección de Operaciones')

    expect(screen.getByText('55 %')).toBeTruthy()
    expect(screen.getByText('No disponible')).toBeTruthy()
    expect(screen.getByText(/no quiere decir cero/)).toBeTruthy()
  })

  /**
   * The anonymity property of this screen, asserted as a drill-DEPTH rule.
   *
   * The payload has no answer, no score and no persona in it (`DashboardDtos.cs`),
   * so there is nothing to suppress. What could still go wrong is a link that goes
   * somewhere narrower than a nodo, so every link a row offers is checked: the
   * deepest this screen reaches is one jefatura's aggregate board.
   */
  it('drills no deeper than a nodo aggregate board', async () => {
    renderPage()
    await screen.findByText('Dirección de Operaciones')

    const links = [...screen.getByRole('table').querySelectorAll('a')]
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^\/tracking\/tablero\?nodoId=[^&]+$/)
    }
  })

  it('names each nodo, so the reader is not shown an external id', async () => {
    renderPage()
    expect(await screen.findByText('Dirección de Operaciones')).toBeTruthy()
    expect(screen.queryByText('nodo-alpha')).toBeNull()
  })

  it('falls back to the external id when the name lookup is refused, rather than blanking the board', async () => {
    routeFetch({ pickerOk: false })
    renderPage()
    // The board is still there, and the row is still identifiable.
    expect(await screen.findByText('nodo-alpha')).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
  })

  /**
   * #125's fifth acceptance criterion.
   *
   * A rejected `fetch` is the shape a real outage takes in the browser: the
   * tracking service is a *different origin*, so a service that is down, a DNS
   * name that does not resolve, and a CORS preflight its deployment has not been
   * configured to allow all arrive as a rejection rather than as a status.
   */
  it('degrades to a retryable message when the tracking service is unreachable', async () => {
    routeFetch({
      consolidado: () => {
        throw new TypeError('Failed to fetch')
      },
    })
    renderPage()

    expect(await screen.findByText('No se pudo contactar el servicio de seguimiento')).toBeTruthy()
    // The page is still a page: header, and a way to try again.
    expect(screen.getByRole('heading', { name: 'Vista Consolidada' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('degrades the same way when the service answers an error status', async () => {
    routeFetch({
      consolidado: () => new Response(JSON.stringify({ message: 'boom' }), { status: 503 }),
    })
    renderPage()
    expect(await screen.findByText('No se pudo contactar el servicio de seguimiento')).toBeTruthy()
  })

  it('recovers when the service comes back', async () => {
    let up = false
    routeFetch({
      consolidado: () =>
        up
          ? new Response(JSON.stringify(CONSOLIDADO), { status: 200 })
          : new Response('{}', { status: 503 }),
    })
    renderPage()

    const retry = await screen.findByRole('button', { name: 'Reintentar' })
    up = true
    await userEvent.click(retry)

    expect(await screen.findByText('Dirección de Operaciones')).toBeTruthy()
  })

  it('says so when there is nothing to consolidate yet', async () => {
    routeFetch({
      consolidado: () =>
        new Response(JSON.stringify({ conteos: { rojo: 0, amarillo: 0, verde: 0 }, porNodo: [] }), {
          status: 200,
        }),
    })
    renderPage()
    expect(await screen.findByText('Todavía no hay planes de acción')).toBeTruthy()
  })

  /**
   * `ConsolidadoAsync` forbids anything outside `Roles.Admin`, and this URL is
   * typeable. The page declines before asking, so the reader gets a sentence rather
   * than "Request failed: 403".
   */
  it.each(['employee', 'supervisor', 'leader'])(
    'declines for %s without making a request the service would forbid',
    async (role) => {
      setToken(tokenFor({ role, companyId: 'procomer-co', isActive: 'true' }))
      renderPage()

      expect(await screen.findByText('Esta pantalla es para administradores')).toBeTruthy()
      expect(trackingRequests()).toEqual([])
      await waitFor(() => {
        expect(requestedUrls().some((url) => url.includes('/tracking/picker/nodos'))).toBe(false)
      })
    },
  )
})
