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
 *
 * The clock is pinned to that day (local noon, so no time zone moves it to the 9th or the
 * 11th): "Venció el 20 de agosto, hace 21 días" is a count from today, and against the real
 * clock the suite passed only on 10 Sep (CI run 34559118997 went red on the 11th, UTC).
 */

const API = 'http://api.test'
const TRACKING = 'http://tracking.test'
const COMPANY = '16c97c29-07f8-4522-86fc-e6cc56298829'
const FINANZAS = 'bff21fd0-422b-4f3b-8c89-d6bfbf5f19e9'
const PLAN_ID = '01a08b9e-6367-75aa-942c-1ec0efd04176'
const ADRIANA = '77fbfc92-76bb-452e-8be3-8ae588464994'
/** Luis Mora, `leader` of Ingeniería on the Meridiano demo — the leader boards' own reader. */
const LUIS = '64fa2a68-3cef-4644-a7b0-ee3a7315c671'
const INGENIERIA = '5bfdb04e-8847-4baa-89c8-d4411654a129'

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

/**
 * `GET /profile`'s answer, which a non-admin's screen reads for the ONE nodo it can name:
 * their own. Set before `renderPage` for the states that print it — the leader's eyebrow,
 * and the 403/404 boards, which have no plan to take a name from.
 */
let profile = { companyName: 'Grupo Meridiano S.A.', departmentId: null as string | null, departmentName: null as string | null }
function profileDepartment(id: string, name: string) {
  profile = { companyName: 'Grupo Meridiano S.A.', departmentId: id, departmentName: name }
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
    if (/\/profile(\?|$)/.test(url)) return json(profile)
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
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 10, 12, 0, 0))
  vi.stubEnv('VITE_TRACKING_API_BASE_URL', TRACKING)
  vi.stubEnv('VITE_API_BASE_URL', API)
  vi.stubGlobal('fetch', vi.fn())
  clearCompanyNameCache()
  profile = { companyName: 'Grupo Meridiano S.A.', departmentId: null, departmentName: null }
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
    expect(screen.getByRole('link', { name: next.backToPlans }).getAttribute('href')).toBe('/tracking/planes')
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
    // The plan NAMES this reader — they are its responsable de ejecución — so the rail closes
    // with the sentence for someone who takes part, not with the one about who writes, which
    // would be telling the responsable that the responsable does not record progress.
    expect(screen.getByText(next.whoWritesInvolved)).toBeTruthy()
    expect(screen.queryByText(next.whoWrites)).toBeNull()
    // The directory is admin-only and is not asked; the viewer still reads their own name.
    expect(calls().some((call) => call.url.includes('/tracking/picker/'))).toBe(false)
    const ficha = screen.getByRole('heading', { name: next.fichaHeading }).closest('section') as HTMLElement
    expect(within(ficha).getByText('Adriana Marín')).toBeTruthy()
  })

  it('tells a reader who cannot record progress only that there is none yet — never to press a button they do not have', async () => {
    setToken(tokenFor({ sub: ADRIANA, name: 'Adriana Marín', role: 'employee', companyId: COMPANY, nodoId: FINANZAS, isActive: 'true' }))
    renderPage()
    const card = (await screen.findByRole('heading', { name: next.bitacoraHeading })).closest('section') as HTMLElement
    expect(within(card).getByText(next.noAvancesFromNodo)).toBeTruthy()
    expect(card.textContent).not.toContain(next.noAvancesLead)
  })

  it('gives the leader of the plan nodo the write controls but not the directory picker', async () => {
    setToken(tokenFor({ sub: 'u-leader', name: 'Jefa de Finanzas', role: 'leader', companyId: COMPANY, nodoId: FINANZAS, isActive: 'true' }))
    renderPage()
    expect(await screen.findByRole('button', { name: es.tracking.actions.registrarAvance })).toBeTruthy()
    expect(screen.queryByRole('button', { name: es.tracking.actions.abrirAgregarInvolucrados })).toBeNull()
    expect(screen.getByText(next.addByAdmin)).toBeTruthy()
    expect(calls().some((call) => call.url.includes('/tracking/picker/'))).toBe(false)
  })

  /**
   * The ruling of 2026-09-14 (`docs/decisions/tracking-fulfilment-authority.md`), at the one
   * seam in the browser that can still get it wrong.
   *
   * `POST …/cumplir` moved from `AccessLevel.Write` to `Approve`, and `PlanAccessHandler`
   * excludes the node's own leader from `Approve` expressly. The API shipped that on
   * `aa803bbd`; this screen did not move with it and went on drawing "Marcar cumplido" for
   * exactly the caller the rule is about — and the test above asserted that it did.
   *
   * This asserts BOTH answers on ONE caller, for the reason the decision gives: the leader is
   * the only principal whose two answers differ, so a case that checked only the refusal
   * would also pass if the leader had simply lost all access.
   */
  it('does not offer the node leader "Marcar cumplido" — Approve is an administrator level — while keeping their avance', async () => {
    setToken(tokenFor({ sub: 'u-leader', name: 'Jefa de Finanzas', role: 'leader', companyId: COMPANY, nodoId: FINANZAS, isActive: 'true' }))
    renderPage()
    // Write: still theirs.
    expect(await screen.findByRole('button', { name: es.tracking.actions.registrarAvance })).toBeTruthy()
    // Approve: not theirs — at the button, and at the confirmation it would have opened.
    expect(screen.queryByRole('button', { name: next.marcarCumplido })).toBeNull()
    expect(screen.queryByText(es.tracking.detail.confirmCumplido)).toBeNull()
    // Nor in the next-milestone box, which named "Marcar cumplido" on every overdue plan.
    const avance = screen.getByRole('heading', { name: next.avanceHeading }).closest('section') as HTMLElement
    expect(avance.textContent).not.toContain(next.hitoCumplir)
    expect(within(avance).getByText(next.hitoOrNewDate)).toBeTruthy()
  })

  it('still offers an administrator "Marcar cumplido", because Approve is exactly their level', async () => {
    setToken(tokenFor({ sub: 'u-ana', name: 'Ana Rojas', role: 'company_admin', companyId: COMPANY, nodoId: `unassigned-${COMPANY}`, isActive: 'true' }))
    renderPage()
    expect(await screen.findByRole('button', { name: next.marcarCumplido })).toBeTruthy()
    const avance = screen.getByRole('heading', { name: next.avanceHeading }).closest('section') as HTMLElement
    expect(within(avance).getByText(next.hitoCumplir)).toBeTruthy()
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

/**
 * The four leader states of 10 Sep, which nobody had ever looked at:
 * TrackingPlanDetailLeader, …LeaderReadOnly, …LeaderForbidden and …LeaderNotFound.
 */
describe('PlanDetailNextPage — the leader states', () => {
  it('tells the node leader the plan is theirs: in the eyebrow, on the nodo row and in the rail', async () => {
    setToken(tokenFor({ sub: LUIS, name: 'Luis Mora', role: 'leader', companyId: COMPANY, nodoId: FINANZAS, isActive: 'true' }))
    profileDepartment(FINANZAS, 'Finanzas')
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Reponer la reunión de handover entre turnos' })
    expect(await screen.findByText(next.detailEyebrowOwn.replace('{nodo}', 'Finanzas'))).toBeTruthy()
    const ficha = screen.getByRole('heading', { name: next.fichaHeading }).closest('section') as HTMLElement
    expect(within(ficha).getByText(next.chipTuNodo)).toBeTruthy()
    expect(screen.getByText(next.whoWritesLeader.replace('{nodo}', 'Finanzas'))).toBeTruthy()
    // The unconditional sentence described this reader in the third person.
    expect(screen.queryByText(next.whoWrites)).toBeNull()
    // No "Tu papel" row: a reader with write access does not need to be told their part.
    expect(document.querySelector('[data-slot="tu-papel"]')).toBeNull()
    // The leader's own wording for the first avance, naming the nodo they lead.
    const bitacora = screen.getByRole('heading', { name: next.bitacoraHeading }).closest('section') as HTMLElement
    expect(bitacora.textContent).toContain(next.noAvancesLeadLeader.replace('{nodo}', 'Finanzas'))
  })

  /**
   * TrackingPlanDetailLeaderReadOnly: a leader of ANOTHER nodo whom this plan names as an
   * involucrado. `PlanAccessHandler` gives them `Read` and nothing else.
   */
  it('gives a leader named on another nodo plan the read-only notice, their part and no write control', async () => {
    setToken(tokenFor({ sub: LUIS, name: 'Luis Mora', role: 'leader', companyId: COMPANY, nodoId: INGENIERIA, isActive: 'true' }))
    routeFetch({ plan: { involucradosExternalIds: [ADRIANA, LUIS] } })
    profileDepartment(INGENIERIA, 'Ingeniería')
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Reponer la reunión de handover entre turnos' })
    // The plan's own nodo has no name for this reader — the nodo directory is admin-only —
    // so the eyebrow keeps the relation and drops the name rather than printing an id.
    expect(screen.getByText(next.detailEyebrowInvolvedBare)).toBeTruthy()
    expect(screen.getByText(next.readOnlyBadge)).toBeTruthy()
    expect(screen.getByText(next.readOnlyInvolucrado)).toBeTruthy()
    expect(screen.queryByRole('button', { name: es.tracking.actions.registrarAvance })).toBeNull()
    expect(screen.queryByRole('button', { name: next.marcarCumplido })).toBeNull()
    const ficha = screen.getByRole('heading', { name: next.fichaHeading }).closest('section') as HTMLElement
    expect(within(ficha).getByText(next.papelInvolucrado)).toBeTruthy()
    // Not "tu nodo": the plan is Finanzas', and this reader leads Ingeniería.
    expect(within(ficha).queryByText(next.chipTuNodo)).toBeNull()
    expect(screen.getByText(next.involucradosOnlyAdmin)).toBeTruthy()
  })

  /**
   * TrackingPlanDetailLeaderForbidden. `PlanAccessHandler` refuses a plan of another nodo
   * that does not name the caller, and until now the refusal reached the reader as "No se
   * pudo contactar el servicio de seguimiento" with a Reintentar button — a fault, about a
   * service that had just answered, and a retry that could only be refused again.
   *
   * The second half is the one that matters. **Nothing off the plan may appear**, so the
   * 403 here carries a body holding the whole plan: `Results.Forbid()` sends none, but a
   * proxy or a later handler could, and a fixture that published nothing would hide exactly
   * the bug that would matter.
   */
  it('answers a 403 with "this plan is of another nodo", and leaks not one word of it', async () => {
    setToken(tokenFor({ sub: LUIS, name: 'Luis Mora', role: 'leader', companyId: COMPANY, nodoId: INGENIERIA, isActive: 'true' }))
    profileDepartment(INGENIERIA, 'Ingeniería')
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith(`${TRACKING}/api/planes-accion/`)) return json(PLAN, 403)
      if (/\/profile(\?|$)/.test(url)) return json(profile)
      return json({}, 404)
    })
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: next.forbiddenTitle })).toBeTruthy()
    expect(await screen.findByText(next.forbiddenBody.replace('{nodo}', 'Ingeniería'))).toBeTruthy()
    expect(screen.getByText(next.forbiddenHelp)).toBeTruthy()
    expect(screen.getByRole('link', { name: next.backToPlans }).getAttribute('href')).toBe('/tracking/planes')
    expect(screen.getByRole('link', { name: es.tracking.misTareas.title }).getAttribute('href')).toBe('/tracking/mis-tareas')

    // Not an outage, and not a retry.
    expect(screen.queryByText(es.tracking.serviceUnavailableTitle)).toBeNull()
    expect(screen.queryByRole('button', { name: es.common.retry })).toBeNull()

    // Fail closed, field by field of the refused plan.
    const page = document.body.textContent ?? ''
    for (const leaked of [
      'PA-2026-00001',
      'Reponer la reunión de handover entre turnos',
      'Sesión de 20 minutos al cierre de cada turno, con acta breve.',
      'Adriana Marín',
      '20 ago',
      es.tracking.semaforo.rojo,
    ]) {
      expect(page, `the 403 screen printed "${leaked}"`).not.toContain(leaked)
    }
  })

  it('names the 404 and the 403 apart, and offers both ways out on each', async () => {
    setToken(tokenFor({ sub: LUIS, name: 'Luis Mora', role: 'leader', companyId: COMPANY, nodoId: INGENIERIA, isActive: 'true' }))
    profileDepartment(INGENIERIA, 'Ingeniería')
    routeFetch({ planStatus: 404 })
    renderPage('00000000-0000-0000-0000-000000000000')
    expect(await screen.findByRole('heading', { level: 1, name: next.notFoundTitle })).toBeTruthy()
    expect(screen.getByText(next.notFoundBody)).toBeTruthy()
    expect(await screen.findByText(next.notFoundHelp.replace('{nodo}', 'Ingeniería'))).toBeTruthy()
    expect(screen.queryByText(next.forbiddenTitle)).toBeNull()
    expect(screen.getByRole('link', { name: es.tracking.misTareas.title })).toBeTruthy()
    expect(screen.queryByText(es.tracking.serviceUnavailableTitle)).toBeNull()
  })
})
