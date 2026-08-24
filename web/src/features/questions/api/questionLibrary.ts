import { authFetch } from '../../../api/authFetch'

/**
 * The question LIBRARY and its category tree — the read half of #112, consumed by
 * the shared picker (#115).
 *
 * ## This is not the question bank
 *
 * `QuestionLibraryEndpoints.cs` says it outright and #58 says it twice: the library
 * is the AUTHORING repository (a real category hierarchy, a dimension, version
 * chaining) and the bank (#110) is the CURATION surface (cross-corpus metrics,
 * industry targeting, a flat string category). They do not overlap and must not be
 * merged. Nothing here reaches `/admin/question-bank`.
 *
 * ## Only the reads
 *
 * The endpoints also accept POST and PUT, and this client deliberately does not.
 * The picker's job ends at making an item readable; authoring belongs to the library
 * admin screens (#113/#114), and a write path smuggled in beside a picker is how one
 * component grows two responsibilities.
 */

/** A node of the category tree. `itemCount` is COUNTed server-side, never stored. */
export interface QuestionCategory {
  id: string
  /** `null` is a GLOBAL category, visible to every tenant. */
  companyId: string | null
  parentCategoryId: string | null
  nameEn: string
  nameEs: string
  descriptionEn: string | null
  descriptionEs: string | null
  order: number
  icon: string | null
  color: string | null
  isActive: boolean
  itemCount: number
}

/**
 * A row of `GET /admin/question-library`.
 *
 * Note what is NOT here: `options`, `scaleMin`/`scaleMax` and the four scale-label
 * columns. The list projection omits them, so a `multiple_choice` item copied out of
 * a list row would arrive with no options and be unanswerable. Anything that
 * instantiates an item must read {@link QuestionLibraryItemDetail} first.
 */
export interface QuestionLibraryItem {
  id: string
  companyId: string | null
  questionCategoryId: string
  textEn: string
  textEs: string
  /** One of `QuestionRepositoryTypes.Supported` — the ForSurvey ∩ ForMicroclimate intersection. */
  type: string
  /** `Question.Category` — the raw climate-dimension key, never a display name. */
  dimension: string | null
  usageCount: number
  lastUsedAt: string | null
  isActive: boolean
  version: number
  tags: string[]
}

/** An option on a library item: the stable value aggregation joins on, plus its labels. */
export interface QuestionLibraryOption {
  order: number
  value: string
  labelEn: string | null
  labelEs: string | null
}

/** `GET /admin/question-library/{id}` — the list row plus everything needed to copy it. */
export interface QuestionLibraryItemDetail extends QuestionLibraryItem {
  language: string
  scaleMin: number | null
  scaleMax: number | null
  scaleLabelMinEn: string | null
  scaleLabelMinEs: string | null
  scaleLabelMaxEn: string | null
  scaleLabelMaxEs: string | null
  previousVersionId: string | null
  createdAt: string
  updatedAt: string
  options: QuestionLibraryOption[]
}

/**
 * Server-side filters on the list endpoint.
 *
 * `companyId` is honoured for a SuperAdmin ONLY, and when it is supplied the server
 * answers `i.CompanyId == companyId` — which EXCLUDES the global rows. That is the
 * opposite of what a picker wants, so nothing in this slice passes it; see
 * `visibleToCompany` in `questionLibraryFilter.ts` for how scoping is done instead.
 */
export interface QuestionLibraryFilters {
  categoryId?: string
  type?: string
  dimension?: string
  tag?: string
  companyId?: string
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
 * The category tree the picker browses by.
 *
 * `companyId` last and optional, per the house rule a prior bug earned: an optional
 * parameter ahead of a required one silently reorders every call site.
 */
export async function listQuestionCategories(
  baseUrl: string,
  companyId?: string,
): Promise<QuestionCategory[]> {
  const response = await authFetch(
    withQuery(`${baseUrl}/admin/question-categories`, { companyId }),
  )
  const body = (await response.json()) as { categories: QuestionCategory[] }
  return body.categories
}

export async function listQuestionLibraryItems(
  baseUrl: string,
  filters: QuestionLibraryFilters = {},
): Promise<QuestionLibraryItem[]> {
  const response = await authFetch(
    withQuery(`${baseUrl}/admin/question-library`, {
      categoryId: filters.categoryId,
      type: filters.type,
      dimension: filters.dimension,
      tag: filters.tag,
      companyId: filters.companyId,
    }),
  )
  const body = (await response.json()) as { items: QuestionLibraryItem[] }
  return body.items
}

/** The full item, including the options and scale bounds the list projection drops. */
export async function getQuestionLibraryItem(
  baseUrl: string,
  id: string,
): Promise<QuestionLibraryItemDetail> {
  const response = await authFetch(`${baseUrl}/admin/question-library/${id}`)
  return response.json() as Promise<QuestionLibraryItemDetail>
}
