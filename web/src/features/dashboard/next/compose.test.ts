import { describe, it, expect } from 'vitest'
import type { ActionPlan, ActionPlanDetail } from '../../action-plans/api/actionPlans'
import type { Microclimate, MicroclimateDetail } from '../../microclimates/api/microclimates'
import type { ClimateTrendsResponse } from '../../surveys/api/climateTrends'
import type { SurveyListItem } from '../../surveys/api/surveys'
import type { PlanAccion } from '../../tracking/api/trackingApi'
import type { CompanyAdminDashboard } from '../api/dashboard'
import {
  composeModel,
  coveringPlan,
  isOverdue,
  planProgress,
  waveCode,
  type ComposeOptions,
  type ModelParts,
} from './compose'
import { lowestCell } from './derive'
import { sampleModel } from './sampleModel'

/**
 * Fixtures shaped like the payloads the local API returned on 2026-09-10 for the
 * seeded tenant — the shapes are copied, the values are small. Ids are deliberately
 * unlike the sample's (`s-q3`, `ap-1`, `tp-1`, `mc-1`), so a link carrying a sample id
 * in a live region cannot pass.
 */
const ASOF = '2026-09-10'

function survey(overrides: Partial<SurveyListItem>): SurveyListItem {
  return {
    id: 'x',
    title: null,
    companyId: 'c1',
    type: 'periodic',
    status: 'closed',
    language: 'es',
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-02-01T00:00:00Z',
    responseCount: 0,
    targetAudienceCount: null,
    questionCount: 6,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function surveys(): SurveyListItem[] {
  return [
    survey({ id: 'sv-q1', title: 'Q1 Climate Survey', startDate: '2026-01-22', endDate: '2026-02-12', responseCount: 24 }),
    survey({ id: 'sv-q3', title: 'Q3 Climate Survey', startDate: '2026-07-16', endDate: '2026-08-06', responseCount: 24 }),
    survey({ id: 'sv-q2', title: 'Q2 Climate Survey', startDate: '2026-04-22', endDate: '2026-05-13', responseCount: 24 }),
    survey({ id: 'sv-q4', title: 'Q4 Climate Survey (open)', status: 'active', startDate: '2026-09-03', endDate: '2026-10-10', responseCount: 3, targetAudienceCount: 24 }),
    survey({ id: 'sv-copy', title: 'Q4 Climate Survey (open) (Copy)', status: 'archived', startDate: '2026-09-03', endDate: '2026-10-10', responseCount: 1 }),
    survey({ id: 'sv-next', title: 'Encuesta de Clima Q1 2027', status: 'draft', startDate: '2027-01-20', endDate: '2027-02-10' }),
  ]
}

function trends(): ClimateTrendsResponse {
  return {
    companyId: 'c1',
    groupBy: null,
    surveys: [
      { surveyId: 'sv-q1', title: 'Q1 Climate Survey', status: 'closed', endDate: '2026-02-12', completedCount: 24, isSuppressed: false },
      { surveyId: 'sv-q2', title: 'Q2 Climate Survey', status: 'closed', endDate: '2026-05-13', completedCount: 24, isSuppressed: false },
      { surveyId: 'sv-q3', title: 'Q3 Climate Survey', status: 'closed', endDate: '2026-08-06', completedCount: 23, isSuppressed: false },
      { surveyId: 'sv-copy', title: 'Q4 (Copy)', status: 'archived', endDate: '2026-10-10', completedCount: 1, isSuppressed: true },
    ],
    dimensions: [
      { key: 'workload', surveyCount: 3 },
      { key: 'trust', surveyCount: 3 },
    ],
    groups: [
      {
        key: '__company__',
        label: null,
        points: [
          { surveyId: 'sv-q1', respondentCount: 24, isSuppressed: false, scores: [2.75, 2.96] },
          { surveyId: 'sv-q2', respondentCount: 24, isSuppressed: false, scores: [3.04, 3.33] },
          { surveyId: 'sv-q3', respondentCount: 24, isSuppressed: false, scores: [3.33, 3.67] },
          { surveyId: 'sv-copy', respondentCount: 0, isSuppressed: true, scores: [null, null] },
        ],
      },
    ],
    suppressedGroupCount: 0,
    minimumGroupSize: 5,
    generatedAt: '2026-09-10T00:00:00Z',
  }
}

function trendsByDepartment(): ClimateTrendsResponse {
  const base = trends()
  const suppressed = (surveyId: string) => ({ surveyId, respondentCount: 0, isSuppressed: true, scores: [null, null] })
  return {
    ...base,
    groupBy: 'department',
    groups: [
      { key: 'd-fin', label: 'Finanzas', points: ['sv-q1', 'sv-q2', 'sv-q3', 'sv-copy'].map(suppressed) },
      {
        key: 'd-ops',
        label: 'Operaciones',
        points: [
          { surveyId: 'sv-q1', respondentCount: 5, isSuppressed: false, scores: [1.8, 2.2] },
          { surveyId: 'sv-q2', respondentCount: 5, isSuppressed: false, scores: [2.2, 2.6] },
          { surveyId: 'sv-q3', respondentCount: 5, isSuppressed: false, scores: [2.4, 3.0] },
          suppressed('sv-copy'),
        ],
      },
      {
        key: 'd-ven',
        label: 'Ventas',
        points: [
          { surveyId: 'sv-q1', respondentCount: 5, isSuppressed: false, scores: [2.8, 3.2] },
          { surveyId: 'sv-q2', respondentCount: 5, isSuppressed: false, scores: [3.0, 3.4] },
          { surveyId: 'sv-q3', respondentCount: 5, isSuppressed: false, scores: [3.4, 3.8] },
          suppressed('sv-copy'),
        ],
      },
    ],
  }
}

function company(): CompanyAdminDashboard {
  return {
    companyId: 'c1',
    companyName: 'Acme Corporation',
    userCount: 42,
    activeUserCount: 40,
    departmentCount: 3,
    surveyCount: 5,
    activeSurveyCount: 1,
    draftSurveyCount: 1,
    responseCount: 76,
    completedResponseCount: 76,
    openActionPlanCount: 4,
    overdueActionPlanCount: 0,
    ongoingSurveys: [],
    departments: [],
  }
}

function plan(overrides: Partial<ActionPlan>): ActionPlan {
  return {
    id: 'x',
    title: 'x',
    companyId: 'c1',
    departmentId: null,
    dueDate: '2026-10-15T00:00:00Z',
    status: 'not_started',
    priority: 'high',
    createdAt: '2026-09-10T00:00:00Z',
    ...overrides,
  }
}

function plans(): ActionPlan[] {
  return [
    plan({ id: 'ap-lunch', title: 'Monthly department lunches', departmentId: 'd-ops', dueDate: '2026-09-30T00:00:00Z' }),
    plan({ id: 'ap-ops', title: 'Reduce the workload in Operations', departmentId: 'd-ops', dueDate: '2026-10-15T00:00:00Z' }),
    plan({ id: 'ap-done', title: 'Workload review (done)', departmentId: 'd-ops', status: 'completed', dueDate: '2026-01-01T00:00:00Z' }),
    plan({ id: 'ap-hr', title: 'Peer recognition programme', departmentId: 'd-per' }),
  ]
}

function covering(): ActionPlanDetail {
  return {
    id: 'ap-ops',
    title: 'Reduce the workload in Operations',
    description: '',
    companyId: 'c1',
    departmentId: 'd-ops',
    createdBy: 'u1',
    dueDate: '2026-10-15T00:00:00Z',
    status: 'in_progress',
    priority: 'high',
    tags: [],
    templateId: null,
    kpis: [],
    objectives: [
      { id: 'o1', description: '', successCriteria: '', currentStatus: '', completionPercentage: 50 },
      { id: 'o2', description: '', successCriteria: '', currentStatus: '', completionPercentage: 0 },
    ],
  }
}

function plane(overrides: Partial<PlanAccion>): PlanAccion {
  return {
    id: 'x',
    planCode: 'PA-2026-00001',
    nodoExternalId: 'd-fin',
    liderExternalId: '',
    hallazgoExternalId: null,
    descripcionQue: 'x',
    metodologiaComo: '',
    responsableEjecucionExternalId: 'p-1',
    fechaCreacion: '2026-09-10',
    fechaCompromiso: '2026-09-15',
    porcentajeAvance: 0,
    estadoSemaforo: 'Verde',
    cicloEncuestaExternalId: null,
    fechaUltimaActualizacion: '2026-09-10',
    cumplido: false,
    involucradosExternalIds: [],
    ...overrides,
  }
}

function tracking() {
  return {
    planes: [
      plane({ id: 'tp-fin', descripcionQue: 'Reponer la reunión de handover entre turnos', fechaCompromiso: '2026-08-20', estadoSemaforo: 'Rojo' }),
      plane({ id: 'tp-ing', nodoExternalId: 'd-ing', descripcionQue: 'Publicar el rol', fechaCompromiso: '2026-09-15' }),
      plane({ id: 'tp-done', descripcionQue: 'Hecho', fechaCompromiso: '2026-01-01', cumplido: true }),
    ],
    nodoNames: new Map([
      ['d-fin', 'Finanzas'],
      ['d-ing', 'Ingeniería'],
    ]),
    personaNames: new Map([['p-1', 'Adriana Marín']]),
  }
}

function microclimates(): { list: Microclimate[]; live: MicroclimateDetail | null } {
  const active: Microclimate = {
    id: 'mc-pulse',
    title: 'Weekly pulse — how did the week go?',
    companyId: 'c1',
    status: 'active',
    language: 'en',
    responseCount: 0,
    targetParticipantCount: 20,
    createdAt: '2026-09-10T00:00:00Z',
  }
  return {
    list: [active],
    live: {
      id: 'mc-pulse',
      title: active.title,
      description: null,
      companyId: 'c1',
      createdBy: 'u1',
      status: 'active',
      responseCount: 0,
      targetParticipantCount: 20,
      startTime: '2026-09-10T08:00:00Z',
      endTime: '2026-09-11T18:00:00Z',
      anonymousResponses: true,
      showLiveResults: true,
      questions: [],
      language: 'en',
      resolvedLocale: 'en',
      fallbackFields: [],
    },
  }
}

function live(): ModelParts {
  return {
    company: { status: 'live', value: company() },
    surveys: { status: 'live', value: surveys() },
    trends: { status: 'live', value: trends() },
    map: { status: 'live', value: trendsByDepartment() },
    actionPlans: { status: 'live', value: { plans: plans(), covering: covering() } },
    tracking: { status: 'live', value: tracking() },
    microclimates: { status: 'live', value: microclimates() },
  }
}

const NAMES: Record<string, string> = { workload: 'Workload', trust: 'Trust' }

function options(): ComposeOptions {
  return { asOf: ASOF, floor: 5, dimensionName: (key) => NAMES[key] ?? key, sample: sampleModel }
}

describe('composeModel', () => {
  it('composes every region from the payloads, with real ids on every link and no sample anywhere', () => {
    const { model, regions } = composeModel(live(), options())

    expect(model.isSample).toBe(false)
    expect(Object.values(regions).every((region) => region.status === 'live')).toBe(true)
    expect(model.companyName).toBe('Acme Corporation')
    expect(model.asOf).toBe(ASOF)

    // The cycle: closed by close date, then the open one, then the next planned.
    expect(model.waves.map((wave) => [wave.code, wave.status])).toEqual([
      ['Q1', 'closed'],
      ['Q2', 'closed'],
      ['Q3', 'closed'],
      ['Q4', 'open'],
      ['Q1 2027', 'planned'],
    ])
    expect(model.latestClosedWave).toMatchObject({ id: 'sv-q3', code: 'Q3', closedAt: '2026-08-06' })
    expect(model.previousWave).toMatchObject({ id: 'sv-q2', code: 'Q2' })
    expect(model.openSurvey).toEqual({
      id: 'sv-q4',
      code: 'Q4',
      name: 'Q4 Climate Survey (open)',
      responses: 3,
      audience: 24,
      closesAt: '2026-10-10',
    })
    // Responses from the list, completed from the trends' own count of the same survey.
    expect(model.participation).toEqual({ responses: 24, completed: 23 })

    // The series over the closed, disclosed waves only — the archived copy is not a wave.
    expect(model.dimensions).toEqual([
      { key: 'workload', name: 'Workload', values: [2.75, 3.04, 3.33] },
      { key: 'trust', name: 'Trust', values: [2.96, 3.33, 3.67] },
    ])

    // The map of the latest closed wave: a withheld row keeps its row and no scores.
    expect(model.map.dimensionKeys).toEqual(['workload', 'trust'])
    expect(model.map.rows).toEqual([
      { departmentId: 'd-fin', name: 'Finanzas', responses: 0, scores: [] },
      { departmentId: 'd-ops', name: 'Operaciones', responses: 5, scores: [2.4, 3.0] },
      { departmentId: 'd-ven', name: 'Ventas', responses: 5, scores: [3.4, 3.8] },
    ])

    // Plans from tracking, since it is on: two not done, one of them overdue, in Finanzas.
    expect(model.plans).toEqual({ open: 2, overdue: 1, overdueNodo: 'Finanzas' })

    expect(model.attention).toEqual([
      { kind: 'lowest-cell', plan: { id: 'ap-ops', name: 'Reduce the workload in Operations', progress: 25 } },
      {
        kind: 'overdue-plan',
        nodo: 'Finanzas',
        plan: {
          id: 'tp-fin',
          name: 'Reponer la reunión de handover entre turnos',
          progress: 0,
          owner: 'Adriana Marín',
          dueAt: '2026-08-20',
        },
      },
      { kind: 'low-participation', surveyId: 'sv-q4', remindersSent: null },
    ])
    expect(model.liveMicroclimate).toEqual({
      id: 'mc-pulse',
      name: 'Weekly pulse — how did the week go?',
      responses: 0,
      closesAt: '2026-09-11T18:00:00Z',
    })
  })

  it("a failed region takes the sample's part, and only that part, and says why", () => {
    const parts = live()
    parts.trends = { status: 'fallback', reason: 'failed', error: 'Service unavailable' }
    const { model, regions } = composeModel(parts, options())

    expect(model.isSample).toBe(true)
    expect(regions.trends).toEqual({ status: 'fallback', reason: 'failed', error: 'Service unavailable' })
    expect(model.dimensions).toBe(sampleModel.dimensions)
    // Everything else is still the tenant's own.
    expect(regions.company).toEqual({ status: 'live' })
    expect(model.companyName).toBe('Acme Corporation')
    expect(model.map.rows[1]).toMatchObject({ name: 'Operaciones' })
    expect(model.latestClosedWave.id).toBe('sv-q3')
  })

  it('a tenant with no closed survey is an empty fallback, not a failure', () => {
    const parts = live()
    parts.surveys = { status: 'live', value: surveys().filter((survey) => survey.status !== 'closed') }
    const { model, regions } = composeModel(parts, options())

    expect(regions.surveys).toEqual({ status: 'fallback', reason: 'empty' })
    expect(model.isSample).toBe(true)
    expect(model.waves).toBe(sampleModel.waves)
  })

  it('with no tracking service, the plans are the company payload and no overdue plan is named', () => {
    const parts = live()
    parts.tracking = { status: 'off' }
    const { model, regions } = composeModel(parts, options())

    expect(regions.tracking).toEqual({ status: 'off' })
    expect(model.isSample).toBe(false)
    expect(model.plans).toEqual({ open: 4, overdue: 0, overdueNodo: null })
    expect(model.attention.map((item) => item.kind)).toEqual(['lowest-cell', 'low-participation'])
  })

  it('names no plan for the lowest cell when none in its department is live', () => {
    const parts = live()
    parts.actionPlans = {
      status: 'live',
      value: { plans: plans().filter((candidate) => candidate.departmentId !== 'd-ops'), covering: null },
    }
    const { model } = composeModel(parts, options())

    expect(model.attention[0]).toEqual({ kind: 'lowest-cell', plan: null })
  })

  it('draws no participation item once the open survey is past half its audience', () => {
    const parts = live()
    parts.surveys = {
      status: 'live',
      value: surveys().map((survey) => (survey.id === 'sv-q4' ? { ...survey, responseCount: 12 } : survey)),
    }
    const { model } = composeModel(parts, options())

    expect(model.openSurvey?.responses).toBe(12)
    expect(model.attention.some((item) => item.kind === 'low-participation')).toBe(false)
  })
})

describe('the derivations', () => {
  it('reads the wave code out of a title, and keeps the title when there is none', () => {
    expect(waveCode('Q3 Climate Survey', 'x')).toBe('Q3')
    expect(waveCode('Encuesta de Clima Q1 2027', 'x')).toBe('Q1 2027')
    expect(waveCode('q2-2026 pulse', 'x')).toBe('Q2 2026')
    expect(waveCode('Pulse of the week', 'x')).toBe('Pulse of the week')
    expect(waveCode(null, 'abcd1234')).toBe('abcd1234')
  })

  it('calls a plan overdue past its date and not done, and nothing else', () => {
    expect(isOverdue({ cumplido: false, fechaCompromiso: '2026-09-09' }, ASOF)).toBe(true)
    expect(isOverdue({ cumplido: false, fechaCompromiso: '2026-09-10' }, ASOF)).toBe(false)
    expect(isOverdue({ cumplido: false, fechaCompromiso: '2026-09-11' }, ASOF)).toBe(false)
    expect(isOverdue({ cumplido: true, fechaCompromiso: '2026-08-20' }, ASOF)).toBe(false)
  })

  it('prefers the plan whose title names the dimension, ignores settled ones, and needs the department', () => {
    const cell = { row: { departmentId: 'd-ops', name: 'Operaciones', responses: 5, scores: [2.4] }, dimensionKey: 'workload', score: 2.4 }
    expect(coveringPlan(plans(), cell, 'Workload')?.id).toBe('ap-ops')
    // Without a title match the soonest due live plan in the department wins.
    expect(coveringPlan(plans(), { ...cell, dimensionKey: 'trust' }, 'Trust')?.id).toBe('ap-lunch')
    expect(coveringPlan(plans(), { ...cell, row: { ...cell.row, departmentId: 'd-none' } }, 'Workload')).toBeNull()
  })

  it('averages the objectives for progress, and has none without objectives', () => {
    expect(planProgress(covering())).toBe(25)
    expect(planProgress({ ...covering(), objectives: [] })).toBe(0)
    expect(planProgress(null)).toBe(0)
  })

  it('never lets a protected row be the lowest cell, however low its scores', () => {
    const { model } = composeModel(live(), options())
    const withProtected = {
      ...model,
      map: {
        ...model.map,
        rows: [{ departmentId: 'd-tiny', name: 'Tiny', responses: 3, scores: [1.0, 1.0] }, ...model.map.rows],
      },
    }
    expect(lowestCell(withProtected, 5)).toMatchObject({ dimensionKey: 'workload', score: 2.4 })
    expect(lowestCell(withProtected, 5)?.row.name).toBe('Operaciones')
  })
})
