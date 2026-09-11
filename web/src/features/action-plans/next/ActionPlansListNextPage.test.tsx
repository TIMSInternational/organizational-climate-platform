import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import ActionPlansListNextPage from './ActionPlansListNextPage'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { clearCompanyNameCache } from '../../../company-context/useCompanyName'
import { tokenFor } from '../../../test/jwtFixture'
import es from '../../../i18n/es.json'

/**
 * `/action-plans` — the redesigned Planes de Acción. The action plans, departments and
 * tracking plans are the bodies the local stack answered for the Grupo Meridiano demo
 * tenant on 10 Sep (the same as `scripts/shot-fixtures/plans-tracking-admin.json`).
 */

const API = 'http://api.test'
const TRACKING = 'http://tracking.test'
const COMPANY = '16c97c29-07f8-4522-86fc-e6cc56298829'
const FINANZAS = 'bff21fd0-422b-4f3b-8c89-d6bfbf5f19e9'

const ACTION_PLANS = {
  actionPlans: [
    { id: 'p1', title: 'Programa de reconocimiento entre pares', companyId: COMPANY, departmentId: 'd-personas', dueDate: '2026-09-30T02:05:50.251+00:00', status: 'not_started', priority: 'high', createdAt: '2026-09-10T02:05:50.263923+00:00' },
    { id: 'c1', title: 'Buzón anónimo de sugerencias', companyId: COMPANY, departmentId: null, dueDate: '2026-10-10T00:00:00+00:00', status: 'cancelled', priority: 'medium', createdAt: '2026-09-10T02:12:06.466863+00:00' },
    { id: 'c2', title: 'Almuerzos mensuales por departamento', companyId: COMPANY, departmentId: null, dueDate: '2026-10-10T00:00:00+00:00', status: 'cancelled', priority: 'medium', createdAt: '2026-09-10T02:13:38.941573+00:00' },
    { id: 'c3', title: 'Piloto de horario flexible en Ventas', companyId: COMPANY, departmentId: null, dueDate: '2026-10-10T00:00:00+00:00', status: 'cancelled', priority: 'medium', createdAt: '2026-09-10T02:14:40.726189+00:00' },
    { id: 'p2', title: 'Reducir la carga de trabajo en Operaciones', companyId: COMPANY, departmentId: 'd-ops', dueDate: '2026-10-15T02:05:50.278+00:00', status: 'not_started', priority: 'high', createdAt: '2026-09-10T02:05:50.280646+00:00' },
    { id: 'p3', title: 'Reuniones abiertas con la dirección', companyId: COMPANY, departmentId: null, dueDate: '2026-10-25T02:05:50.292+00:00', status: 'not_started', priority: 'medium', createdAt: '2026-09-10T02:05:50.294635+00:00' },
    { id: 'p4', title: 'Plan de desarrollo de carrera en Ingeniería', companyId: COMPANY, departmentId: 'd-ing', dueDate: '2026-11-09T03:05:50.285+00:00', status: 'not_started', priority: 'medium', createdAt: '2026-09-10T02:05:50.287727+00:00' },
  ],
}

const DEPARTMENTS = {
  departments: [
    { id: 'd-personas', companyId: COMPANY, name: 'Personas', description: null, parentDepartmentId: null, isActive: true, employeeCount: 7 },
    { id: 'd-ops', companyId: COMPANY, name: 'Operaciones', description: null, parentDepartmentId: null, isActive: true, employeeCount: 7 },
    { id: 'd-ing', companyId: COMPANY, name: 'Ingeniería', description: null, parentDepartmentId: null, isActive: true, employeeCount: 14 },
  ],
}

const TRACKING_PLANES = [
  { id: 't1', planCode: 'PA-2026-00001', nodoExternalId: FINANZAS, liderExternalId: '', hallazgoExternalId: null, descripcionQue: 'Reponer la reunión de handover entre turnos', metodologiaComo: 'x', responsableEjecucionExternalId: 'p', fechaCreacion: '2026-09-10', fechaCompromiso: '2026-08-20', porcentajeAvance: 0, estadoSemaforo: 'Rojo', cicloEncuestaExternalId: null, fechaUltimaActualizacion: '2026-09-10', cumplido: false, involucradosExternalIds: [] },
  { id: 't2', planCode: 'PA-2026-00002', nodoExternalId: 'n-ing', liderExternalId: '', hallazgoExternalId: null, descripcionQue: 'Publicar el rol de fines de semana con dos semanas de antelación', metodologiaComo: 'x', responsableEjecucionExternalId: 'p', fechaCreacion: '2026-09-10', fechaCompromiso: '2026-09-15', porcentajeAvance: 0, estadoSemaforo: 'Verde', cicloEncuestaExternalId: null, fechaUltimaActualizacion: '2026-09-10', cumplido: false, involucradosExternalIds: [] },
]

function calls(): Array<{ url: string; method: string; body: string | undefined }> {
  return vi.mocked(fetch).mock.calls.map((call) => ({
    url: String(call[0]),
    method: (call[1] as RequestInit | undefined)?.method ?? 'GET',
    body: (call[1] as RequestInit | undefined)?.body as string | undefined,
  }))
}

function dataCalls() {
  return calls().filter((call) => !/\/profile(\?|$)/.test(call.url))
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

function routeFetch() {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith(`${API}/action-plans/`) && init?.method === 'PUT') return json({ ...ACTION_PLANS.actionPlans[0], status: 'cancelled' })
    if (url.startsWith(`${API}/action-plans?`)) return json(ACTION_PLANS)
    if (url.startsWith(`${API}/admin/departments`)) return json(DEPARTMENTS)
    if (url.includes('/action-plan-templates')) return json({ templates: [] })
    if (url.startsWith(`${TRACKING}/api/planes-accion`)) return json(TRACKING_PLANES)
    if (url.includes('/tracking/picker/nodos')) return json({ nodos: [{ id: FINANZAS, name: 'Finanzas' }] })
    if (/\/profile(\?|$)/.test(url)) return json({ companyName: 'Grupo Meridiano S.A.' })
    return json({}, 404)
  })
}

function renderPage() {
  return render(
    <TranslationProvider initialLocale="es">
      <MemoryRouter>
        <CompanyContextProvider>
          <ActionPlansListNextPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const next = es.actionPlans.next

function section(name: string): HTMLElement {
  return screen.getByRole('heading', { name }).closest('section') as HTMLElement
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 10, 12, 0, 0))
  vi.stubEnv('VITE_API_BASE_URL', API)
  vi.stubEnv('VITE_TRACKING_API_BASE_URL', TRACKING)
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
  vi.useRealTimers()
})

describe('ActionPlansListNextPage — company_admin', () => {
  beforeEach(() => {
    setToken(tokenFor({ sub: 'u-ana', role: 'company_admin', companyId: COMPANY, nodoId: `unassigned-${COMPANY}`, isActive: 'true' }))
  })

  it('groups by state: En marcha empty with its sentence, the four No iniciados by due date', async () => {
    renderPage()
    await screen.findByText('Programa de reconocimiento entre pares')
    expect(within(section(next.groupInProgress)).getByText(next.inProgressEmpty)).toBeTruthy()
    const names = within(section(next.groupNotStarted))
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/action-plans/') && link.textContent !== next.open)
      .map((link) => link.textContent)
    expect(names).toEqual([
      'Programa de reconocimiento entre pares',
      'Reducir la carga de trabajo en Operaciones',
      'Reuniones abiertas con la dirección',
      'Plan de desarrollo de carrera en Ingeniería',
    ])
  })

  it('collapses the cancelled plans at the bottom until asked, and never among open work', async () => {
    renderPage()
    await screen.findByText('Programa de reconocimiento entre pares')
    const cancelled = document.querySelector('[data-group="cancelled"]') as HTMLElement
    expect(within(cancelled).getByText(/Buzón anónimo de sugerencias/)).toBeTruthy()
    expect(within(cancelled).queryByRole('table')).toBeNull()
    expect(within(section(next.groupNotStarted)).queryByText('Buzón anónimo de sugerencias')).toBeNull()
    await userEvent.click(within(cancelled).getByRole('button', { name: new RegExp(next.show) }))
    expect(within(cancelled).getByRole('table')).toBeTruthy()
  })

  it('reads the tiles off the payload: 4 open, 1 due this month, none with progress', async () => {
    renderPage()
    const open = await screen.findByText(`${next.dueThisMonthOne} · ${next.noneWithProgress}`)
    expect(open.closest('[data-slot="kpi-tile"]')?.textContent).toContain('4')
    expect(screen.getByText('7 planes · 4 abiertos · 3 cancelados')).toBeTruthy()
  })

  it('reads the seguimiento tile from the tracking semáforo where a tracking service is configured', async () => {
    renderPage()
    const first = await screen.findByText('Finanzas · Reponer la reunión de handover entre turnos')
    expect(first.getAttribute('data-source')).toBe('tracking')
  })

  it('reads the seguimiento tile from the plans past their date where there is no tracking service', async () => {
    vi.stubEnv('VITE_TRACKING_API_BASE_URL', '')
    renderPage()
    const none = await screen.findByText(next.noneOverdue)
    expect(none.getAttribute('data-source')).toBe('plans')
    expect(calls().some((call) => call.url.startsWith(TRACKING))).toBe(false)
  })

  it('wears the sample chip only on the finding and owner columns and their two tiles', async () => {
    renderPage()
    await screen.findByText('Programa de reconocimiento entre pares')
    const chips = [...document.querySelectorAll('[data-slot="sample-chip"]')]
    expect(chips.length).toBeGreaterThan(0)
    for (const chip of chips) {
      const tile = chip.closest('[data-slot="kpi-tile"]')
      const header = chip.closest('th')
      const where = tile?.querySelector('[data-slot="kpi-label"]')?.textContent ?? header?.textContent ?? ''
      expect([next.tileFinding, next.tileOwner, next.colFinding, next.colOwner].some((name) => where.startsWith(name))).toBe(true)
    }
    const tileChips = chips.filter((chip) => chip.closest('[data-slot="kpi-tile"]'))
    expect(tileChips).toHaveLength(2)
  })

  it('offers the new plan and, per row, cancelling — which PUTs status cancelled after a confirmation', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: next.newPlan })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: next.moreActions.replace('{title}', 'Programa de reconocimiento entre pares') }))
    await userEvent.click(await screen.findByRole('menuitem', { name: next.cancelPlan }))
    expect(calls().some((call) => call.method === 'PUT')).toBe(false)
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: next.cancelConfirm }))
    const put = calls().find((call) => call.method === 'PUT')
    expect(put?.url).toBe(`${API}/action-plans/p1`)
    expect(JSON.parse(put?.body ?? '{}')).toEqual({ status: 'cancelled' })
  })

  it('narrows by title in the browser, without a request per keystroke', async () => {
    renderPage()
    await screen.findByText('Programa de reconocimiento entre pares')
    const before = dataCalls().length
    await userEvent.type(screen.getByRole('searchbox', { name: next.searchPlaceholder }), 'carga')
    expect(dataCalls().length).toBe(before)
    expect(screen.queryByText('Programa de reconocimiento entre pares')).toBeNull()
    expect(screen.getByText('Reducir la carga de trabajo en Operaciones')).toBeTruthy()
  })
})

describe('ActionPlansListNextPage — the roles GET /action-plans refuses', () => {
  for (const role of ['leader', 'supervisor', 'employee']) {
    it(`tells a ${role} whose screen this is, offers nothing to create, and asks for no plan`, async () => {
      setToken(tokenFor({ sub: 'u-x', role, companyId: COMPANY, nodoId: 'n', isActive: 'true' }))
      renderPage()
      expect(await screen.findByText(next.restrictedTitle)).toBeTruthy()
      expect(screen.queryByRole('button', { name: next.newPlan })).toBeNull()
      expect(calls().some((call) => call.url.includes('/action-plans'))).toBe(false)
    })
  }

  it('asks a super_admin with nothing selected which company they mean, and fetches nothing', async () => {
    setToken(tokenFor({ sub: 'u-s', role: 'super_admin', companyId: '', isActive: 'true' }))
    renderPage()
    expect(await screen.findByText(es.companyContext.chooseACompany)).toBeTruthy()
    expect(dataCalls()).toEqual([])
  })
})
