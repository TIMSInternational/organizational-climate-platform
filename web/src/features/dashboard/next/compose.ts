import type { ActionPlan, ActionPlanDetail } from '../../action-plans/api/actionPlans'
import type { Microclimate, MicroclimateDetail } from '../../microclimates/api/microclimates'
import { WHOLE_COMPANY_KEY, type ClimateTrendsResponse } from '../../surveys/api/climateTrends'
import type { SurveyListItem } from '../../surveys/api/surveys'
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
 * A climate target: `CLIMATE_TARGET` is the mockup's 3.7 until a setting exists. A
 * count of reminders sent: the participation item carries `remindersSent: null` and the
 * page says nothing about reminders rather than "none sent".
 */

/** The climate target on the 1–5 scale. No endpoint carries one; this is the mockup's. */
export const CLIMATE_TARGET = 3.7

/**
 * How a 1–5 reading is tinted against `CLIMATE_TARGET` wherever the product draws a cell,
 * applied to the reading ROUNDED TO THE ONE DECIMAL THE CELL PRINTS: a cell that prints
 * "3,7" beside "meta 3,7" is on target, one that prints "3,8" is above it — the same
 * rule as the "sobre / en / bajo la meta" chips (`surveys/next/trends/derive.ts`
 * `standing`), so a tint never contradicts the word beside it. A full point away
 * saturates. The Panel de Control's map and Clima en el tiempo's table both read these,
 * so one score is one tint on both screens.
 */
export const MAP_DEAD_BAND_AT = 0.05
export const MAP_EXTREME_AT = 1

/** A 1–5 reading at the one decimal every cell prints — what the tint is judged on. */
export function printedReading(value: number): number {
  return Math.round(value * 10) / 10
}

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

interface SurveysRegion {
  waves: Wave[]
  latestClosedWave: Wave
  previousWave: Wave | null
  openSurvey: OpenSurvey | null
  latest: SurveyListItem
}

function composeSurveys(surveys: readonly SurveyListItem[]): SurveysRegion | null {
  const kept = surveys.filter((survey) => survey.status !== 'archived')
  const closed = kept
    .filter((survey) => survey.status === 'closed')
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
  const latest = closed[closed.length - 1]
  if (latest === undefined) return null
  const open = kept
    .filter((survey) => survey.status === 'active')
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
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

/** One row per department for one survey — the latest closed wave — by the results screen's rules. */
function composeMap(grouped: ClimateTrendsResponse, latestClosedId: string | null): AdminDashboardModel['map'] {
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
  const rows: MapRow[] = points.map(({ group, point }) => ({
    departmentId: group.key,
    name: group.label ?? group.key,
    // The server's own count, untouched: 0 for a withheld row, which is what hatches it.
    responses: point.respondentCount,
    scores: point.isSuppressed ? [] : kept.map(({ dimensionIndex }) => point.scores[dimensionIndex] as number),
  }))
  return { dimensionKeys: kept.map(({ key }) => key), rows }
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
  const map = grouped ? composeMap(grouped, surveys ? surveys.latestClosedWave.id : null) : sample.map
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
      attention.push({ kind: 'low-participation', surveyId: open.id, remindersSent: null })
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
