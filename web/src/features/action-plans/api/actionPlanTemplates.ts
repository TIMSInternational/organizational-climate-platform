import { authFetch } from '../../../api/authFetch'

export interface ActionPlanTemplate {
  id: string
  name: string
  description: string
  category: string
  companyId: string | null
  tags: string[]
  usageCount: number
  isActive: boolean
}

export interface CreateActionPlanTemplateInput {
  name: string
  description: string
  category: string
  companyId?: string
  tags?: string[]
}

export async function listActionPlanTemplates(baseUrl: string, companyId: string): Promise<ActionPlanTemplate[]> {
  const response = await authFetch(`${baseUrl}/action-plan-templates?companyId=${companyId}`)
  const body = (await response.json()) as { templates: ActionPlanTemplate[] }
  return body.templates
}

export async function createActionPlanTemplate(baseUrl: string, input: CreateActionPlanTemplateInput): Promise<ActionPlanTemplate> {
  const response = await authFetch(`${baseUrl}/action-plan-templates`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<ActionPlanTemplate>
}
