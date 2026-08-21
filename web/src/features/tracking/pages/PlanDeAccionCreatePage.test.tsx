import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import {
  CompanyContextProvider,
  COMPANY_CONTEXT_STORAGE_KEY,
} from '../../../company-context'
import PlanDeAccionCreatePage from './PlanDeAccionCreatePage'

/**
 * The fourth page. It has no route in `app/router.tsx` — the sibling slice that
 * owns that file registers three tracking paths and no create one — so it is
 * mounted here directly, which is exactly what it will do the day
 * `/tracking/planes/nuevo` is added.
 *
 * Creation itself is not blocked meanwhile: `PlanesAccionListPage` hosts the same
 * `PlanDeAccionForm`, and its own test covers that path.
 */
const NODOS = {
  nodos: [
    { id: 'nodo-a', name: 'Operaciones' },
    { id: 'nodo-b', name: 'Finanzas' },
  ],
}
const PERSONAS = {
  personas: [
    { id: 'persona-2', name: 'Beto Solís', email: 'beto@acme.test' },
    { id: 'persona-3', name: 'Carla Mora', email: 'carla@acme.test' },
  ],
}

function tokenFor(payload: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `header.${body}.signature`
}

function routeFetch() {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status }))
    if (url.includes('/tracking/picker/nodos')) return json(NODOS)
    if (url.includes('/tracking/picker/personas')) return json(PERSONAS)
    if (init?.method === 'POST') return json({ id: 'plan-new', planCode: 'PA-2026-00099' }, 201)
    return json({})
  })
}

function renderPage() {
  return render(
    <TranslationProvider initialLocale="es">
      <MemoryRouter initialEntries={['/tracking/planes/nuevo']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/tracking/planes/nuevo" element={<PlanDeAccionCreatePage />} />
            <Route path="/tracking/planes/:id" element={<p>detalle del plan</p>} />
          </Routes>
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

async function fillRequiredFields() {
  fireEvent.click(await screen.findByRole('combobox', { name: /Nodo/ }))
  fireEvent.click(await screen.findByRole('option', { name: 'Operaciones' }))

  fireEvent.change(screen.getByLabelText(/Qué se hará/), {
    target: { value: 'Reforzar la comunicación interna' },
  })
  fireEvent.change(screen.getByLabelText(/Cómo se hará/), {
    target: { value: 'Boletín quincenal' },
  })

  fireEvent.click(screen.getByRole('combobox', { name: /Responsable de ejecución/ }))
  fireEvent.click(await screen.findByRole('option', { name: /Beto/ }))

  fireEvent.change(screen.getByLabelText(/Fecha de compromiso/), {
    target: { value: '2026-12-31' },
  })
}

describe('PlanDeAccionCreatePage', () => {
  it('posts a plan whose fecha is a calendar day, not an instant', async () => {
    renderPage()
    await fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: 'Crear plan de acción' }))

    await waitFor(() => {
      const post = vi
        .mocked(fetch)
        .mock.calls.find(([, init]) => init?.method === 'POST')
      expect(post).toBeTruthy()
      const body = JSON.parse(String(post?.[1]?.body)) as Record<string, unknown>
      expect(body.fechaCompromiso).toBe('2026-12-31')
      expect(String(body.fechaCompromiso)).not.toContain('T')
    })
  })

  it('sends several involucrados in one CreatePlanRequest', async () => {
    // `CreatePlanRequest.Involucrados` is an `IReadOnlyList<string>` and
    // `CreateAsync` loops it into `AgregarInvolucrado`, so creation is the one place
    // the API takes many at once.
    renderPage()
    await fillRequiredFields()

    fireEvent.click(await screen.findByRole('checkbox', { name: /Beto/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Carla/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear plan de acción' }))

    await waitFor(() => {
      const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')
      const body = JSON.parse(String(post?.[1]?.body)) as { involucrados: string[] }
      expect(body.involucrados).toEqual(['persona-2', 'persona-3'])
    })
  })

  it('sends a blank hallazgo as null, which is what the nullable column means', async () => {
    renderPage()
    await fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: 'Crear plan de acción' }))

    await waitFor(() => {
      const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')
      const body = JSON.parse(String(post?.[1]?.body)) as { hallazgoExternalId: unknown }
      expect(body.hallazgoExternalId).toBeNull()
    })
  })

  it('refuses to submit with a required field missing, rather than posting a 400', async () => {
    renderPage()
    await screen.findByRole('combobox', { name: /Nodo/ })
    fireEvent.click(screen.getByRole('button', { name: 'Crear plan de acción' }))

    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    expect(await screen.findAllByText('Este campo es requerido')).toBeTruthy()
  })

  it('lands the creator on the new plan', async () => {
    renderPage()
    await fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: 'Crear plan de acción' }))

    expect(await screen.findByText('detalle del plan')).toBeTruthy()
  })

  it('offers a leader only their own node, because CreateAsync forbids the rest', async () => {
    setToken(tokenFor({ sub: 'lider-1', role: 'leader', nodoId: 'nodo-b', companyId: 'company-1' }))
    renderPage()

    fireEvent.click(await screen.findByRole('combobox', { name: /Nodo/ }))
    expect(await screen.findByRole('option', { name: 'Finanzas' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Operaciones' })).toBeNull()
  })

  it('refuses the page outright to a role Roles.PlanCreator excludes', async () => {
    setToken(tokenFor({ sub: 'persona-2', role: 'employee', nodoId: '', companyId: 'company-1' }))
    renderPage()

    expect(
      await screen.findByText(
        'Solo la jefatura del nodo o una administración pueden crear planes de acción.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Crear plan de acción' })).toBeNull()
  })
})
