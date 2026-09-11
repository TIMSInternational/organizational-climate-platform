import { describe, it, expect } from 'vitest'
import {
  composeLeaderDashboard,
  composeSupervisorDashboard,
  countFloor,
  dimensionMove,
  dimensionStanding,
  flooredCount,
  teamClosedWave,
  teamOpenSurveys,
  type TrackingRead,
} from './compose'
import { ORGANIZATION_SAMPLE } from './sampleModel'
import type { DashboardTeamClimate, DepartmentAdminDashboard } from '../../api/dashboard'
import type { MySurveyListItem } from '../../../surveys/api/surveys'
import type { PlanAccion, TableroResponse } from '../../../tracking/api/trackingApi'

const DEPARTMENT = 'd-ing'
const KEYS = ['belonging', 'growth', 'psychological_safety', 'recognition', 'trust', 'workload']
const AS_OF = '2026-09-11T15:00:00.000Z'
const VIEWER = { personaExternalId: 'me', name: 'Sofía Vargas' }

function climate(scores: readonly (number | null)[], overrides: Partial<DashboardTeamClimate> = {}): DashboardTeamClimate {
  return {
    surveyId: 'q3',
    surveyTitle: 'Encuesta de Clima Q3',
    surveyEndDate: '2026-08-06T02:05:22.922+00:00',
    respondentCount: 6,
    isSuppressed: false,
    minimumGroupSize: 5,
    dimensions: KEYS.map((dimension, index) => ({ dimension, averageScore: scores[index] ?? null })),
    ...overrides,
  }
}

function department(overrides: Partial<DepartmentAdminDashboard> = {}): DepartmentAdminDashboard {
  return {
    departmentId: DEPARTMENT,
    departmentName: 'Ingeniería',
    companyId: 'c1',
    memberCount: 14,
    activeMemberCount: 14,
    activeSurveyCount: 1,
    completedResponseCount: 22,
    openActionPlanCount: 1,
    overdueActionPlanCount: 0,
    activeSurveys: [
      {
        id: 'q4',
        title: 'Encuesta de Clima Q4 (abierta)',
        status: 'active',
        startDate: '2026-09-03T02:03:39.148+00:00',
        endDate: '2026-10-10T02:03:39.148+00:00',
        responseCount: 3,
      },
    ],
    climate: climate([4.33, 4.17, 4, 3.5, 4, 3.67]),
    ...overrides,
  }
}

function plan(overrides: Partial<PlanAccion> = {}): PlanAccion {
  return {
    id: 'p2',
    planCode: 'PA-2026-00002',
    nodoExternalId: DEPARTMENT,
    liderExternalId: '',
    hallazgoExternalId: null,
    descripcionQue: 'Publicar el rol de fines de semana',
    metodologiaComo: 'Calendario compartido.',
    responsableEjecucionExternalId: 'someone',
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

function leader(overrides: { department?: DepartmentAdminDashboard; tablero?: TrackingRead<TableroResponse> | null } = {}) {
  return composeLeaderDashboard({
    department: overrides.department ?? department(),
    organization: ORGANIZATION_SAMPLE,
    tablero: overrides.tablero === undefined ? { status: 'off' } : overrides.tablero,
    trackingOn: true,
    viewer: VIEWER,
    asOf: AS_OF,
    target: 3.7,
  })
}

const mine: MySurveyListItem = {
  id: 'q4',
  title: 'Encuesta de Clima Q4 (abierta)',
  description: null,
  type: 'periodic',
  startDate: '2026-09-03T02:03:39.148+00:00',
  endDate: '2026-10-10T02:03:39.148+00:00',
  questionCount: 6,
  anonymous: false,
  timeLimitMinutes: null,
}

function supervisor(
  overrides: {
    department?: DepartmentAdminDashboard
    mySurveys?: MySurveyListItem[] | null
    misTareas?: TrackingRead<PlanAccion[]>
    mayRecord?: (plan: { nodoExternalId: string }) => boolean
  } = {},
) {
  return composeSupervisorDashboard({
    department: overrides.department ?? department(),
    mySurveys: overrides.mySurveys === undefined ? [mine] : overrides.mySurveys,
    misTareas: overrides.misTareas ?? { status: 'ok', value: [plan()] },
    trackingOn: true,
    mayRecord: overrides.mayRecord ?? (() => false),
    viewer: VIEWER,
    asOf: AS_OF,
  })
}

describe('the floor', () => {
  it('holds a count to the server floor and never below 5', () => {
    expect(countFloor(null)).toBe(5)
    expect(countFloor(climate([], { minimumGroupSize: 3 }))).toBe(5)
    expect(countFloor(climate([], { minimumGroupSize: 7 }))).toBe(7)
    expect(flooredCount(4, 5)).toBeNull()
    expect(flooredCount(5, 5)).toBe(5)
    // An absent count is not zero: zero is under the floor too, and prints nothing.
    expect(flooredCount(0, 5)).toBeNull()
  })

  it("withholds the open survey's team count under the floor, and keeps it at or over", () => {
    const [open] = teamOpenSurveys(department(), 5, AS_OF)
    expect(open?.responses).toBeNull()
    const over = department()
    over.activeSurveys[0] = { ...over.activeSurveys[0]!, responseCount: 5 }
    expect(teamOpenSurveys(over, 5, AS_OF)[0]?.responses).toBe(5)
  })

  it('orders the open surveys soonest close first and counts the days to the UTC close day', () => {
    const two = department({
      activeSurveys: [
        { id: 'late', title: 'B', status: 'active', startDate: '', endDate: '2026-10-10T02:03:39Z', responseCount: 9 },
        { id: 'soon', title: 'A', status: 'active', startDate: '', endDate: '2026-09-20T00:00:00Z', responseCount: 9 },
      ],
    })
    const open = teamOpenSurveys(two, 5, '2026-09-11T15:00:00')
    expect(open.map((survey) => survey.id)).toEqual(['soon', 'late'])
    expect(open[1]?.daysLeft).toBe(29)
  })
})

describe('the team against the organisation', () => {
  it('is null when the company has never closed a survey', () => {
    expect(teamClosedWave(null, ORGANIZATION_SAMPLE)).toBeNull()
  })

  it("reads the team's disclosed means beside the organisation's, keyed by dimension", () => {
    const wave = teamClosedWave(climate([4.33, 4.17, 4, 3.5, 4, 3.67]), ORGANIZATION_SAMPLE)!
    expect(wave.code).toBe('Q3')
    expect(wave.respondents).toBe(6)
    expect(wave.withheld).toBe(false)
    expect(wave.dimensions.find((d) => d.key === 'psychological_safety')).toEqual({
      key: 'psychological_safety',
      team: 4,
      organization: 3.75,
    })
  })

  it('draws no organisation bar for a dimension the sample has no value for, rather than borrowing one', () => {
    const wave = teamClosedWave(
      { ...climate([]), dimensions: [{ dimension: 'autonomy', averageScore: 4.1 }] },
      ORGANIZATION_SAMPLE,
    )!
    expect(wave.dimensions[0]).toEqual({ key: 'autonomy', team: 4.1, organization: null })
  })

  it('withholds every number of a withheld reading — scores, the organisation beside them, the count', () => {
    const wave = teamClosedWave(climate([null, null, null, null, null, null], { isSuppressed: true, respondentCount: 0 }), ORGANIZATION_SAMPLE)!
    expect(wave.withheld).toBe(true)
    expect(wave.surveyWithheld).toBe(false)
    expect(wave.respondents).toBeNull()
    expect(wave.dimensions.every((d) => d.team === null && d.organization === null)).toBe(true)
  })

  it('withholds a reading the server marked disclosed when its own count is under the floor', () => {
    const wave = teamClosedWave(climate([4, 4, 4, 4, 4, 4], { respondentCount: 3 }), ORGANIZATION_SAMPLE)!
    expect(wave.withheld).toBe(true)
    expect(wave.respondents).toBeNull()
    expect(wave.dimensions.every((d) => d.team === null)).toBe(true)
  })

  /**
   * The live stack's "(Copia)" was archived on 9 Sep with an end date of 10 Oct: "cerró el 10
   * oct" would be a sentence about a day that has not come.
   */
  it('prints no close date that is still ahead of the reader', () => {
    const archivedEarly = climate([], { surveyEndDate: '2026-10-10T02:03:39Z', isSuppressed: true, respondentCount: 0, dimensions: [] })
    expect(teamClosedWave(archivedEarly, ORGANIZATION_SAMPLE, AS_OF)?.closedOn).toBeNull()
    expect(teamClosedWave(climate([4]), ORGANIZATION_SAMPLE, AS_OF)?.closedOn).toBe('2026-08-06T02:05:22.922+00:00')
  })

  it('knows a survey under its own floor has no names to hatch', () => {
    const wave = teamClosedWave(climate([], { isSuppressed: true, respondentCount: 0, dimensions: [] }), ORGANIZATION_SAMPLE)!
    expect(wave.surveyWithheld).toBe(true)
    expect(wave.dimensions).toEqual([])
  })

  /**
   * Seguridad psicológica, as the artboard draws it: 4,00 against 3,75 prints 4,0 and 3,8,
   * and the move is their difference, +0,2 — never the rounded raw 0,25 (+0,3).
   */
  it('moves by the difference of the printed readings', () => {
    expect(dimensionMove({ key: 'psychological_safety', team: 4, organization: 3.75 })).toBeCloseTo(0.2, 10)
    expect(dimensionMove({ key: 'belonging', team: 4.33, organization: 4 })).toBeCloseTo(0.3, 10)
    expect(dimensionMove({ key: 'recognition', team: 3.17, organization: 3.38 })).toBeCloseTo(-0.2, 10)
    expect(dimensionMove({ key: 'x', team: null, organization: 3.75 })).toBeNull()
    expect(dimensionMove({ key: 'x', team: 4, organization: null })).toBeNull()
  })

  it('stands each reading by the one target rule every screen uses', () => {
    expect(dimensionStanding({ key: 'a', team: 3.17, organization: null }, 3.7)).toBe('below')
    expect(dimensionStanding({ key: 'a', team: 3.5, organization: null }, 3.7)).toBe('on')
    expect(dimensionStanding({ key: 'a', team: 3.67, organization: null }, 3.7)).toBe('on')
    expect(dimensionStanding({ key: 'a', team: 4.33, organization: null }, 3.7)).toBe('above')
    expect(dimensionStanding({ key: 'a', team: null, organization: 4 }, 3.7)).toBeNull()
  })
})

describe("the leader's model", () => {
  it('takes the headcount unfloored and the organisation count only beside a drawn reading', () => {
    const model = leader()
    expect(model.memberCount).toBe(14)
    expect(model.openSurveyCount).toBe(1)
    expect(model.organizationRespondents).toBe(24)
    expect(model.organizationIsSample).toBe(true)
    const withheld = leader({
      department: department({ climate: climate([null, null, null, null, null, null], { isSuppressed: true, respondentCount: 0 }) }),
    })
    expect(withheld.organizationRespondents).toBeNull()
  })

  it("lists the board's open plans, nearest compromiso first, and counts the overdue ones", () => {
    const model = leader({
      tablero: {
        status: 'ok',
        value: {
          nodoExternalId: DEPARTMENT,
          conteos: { rojo: 1, amarillo: 0, verde: 2 },
          planes: [
            plan({ id: 'later', planCode: 'PA-3', fechaCompromiso: '2026-10-01' }),
            plan({ id: 'late', planCode: 'PA-1', fechaCompromiso: '2026-09-01', estadoSemaforo: 'Rojo' }),
            plan({ id: 'done', planCode: 'PA-0', cumplido: true }),
          ],
        },
      },
    })
    expect(model.plans.source).toBe('tracking')
    if (model.plans.source !== 'tracking') return
    expect(model.plans.plans.map((p) => p.id)).toEqual(['late', 'later'])
    expect(model.plans.open).toBe(2)
    expect(model.plans.overdue).toBe(1)
    expect(model.plans.plans[0]?.overdue).toBe(true)
    expect(model.plans.plans[0]?.nodoName).toBe('Ingeniería')
    expect(model.plans.plans[0]?.daysToDue).toBe(-10)
  })

  it("counts the department's action plans when there is no board, and waits for one in flight", () => {
    expect(leader({ tablero: { status: 'off' } }).plans).toEqual({ source: 'counts', open: 1, overdue: 0 })
    expect(leader({ tablero: null }).plans).toEqual({ source: 'loading' })
    expect(leader({ tablero: { status: 'failed', error: 'boom' } }).plans).toEqual({ source: 'failed', error: 'boom' })
  })

  it('names a responsable only when it is the reader, since no directory answers this role', () => {
    const model = leader({
      tablero: {
        status: 'ok',
        value: { nodoExternalId: DEPARTMENT, conteos: { rojo: 0, amarillo: 0, verde: 2 }, planes: [plan({ responsableEjecucionExternalId: 'me' }), plan({ id: 'b' })] },
      },
    })
    if (model.plans.source !== 'tracking') throw new Error('expected a board')
    expect(model.plans.plans.map((p) => p.responsable)).toEqual([
      { name: 'Sofía Vargas', isViewer: true },
      { name: null, isViewer: false },
    ])
  })
})

describe("the supervisor's model", () => {
  it('hides who answered under the floor, and who has not for as long', () => {
    const model = supervisor()
    expect(model.openSurvey?.id).toBe('q4')
    expect(model.responded).toBeNull()
    expect(model.remaining).toBeNull()
  })

  it('prints both once the team passes the floor, never a negative remainder', () => {
    const over = department()
    over.activeSurveys[0] = { ...over.activeSurveys[0]!, responseCount: 9 }
    expect(supervisor({ department: over })).toMatchObject({ responded: 9, remaining: 5 })
    const beyond = department({ activeMemberCount: 4 })
    beyond.activeSurveys[0] = { ...beyond.activeSurveys[0]!, responseCount: 6 }
    expect(supervisor({ department: beyond })).toMatchObject({ responded: 6, remaining: 0 })
  })

  it('lists the surveys she owes and the plans she executes, soonest first', () => {
    expect(supervisor().tasks).toEqual([
      { kind: 'follow-plan', id: 'p2', code: 'PA-2026-00002', dueOn: '2026-09-15' },
      { kind: 'answer-survey', id: 'q4', name: 'Encuesta de Clima Q4 (abierta)', dueOn: '2026-10-10T02:03:39.148+00:00' },
    ])
  })

  it('asks to record progress only where the capability allows it', () => {
    const tasks = supervisor({ mayRecord: () => true }).tasks
    expect(tasks[0]).toEqual({ kind: 'record-progress', id: 'p2', code: 'PA-2026-00002', firstAvance: true, dueOn: '2026-09-15' })
  })

  it('says the surveys she owes could not be read, and keeps her plans', () => {
    const model = supervisor({ mySurveys: null })
    expect(model.surveysUnread).toBe(true)
    expect(model.tasks.map((task) => task.kind)).toEqual(['follow-plan'])
  })

  it('has no plans to read without a tracking service, and says a failed read failed', () => {
    expect(supervisor({ misTareas: { status: 'off' } }).plans).toEqual({ source: 'off' })
    expect(supervisor({ misTareas: { status: 'failed', error: null } }).plans).toEqual({ source: 'failed', error: null })
  })
})
