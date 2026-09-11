import type { QuestionBankItem, QuestionBankMetrics } from '../../api/questionBank'
import type { QuestionCategory, QuestionLibraryItem } from '../../api/questionLibrary'

/**
 * The pure readings behind the redesigned Banco de preguntas (`/admin/question-bank`). Every
 * count on the page comes from `GET /admin/question-bank`, its `/effectiveness` derivation and
 * the library's two reads — nothing is typed and nothing is a sample.
 */

/** `all` — global and every company the caller may read; `global` — owner-less rows only; else a company id. */
export type OwnerFilter = string

export const OWNER_ALL = 'all'
export const OWNER_GLOBAL = 'global'

/**
 * The owner filter, applied to the rows the server already scoped: a super administrator is
 * answered global plus every tenant, a company administrator global plus their own
 * (`QuestionBankEndpoints.cs:141-152`), so this narrows and never widens.
 */
export function filterByOwner(items: readonly QuestionBankItem[], owner: OwnerFilter): QuestionBankItem[] {
  if (owner === OWNER_ALL) return [...items]
  if (owner === OWNER_GLOBAL) return items.filter((item) => item.companyId === null)
  return items.filter((item) => item.companyId === owner)
}

/**
 * "12 preguntas globales en 6 categorías" — the library's global corpus, for the card that
 * states where the bank ends and the library begins. Active rows only: a retired question is
 * not one a wizard offers.
 */
export function librarySummary(
  categories: readonly QuestionCategory[],
  items: readonly QuestionLibraryItem[],
): { questions: number; categories: number } {
  return {
    questions: items.filter((item) => item.companyId === null && item.isActive).length,
    categories: categories.filter((category) => category.companyId === null && category.isActive).length,
  }
}

/**
 * Asked, answered and skipped for one row, from its effectiveness metrics. `timesAsked`
 * counts completed responses only (`questionBank.ts`, `QuestionBankMetrics`), so skipped is
 * the difference — never negative. `null` when no metrics were read for the row: the cell then
 * prints a dash, never a zero that would read as "never asked".
 */
export function askedAnsweredSkipped(
  metrics: QuestionBankMetrics | undefined,
): { asked: number; answered: number; skipped: number } | null {
  if (!metrics) return null
  return {
    asked: metrics.timesAsked,
    answered: metrics.timesAnswered,
    skipped: Math.max(0, metrics.timesAsked - metrics.timesAnswered),
  }
}

/** How a row is scored for the "needs attention" hint, once it has actually been asked. */
export const LOW_RESPONSE_RATE = 60

/** Below this many completed askings, a rate is not yet a signal. */
export const MIN_ASKINGS_FOR_A_VERDICT = 5

/**
 * Whether a row is worth an administrator's attention — the old page's three gates, kept:
 * a retired row is already dealt with, and a rate over too few askings is noise.
 */
export function needsAttention(item: QuestionBankItem, metrics: QuestionBankMetrics | undefined): boolean {
  if (!item.isActive) return false
  if (!metrics || metrics.timesAsked < MIN_ASKINGS_FOR_A_VERDICT) return false
  return metrics.responseRate < LOW_RESPONSE_RATE
}

/**
 * Whether this viewer may write the row — `QuestionBankEndpoints.cs:94-102`: a super
 * administrator any row, a company administrator only a row their own company owns (never a
 * global one). A row the viewer may not write offers no Edit and no Retire.
 */
export function canWriteRow(
  row: { companyId: string | null },
  viewer: { role: string | undefined; companyId: string | undefined },
): boolean {
  if (viewer.role === 'super_admin') return true
  return viewer.role === 'company_admin' && row.companyId !== null && row.companyId === viewer.companyId
}
