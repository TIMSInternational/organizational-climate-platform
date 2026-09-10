import { authFetch } from '../../../api/authFetch'

/**
 * `name` and `description` are #210 paired columns, resolved server-side for the
 * requested locale -- never `nameEn`/`nameEs` on the wire. A bare string on write is
 * attributed to the company's language (or the author's own for a global row) and is never
 * refused; `{ en, es }` is the explicit form, accepted by the same field. See
 * `docs/decisions/author-content-i18n.md`.
 */
export interface ActionPlanTemplate {
  id: string
  name: string
  description: string
  category: string
  companyId: string | null
  tags: string[]
  usageCount: number
  isActive: boolean
  /** Fields that had to reach for the other language, e.g. `name`. Always sent since #210. */
  fallbackFields?: string[]
}

export interface CreateActionPlanTemplateInput {
  name: string
  description: string
  category: string
  companyId?: string
  tags?: string[]
}

/**
 * `lang` rides along so `name` and `description` come back in the reader's language.
 * Without it the server resolved for its own fallback, and the create form's template
 * picker offered the English half of every bilingual name on a Spanish screen.
 */
export async function listActionPlanTemplates(
  baseUrl: string,
  companyId: string,
  lang?: string,
): Promise<ActionPlanTemplate[]> {
  const query = lang ? `&lang=${encodeURIComponent(lang)}` : ''
  const response = await authFetch(`${baseUrl}/action-plan-templates?companyId=${companyId}${query}`)
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
