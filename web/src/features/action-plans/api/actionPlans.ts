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

export async function listActionPlans(baseUrl: string, companyId: string): Promise<ActionPlan[]> {
  const response = await authFetch(`${baseUrl}/action-plans?companyId=${companyId}`)
  const body = (await response.json()) as { actionPlans: ActionPlan[] }
  return body.actionPlans
}

export async function createActionPlan(baseUrl: string, input: CreateActionPlanInput): Promise<ActionPlanDetail> {
  const response = await authFetch(`${baseUrl}/action-plans`, {
    method: 'POST',
    body: JSON.stringify(input),
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
    body: JSON.stringify(input),
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
