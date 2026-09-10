import { getActionPlan, listActionPlans } from '../../action-plans/api/actionPlans'
import { getMicroclimate, listMicroclimates } from '../../microclimates/api/microclimates'
import { DEPARTMENT_GROUP, getClimateTrends } from '../../surveys/api/climateTrends'
import { listSurveys } from '../../surveys/api/surveys'
import { listPlanesAccion } from '../../tracking/api/trackingApi'
import { getNodoNames, listPersonaOptions } from '../../tracking/api/trackingPickers'
import { getCompanyAdminDashboard } from '../api/dashboard'
import {
  composeModel,
  coveringPlan,
  type ActionPlansPart,
  type ComposedModel,
  type MicroclimatesPart,
  type Part,
  type TrackingPart,
} from './compose'
import { lowestCell } from './derive'
import { sampleModel } from './sampleModel'

/**
 * The reads behind the Panel de Control — every one of them an existing client, no new
 * endpoint — settled region by region so one failure costs one region (`compose.ts`).
 *
 * Two passes over `composeModel`: the plan covering the lowest cell needs the map before
 * it can be chosen, and its progress lives on the plan's detail, so the first pass finds
 * the cell, one detail request follows, and the second pass carries it.
 */
export interface LoadDeps {
  baseUrl: string
  /** `null` when this deployment has no tracking service (`isTrackingEnabled`). */
  trackingBaseUrl: string | null
  /** A SuperAdmin's selection. A CompanyAdmin sends none; the server scopes by claim. */
  companyId?: string
  lang: string
  asOf: string
  floor: number
  dimensionName: (key: string) => string
}

async function settle<T>(work: () => Promise<T>): Promise<Part<T>> {
  try {
    return { status: 'live', value: await work() }
  } catch (err) {
    return { status: 'fallback', reason: 'failed', error: err instanceof Error ? err.message : null }
  }
}

async function loadTracking(trackingBaseUrl: string, baseUrl: string, tenant: string): Promise<TrackingPart> {
  const [planes, nodoNames, personas] = await Promise.all([
    listPlanesAccion(trackingBaseUrl),
    getNodoNames(tenant, baseUrl),
    listPersonaOptions(tenant, baseUrl),
  ])
  return { planes, nodoNames, personaNames: new Map(personas.map((persona) => [persona.id, persona.name])) }
}

async function loadMicroclimates(baseUrl: string, tenant: string, lang: string): Promise<MicroclimatesPart> {
  const list = await listMicroclimates(baseUrl, tenant, lang)
  const active = list.find((item) => item.status === 'active')
  const live = active ? await getMicroclimate(baseUrl, active.id, lang) : null
  return { list, live }
}

export async function loadAdminDashboard(deps: LoadDeps): Promise<ComposedModel> {
  const { baseUrl, companyId, lang } = deps
  const [company, surveys, trends, map] = await Promise.all([
    settle(() => getCompanyAdminDashboard(baseUrl, { companyId, lang })),
    settle(() => listSurveys(baseUrl, { companyId }, lang)),
    settle(() => getClimateTrends(baseUrl, { companyId, lang })),
    settle(() => getClimateTrends(baseUrl, { groupBy: DEPARTMENT_GROUP, companyId, lang })),
  ])

  // The scoped clients need the tenant by id. A SuperAdmin named it; a CompanyAdmin's
  // comes back on the company payload — and when that failed, everything scoped by it
  // inherits the failure rather than guessing a tenant.
  const tenant = company.status === 'live' ? company.value.companyId : companyId
  const inherited: Part<never> =
    company.status === 'fallback' ? company : { status: 'fallback', reason: 'failed', error: null }

  const [plans, tracking, microclimates] = await Promise.all([
    tenant ? settle(() => listActionPlans(baseUrl, tenant, {}, lang)) : Promise.resolve(inherited),
    deps.trackingBaseUrl === null
      ? Promise.resolve<Part<TrackingPart>>({ status: 'off' })
      : tenant
        ? settle(() => loadTracking(deps.trackingBaseUrl as string, baseUrl, tenant))
        : Promise.resolve(inherited),
    tenant ? settle(() => loadMicroclimates(baseUrl, tenant, lang)) : Promise.resolve(inherited),
  ])

  let actionPlans: Part<ActionPlansPart> =
    plans.status === 'live' ? { status: 'live', value: { plans: plans.value, covering: null } } : plans
  const options = { asOf: deps.asOf, floor: deps.floor, dimensionName: deps.dimensionName, sample: sampleModel }
  const parts = { company, surveys, trends, map, tracking, microclimates }

  const first = composeModel({ ...parts, actionPlans }, options)
  if (actionPlans.status === 'live') {
    const cell = lowestCell(first.model, deps.floor)
    const candidate = cell ? coveringPlan(actionPlans.value.plans, cell, deps.dimensionName(cell.dimensionKey)) : null
    if (candidate) {
      const detail = await settle(() => getActionPlan(baseUrl, candidate.id, lang))
      actionPlans =
        detail.status === 'live'
          ? { status: 'live', value: { plans: actionPlans.value.plans, covering: detail.value } }
          : detail
    }
  }
  return composeModel({ ...parts, actionPlans }, options)
}
