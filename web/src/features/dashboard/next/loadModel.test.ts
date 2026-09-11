import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadAdminDashboard, type LoadDeps } from './loadModel'
import { sampleModel } from './sampleModel'

/**
 * The loader against a `fetch` answered by URL, with payloads shaped like the ones the
 * local API returned on 2026-09-10. What this file proves is the routing — which client
 * is asked, with which scope, and what one failure costs; the arithmetic is
 * `compose.test.ts`'s.
 */
const API = 'http://api.test'
const TRACKING = 'http://tracking.test'

type Route = { match: (url: string) => boolean; body: unknown; status?: number }

function routes(): Route[] {
  return [
    {
      match: (url) => url.includes('/dashboard/company-admin'),
      body: { companyId: 'c1', companyName: 'Acme Corporation', openActionPlanCount: 4, overdueActionPlanCount: 0, departments: [], ongoingSurveys: [] },
    },
    {
      match: (url) => /\/surveys(\?|$)/.test(url),
      body: {
        surveys: [
          { id: 'sv-q3', title: 'Q3 Climate Survey', status: 'closed', startDate: '2026-07-16', endDate: '2026-08-06', responseCount: 24, targetAudienceCount: null },
          { id: 'sv-q4', title: 'Q4 Climate Survey', status: 'active', startDate: '2026-09-03', endDate: '2026-10-10', responseCount: 3, targetAudienceCount: 24 },
        ],
      },
    },
    {
      match: (url) => url.includes('/surveys/climate-trends') && !url.includes('groupBy'),
      body: {
        surveys: [{ surveyId: 'sv-q3', title: 'Q3', status: 'closed', endDate: '2026-08-06', completedCount: 24, isSuppressed: false }],
        dimensions: [{ key: 'workload', surveyCount: 1 }],
        groups: [{ key: '__company__', label: null, points: [{ surveyId: 'sv-q3', respondentCount: 24, isSuppressed: false, scores: [3.33] }] }],
        minimumGroupSize: 5,
      },
    },
    {
      match: (url) => url.includes('/surveys/climate-trends') && url.includes('groupBy=department'),
      body: {
        surveys: [{ surveyId: 'sv-q3', title: 'Q3', status: 'closed', endDate: '2026-08-06', completedCount: 24, isSuppressed: false }],
        dimensions: [{ key: 'workload', surveyCount: 1 }],
        groups: [{ key: 'd-ops', label: 'Operaciones', points: [{ surveyId: 'sv-q3', respondentCount: 5, isSuppressed: false, scores: [2.4] }] }],
        minimumGroupSize: 5,
      },
    },
    {
      match: (url) => url.includes('/action-plans?'),
      body: { actionPlans: [{ id: 'ap-ops', title: 'Reduce the workload in Operations', departmentId: 'd-ops', dueDate: '2026-10-15T00:00:00Z', status: 'not_started' }] },
    },
    {
      match: (url) => url.includes('/action-plans/ap-ops'),
      body: { id: 'ap-ops', title: 'Reduce the workload in Operations', objectives: [{ id: 'o1', completionPercentage: 40 }] },
    },
    {
      match: (url) => url.includes('/microclimates?'),
      body: { microclimates: [{ id: 'mc-pulse', title: 'Weekly pulse', status: 'active', responseCount: 0, targetParticipantCount: 20 }] },
    },
    { match: (url) => url.includes('/microclimates/mc-pulse'), body: { id: 'mc-pulse', title: 'Weekly pulse', endTime: '2026-09-11T18:00:00Z' } },
    {
      match: (url) => url.startsWith(`${TRACKING}/api/planes-accion`),
      body: [{ id: 'tp-fin', nodoExternalId: 'd-fin', descripcionQue: 'Handover', responsableEjecucionExternalId: 'p-1', fechaCompromiso: '2026-08-20', porcentajeAvance: 0, cumplido: false }],
    },
    { match: (url) => url.includes('/tracking/picker/nodos'), body: { nodos: [{ id: 'd-fin', name: 'Finanzas' }] } },
    { match: (url) => url.includes('/tracking/picker/personas'), body: { personas: [{ id: 'p-1', name: 'Adriana Marín', email: 'a@x' }] } },
    { match: (url) => url.includes('/surveys/sv-q3?'), body: { id: 'sv-q3', questions: [{ order: 0, category: 'workload' }] } },
    {
      match: (url) => url.includes('/surveys/sv-q4/invitations'),
      body: { invitations: [{ reminderCount: 1 }, { reminderCount: 2 }], summary: {}, anonymity: {} },
    },
  ]
}

function serve(table: Route[]): void {
  vi.mocked(fetch).mockImplementation((input) => {
    const url = String(input)
    const route = table.find((candidate) => candidate.match(url))
    if (!route) return Promise.resolve(new Response(JSON.stringify({ message: `unrouted ${url}` }), { status: 404 }))
    return Promise.resolve(new Response(JSON.stringify(route.body), { status: route.status ?? 200 }))
  })
}

function requested(): string[] {
  return vi.mocked(fetch).mock.calls.map(([url]) => String(url))
}

function deps(overrides: Partial<LoadDeps> = {}): LoadDeps {
  return {
    baseUrl: API,
    trackingBaseUrl: TRACKING,
    lang: 'es',
    asOf: '2026-09-10',
    floor: 5,
    dimensionName: (key) => key,
    ...overrides,
  }
}

describe('loadAdminDashboard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads every region from the existing endpoints and carries their ids into the model', async () => {
    serve(routes())
    const { model, regions } = await loadAdminDashboard(deps())

    expect(Object.values(regions).every((region) => region.status === 'live')).toBe(true)
    expect(model.isSample).toBe(false)
    expect(model.latestClosedWave.id).toBe('sv-q3')
    expect(model.openSurvey?.id).toBe('sv-q4')
    expect(model.attention).toEqual([
      { kind: 'lowest-cell', plan: { id: 'ap-ops', name: 'Reduce the workload in Operations', progress: 40 } },
      { kind: 'overdue-plan', nodo: 'Finanzas', plan: { id: 'tp-fin', name: 'Handover', progress: 0, owner: 'Adriana Marín', dueAt: '2026-08-20' } },
      // Read from the open survey's invitations: 1 + 2 reminders sent.
      { kind: 'low-participation', surveyId: 'sv-q4', remindersSent: 3 },
    ])
    expect(model.liveMicroclimate).toMatchObject({ id: 'mc-pulse', closesAt: '2026-09-11T18:00:00Z' })

    const urls = requested()
    expect(urls).toContain(`${API}/dashboard/company-admin?lang=es`)
    expect(urls).toContain(`${API}/surveys?lang=es`)
    expect(urls).toContain(`${API}/surveys/climate-trends?lang=es`)
    expect(urls).toContain(`${API}/surveys/climate-trends?groupBy=department&lang=es`)
    expect(urls).toContain(`${API}/action-plans?companyId=c1&lang=es`)
    expect(urls).toContain(`${API}/action-plans/ap-ops?lang=es`)
    expect(urls).toContain(`${API}/microclimates?companyId=c1&lang=es`)
    expect(urls).toContain(`${API}/microclimates/mc-pulse?lang=es`)
    expect(urls).toContain(`${TRACKING}/api/planes-accion`)
    expect(urls).toContain(`${API}/tracking/picker/nodos?companyId=c1`)
    expect(urls).toContain(`${API}/tracking/picker/personas?companyId=c1`)
  })

  it("a failing endpoint costs its region only, and the region carries the server's message", async () => {
    const table = routes()
    const micro = table.find((route) => route.match(`${API}/microclimates?companyId=c1`))
    if (!micro) throw new Error('no microclimates route')
    micro.body = { message: 'Service unavailable' }
    micro.status = 503
    serve(table)

    const { model, regions } = await loadAdminDashboard(deps())

    expect(regions.microclimates).toEqual({ status: 'fallback', reason: 'failed', error: 'Service unavailable' })
    expect(model.isSample).toBe(true)
    expect(model.liveMicroclimate).toBe(sampleModel.liveMicroclimate)
    expect(regions.company).toEqual({ status: 'live' })
    expect(regions.map).toEqual({ status: 'live' })
    expect(model.attention[0]).toMatchObject({ kind: 'lowest-cell', plan: { id: 'ap-ops' } })
  })

  it('asks nothing of a tracking service that is not configured', async () => {
    serve(routes())
    const { model, regions } = await loadAdminDashboard(deps({ trackingBaseUrl: null }))

    expect(regions.tracking).toEqual({ status: 'off' })
    expect(model.isSample).toBe(false)
    expect(model.plans).toEqual({ open: 4, overdue: 0, overdueNodo: null })
    expect(requested().some((url) => url.startsWith(TRACKING) || url.includes('/tracking/picker'))).toBe(false)
  })

  it("carries a SuperAdmin's selection into every scoped request, and a CompanyAdmin's nothing", async () => {
    serve(routes())
    await loadAdminDashboard(deps({ companyId: 'c9' }))
    let urls = requested()
    expect(urls).toContain(`${API}/dashboard/company-admin?companyId=c9&lang=es`)
    expect(urls).toContain(`${API}/surveys?companyId=c9&lang=es`)
    expect(urls).toContain(`${API}/surveys/climate-trends?companyId=c9&lang=es`)
    expect(urls).toContain(`${API}/surveys/climate-trends?groupBy=department&companyId=c9&lang=es`)

    vi.mocked(fetch).mockClear()
    await loadAdminDashboard(deps())
    urls = requested()
    expect(urls.filter((url) => url.includes('/dashboard/company-admin'))).toEqual([`${API}/dashboard/company-admin?lang=es`])
    expect(urls.filter((url) => url.includes('/surveys?'))).toEqual([`${API}/surveys?lang=es`])
    // The scoped clients take the tenant from the company payload, not from a guess.
    expect(urls).toContain(`${API}/action-plans?companyId=c1&lang=es`)
  })

  it('when the company payload fails and no tenant was named, the scoped regions inherit that failure', async () => {
    const table = routes()
    const companyRoute = table[0]
    companyRoute.body = { message: 'Service unavailable' }
    companyRoute.status = 503
    serve(table)

    const { regions } = await loadAdminDashboard(deps())

    expect(regions.company).toEqual({ status: 'fallback', reason: 'failed', error: 'Service unavailable' })
    expect(regions.actionPlans).toEqual({ status: 'fallback', reason: 'failed', error: 'Service unavailable' })
    expect(regions.microclimates).toEqual({ status: 'fallback', reason: 'failed', error: 'Service unavailable' })
    expect(regions.tracking).toEqual({ status: 'fallback', reason: 'failed', error: 'Service unavailable' })
    expect(regions.surveys).toEqual({ status: 'live' })
    expect(requested().some((url) => url.includes('/action-plans'))).toBe(false)
  })

  it('reads the latest closed survey’s question order and the open survey’s reminders beside the regions', async () => {
    serve(routes())
    const { model } = await loadAdminDashboard(deps())
    const urls = requested()
    expect(urls).toContain(`${API}/surveys/sv-q3?lang=es`)
    expect(urls).toContain(`${API}/surveys/sv-q4/invitations?lang=es`)
    expect(model.attention.find((item) => item.kind === 'low-participation')).toMatchObject({ remindersSent: 3 })
  })
})
