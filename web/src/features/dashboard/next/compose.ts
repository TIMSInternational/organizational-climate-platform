import type { ActionPlan, ActionPlanDetail } from '../../action-plans/api/actionPlans'
import type { Microclimate, MicroclimateDetail } from '../../microclimates/api/microclimates'
import { WHOLE_COMPANY_KEY, type ClimateTrendsResponse } from '../../surveys/api/climateTrends'
import type { SurveyInvitationList } from '../../surveys/api/surveyDistribution'
import type { SurveyDetail, SurveyListItem } from '../../surveys/api/surveys'
import type { PlanAccion } from '../../tracking/api/trackingApi'
import type { CompanyAdminDashboard } from '../api/dashboard'
import { daysBetween, lowestCell, type MapCell } from './derive'
import type {
  AdminDashboardModel,
  AttentionItem,
  DimensionSeries,
  MapRow,
  OpenSurvey,
  PlanRef,
  RegionKey,
  RegionState,
  RegionStatuses,
  Wave,
} from './model'

/**
 * The composition of the Panel de Control's model from the existing clients' payloads.
 *
 * Pure: `loadModel.ts` fetches and hands the parts in, so every rule here is unit-tested
 * against fixtures shaped like the payloads the local API was observed to return
 * (`compose.test.ts`), and the page never sees a number this file did not derive.
 *
 * ## Regions, and the sample as the fallback
 *
 * Each region below is one existing client, and each fails on its own. A region that
 * fell back takes the sample's fields for that region and nothing else, `isSample`
 * turns on, and the page names the region — so a tenant whose tracking service is down
 * still reads its own climate, and the sample never stands in silently.
 *
 * | Region          | Client                                            | Fields                                                |
 * |-----------------|---------------------------------------------------|-------------------------------------------------------|
 * | `company`       | `GET /dashboard/company-admin`                    | `companyName`; `plans` when tracking is off           |
 * | `surveys`       | `GET /surveys`                                    | `waves`, `latestClosedWave`, `previousWave`, `openSurvey`, `participation.responses`, the participation item |
 * | `trends`        | `GET /surveys/climate-trends`                     | `dimensions`, `participation.completed`               |
 * | `map`           | `GET /surveys/climate-trends?groupBy=department`  | `map` (the latest closed wave, one row per department)|
 * | `actionPlans`   | `GET /action-plans`, `GET /action-plans/{id}`     | the plan covering the lowest cell                     |
 * | `tracking`      | tracking `GET /api/planes-accion` + the pickers   | `plans` when tracking is on, the overdue-plan item    |
 * | `microclimates` | `GET /microclimates`, `GET /microclimates/{id}`   | `liveMicroclimate`                                    |
 * | (column order)  | `GET /surveys/{latest closed id}`                 | the map's column order: the order that survey asks its dimensions |
 * | (reminders)     | `GET /surveys/{open id}/invitations`              | `remindersSent` on the participation item             |
 *
 * The last two are enrichments, not regions: neither carries a number the page could
 * mistake, so a failed read changes no chip — the map keeps the server's column order,
 * and the participation item says nothing about reminders.
 *
 * ## Why the map reads the trends endpoint and not `/surveys/{id}/results`
 *
 * `/results` carries the per-question half only — no rows by department — and
 * `/analytics` carries segments as per-question averages that would have to be reduced
 * by category here. `climate-trends?groupBy=department` is that reduction, done by the
 * server with the floor applied and suppression arriving as data; the two conventions
 * `climateTrendsMap.ts` inherits from the results screen hold here too: a withheld row
 * keeps its row (empty scores), and a dimension survives only if every disclosed row
 * has a score for it.
 *
 * ## What no endpoint carries
 *
 * A climate target: `CLIMATE_TARGET` is the mockup's 3.7 until a setting exists.
 * Reminders are read from the open survey's invitations (`reminderCount`, summed); when
 * that read fails the item carries `remindersSent: null` and the page says nothing about
 * reminders rather than "none sent".
 */

/** The climate target on the 1–5 scale. No endpoint carries one; this is the mockup's. */
export const CLIMATE_TARGET = 3.7

// How a reading is tinted and worded against the target — `targetStep` and
// `targetStanding` in `derive.ts` — is judged at the printed decimal with the canvas's
// bands; every cell and chip on the Panel de Control and Clima en el tiempo reads it.

/** One region's payload, or the reason it has none. */
export type Part<T> =
  | { status: 'live'; value: T }
  | { status: 'fallback'; reason: 'failed'; error: string | null }
  | { status: 'fallback'; reason: 'empty' }
  | { status: 'off' }

export interface ActionPlansPart {
  plans: readonly ActionPlan[]
  /** The detail of the plan covering the lowest cell, once `loadModel.ts` has fetched it. */
  covering: ActionPlanDetail | null
}

export interface TrackingPart {
  planes: readonly PlanAccion[]
  nodoNames: ReadonlyMap<string, string>
  personaNames: ReadonlyMap<string, string>
}

export interface MicroclimatesPart {
  list: readonly Microclimate[]
  /** The detail of the live one — the list item carries no close time. */
  live: MicroclimateDetail | null
}

export interface ModelParts {
  company: Part<CompanyAdminDashboard>
  surveys: Part<readonly SurveyListItem[]>
  trends: Part<ClimateTrendsResponse>
  map: Part<ClimateTrendsResponse>
  actionPlans: Part<ActionPlansPart>
  tracking: Part<TrackingPart>
  microclimates: Part<MicroclimatesPart>
  /**
   * The categories of the latest closed survey's questions, in the order it asks them
   * (`GET /surveys/{id}`, `questionOrderOf`) — the map's column order. Absent or failed,
   * the map keeps the server's order.
   */
  questionOrder?: Part<readonly string[]>
  /**
   * Reminders sent for the open survey, summed from its invitations' `reminderCount`
   * (`GET /surveys/{id}/invitations`, `remindersOf`). Absent or failed, the item says
   * nothing about reminders — "ningún recordatorio" would be a claim nobody read.
   */
  reminders?: Part<number>
}

export interface ComposeOptions {
  /** ISO date the model is read at; overdue and days-to-close are judged against it. */
  asOf: string
  floor: number
  /** The display name of a dimension key, from the reader's catalogue. */
  dimensionName: (key: string) => string
  sample: AdminDashboardModel
}

export interface ComposedModel {
  model: AdminDashboardModel
  regions: RegionStatuses
}

/** "Q3" out of "Q3 Climate Survey", "Q1 2027" out of "Encuesta de Clima Q1 2027". */
const WAVE_CODE = /\bQ[1-4](?:[\s-]+\d{4})?\b/i

/** The short code a wave is discussed in, or the title itself when it carries none. */
export function waveCode(title: string | null, fallback: string): string {
  const match = title?.match(WAVE_CODE)
  if (match) return match[0].replace(/[\s-]+/, ' ').toUpperCase()
  const trimmed = title?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : fallback
}

/** Past its commitment date and not marked done. Judged on calendar days, in `asOf`'s terms. */
export function isOverdue(plan: Pick<PlanAccion, 'cumplido' | 'fechaCompromiso'>, asOf: string): boolean {
  return !plan.cumplido && daysBetween(asOf, plan.fechaCompromiso) < 0
}

/** A plan that is over: nothing it says covers anything any more. */
const SETTLED_PLAN_STATUSES: ReadonlySet<string> = new Set(['completed', 'cancelled'])

/**
 * The action plan covering the lowest cell: the same department, still live, and
 * preferring one whose title names the dimension — "Reduce the workload in Operations"
 * for Operaciones × workload. Among equals, the one due soonest.
 */
export function coveringPlan(
  plans: readonly ActionPlan[],
  cell: MapCell,
  dimensionName: string,
): ActionPlan | null {
  const candidates = plans.filter(
    (plan) => plan.departmentId === cell.row.departmentId && !SETTLED_PLAN_STATUSES.has(plan.status),
  )
  if (candidates.length === 0) return null
  const needles = [dimensionName, cell.dimensionKey]
    .map((needle) => needle.trim().toLowerCase())
    .filter((needle) => needle.length > 0)
  const named = candidates.filter((plan) => {
    const title = plan.title.toLowerCase()
    return needles.some((needle) => title.includes(needle))
  })
  const pool = named.length > 0 ? named : candidates
  return [...pool].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
}

/** The mean completion of a plan's objectives, 0–100; a plan with none has no progress. */
export function planProgress(detail: ActionPlanDetail | null): number {
  if (!detail || detail.objectives.length === 0) return 0
  const total = detail.objectives.reduce((sum, objective) => sum + objective.completionPercentage, 0)
  return Math.max(0, Math.min(100, total / detail.objectives.length))
}

function toWave(survey: SurveyListItem): Wave {
  const code = waveCode(survey.title, survey.id.slice(0, 8))
  const name = survey.title?.trim() || code
  if (survey.status === 'closed') return { id: survey.id, code, name, status: 'closed', closedAt: survey.endDate }
  if (survey.status === 'active') return { id: survey.id, code, name, status: 'open', closesAt: survey.endDate }
  return { id: survey.id, code, name, status: 'planned' }
}

/** The rail: the last three closed waves, every open one, and the next planned one. */
const CLOSED_WAVES_ON_RAIL = 3

/** Closed surveys by close date, oldest first. An archived survey is never one. */
function closedByClose(surveys: readonly SurveyListItem[]): SurveyListItem[] {
  return surveys
    .filter((survey) => survey.status === 'closed')
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
}

/** Open surveys, the one closing soonest first. */
function openByClose(surveys: readonly SurveyListItem[]): SurveyListItem[] {
  return surveys
    .filter((survey) => survey.status === 'active')
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
}

/** The latest closed survey — the wave the tiles and the map read — or `null`. */
export function latestClosedSurvey(surveys: readonly SurveyListItem[]): SurveyListItem | null {
  const closed = closedByClose(surveys)
  return closed[closed.length - 1] ?? null
}

/** The open survey the page reports on — the one closing soonest — or `null`. */
export function currentOpenSurvey(surveys: readonly SurveyListItem[]): SurveyListItem | null {
  return openByClose(surveys)[0] ?? null
}

/**
 * The dimensions a survey asks, in question order, each once: the map's column order.
 * The Dashboard artboard's columns — Seguridad psicológica, Carga de trabajo, Confianza,
 * Reconocimiento, Desarrollo, Pertenencia — are exactly the order the tenant's Q3 asks
 * them (read on `GET /surveys/{id}`, 10 Sep); the trends payload lists them by key.
 */
export function questionOrderOf(survey: Pick<SurveyDetail, 'questions'>): string[] {
  const order: string[] = []
  for (const question of [...survey.questions].sort((a, b) => a.order - b.order)) {
    if (question.category && !order.includes(question.category)) order.push(question.category)
  }
  return order
}

/** Reminders sent for a survey: every invitation's `reminderCount` (attempts), summed. */
export function remindersOf(list: Pick<SurveyInvitationList, 'invitations'>): number {
  return list.invitations.reduce((sum, invitation) => sum + invitation.reminderCount, 0)
}

interface SurveysRegion {
  waves: Wave[]
  latestClosedWave: Wave
  previousWave: Wave | null
  openSurvey: OpenSurvey | null
  latest: SurveyListItem
}

function composeSurveys(surveys: readonly SurveyListItem[]): SurveysRegion | null {
  const kept = surveys.filter((survey) => survey.status !== 'archived')
  const closed = closedByClose(kept)
  const latest = closed[closed.length - 1]
  if (latest === undefined) return null
  const open = openByClose(kept)
  const planned = kept
    .filter((survey) => survey.status !== 'closed' && survey.status !== 'active')
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 1)
  const waves = [...closed.slice(-CLOSED_WAVES_ON_RAIL), ...open, ...planned].map(toWave)
  const latestClosedWave = toWave(latest)
  const previous = closed[closed.length - 2]
  const first = open[0]
  return {
    waves,
    latestClosedWave,
    previousWave: previous ? toWave(previous) : null,
    openSurvey: first
      ? {
          id: first.id,
          code: waveCode(first.title, first.id.slice(0, 8)),
          name: first.title?.trim() || waveCode(first.title, first.id.slice(0, 8)),
          responses: first.responseCount,
          audience: first.targetAudienceCount ?? 0,
          closesAt: first.endDate,
        }
      : null,
    latest,
  }
}

/** The whole-company series over the closed, disclosed waves, oldest first. */
function composeDimensions(
  trends: ClimateTrendsResponse,
  dimensionName: (key: string) => string,
): DimensionSeries[] {
  const closedIndexes = trends.surveys
    .map((survey, index) => ({ survey, index }))
    .filter(({ survey }) => survey.status === 'closed' && !survey.isSuppressed)
    .map(({ index }) => index)
  const group = trends.groups.find((candidate) => candidate.key === WHOLE_COMPANY_KEY) ?? trends.groups[0]
  if (group === undefined || closedIndexes.length === 0) return []
  return trends.dimensions.map((dimension, dimensionIndex) => ({
    key: dimension.key,
    name: dimensionName(dimension.key),
    values: closedIndexes
      .map((index) => group.points[index]?.scores[dimensionIndex])
      .filter((value): value is number => typeof value === 'number'),
  }))
}

/**
 * One row per department for one survey — the latest closed wave — by the results
 * screen's rules, its columns in `order` (the survey's question order) when it is known.
 */
function composeMap(
  grouped: ClimateTrendsResponse,
  latestClosedId: string | null,
  order: readonly string[] | null,
): AdminDashboardModel['map'] {
  let index = latestClosedId === null ? -1 : grouped.surveys.findIndex((survey) => survey.surveyId === latestClosedId)
  if (index < 0) index = grouped.surveys.map((survey) => survey.status).lastIndexOf('closed')
  if (index < 0) return { dimensionKeys: [], rows: [] }
  const points = grouped.groups.flatMap((group) => {
    const point = group.points[index]
    return point === undefined ? [] : [{ group, point }]
  })
  const disclosed = points.filter(({ point }) => !point.isSuppressed)
  const kept = grouped.dimensions
    .map((dimension, dimensionIndex) => ({ key: dimension.key, dimensionIndex }))
    .filter(
      ({ dimensionIndex }) =>
        disclosed.length > 0 && disclosed.every(({ point }) => point.scores[dimensionIndex] !== null),
    )
  // The survey's question order; a dimension it does not name keeps the server's place,
  // after the named ones.
  const rank = (key: string) => {
    const at = order?.indexOf(key) ?? -1
    return at === -1 ? Number.MAX_SAFE_INTEGER : at
  }
  const columns = [...kept].sort((a, b) => rank(a.key) - rank(b.key) || a.dimensionIndex - b.dimensionIndex)
  const rows: MapRow[] = points.map(({ group, point }) => ({
    departmentId: group.key,
    name: group.label ?? group.key,
    // The server's own count, untouched: 0 for a withheld row, which is what hatches it.
    responses: point.respondentCount,
    scores: point.isSuppressed ? [] : columns.map(({ dimensionIndex }) => point.scores[dimensionIndex] as number),
  }))
  return { dimensionKeys: columns.map(({ key }) => key), rows }
}

function toRegionState(part: Part<unknown>): RegionState {
  if (part.status === 'live') return { status: 'live' }
  if (part.status === 'off') return { status: 'off' }
  return part.reason === 'failed' ? { status: 'fallback', reason: 'failed', error: part.error } : part
}

const EMPTY: Part<never> = { status: 'fallback', reason: 'empty' }

export function composeModel(parts: ModelParts, options: ComposeOptions): ComposedModel {
  const { sample, asOf, floor, dimensionName } = options
  const statuses: Record<RegionKey, RegionState> = {
    company: toRegionState(parts.company),
    surveys: toRegionState(parts.surveys),
    trends: toRegionState(parts.trends),
    map: toRegionState(parts.map),
    actionPlans: toRegionState(parts.actionPlans),
    tracking: toRegionState(parts.tracking),
    microclimates: toRegionState(parts.microclimates),
  }

  // company
  const company = parts.company.status === 'live' ? parts.company.value : null
  const companyName = company?.companyName ?? sample.companyName

  // surveys
  const surveys = parts.surveys.status === 'live' ? composeSurveys(parts.surveys.value) : null
  if (parts.surveys.status === 'live' && surveys === null) statuses.surveys = toRegionState(EMPTY)
  const waves = surveys?.waves ?? sample.waves
  const latestClosedWave = surveys?.latestClosedWave ?? sample.latestClosedWave
  const previousWave = surveys ? surveys.previousWave : sample.previousWave
  const openSurvey = surveys ? surveys.openSurvey : sample.openSurvey

  // trends
  const trends = parts.trends.status === 'live' ? parts.trends.value : null
  const dimensions = trends ? composeDimensions(trends, dimensionName) : sample.dimensions
  if (trends && dimensions.every((dimension) => dimension.values.length === 0)) statuses.trends = toRegionState(EMPTY)
  const trendsDimensions = statuses.trends.status === 'live' ? dimensions : sample.dimensions
  const completedOnWire = trends?.surveys.find((survey) => survey.surveyId === latestClosedWave.id)?.completedCount
  const participation = surveys
    ? { responses: surveys.latest.responseCount, completed: completedOnWire ?? surveys.latest.responseCount }
    : sample.participation

  // map
  const grouped = parts.map.status === 'live' ? parts.map.value : null
  const questionOrder = parts.questionOrder?.status === 'live' ? parts.questionOrder.value : null
  const map = grouped ? composeMap(grouped, surveys ? surveys.latestClosedWave.id : null, questionOrder) : sample.map
  if (grouped && map.rows.length === 0) statuses.map = toRegionState(EMPTY)
  const mapOrSample = statuses.map.status === 'live' ? map : sample.map

  // plans: one source per deployment, matching the nav — tracking when it is on.
  const tracking = parts.tracking.status === 'live' ? parts.tracking.value : null
  const overduePlanes = tracking
    ? [...tracking.planes].filter((plan) => isOverdue(plan, asOf)).sort((a, b) => a.fechaCompromiso.localeCompare(b.fechaCompromiso))
    : []
  const mostOverdue = overduePlanes[0]
  const plans: AdminDashboardModel['plans'] = tracking
    ? {
        open: tracking.planes.filter((plan) => !plan.cumplido).length,
        overdue: overduePlanes.length,
        overdueNodo: mostOverdue ? (tracking.nodoNames.get(mostOverdue.nodoExternalId) ?? mostOverdue.nodoExternalId) : null,
      }
    : parts.tracking.status === 'fallback'
      ? sample.plans
      : company
        ? { open: company.openActionPlanCount, overdue: company.overdueActionPlanCount, overdueNodo: null }
        : sample.plans

  // attention
  const attention: AttentionItem[] = []
  const partial: AdminDashboardModel = {
    ...sample,
    dimensions: trendsDimensions,
    map: mapOrSample,
  }
  const cell = lowestCell(partial, floor)
  if (cell) {
    if (parts.actionPlans.status === 'live') {
      const { plans: candidates, covering } = parts.actionPlans.value
      const candidate = coveringPlan(candidates, cell, dimensionName(cell.dimensionKey))
      const plan: PlanRef | null = candidate
        ? {
            id: candidate.id,
            name: covering && covering.id === candidate.id ? covering.title : candidate.title,
            progress: covering && covering.id === candidate.id ? planProgress(covering) : 0,
          }
        : null
      attention.push({ kind: 'lowest-cell', plan })
    } else {
      const sampleItem = sample.attention.find((item) => item.kind === 'lowest-cell')
      attention.push({ kind: 'lowest-cell', plan: sampleItem?.kind === 'lowest-cell' ? sampleItem.plan : null })
    }
  }
  if (tracking) {
    if (mostOverdue) {
      attention.push({
        kind: 'overdue-plan',
        nodo: tracking.nodoNames.get(mostOverdue.nodoExternalId) ?? mostOverdue.nodoExternalId,
        plan: {
          id: mostOverdue.id,
          name: mostOverdue.descripcionQue,
          progress: mostOverdue.porcentajeAvance,
          owner: tracking.personaNames.get(mostOverdue.responsableEjecucionExternalId),
          dueAt: mostOverdue.fechaCompromiso,
        },
      })
    }
  } else if (parts.tracking.status === 'fallback') {
    const sampleItem = sample.attention.find((item) => item.kind === 'overdue-plan')
    if (sampleItem) attention.push(sampleItem)
  }
  if (surveys) {
    const open = surveys.openSurvey
    if (open && (open.audience <= 0 || open.responses / open.audience < 0.5)) {
      attention.push({
        kind: 'low-participation',
        surveyId: open.id,
        remindersSent: parts.reminders?.status === 'live' ? parts.reminders.value : null,
      })
    }
  } else {
    const sampleItem = sample.attention.find((item) => item.kind === 'low-participation')
    if (sampleItem) attention.push(sampleItem)
  }

  // the live microclimate
  const micro = parts.microclimates.status === 'live' ? parts.microclimates.value : null
  const active = micro?.list.find((item) => item.status === 'active')
  const liveMicroclimate = micro
    ? active && micro.live && micro.live.id === active.id
      ? {
          id: active.id,
          name: active.title?.trim() || active.id.slice(0, 8),
          responses: active.responseCount,
          closesAt: micro.live.endTime,
        }
      : null
    : sample.liveMicroclimate

  const regions: RegionStatuses = statuses
  const isSample = Object.values(regions).some((region) => region.status === 'fallback')
  return {
    model: {
      isSample,
      asOf,
      companyName,
      target: CLIMATE_TARGET,
      latestClosedWave,
      previousWave,
      openSurvey,
      participation,
      dimensions: trendsDimensions,
      waves,
      map: mapOrSample,
      plans,
      attention,
      liveMicroclimate,
    },
    regions,
  }
}
