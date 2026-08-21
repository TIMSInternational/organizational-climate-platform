import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import ConsolidadoPage from './ConsolidadoPage'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { clearCompanyNameCache } from '../../../company-context/useCompanyName'

const TRACKING = 'http://tracking.test'

function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

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

    // Three words, each appearing in the summary strip AND as a column header —
    // so `getAllByText`, and the count is what proves the word is not decorative.
    for (const word of ['Rojo', 'Amarillo', 'Verde']) {
      expect(screen.getAllByText(word).length).toBeGreaterThan(0)
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
