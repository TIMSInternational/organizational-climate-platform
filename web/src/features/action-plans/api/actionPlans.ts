import { authFetch } from '../../../api/authFetch'

export interface Kpi {
  id: string
  name: string
  targetValue: number
  currentValue: number
  unit: string
  measurementFrequency: string
}

export interface Objective {
  id: string
  description: string
  successCriteria: string
  currentStatus: string
  completionPercentage: number
}

export interface ActionPlan {
  id: string
  title: string
  companyId: string
  departmentId: string | null
  dueDate: string
  status: string
  priority: string
  createdAt: string
}

export interface ActionPlanDetail {
  id: string
  title: string
  description: string
  companyId: string
  departmentId: string | null
  createdBy: string
  dueDate: string
  status: string
  priority: string
  tags: string[]
  templateId: string | null
  kpis: Kpi[]
  objectives: Objective[]
}

export interface CreateKpiInput {
  name: string
  targetValue: number
  unit: string
  measurementFrequency: string
}

export interface CreateObjectiveInput {
  description: string
  successCriteria: string
}

export interface CreateActionPlanInput {
  title: string
  description: string
  companyId: string
  departmentId?: string
  dueDate: string
  priority: string
  tags?: string[]
  templateId?: string
  kpis?: CreateKpiInput[]
  objectives?: CreateObjectiveInput[]
}

export interface UpdateActionPlanInput {
  title?: string
  description?: string
  dueDate?: string
  status?: string
  priority?: string
  tags?: string[]
}

export interface KpiUpdateInput {
  kpiId: string
  newValue: number
  notes?: string
}

export interface ObjectiveUpdateInput {
  objectiveId: string
  statusUpdate: string
  completionPercentage?: number
  notes?: string
}

export interface RecordProgressInput {
  overallNotes: string
  kpiUpdates: KpiUpdateInput[]
  objectiveUpdates: ObjectiveUpdateInput[]
}

export interface ProgressUpdateDetail {
  id: string
  updateDate: string
  overallNotes: string
  updatedBy: string
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// `<input type="date">` submits a bare "YYYY-MM-DD". The backend's DueDate is a
// non-nullable DateTimeOffset, and System.Text.Json's DateTimeOffset converter
// treats an offset-less date-only string as midnight in *whatever time zone the
// server process happens to be running in* -- not necessarily UTC. If that ever
// differs from UTC (or simply differs from the viewer's browser time zone), the
// due date a user typed and the due date rendered back to them can be a day
// apart. Making the offset explicit here removes the ambiguity: every
// environment agrees this instant means "midnight UTC on this calendar date",
// which is also what ActionPlanList renders back (see its `timeZone: 'UTC'`
// formatting option).
function normalizeDueDate(dueDate: string): string {
  return DATE_ONLY_PATTERN.test(dueDate) ? `${dueDate}T00:00:00.000Z` : dueDate
}

/**
 * The filters `ActionPlanEndpoints.ListAsync` applies **in the database**.
 *
 * Deliberately only these two. The endpoint's signature is
 * `(Guid companyId, Guid? departmentId, string? status)` and nothing else — there
 * is no priority parameter and no search parameter, so adding either here would
 * put a field on the query string that the server silently ignores, which is worse
 * than not offering it. Those two filters are applied client-side by the list page,
 * which is exact rather than approximate because this endpoint returns the complete
 * result set (no `Take`, no paging) — see `ActionPlanFilters` for the reasoning.
 */
export interface ActionPlanListFilters {
  /** One of `ActionPlanValidation.ValidStatuses`. Empty/undefined means no filter. */
  status?: string
  departmentId?: string
}

export async function listActionPlans(
  baseUrl: string,
  companyId: string,
  filters: ActionPlanListFilters = {},
): Promise<ActionPlan[]> {
  const query = new URLSearchParams({ companyId })
  // Empty strings are dropped rather than sent: the server treats a whitespace
  // status as "no filter" (`IsNullOrWhiteSpace`), but `departmentId` is a
  // `Guid?` and an empty one is a 400 from model binding, not an absent filter.
  if (filters.status) query.set('status', filters.status)
  if (filters.departmentId) query.set('departmentId', filters.departmentId)

  const response = await authFetch(`${baseUrl}/action-plans?${query.toString()}`)
  const body = (await response.json()) as { actionPlans: ActionPlan[] }
  return body.actionPlans
}

export async function createActionPlan(baseUrl: string, input: CreateActionPlanInput): Promise<ActionPlanDetail> {
  const response = await authFetch(`${baseUrl}/action-plans`, {
    method: 'POST',
    body: JSON.stringify({ ...input, dueDate: normalizeDueDate(input.dueDate) }),
  })
  return response.json() as Promise<ActionPlanDetail>
}

export async function getActionPlan(baseUrl: string, id: string): Promise<ActionPlanDetail> {
  const response = await authFetch(`${baseUrl}/action-plans/${id}`)
  return response.json() as Promise<ActionPlanDetail>
}

export async function updateActionPlan(baseUrl: string, id: string, input: UpdateActionPlanInput): Promise<ActionPlanDetail> {
  const response = await authFetch(`${baseUrl}/action-plans/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...input, dueDate: input.dueDate ? normalizeDueDate(input.dueDate) : input.dueDate }),
  })
  return response.json() as Promise<ActionPlanDetail>
}

export async function recordProgress(baseUrl: string, id: string, input: RecordProgressInput): Promise<ProgressUpdateDetail> {
  const response = await authFetch(`${baseUrl}/action-plans/${id}/progress`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<ProgressUpdateDetail>
}
