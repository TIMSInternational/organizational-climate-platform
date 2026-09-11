import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import PlanDetailNextPage from './PlanDetailNextPage'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { clearCompanyNameCache } from '../../../company-context/useCompanyName'
import { tokenFor } from '../../../test/jwtFixture'
import es from '../../../i18n/es.json'

/**
 * `/tracking/planes/:id` — the redesigned plan detail. PA-2026-00001 is the body the local
 * tracking service answered on 10 Sep; the personas are the directory's own rows.
 */

const API = 'http://api.test'
const TRACKING = 'http://tracking.test'
const COMPANY = '16c97c29-07f8-4522-86fc-e6cc56298829'
const FINANZAS = 'bff21fd0-422b-4f3b-8c89-d6bfbf5f19e9'
const PLAN_ID = '01a08b9e-6367-75aa-942c-1ec0efd04176'
const ADRIANA = '77fbfc92-76bb-452e-8be3-8ae588464994'

const PLAN = {
  id: PLAN_ID,
  planCode: 'PA-2026-00001',
  nodoExternalId: FINANZAS,
  liderExternalId: '',
  hallazgoExternalId: null,
  descripcionQue: 'Reponer la reunión de handover entre turnos',
  metodologiaComo: 'Sesión de 20 minutos al cierre de cada turno, con acta breve.',
  responsableEjecucionExternalId: ADRIANA,
  fechaCreacion: '2026-09-10',
  fechaCompromiso: '2026-08-20',
  porcentajeAvance: 0,
  estadoSemaforo: 'Rojo',
  cicloEncuestaExternalId: null,
  fechaUltimaActualizacion: '2026-09-10',
  cumplido: false,
  involucradosExternalIds: [ADRIANA],
}

function calls(): Array<{ url: string; method: string; body: string | undefined }> {
  return vi.mocked(fetch).mock.calls.map((call) => ({
    url: String(call[0]),
    method: (call[1] as RequestInit | undefined)?.method ?? 'GET',
    body: (call[1] as RequestInit | undefined)?.body as string | undefined,
  }))
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(status === 404 ? '' : JSON.stringify(body), { status }))
}

function routeFetch(options: { planStatus?: number; plan?: Record<string, unknown> } = {}) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith(`${TRACKING}/api/planes-accion/`) && init?.method === 'POST') return json({ ...PLAN, porcentajeAvance: 0.25 })
    if (url.startsWith(`${TRACKING}/api/planes-accion/`)) return options.planStatus ? json({}, options.planStatus) : json({ ...PLAN, ...options.plan })
    if (url.includes('/tracking/picker/nodos')) return json({ nodos: [{ id: FINANZAS, name: 'Finanzas' }] })
    if (url.includes('/tracking/picker/personas')) {
      return json({ personas: [{ id: ADRIANA, name: 'Adriana Marín', email: 'adriana.marin@meridiano.test' }] })
    }
    if (/\/profile(\?|$)/.test(url)) return json({ companyName: 'Grupo Meridiano S.A.', departmentId: null, departmentName: null })
    return json({}, 404)
  })
}

function renderPage(id = PLAN_ID) {
  return render(
    <TranslationProvider initialLocale="es">
      <MemoryRouter initialEntries={[`/tracking/planes/${id}`]}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/tracking/planes/:id" element={<PlanDetailNextPage />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const next = es.tracking.next

beforeEach(() => {
  vi.stubEnv('VITE_TRACKING_API_BASE_URL', TRACKING)
  vi.stubEnv('VITE_API_BASE_URL', API)
  vi.stubGlobal('fetch', vi.fn())
  clearCompanyNameCache()
  routeFetch()
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('PlanDetailNextPage — an administrator', () => {
  beforeEach(() => {
    setToken(tokenFor({ sub: 'u-ana', name: 'Ana Rojas', role: 'company_admin', companyId: COMPANY, nodoId: `unassigned-${COMPANY}`, isActive: 'true' }))
  })

  it('titles the page with the plan "qué", the code as a chip beside its semáforo and its date', async () => {
    renderPage()
    // The loading state titles itself "Plan de acción"; the plan's own title replaces it.
    expect(await screen.findByRole('heading', { level: 1, name: 'Reponer la reunión de handover entre turnos' })).toBeTruthy()
    const meta = document.querySelector('[data-slot="page-meta"]') as HTMLElement
    expect(within(meta).getByText('PA-2026-00001')).toBeTruthy()
    expect(within(meta).getByText(es.tracking.semaforo.rojo)).toBeTruthy()
    expect(within(meta).getByText('Venció el 20 de agosto, hace 21 días')).toBeTruthy()
    expect(within(meta).getByText(next.metaNoAvances)).toBeTruthy()
    // The Main artboard's spacing, over the primitive's 6px status line.
    expect(meta.className).toContain('gap-2.5')
    expect(meta.className).not.toMatch(/(^|\s)gap-1\.5(\s|$)/)
  })

  it('prints the qué as a sentence in its card, while the title keeps it as written', async () => {
    renderPage()
    const card = (await screen.findByRole('heading', { name: next.queComoHeading })).closest('section') as HTMLElement
    expect(within(card).getByText('Reponer la reunión de handover entre turnos.')).toBeTruthy()
    expect(within(card).getByText('Sesión de 20 minutos al cierre de cada turno, con acta breve.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Reponer la reunión de handover entre turnos')
  })

  it('names the nodo and the people from the directory in the Ficha', async () => {
    renderPage()
    const ficha = (await screen.findByRole('heading', { name: next.fichaHeading })).closest('section') as HTMLElement
    expect(await within(ficha).findByText('Finanzas')).toBeTruthy()
    expect(within(ficha).getByText('Adriana Marín')).toBeTruthy()
    expect(within(ficha).getByText(next.sinAsignar)).toBeTruthy()
    expect(within(ficha).getByRole('link', { name: /Finanzas/ }).getAttribute('href')).toBe(`/tracking/tablero?nodoId=${FINANZAS}`)
  })

  it('prints the Bitácora from the plan itself: its creation as one entry, no author the payload does not name, no sample chip', async () => {
    renderPage()
    const card = (await screen.findByRole('heading', { name: next.bitacoraHeading })).closest('section') as HTMLElement
    expect(document.querySelectorAll('[data-slot="sample-chip"]')).toHaveLength(0)
    expect([...card.querySelectorAll('[data-entry]')].map((entry) => entry.getAttribute('data-entry'))).toEqual(['created'])
    expect(within(card).getByText(next.created)).toBeTruthy()
    expect(card.textContent).not.toContain(next.createdBy)
    expect(card.textContent).not.toContain('Ana Rojas')
    expect(within(card).getByText('Responsable: Adriana Marín · Compromiso: 20 ago')).toBeTruthy()
    expect(within(card).getByText(next.entriesOne)).toBeTruthy()
    // A writer is told how the first avance is recorded.
    expect(card.textContent).toContain(next.noAvancesLead)
  })

  it('adds the latest avance as its own row once one is on record, and says the earlier ones are not listed', async () => {
    routeFetch({ plan: { porcentajeAvance: 0.4, fechaUltimaActualizacion: '2026-09-12' } })
    renderPage()
    const card = (await screen.findByRole('heading', { name: next.bitacoraHeading })).closest('section') as HTMLElement
    expect([...card.querySelectorAll('[data-entry]')].map((entry) => entry.getAttribute('data-entry'))).toEqual(['created', 'latest'])
    const latest = card.querySelector('[data-entry="latest"]') as HTMLElement
    expect(latest.textContent).toContain('12 sept')
    expect(latest.textContent).toContain(next.latestAvanceRow.replace('{percent}', '40'))
    expect(within(card).getByText(next.earlierNotListed)).toBeTruthy()
    expect(within(card).getByText(next.bitacoraLastOn.replace('{date}', '12 sept'))).toBeTruthy()
    expect(within(card).queryByText(next.entriesOne)).toBeNull()
  })

  it('writes a plan marked cumplido into its latest row as the service words it', async () => {
    routeFetch({ plan: { porcentajeAvance: 1, cumplido: true, estadoSemaforo: 'Verde', fechaUltimaActualizacion: '2026-09-12' } })
    renderPage()
    const card = (await screen.findByRole('heading', { name: next.bitacoraHeading })).closest('section') as HTMLElement
    expect((card.querySelector('[data-entry="latest"]') as HTMLElement).textContent).toContain(next.cumplidoRow)
  })

  it('shows the hallazgo as text and never as a link into survey responses', async () => {
    routeFetch()
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith(`${TRACKING}/api/planes-accion/`)) return json({ ...PLAN, hallazgoExternalId: 'hallazgo-carga-2026Q1' })
      return json({ nodos: [], personas: [] })
    })
    renderPage()
    const que = (await screen.findByRole('heading', { name: next.queComoHeading })).closest('section') as HTMLElement
    expect(within(que).getByText(next.hallazgoRef.replace('{ref}', 'hallazgo-carga-2026Q1'))).toBeTruthy()
    expect(within(que).queryAllByRole('link')).toEqual([])
  })

  it('records an avance from the dialog as the fraction the service stores', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: es.tracking.actions.registrarAvance }))
    const dialog = await screen.findByRole('dialog')
    const percent = within(dialog).getByLabelText(es.tracking.fields.avance, { exact: false })
    await userEvent.clear(percent)
    await userEvent.type(percent, '25')
    await userEvent.click(within(dialog).getByRole('button', { name: es.tracking.actions.registrarAvance }))
    const post = calls().find((call) => call.method === 'POST')
    expect(post?.url).toBe(`${TRACKING}/api/planes-accion/${PLAN_ID}/avance`)
    expect((JSON.parse(post?.body ?? '{}') as { porcentajeAvance: number }).porcentajeAvance).toBe(0.25)
  })

  it('marks the plan cumplido only after the confirmation', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: next.marcarCumplido }))
    expect(calls().some((call) => call.method === 'POST')).toBe(false)
    await userEvent.click(await screen.findByRole('button', { name: es.common.confirm }))
    const post = calls().find((call) => call.method === 'POST')
    expect(post?.url).toBe(`${TRACKING}/api/planes-accion/${PLAN_ID}/cumplir`)
  })

  it('says the plan is gone on a 404, never "an error occurred"', async () => {
    routeFetch({ planStatus: 404 })
    renderPage('00000000-0000-0000-0000-000000000000')
    expect(await screen.findAllByText(next.notFoundTitle)).not.toHaveLength(0)
    expect(screen.queryByText(es.errors.generic)).toBeNull()
    expect(screen.getByRole('link', { name: next.goToPlans }).getAttribute('href')).toBe('/tracking/planes')
  })
})

describe('PlanDetailNextPage — who may write, as PlanAccessHandler rules it', () => {
  it('gives the responsable (an employee) the plan to read and no write control', async () => {
    setToken(tokenFor({ sub: ADRIANA, name: 'Adriana Marín', role: 'employee', companyId: COMPANY, nodoId: FINANZAS, isActive: 'true' }))
    renderPage()
    // Wait for the plan itself: the loading state has an h1 too, and a "no button" read
    // before the plan arrives would pass for a screen that never drew it.
    await screen.findByRole('heading', { level: 1, name: 'Reponer la reunión de handover entre turnos' })
    expect(screen.queryByRole('button', { name: es.tracking.actions.registrarAvance })).toBeNull()
    expect(screen.queryByRole('button', { name: next.marcarCumplido })).toBeNull()
    expect(screen.queryByRole('button', { name: es.tracking.actions.abrirAgregarInvolucrados })).toBeNull()
    expect(screen.getByText(next.whoWrites)).toBeTruthy()
    // The directory is admin-only and is not asked; the viewer still reads their own name.
    expect(calls().some((call) => call.url.includes('/tracking/picker/'))).toBe(false)
    const ficha = screen.getByRole('heading', { name: next.fichaHeading }).closest('section') as HTMLElement
    expect(within(ficha).getByText('Adriana Marín')).toBeTruthy()
  })

  it('tells a reader who cannot record progress only that there is none yet — never to press a button they do not have', async () => {
    setToken(tokenFor({ sub: ADRIANA, name: 'Adriana Marín', role: 'employee', companyId: COMPANY, nodoId: FINANZAS, isActive: 'true' }))
    renderPage()
    const card = (await screen.findByRole('heading', { name: next.bitacoraHeading })).closest('section') as HTMLElement
    expect(within(card).getByText(next.noAvancesYet)).toBeTruthy()
    expect(card.textContent).not.toContain(next.noAvancesLead)
  })

  it('gives the leader of the plan nodo the write controls but not the directory picker', async () => {
    setToken(tokenFor({ sub: 'u-leader', name: 'Jefa de Finanzas', role: 'leader', companyId: COMPANY, nodoId: FINANZAS, isActive: 'true' }))
    renderPage()
    expect(await screen.findByRole('button', { name: es.tracking.actions.registrarAvance })).toBeTruthy()
    expect(screen.getByRole('button', { name: next.marcarCumplido })).toBeTruthy()
    expect(screen.queryByRole('button', { name: es.tracking.actions.abrirAgregarInvolucrados })).toBeNull()
    expect(screen.getByText(next.addByAdmin)).toBeTruthy()
    expect(calls().some((call) => call.url.includes('/tracking/picker/'))).toBe(false)
  })

  it('gives a leader of another nodo no write control', async () => {
    setToken(tokenFor({ sub: 'u-other', role: 'leader', companyId: COMPANY, nodoId: 'otro-nodo', isActive: 'true' }))
    renderPage()
    // Wait for the plan itself: the loading state has an h1 too, and a "no button" read
    // before the plan arrives would pass for a screen that never drew it.
    await screen.findByRole('heading', { level: 1, name: 'Reponer la reunión de handover entre turnos' })
    expect(screen.queryByRole('button', { name: es.tracking.actions.registrarAvance })).toBeNull()
    expect(screen.queryByText(next.addByAdmin)).toBeNull()
  })
})
