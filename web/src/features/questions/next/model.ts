import type { QuestionCategory, QuestionLibraryItem } from '../api/questionLibrary'
import { questionTypeLabel } from '../../surveys/surveyVocabulary'
import type { QuestionBankEffectivenessItem, QuestionBankItem, QuestionBankMetrics } from '../api/questionBank'

/**
 * Banco de preguntas and Biblioteca de preguntas, redesigned, as data.
 *
 * Every figure is computed from `GET /admin/question-categories`, `GET /admin/question-library`,
 * `GET /admin/question-bank` and `GET /admin/question-bank/effectiveness`; neither screen has
 * a sample region.
 */

export interface CategoryNode {
  category: QuestionCategory
  /** Questions filed under this category and every category under it. */
  count: number
  children: CategoryNode[]
}

/**
 * What a company's library may draw: the global rows and the viewer's own company's rows.
 * Another tenant's category or question is dropped before anything is counted or drawn —
 * whatever the payload carries. With no company in scope only the global rows remain.
 */
export function libraryForCompany(
  categories: QuestionCategory[],
  items: QuestionLibraryItem[],
  companyId: string | undefined,
): { categories: QuestionCategory[]; items: QuestionLibraryItem[] } {
  const visible = (row: { companyId: string | null }) =>
    row.companyId === null || (companyId !== undefined && companyId !== '' && row.companyId === companyId)
  return {
    categories: categories.filter(visible),
    items: items.filter(visible),
  }
}

/**
 * The category tree, split by owner: global rows (every tenant reads them, a company never
 * writes them) and the viewer's own company's. Rows of any other company are dropped first
 * (`libraryForCompany`), so a rival tenant's category never reaches either list or a count. A
 * child whose parent is not in the payload is shown at the top level rather than dropped.
 */
export function categoryTree(
  allCategories: QuestionCategory[],
  allItems: QuestionLibraryItem[],
  companyId: string | undefined,
): { globals: CategoryNode[]; own: CategoryNode[] } {
  const { categories, items } = libraryForCompany(allCategories, allItems, companyId)
  const direct = new Map<string, number>()
  for (const item of items) direct.set(item.questionCategoryId, (direct.get(item.questionCategoryId) ?? 0) + 1)
  const byId = new Map(categories.map((c) => [c.id, c]))
  const sorted = [...categories].sort((a, b) => a.order - b.order || a.nameEn.localeCompare(b.nameEn))

  const build = (category: QuestionCategory): CategoryNode => {
    const children = sorted.filter((c) => c.parentCategoryId === category.id).map(build)
    return {
      category,
      children,
      count: (direct.get(category.id) ?? 0) + children.reduce((sum, child) => sum + child.count, 0),
    }
  }
  const roots = sorted.filter((c) => !c.parentCategoryId || !byId.has(c.parentCategoryId)).map(build)
  return {
    globals: roots.filter((node) => node.category.companyId === null),
    own: roots.filter((node) => node.category.companyId !== null && node.category.companyId === companyId),
  }
}

export function flattenTree(nodes: CategoryNode[]): CategoryNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)])
}

/** What the bank's intro block says about the library: its global questions and categories. */
export function globalLibraryTotals(categories: QuestionCategory[], items: QuestionLibraryItem[]) {
  return {
    questions: items.filter((item) => item.companyId === null).length,
    categories: categories.filter((category) => category.companyId === null).length,
  }
}

export const LOW_RESPONSE_RATE = 60
export const MIN_ASKINGS_FOR_A_VERDICT = 5

/**
 * "Requiere atención": asked at least five times and answered by fewer than 60 %. With
 * fewer askings a rate says nothing, so no verdict is printed.
 */
export function needsAttention(metrics: QuestionBankMetrics | undefined): boolean {
  if (!metrics || metrics.timesAsked < MIN_ASKINGS_FOR_A_VERDICT) return false
  return metrics.responseRate < LOW_RESPONSE_RATE
}

export interface BankRow {
  item: QuestionBankItem
  /** `null` when the effectiveness read has no row for this item — shown as a dash. */
  asked: number | null
  answered: number | null
  skipped: number | null
  attention: boolean
}

export function bankRows(items: QuestionBankItem[], effectiveness: QuestionBankEffectivenessItem[]): BankRow[] {
  const byItem = new Map(effectiveness.map((row) => [row.questionBankItemId, row.metrics]))
  return items.map((item) => {
    const metrics = byItem.get(item.id)
    return {
      item,
      asked: metrics ? metrics.timesAsked : null,
      answered: metrics ? metrics.timesAnswered : null,
      skipped: metrics ? Math.max(0, metrics.timesAsked - metrics.timesAnswered) : null,
      attention: needsAttention(metrics),
    }
  })
}

/** Search a library row in both languages, case- and accent-insensitively. */
export function matchesSearch(item: QuestionLibraryItem, query: string): boolean {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const q = fold(query.trim())
  if (!q) return true
  return fold(item.textEs).includes(q) || fold(item.textEn).includes(q)
}

/**
 * The library's name for a question type. The boards print "Valoración" for `rating`, where
 * the survey vocabulary says "Calificación"; every other type keeps the shared name.
 */
export function libraryTypeLabel(t: Parameters<typeof questionTypeLabel>[0], type: string): string {
  return type === 'rating' ? t('questionLibrary.next.ratingType') : questionTypeLabel(t, type)
}

/** One option per line, the same text in both languages — the previous page's rule (`pages/QuestionLibraryPage.tsx`). */
export function parseOptions(raw: string): { labelEn: string; labelEs: string }[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => ({ labelEn: line, labelEs: line }))
}

/**
 * The words for a dimension or a bank category code (`psychological_safety`, `leadership`…).
 *
 * The product's own catalogue first (`surveyRespond.dimensions`, the one the respond form and
 * results read), then the library's (`questionLibrary.dimensionNames`). A value the catalogues
 * do not know is printed as authored when it reads as words (`Comunicación interna`,
 * `Liderazgo`); when it is shaped like a machine code — lowercase ASCII, one token or
 * snake_case — it is left out (`null`), so a Spanish screen never prints an English slug.
 */
export function dimensionName(code: string | null | undefined, t: (key: string) => string): string | null {
  const value = code?.trim() ?? ''
  if (value === '') return null
  for (const path of [`surveyRespond.dimensions.${value}`, `questionLibrary.dimensionNames.${value}`]) {
    const label = t(path)
    if (label !== path) return label
  }
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value) ? null : value
}
