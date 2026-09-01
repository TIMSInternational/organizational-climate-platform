import { authFetch } from '../../../api/authFetch'

/**
 * The question BANK — the curation surface behind `/admin/question-bank` (#110, #114).
 *
 * ## This is not the question library
 *
 * `questionLibrary.ts` sits beside this file and reaches a different set of tables.
 * `QuestionBankEndpoints.cs` and #58 both say it outright: "They do not overlap in
 * purpose and must not be merged." The LIBRARY is the authoring repository — a real
 * category hierarchy, a dimension, bilingual by construction, read by the picker inside
 * both wizards. The BANK is the curation repository — cross-corpus usage and
 * effectiveness, industry and company-size targeting, alternate phrasings under one
 * lineage, and a flat string `category` with a `subcategory` beside it.
 *
 * So nothing here calls `/admin/question-library` and nothing there calls these routes.
 * The two clients are deliberately separate for the same reason the two endpoint files
 * are.
 *
 * ## Monolingual, and inherited rather than chosen
 *
 * A bank item holds ONE authored string plus a `language` saying which language it is in
 * — never `both`. Legacy `QuestionBank.text` was one column, and a second phrasing is a
 * VARIATION rather than a translation, which is what `/{id}/variations` is for. That is
 * why nothing on this surface takes a `LocalizedInput`, unlike every other authoring
 * shape in this codebase.
 *
 * ## Every metric is derived at read time
 *
 * `usageCount`, `responseRate` and `insightScore` are COUNTs over
 * `questions`/`responses`/`question_responses`, taken when an admin asks. Nothing a
 * respondent does writes a row in these tables. A stale-looking number therefore means
 * "nobody has re-measured", not "the counter is broken" — `measureEffectiveness` is the
 * re-measure.
 *
 * ## Retirement, not deletion
 *
 * `setLifecycle` is the removal this API offers. A question that has been asked of real
 * respondents has to stay resolvable for as long as their answers do (#106), so
 * `DELETE` is refused once an item has been instantiated and the lifecycle response
 * reports `instantiatedQuestionCount` precisely so the UI can say why.
 */

/** The two lifecycle states, from `QuestionBankLifecycleStates.All`. */
export const QUESTION_BANK_LIFECYCLE_STATES = ['active', 'retired'] as const

export type QuestionBankLifecycleState = (typeof QUESTION_BANK_LIFECYCLE_STATES)[number]

/**
 * The types a bank item may have — `QuestionRepositoryTypes.Supported`, which is
 * `QuestionTypes.ForSurvey ∩ ForMicroclimate`, ordinally sorted as the server sorts it.
 *
 * **Narrower than `SURVEY_QUESTION_TYPES`**, and the difference is load-bearing: `ranking`
 * is a survey type and NOT a repository type, so a picker offering the survey list would
 * let an author choose one value the create endpoint answers 400 for. A repository item
 * has to be instantiable into either surface, which is what the intersection means.
 */
export const QUESTION_BANK_TYPES = [
  'likert',
  'multiple_choice',
  'open_ended',
  'rating',
  'yes_no',
] as const

export type QuestionBankType = (typeof QUESTION_BANK_TYPES)[number]

/** An option on a bank item: the stable value aggregation joins on, plus its label. */
export interface QuestionBankOption {
  order: number
  value: string
  label: string | null
}

/**
 * A row of `GET /admin/question-bank`.
 *
 * `text` is nullable on the wire because the row stores it in whichever of `text_en` /
 * `text_es` its `language` names, and the resolver returns null rather than inventing a
 * translation when the requested locale has none.
 */
export interface QuestionBankItem {
  id: string
  /** `null` is a GLOBAL row, readable by every tenant and writable only by a super admin. */
  companyId: string | null
  text: string | null
  language: string
  type: string
  category: string
  subcategory: string | null
  industry: string | null
  companySize: string | null
  usageCount: number
  /** Percentage, 0 when the question has never been asked. */
  responseRate: number
  insightScore: number
  lastUsedAt: string | null
  isActive: boolean
  isAiGenerated: boolean
  version: number
  parentQuestionBankItemId: string | null
  tags: string[]
}

/** `GET /admin/question-bank/{id}` — the row plus the scale bounds and options it omits. */
export interface QuestionBankItemDetail extends QuestionBankItem {
  scaleMin: number | null
  scaleMax: number | null
  scaleLabelMin: string | null
  scaleLabelMax: string | null
  variationCount: number
  createdAt: string
  updatedAt: string
  options: QuestionBankOption[]
}

/**
 * The derived numbers for one item.
 *
 * `timesAsked` counts COMPLETED responses only, deliberately: a respondent who abandoned
 * a survey on page one never saw question nine, and counting them would report an
 * effective question as a skipped one.
 */
export interface QuestionBankMetrics {
  questionBankItemId: string
  surveysUsedIn: number
  questionsCreated: number
  timesAsked: number
  timesAnswered: number
  responseRate: number
  /** The complement of `responseRate`. Carried separately because it is what an author acts on. */
  skipRate: number
  averageTimeSpentSeconds: number | null
  lastUsedAt: string | null
}

export interface QuestionBankEffectivenessItem {
  questionBankItemId: string
  text: string | null
  language: string
  category: string
  subcategory: string | null
  isActive: boolean
  metrics: QuestionBankMetrics
}

/** A row of `GET /admin/question-bank/categories` — counted server-side, never stored. */
export interface QuestionBankCategoryCount {
  category: string
  subcategory: string | null
  itemCount: number
  activeItemCount: number
}

export interface QuestionBankLifecycleResult {
  id: string
  state: string
  /**
   * How many survey questions were copied from this item. Reported on the transition
   * because it is the number that makes retirement rather than deletion the right answer.
   */
  instantiatedQuestionCount: number
  updatedAt: string
}

/**
 * Server-side filters on the list endpoint.
 *
 * `includeRetired` is the one that matters for a curation screen: the default list is
 * ACTIVE only, so a page that never sends it can show an admin the corpus while hiding
 * exactly the rows they came to review.
 */
export interface QuestionBankFilters {
  category?: string
  subcategory?: string
  type?: string
  industry?: string
  companySize?: string
  tag?: string
  search?: string
  includeRetired?: boolean
  companyId?: string
}

export interface CreateQuestionBankItemInput {
  text: string
  type: string
  category: string
  companyId?: string | null
  subcategory?: string
  language?: string
  scaleMin?: number
  scaleMax?: number
  scaleLabelMin?: string
  scaleLabelMax?: string
  industry?: string
  companySize?: string
  tags?: string[]
}

/**
 * `companyId`, `type` and `language` are absent on purpose, mirroring
 * `UpdateQuestionBankItemRequest`: companyId decides who may write the row, type decides
 * how every answer to an instantiated copy is encoded, and language names which column
 * the text is in. Changing any of them through an update is a different operation wearing
 * an update's clothes.
 */
export interface UpdateQuestionBankItemInput {
  text: string
  category: string
  subcategory?: string
  scaleMin?: number
  scaleMax?: number
  scaleLabelMin?: string
  scaleLabelMax?: string
  industry?: string
  companySize?: string
  isActive?: boolean
  tags?: string[]
}

function withQuery(url: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value)
  }
  const query = search.toString()
  return query === '' ? url : `${url}?${query}`
}

/**
 * The corpus, filtered.
 *
 * `filters` last and optional, per the house rule a prior bug earned: an optional
 * parameter ahead of a required one silently reorders every call site.
 */
export async function listQuestionBankItems(
  baseUrl: string,
  filters: QuestionBankFilters = {},
): Promise<{ items: QuestionBankItem[]; total: number }> {
  const response = await authFetch(
    withQuery(`${baseUrl}/admin/question-bank`, {
      category: filters.category,
      subcategory: filters.subcategory,
      type: filters.type,
      industry: filters.industry,
      companySize: filters.companySize,
      tag: filters.tag,
      search: filters.search,
      includeRetired: filters.includeRetired ? 'true' : undefined,
      companyId: filters.companyId,
    }),
  )
  const body = (await response.json()) as { items: QuestionBankItem[]; total: number }
  return { items: body.items, total: body.total }
}

/** The full item, including the scale bounds and options the list projection drops. */
export async function getQuestionBankItem(
  baseUrl: string,
  id: string,
): Promise<QuestionBankItemDetail> {
  const response = await authFetch(`${baseUrl}/admin/question-bank/${id}`)
  return response.json() as Promise<QuestionBankItemDetail>
}

export async function listQuestionBankCategories(
  baseUrl: string,
  companyId?: string,
): Promise<QuestionBankCategoryCount[]> {
  const response = await authFetch(
    withQuery(`${baseUrl}/admin/question-bank/categories`, { companyId }),
  )
  const body = (await response.json()) as { categories: QuestionBankCategoryCount[] }
  return body.categories
}

/**
 * The effectiveness read-out for the whole corpus.
 *
 * Separate from the list because the list's `responseRate` is one number and this is the
 * whole derivation behind it — asked, answered, skipped, average seconds. A curation
 * decision made on the rate alone cannot tell "nobody answers this" from "nobody has
 * been asked this yet", and those need opposite actions.
 */
export async function listQuestionBankEffectiveness(
  baseUrl: string,
  companyId?: string,
): Promise<QuestionBankEffectivenessItem[]> {
  const response = await authFetch(
    withQuery(`${baseUrl}/admin/question-bank/effectiveness`, { companyId }),
  )
  const body = (await response.json()) as { items: QuestionBankEffectivenessItem[] }
  return body.items
}

/** The derived numbers for ONE item, for a row the reader has opened. */
export async function getQuestionBankMetrics(
  baseUrl: string,
  id: string,
): Promise<QuestionBankMetrics> {
  const response = await authFetch(`${baseUrl}/admin/question-bank/${id}/metrics`)
  return response.json() as Promise<QuestionBankMetrics>
}

export async function createQuestionBankItem(
  baseUrl: string,
  input: CreateQuestionBankItemInput,
): Promise<QuestionBankItemDetail> {
  const response = await authFetch(`${baseUrl}/admin/question-bank`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<QuestionBankItemDetail>
}

export async function updateQuestionBankItem(
  baseUrl: string,
  id: string,
  input: UpdateQuestionBankItemInput,
): Promise<QuestionBankItemDetail> {
  const response = await authFetch(`${baseUrl}/admin/question-bank/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<QuestionBankItemDetail>
}

/**
 * Retire an item, or bring a retired one back.
 *
 * This is the only removal on this surface — see the module note. The response carries
 * `instantiatedQuestionCount` so the page can tell the admin how many live survey
 * questions were copied from the row they just withdrew.
 */
export async function setQuestionBankLifecycle(
  baseUrl: string,
  id: string,
  state: QuestionBankLifecycleState,
): Promise<QuestionBankLifecycleResult> {
  const response = await authFetch(`${baseUrl}/admin/question-bank/${id}/lifecycle`, {
    method: 'PUT',
    body: JSON.stringify({ state }),
  })
  return response.json() as Promise<QuestionBankLifecycleResult>
}
