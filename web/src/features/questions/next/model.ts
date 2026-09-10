import type { QuestionCategory, QuestionLibraryItem } from '../api/questionLibrary'
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
 * The category tree, split by owner: global rows (every tenant reads them, a company never
 * writes them) and the caller's own. A child whose parent is not in the payload is shown
 * at the top level rather than dropped.
 */
export function categoryTree(
  categories: QuestionCategory[],
  items: QuestionLibraryItem[],
): { globals: CategoryNode[]; own: CategoryNode[] } {
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
    own: roots.filter((node) => node.category.companyId !== null),
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
