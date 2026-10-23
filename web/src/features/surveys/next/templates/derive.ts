import type { SurveyTemplateDetail, SurveyTemplateListItem } from '../../api/surveyTemplates'

/**
 * Pure rules behind the Templates artboard (`/surveys/templates`): the category facets and
 * their counts, the order ("ordenadas por uso"), and what a template's questions declare —
 * its dimensions and its scale — read from `GET /survey-templates/{id}`, since the list item
 * carries only a `questionCount`.
 */

/** The categories the artboard always offers, even at zero; any other on the wire is added. */
export const KNOWN_CATEGORIES: readonly string[] = ['climate', 'pulse', 'engagement', 'exit']

export function categoriesOf(templates: readonly SurveyTemplateListItem[]): string[] {
  const extra = [...new Set(templates.map((template) => template.category))].filter((category) => !KNOWN_CATEGORIES.includes(category)).sort()
  return [...KNOWN_CATEGORIES, ...extra]
}

export function countByCategory(templates: readonly SurveyTemplateListItem[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const template of templates) counts.set(template.category, (counts.get(template.category) ?? 0) + 1)
  return counts
}

/** Most used first; ties by name, so the order is stable between loads. */
export function byUsage(templates: readonly SurveyTemplateListItem[], locale: string): SurveyTemplateListItem[] {
  return [...templates].sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name, locale))
}

export interface TemplateShape {
  /** Distinct question categories, in question order — the template's dimensions. */
  dimensions: string[]
  /** The one Likert range every question shares, or `null` when they differ or none is Likert. */
  likert: { min: number; max: number } | null
}

export function shapeOf(detail: Pick<SurveyTemplateDetail, 'questions'>): TemplateShape {
  const questions = [...detail.questions].sort((a, b) => a.order - b.order)
  const dimensions = [...new Set(questions.flatMap((question) => (question.category ? [question.category] : [])))]
  const first = questions[0]
  const shared =
    first !== undefined &&
    first.type === 'likert' &&
    first.scaleMin !== null &&
    first.scaleMax !== null &&
    questions.every((question) => question.type === 'likert' && question.scaleMin === first.scaleMin && question.scaleMax === first.scaleMax)
  return { dimensions, likert: shared ? { min: first.scaleMin as number, max: first.scaleMax as number } : null }
}

/**
 * The client mirror of `SurveyTemplateEndpoints.CanWriteTemplate`: a super administrator writes
 * any template; a company administrator only a template of their own company — never a GLOBAL
 * one, which every tenant reads. The server refuses the rest with 403 whatever this says; this
 * only decides whether "Editar" and "Eliminar" are drawn.
 */
export function canWriteTemplate(
  claims: { role?: string; companyId?: string },
  template: Pick<SurveyTemplateListItem, 'companyId' | 'isGlobal'>,
): boolean {
  if (claims.role === 'super_admin') return true
  if (claims.role !== 'company_admin') return false
  return !template.isGlobal && template.companyId !== null && claims.companyId !== undefined && template.companyId === claims.companyId
}

/**
 * The half of a localized name or description the reader is looking at, so an edit writes back
 * to that half and leaves the other language alone. The detail is read in `requested`; a field
 * listed in `fallbackFields` was printed from the OTHER language.
 */
export function editedHalf(field: 'name' | 'description', requested: 'en' | 'es', fallbackFields: readonly string[]): 'en' | 'es' {
  if (!fallbackFields.includes(field)) return requested
  return requested === 'es' ? 'en' : 'es'
}
