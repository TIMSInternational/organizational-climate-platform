import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import TableroNextPage from './TableroNextPage'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { clearCompanyNameCache } from '../../../company-context/useCompanyName'
import { tokenFor } from '../../../test/jwtFixture'
import es from '../../../i18n/es.json'

/**
 * `/tracking/tablero` — the redesigned Tablero de Seguimiento. The board body is the one
 * the local tracking service answered Luis Mora (leader, nodo Ingeniería) on 10 Sep.
 */

const API = 'http://api.test'
const TRACKING = 'http://tracking.test'
const COMPANY = '16c97c29-07f8-4522-86fc-e6cc56298829'
const INGENIERIA = '5bfdb04e-8847-4baa-89c8-d4411654a129'
const PLAN_ID = '01a08b9e-63d1-7f20-8a5d-62a31ac71d53'

const TABLERO = {
  nodoExternalId: INGENIERIA,
  conteos: { rojo: 0, amarillo: 0, verde: 1 },
  planes: [
    {
      id: PLAN_ID,
      planCode: 'PA-2026-00002',
      nodoExternalId: INGENIERIA,
      liderExternalId: '',
      hallazgoExternalId: null,
      descripcionQue: 'Publicar el rol de fines de semana con dos semanas de antelación',
      metodologiaComo: 'Calendario compartido, actualizado los lunes por la jefatura del nodo.',
      responsableEjecucionExternalId: '1553edb1-e100-4bb1-a397-90882b3a3e9e',
      fechaCreacion: '2026-09-10',
      fechaCompromiso: '2026-09-15',
      porcentajeAvance: 0,
      estadoSemaforo: 'Verde',
      cicloEncuestaExternalId: null,
      fechaUltimaActualizacion: '2026-09-10',
      cumplido: false,
      involucradosExternalIds: ['1553edb1-e100-4bb1-a397-90882b3a3e9e'],
    },
  ],
}

const PROFILE = { companyName: 'Grupo Meridiano S.A.', name: 'Luis Mora', departmentId: INGENIERIA, departmentName: 'Ingeniería' }

function calls(): Array<{ url: string; method: string; body: string | undefined }> {
  return vi.mocked(fetch).mock.calls.map((call) => ({
    url: String(call[0]),
    method: (call[1] as RequestInit | undefined)?.method ?? 'GET',
    body: (call[1] as RequestInit | undefined)?.body as string | undefined,
  }))
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

function routeFetch() {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith(`${TRACKING}/api/planes-accion/`) && init?.method === 'POST') return json(TABLERO.planes[0])
    if (url.startsWith(`${TRACKING}/api/tablero-seguimiento`)) return json(TABLERO)
    if (url.includes('/tracking/picker/nodos')) return json({ nodos: [{ id: INGENIERIA, name: 'Ingeniería' }] })
    if (url.includes('/tracking/picker/personas')) return json({ personas: [] })
    if (/\/profile(\?|$)/.test(url)) return json(PROFILE)
    return json({}, 404)
  })
}

function renderPage(entry = '/tracking/tablero') {
  return render(
    <TranslationProvider initialLocale="es">
      <MemoryRouter initialEntries={[entry]}>
        <CompanyContextProvider>
          <TableroNextPage />
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

describe('TableroNextPage — the leader of the nodo', () => {
  beforeEach(() => {
    setToken(tokenFor({ sub: 'u-luis', name: 'Luis Mora', role: 'leader', companyId: COMPANY, nodoId: INGENIERIA, isActive: 'true' }))
  })

  it('asks for the caller own board — no nodoId — and never the admin-only directory', async () => {
    renderPage()
    await screen.findByText('Publicar el rol de fines de semana con dos semanas de antelación')
    const tracking = calls().filter((call) => call.url.startsWith(TRACKING))
    expect(tracking.map((call) => call.url)).toEqual([`${TRACKING}/api/tablero-seguimiento`])
    expect(calls().some((call) => call.url.includes('/tracking/picker/'))).toBe(false)
  })

  it('names the nodo from the caller own department, and the card with its long semáforo word', async () => {
    renderPage()
    expect(await screen.findByText('Ingeniería · Nodo')).toBeTruthy()
    const card = screen.getByRole('article')
    expect(within(card).getByText('PA-2026-00002')).toBeTruthy()
    expect(within(card).getByText(next.semaforoLargoVerde)).toBeTruthy()
    expect(within(card).getByText(next.onTimeBoard)).toBeTruthy()
    expect(within(card).getByRole('link', { name: new RegExp(next.viewPlan) }).getAttribute('href')).toBe(`/tracking/planes/${PLAN_ID}`)
  })

  it('reads Avances registrados 0 off plans with no avance on record, and wears no sample chip anywhere', async () => {
    renderPage()
    await screen.findByRole('article')
    expect(document.querySelectorAll('[data-slot="sample-chip"]')).toHaveLength(0)
    const tile = [...document.querySelectorAll('[data-slot="nodo-tile"]')].find((node) => node.textContent?.includes(next.tileAvances)) as HTMLElement
    expect(tile.querySelector('[data-slot="avances-reading"]')?.textContent).toBe('0')
    expect(tile.textContent).toContain(next.firstBelow)
  })

  it('once a plan carries an avance, reads how many plans do and the latest day — never a count of avances it cannot see', async () => {
    const withAvance = { ...TABLERO.planes[0], porcentajeAvance: 0.25, fechaUltimaActualizacion: '2026-09-12' }
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith(`${TRACKING}/api/tablero-seguimiento`)) return json({ ...TABLERO, planes: [withAvance] })
      if (/\/profile(\?|$)/.test(url)) return json(PROFILE)
      return json({}, 404)
    })
    renderPage()
    await screen.findByRole('article')
    expect(screen.queryByText(next.tileAvances)).toBeNull()
    const tile = screen.getByText(next.tilePlanesConAvance).closest('[data-slot="nodo-tile"]') as HTMLElement
    expect(tile.querySelector('[data-slot="avances-reading"]')?.textContent).toBe('1')
    expect(tile.textContent).toContain(next.ofPlansLatest.replace('{total}', '1').replace('{date}', '12 sept'))
  })

  it('names the viewer as the jefatura del nodo when they are the plan responsable, as the artboard names Luis Mora', async () => {
    const mine = { ...TABLERO.planes[0], responsableEjecucionExternalId: 'u-luis' }
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith(`${TRACKING}/api/tablero-seguimiento`)) return json({ ...TABLERO, planes: [mine] })
      if (/\/profile(\?|$)/.test(url)) return json(PROFILE)
      return json({}, 404)
    })
    renderPage()
    const card = await screen.findByRole('article')
    const box = within(card).getByText(next.boxResponsable).parentElement as HTMLElement
    expect(box.textContent).toContain('Luis Mora')
    expect(box.textContent).toContain(next.jefaturaDelNodo)
  })

  it('says a responsable who is somebody else is named where the directory is — the administration', async () => {
    renderPage()
    const card = await screen.findByRole('article')
    const box = within(card).getByText(next.boxResponsable).parentElement as HTMLElement
    expect(box.textContent).toContain(next.personaUnnamed)
    expect(box.textContent).toContain(next.personaUnnamedSub)
    expect(box.textContent).not.toContain(next.jefaturaDelNodo)
  })

  it('sets the unit right after the figure, "0 %", and a placeholder naming the day the avance is for', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 10, 12, 0, 0))
    try {
      renderPage()
      const card = await screen.findByRole('article')
      const unit = card.querySelector('[data-slot="avance-unit"]') as HTMLElement
      // The stored 0 and a space: the field's 10px padding, one digit, one `ch`.
      expect(unit.style.left).toBe('calc(0.625rem + 2ch)')
      const percent = within(card).getByLabelText(next.fieldAvance)
      await userEvent.clear(percent)
      await userEvent.type(percent, '25')
      expect(unit.style.left).toBe('calc(0.625rem + 3ch)')
      expect(within(card).getByLabelText(next.fieldQueSeHizo).getAttribute('placeholder')).toBe('Lo que se hizo el 10 de septiembre')
    } finally {
      vi.useRealTimers()
    }
  })

  it('prints the avance date as the board prints dates, not as the browser numeric control', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 10, 12, 0, 0))
    try {
      renderPage()
      const card = await screen.findByRole('article')
      expect(within(card).getByRole('button', { name: next.fieldFecha }).textContent).toBe('10 sept 2026')
      expect(card.querySelector('input[type="date"]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('records an avance as the fraction the service stores', async () => {
    renderPage()
    const card = await screen.findByRole('article')
    const percent = within(card).getByLabelText(next.fieldAvance)
    await userEvent.clear(percent)
    await userEvent.type(percent, '25')
    await userEvent.type(within(card).getByLabelText(next.fieldQueSeHizo), 'Rol de octubre publicado')
    await userEvent.click(within(card).getByRole('button', { name: next.saveAvance }))
    const post = calls().find((call) => call.method === 'POST')
    expect(post?.url).toBe(`${TRACKING}/api/planes-accion/${PLAN_ID}/avance`)
    const body = JSON.parse(post?.body ?? '{}') as { porcentajeAvance: number; comentario: string; fecha: string }
    expect(body.porcentajeAvance).toBe(0.25)
    expect(body.comentario).toBe('Rol de octubre publicado')
    expect(body.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('refuses a percentage outside 0–100 before anything is sent', async () => {
    renderPage()
    const card = await screen.findByRole('article')
    const percent = within(card).getByLabelText(next.fieldAvance)
    await userEvent.clear(percent)
    await userEvent.type(percent, '150')
    await userEvent.click(within(card).getByRole('button', { name: next.saveAvance }))
    expect(within(card).getByRole('alert').textContent).toBe(es.tracking.fields.avanceRange)
    expect(calls().some((call) => call.method === 'POST')).toBe(false)
  })
})

describe('TableroNextPage — who else arrives here', () => {
  it('shows a leader with no nodo the artboard card and asks the service nothing', async () => {
    setToken(tokenFor({ sub: 'u-l', role: 'leader', companyId: COMPANY, nodoId: `unassigned-${COMPANY}`, isActive: 'true' }))
    renderPage()
    expect(await screen.findByText(next.noNodoTitle)).toBeTruthy()
    expect(screen.getByRole('link', { name: next.goToPlans }).getAttribute('href')).toBe('/tracking/planes')
    expect(calls().filter((call) => call.url.startsWith(TRACKING))).toEqual([])
  })

  for (const role of ['supervisor', 'employee']) {
    it(`tells a ${role} the board is the leader's, points at Mis tareas, and asks nothing`, async () => {
      setToken(tokenFor({ sub: 'u-s', role, companyId: COMPANY, nodoId: INGENIERIA, isActive: 'true' }))
      renderPage()
      expect(await screen.findByText(es.tracking.tableroRestrictedTitle)).toBeTruthy()
      expect(screen.getByRole('link', { name: next.goToMisTareas }).getAttribute('href')).toBe('/tracking/mis-tareas')
      expect(calls().filter((call) => call.url.startsWith(TRACKING))).toEqual([])
    })
  }

  it('asks an administrator with no nodoId to choose one from the consolidado', async () => {
    setToken(tokenFor({ sub: 'u-a', role: 'company_admin', companyId: COMPANY, nodoId: `unassigned-${COMPANY}`, isActive: 'true' }))
    renderPage()
    expect(await screen.findByText(es.tracking.tableroChooseNodoTitle)).toBeTruthy()
    expect(calls().filter((call) => call.url.startsWith(TRACKING))).toEqual([])
  })

  it('shows an administrator the nodo in the URL, named from the directory, with the form', async () => {
    setToken(tokenFor({ sub: 'u-a', role: 'company_admin', companyId: COMPANY, nodoId: `unassigned-${COMPANY}`, isActive: 'true' }))
    renderPage(`/tracking/tablero?nodoId=${INGENIERIA}`)
    expect(await screen.findByText('Ingeniería · Nodo')).toBeTruthy()
    expect(calls().some((call) => call.url === `${TRACKING}/api/tablero-seguimiento?nodoId=${INGENIERIA}`)).toBe(true)
    expect(screen.getByRole('button', { name: next.saveAvance })).toBeTruthy()
  })
})
