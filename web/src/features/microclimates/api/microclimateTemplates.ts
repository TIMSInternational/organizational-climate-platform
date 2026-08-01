import { authFetch } from '../../../api/authFetch'

export interface MicroclimateTemplate {
  id: string
  name: string
  description: string
  category: string
  companyId: string | null
  isSystemTemplate: boolean
  usageCount: number
  isActive: boolean
}

export interface CreateMicroclimateTemplateInput {
  name: string
  description: string
  category: string
  companyId?: string
}

export async function listMicroclimateTemplates(baseUrl: string, companyId: string): Promise<MicroclimateTemplate[]> {
  const response = await authFetch(`${baseUrl}/microclimate-templates?companyId=${companyId}`)
  const body = (await response.json()) as { templates: MicroclimateTemplate[] }
  return body.templates
}

export async function createMicroclimateTemplate(baseUrl: string, input: CreateMicroclimateTemplateInput): Promise<MicroclimateTemplate> {
  const response = await authFetch(`${baseUrl}/microclimate-templates`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<MicroclimateTemplate>
}
