import type { DashboardTeamClimate, DepartmentAdminDashboard } from '../../api/dashboard'
import type { MySurveyListItem } from '../../../surveys/api/surveys'
import type { PlanAccion, TableroResponse } from '../../../tracking/api/trackingApi'
import { toPercent } from '../../../tracking/semaforo'
import { todayIso } from '../../../tracking/planDates'
import { dayDiff, hasRecordedProgress, isOverdue, type Viewer } from '../../../tracking/next/derive'
import { ANONYMITY_FLOOR, isSuppressed } from '../../../../components/charts/suppression'
import { waveCode } from '../compose'
import { daysUntil } from '../employee/compose'
import { printedMove, printedReading, type TargetStanding } from '../derive'
import type {
  LeaderDashboardModel,
  LeaderPlans,
  SupervisorDashboardModel,
  SupervisorPlans,
  SupervisorTask,
  TeamClosedWave,
  TeamDimension,
  TeamOpenSurvey,
  TeamPlan,
} from './model'

/**
 * Every derived reading on the two team dashboards, as pure functions of the payloads.
 * The pages never carry a computed number as a literal: the artboards' "+0,3 frente a la
 * org.", "bajo la meta 3,7", "menos de 5 respuestas", "30 días" are all outputs of these.
 */

/**
 * One read of the tracking service, as the hook hands it over: `off` when this deployment
 * has no tracking service or this reader has nothing to read there, `failed` with the
 * server's message, or the payload.
 */
export type TrackingRead<T> = { status: 'off' } | { status: 'failed'; error: string | null } | { status: 'ok'; value: T }

/**
 * The floor a count is held to: the server's own `minimumGroupSize` when it sent one, and
 * never lower than `ANONYMITY_FLOOR` — a payload that said 2 would not lower the product's
 * promise, it would be a bug on the wire.
 */
export function countFloor(climate: DashboardTeamClimate | null): number {
  return Math.max(ANONYMITY_FLOOR, climate?.minimumGroupSize ?? 0)
}

/**
 * A count as a page may print it: itself at or over the floor, `null` under it — and `null`
 * for a count the server already withheld (`null` on the wire since fix round 2).
 */
export function flooredCount(count: number | null | undefined, floor: number): number | null {
  if (count === null || count === undefined) return null
  return isSuppressed(count, floor) ? null : count
}

/**
 * The team's latest closed reading beside the organisation's.
 *
 * A withheld reading keeps its dimension NAMES and loses every number — the team's mean,
 * the respondent count (the server zeroes it; a 0 would read "nobody answered"), and the
 * organisation's mean too, because the comparison is the page's subject and half of it
 * cannot be drawn. A survey that fell under its own floor has no names to keep.
 *
 * The organisation's side is the payload's own `climate.organization`, keyed by dimension so
 * a dimension the company block lacks draws no bar rather than a borrowed one. The server
 * sends none when fewer than the floor answered outside the team; the cards then draw the
 * team alone.
 */
export function teamClosedWave(climate: DashboardTeamClimate | null, asOf?: string): TeamClosedWave | null {
  if (climate === null || climate.surveyId === null) return null
  // `surveyEndDate` is the survey's END date, and an archived survey can be archived before
  // it: the live stack's "(Copia)" was archived on 9 Sep with an end date of 10 Oct. "Cerró
  // el 10 oct" would be a sentence about a day that has not come, so a close date after the
  // reader's clock is not printed at all.
  const endsAt = climate.surveyEndDate === null ? Number.NaN : Date.parse(climate.surveyEndDate)
  const closedOn =
    climate.surveyEndDate !== null && !Number.isNaN(endsAt) && (asOf === undefined || endsAt <= Date.parse(asOf))
      ? climate.surveyEndDate
      : null
  const floor = countFloor(climate)
  // Belt and braces: a disclosed reading whose own count is under the floor is withheld
  // here as well. The server never sends one, and a page that trusted it would print it.
  const withheld = climate.isSuppressed || isSuppressed(climate.respondentCount, floor)
  // Half a comparison would give the other half back: beside a withheld reading, no
  // organisation side even if a payload carried one.
  const organization = withheld ? null : (climate.organization ?? null)
  const organizationScores = new Map(
    (organization?.dimensions ?? []).map((score) => [score.dimension, score.averageScore] as const),
  )
  const dimensions: TeamDimension[] = climate.dimensions.map((dimension) => ({
    key: dimension.dimension,
    team: withheld ? null : dimension.averageScore,
    organization: organizationScores.get(dimension.dimension) ?? null,
  }))
  return {
    surveyId: climate.surveyId,
    name: climate.surveyTitle,
    code: waveCode(climate.surveyTitle, '—'),
    closedOn,
    respondents: withheld ? null : climate.respondentCount,
    organizationRespondents: organization === null ? null : organization.respondentCount,
    withheld,
    surveyWithheld: withheld && climate.dimensions.length === 0,
    floor,
    dimensions,
  }
}

/**
 * The move of the team against the organisation AS PRINTED — the difference of the two
 * one-decimal readings, never the rounding of the difference (`derive.printedMove`). The
 * canvas's Seguridad psicológica is 4,00 against 3,75: the raw difference rounds to +0,3
 * beside two numbers a reader subtracts to 0,2. `null` when either side is missing.
 */
export function dimensionMove(dimension: TeamDimension): number | null {
  if (dimension.team === null || dimension.organization === null) return null
  return printedMove(dimension.team, dimension.organization, 1)
}

/**
 * Where the team's reading stands against the target on the leader's card: the side of the
 * target the PRINTED reading falls on, strictly — under 3,7 is "bajo la meta", 3,7 itself is
 * "en la meta", over it "sobre la meta". The LeaderDashboard artboard (10 Sep) draws exactly
 * that: Reconocimiento 3,5 on a red card with "bajo la meta 3,7" and Crear plan, Carga de
 * trabajo 3,7 "en la meta", every 3,8 and up "sobre la meta" — and its legend says why: "un
 * plan nace de la celda que está bajo la meta".
 *
 * The administrator's map TINTS cells in bands (`derive.targetStep`, grey from 3,5 to 3,7): a
 * colour scale over every team at once. This is the plan rule for one team's cell, so the two
 * screens may colour the same 3,5 differently; both print the same number. Judged at the
 * printed decimal, so the word never contradicts the number beside it (3,67 prints 3,7 and is
 * on target). `null` for a withheld reading, which stands nowhere.
 */
export function dimensionStanding(dimension: TeamDimension, target: number): TargetStanding | null {
  if (dimension.team === null) return null
  const tenths = Math.round(printedReading(dimension.team) * 10) - Math.round(printedReading(target) * 10)
  return tenths < 0 ? 'below' : tenths > 0 ? 'above' : 'on'
}

/** The surveys open to the team, soonest close first, each count held to the floor. */
export function teamOpenSurveys(
  department: Pick<DepartmentAdminDashboard, 'activeSurveys'>,
  floor: number,
  asOf: string,
): TeamOpenSurvey[] {
  return [...department.activeSurveys]
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
    .map((survey) => ({
      id: survey.id,
      name: survey.title,
      code: waveCode(survey.title, '—'),
      closesOn: survey.endDate,
      daysLeft: daysUntil(survey.endDate, asOf),
      responses: flooredCount(survey.responseCount, floor),
      company:
        survey.companyResponseCount === undefined
          ? null
          : {
              responses: flooredCount(survey.companyResponseCount, floor),
              target: survey.companyTargetAudienceCount ?? null,
            },
    }))
}

/**
 * A tracking plan as a card line. `today` is the reader's calendar day (`YYYY-MM-DD`), the
 * terms `PlanResponse`'s `DateOnly` fields are in. The node is named only when it is the
 * reader's own department — the `nodoId` claim IS the department's external id
 * (`TrackingIdentifiers.NodoIdClaimForUser`) — and the responsable only when it is the
 * reader: neither a leader nor a supervisor may read the directory
 * (`TrackingPickerEndpoints.cs:19-21`).
 */
export function teamPlan(
  plan: PlanAccion,
  today: string,
  department: { id: string; name: string },
  viewer: Viewer,
): TeamPlan {
  const hasProgress = hasRecordedProgress(plan)
  const isViewer = plan.responsableEjecucionExternalId !== '' && plan.responsableEjecucionExternalId === viewer.personaExternalId
  return {
    id: plan.id,
    code: plan.planCode,
    que: plan.descripcionQue,
    estado: plan.estadoSemaforo,
    percent: toPercent(plan.porcentajeAvance),
    createdOn: plan.fechaCreacion,
    dueOn: plan.fechaCompromiso,
    daysToDue: dayDiff(today, plan.fechaCompromiso),
    hasProgress,
    lastProgressOn: hasProgress ? plan.fechaUltimaActualizacion : null,
    cumplido: plan.cumplido,
    overdue: isOverdue(plan, today),
    nodoExternalId: plan.nodoExternalId,
    nodoName: plan.nodoExternalId === department.id ? department.name : null,
    responsable: { name: isViewer ? viewer.name : null, isViewer },
  }
}

/** Nearest compromiso first, then by code — the tablero's own order. */
function byDue(a: TeamPlan, b: TeamPlan): number {
  const byDate = a.dueOn.localeCompare(b.dueOn)
  return byDate !== 0 ? byDate : a.code.localeCompare(b.code)
}

export interface LeaderInput {
  department: DepartmentAdminDashboard
  /** The leader's own nodo board, or why it was not read; `null` while it is being read. */
  tablero: TrackingRead<TableroResponse> | null
  trackingOn: boolean
  viewer: Viewer
  /** ISO timestamp the model is composed at. */
  asOf: string
  target: number
}

export function composeLeaderDashboard(input: LeaderInput): LeaderDashboardModel {
  const { department, tablero, asOf } = input
  const today = todayIso(new Date(asOf))
  const floor = countFloor(department.climate)
  const closedWave = teamClosedWave(department.climate, asOf)

  let plans: LeaderPlans
  if (tablero === null) {
    plans = { source: 'loading' }
  } else if (tablero.status === 'ok') {
    const open = tablero.value.planes
      .filter((plan) => !plan.cumplido)
      .map((plan) => teamPlan(plan, today, { id: department.departmentId, name: department.departmentName }, input.viewer))
      .sort(byDue)
    plans = { source: 'tracking', plans: open, open: open.length, overdue: open.filter((plan) => plan.overdue).length }
  } else if (tablero.status === 'failed') {
    plans = { source: 'failed', error: tablero.error }
  } else {
    plans = { source: 'counts', open: department.openActionPlanCount, overdue: department.overdueActionPlanCount }
  }

  return {
    asOf,
    departmentId: department.departmentId,
    departmentName: department.departmentName,
    memberCount: department.memberCount,
    activeMemberCount: department.activeMemberCount,
    closedWave,
    openSurveys: teamOpenSurveys(department, floor, asOf),
    openSurveyCount: department.activeSurveyCount,
    floor,
    // The organisation's count belongs with its scores: only beside a reading that is drawn.
    organizationRespondents: closedWave?.organizationRespondents ?? null,
    plans,
    trackingOn: input.trackingOn,
    target: input.target,
  }
}

export interface SupervisorInput {
  department: DepartmentAdminDashboard
  /**
   * `GET /surveys/my` — the surveys she still owes — or `null` when that read failed. Her
   * own self-service list rather than `GET /dashboard/employee`: this page asks ONE role
   * dashboard endpoint, its own, and `/surveys/my` is not one.
   */
  mySurveys: readonly MySurveyListItem[] | null
  /** `GET /api/mis-tareas`, or why it was not read. */
  misTareas: TrackingRead<PlanAccion[]>
  trackingOn: boolean
  /** `viewerCapabilities.canRecordProgress` — decides "registrar" against "seguir". */
  mayRecord: (plan: { nodoExternalId: string }) => boolean
  viewer: Viewer
  asOf: string
}

export function composeSupervisorDashboard(input: SupervisorInput): SupervisorDashboardModel {
  const { department, mySurveys, misTareas, asOf } = input
  const today = todayIso(new Date(asOf))
  const floor = countFloor(department.climate)
  const open = teamOpenSurveys(department, floor, asOf)
  const openSurvey = open[0] ?? null
  const responded = openSurvey?.responses ?? null

  let plans: SupervisorPlans
  if (misTareas.status === 'ok') {
    plans = {
      source: 'tracking',
      plans: misTareas.value
        .filter((plan) => !plan.cumplido)
        .map((plan) => teamPlan(plan, today, { id: department.departmentId, name: department.departmentName }, input.viewer))
        .sort(byDue),
    }
  } else if (misTareas.status === 'failed') {
    plans = { source: 'failed', error: misTareas.error }
  } else {
    plans = { source: 'off' }
  }

  const tasks: SupervisorTask[] = [
    ...(mySurveys ?? []).map(
      (survey): SupervisorTask => ({ kind: 'answer-survey', id: survey.id, name: survey.title, dueOn: survey.endDate }),
    ),
    ...(plans.source === 'tracking' ? plans.plans : []).map(
      (plan): SupervisorTask =>
        input.mayRecord(plan)
          ? { kind: 'record-progress', id: plan.id, code: plan.code, firstAvance: !plan.hasProgress, dueOn: plan.dueOn }
          : { kind: 'follow-plan', id: plan.id, code: plan.code, dueOn: plan.dueOn },
    ),
  ].sort((a, b) => a.dueOn.localeCompare(b.dueOn))

  return {
    asOf,
    departmentId: department.departmentId,
    departmentName: department.departmentName,
    activeMemberCount: department.activeMemberCount,
    openSurvey,
    otherOpenCount: Math.max(0, open.length - 1),
    responded,
    // Never beside a hidden count: the team's size minus "who has not" is "who has".
    remaining: responded === null ? null : Math.max(0, department.activeMemberCount - responded),
    floor,
    plans,
    tasks,
    surveysUnread: mySurveys === null,
    trackingOn: input.trackingOn,
  }
}
