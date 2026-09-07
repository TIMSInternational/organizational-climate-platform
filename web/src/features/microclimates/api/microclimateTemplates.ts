import { authFetch } from '../../../api/authFetch'

/**
 * `name` and `description` are #210 paired columns, resolved server-side for the
 * requested locale -- never `nameEn`/`nameEs` on the wire. A bare string on write is
 * attributed to the company's language (or the author's own for a global row) and is never
 * refused; `{ en, es }` is the explicit form, accepted by the same field. See
 * `docs/decisions/author-content-i18n.md`.
 */
export interface MicroclimateTemplate {
  id: string
  name: string
  description: string
  category: string
  companyId: string | null
  isSystemTemplate: boolean
  usageCount: number
  isActive: boolean
  /** Fields that had to reach for the other language, e.g. `name`. Always sent since #210. */
  fallbackFields?: string[]
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
