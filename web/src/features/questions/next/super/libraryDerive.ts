import type { QuestionCategory, QuestionLibraryItem, QuestionLibraryItemDetail } from '../../api/questionLibrary'
import { QUESTION_LIBRARY_TYPES, type CreateQuestionLibraryItemInput, type UpdateQuestionLibraryItemInput } from '../../api/questionLibraryAdmin'

/**
 * The pure readings behind the redesigned Biblioteca de preguntas (`/admin/question-library`),
 * from `GET /admin/question-categories` and `GET /admin/question-library` — a super
 * administrator is answered the global rows plus every tenant's, a company administrator the
 * global rows plus their own (`QuestionLibraryEndpoints.cs:71-85`, `:224-238`).
 */

/** The category a name is shown by, in the reader's language. Both are mandatory on the row. */
export function categoryName(category: QuestionCategory, locale: string): string {
  return locale.startsWith('es') ? category.nameEs : category.nameEn
}

function sameName(a: QuestionCategory, b: QuestionCategory): boolean {
  const norm = (value: string) => value.trim().toLocaleLowerCase()
  return norm(a.nameEn) === norm(b.nameEn) && norm(a.nameEs) === norm(b.nameEs)
}

export interface TenantGroup {
  companyId: string
  /** The tenant's categories that copy a global one by name — "6 copias de las globales". */
  copies: QuestionCategory[]
  /** The tenant's own categories, which copy nothing. */
  own: QuestionCategory[]
}

export interface CategoryTree {
  /** Global categories, in the server's order. */
  global: QuestionCategory[]
  /** One group per tenant that owns a category, in the order the tenants first appear. */
  tenants: TenantGroup[]
}

/**
 * The tree the left column draws: the global categories, then each tenant's, with the
 * tenant's copies of global categories folded into one row. A copy is a tenant category whose
 * two names both match a global one's — the shape a copied instrument has, and the only
 * relation the payload lets the page read (there is no `copiedFrom` on the row).
 */
export function categoryTree(categories: readonly QuestionCategory[]): CategoryTree {
  const global = categories.filter((category) => category.companyId === null)
  const tenants: TenantGroup[] = []
  for (const category of categories) {
    if (category.companyId === null) continue
    let group = tenants.find((entry) => entry.companyId === category.companyId)
    if (!group) {
      group = { companyId: category.companyId, copies: [], own: [] }
      tenants.push(group)
    }
    if (global.some((candidate) => sameName(candidate, category))) group.copies.push(category)
    else group.own.push(category)
  }
  return { global, tenants }
}

/** The tenant copies of one global category — the "Ver las de Acme" link's targets. */
export function copiesOf(global: QuestionCategory, categories: readonly QuestionCategory[]): QuestionCategory[] {
  return categories.filter((category) => category.companyId !== null && sameName(category, global))
}

/**
 * A category's questions in the order the type select offers the types
 * (`QUESTION_LIBRARY_TYPES`: the Likert scale first), then by their Spanish text. The server
 * sorts by the English text (`QuestionLibraryEndpoints.cs`, `OrderBy(i => i.TextEn)`), which put
 * "How would you rate…" above "My manager gives me…"; the SuperQuestionLibrary artboard lists —
 * and opens — the Likert question first.
 */
export function itemsIn(categoryId: string, items: readonly QuestionLibraryItem[]): QuestionLibraryItem[] {
  const rank = (type: string) => {
    const index = (QUESTION_LIBRARY_TYPES as readonly string[]).indexOf(type)
    return index === -1 ? QUESTION_LIBRARY_TYPES.length : index
  }
  return items
    .filter((item) => item.questionCategoryId === categoryId)
    .sort((a, b) => rank(a.type) - rank(b.type) || a.textEs.localeCompare(b.textEs, 'es'))
}

/** How many of a set of rows a survey has already asked (`usageCount` is counted server-side). */
export function usedCount(items: readonly QuestionLibraryItem[]): number {
  return items.filter((item) => item.usageCount > 0).length
}

/**
 * Whether this viewer may write the row — `QuestionLibraryEndpoints.cs:60-67`: a super
 * administrator any row, a company administrator only a row their own company owns (never a
 * global one).
 */
export function canWriteLibraryRow(
  row: { companyId: string | null },
  viewer: { role: string | undefined; companyId: string | undefined },
): boolean {
  if (viewer.role === 'super_admin') return true
  return viewer.role === 'company_admin' && row.companyId !== null && row.companyId === viewer.companyId
}

/** The types that carry a scale's two ends. */
export function hasScale(type: string): boolean {
  return type === 'likert' || type === 'rating'
}

export interface LibraryDraft {
  questionCategoryId: string
  textEs: string
  textEn: string
  type: string
  dimension: string
  tags: string[]
  scaleMin: number | null
  scaleMax: number | null
  scaleLabelMinEs: string
  scaleLabelMaxEs: string
  scaleLabelMinEn: string
  scaleLabelMaxEn: string
  /** One option per line, `multiple_choice` only. */
  options: string
  /** Asked once, at creation; immutable after (`UpdateQuestionLibraryItemInput` has no `companyId`). */
  owner: 'global' | 'company'
}

export function emptyDraft(questionCategoryId: string, owner: 'global' | 'company'): LibraryDraft {
  return {
    questionCategoryId,
    textEs: '',
    textEn: '',
    type: 'likert',
    dimension: '',
    tags: [],
    scaleMin: null,
    scaleMax: null,
    scaleLabelMinEs: '',
    scaleLabelMaxEs: '',
    scaleLabelMinEn: '',
    scaleLabelMaxEn: '',
    options: '',
    owner,
  }
}

/**
 * The editor's starting point for an existing row — from its DETAIL, never its list row:
 * the list projection drops options and the scale, and `UpdateItemAsync` replaces all of them
 * with whatever the PUT carries (`QuestionLibraryEndpoints.cs:371-393`), so a draft built from
 * a list row would wipe the row's tags, options and scale on a text edit.
 */
export function draftFromDetail(detail: QuestionLibraryItemDetail): LibraryDraft {
  return {
    questionCategoryId: detail.questionCategoryId,
    textEs: detail.textEs,
    textEn: detail.textEn,
    type: detail.type,
    dimension: detail.dimension ?? '',
    tags: [...detail.tags],
    scaleMin: detail.scaleMin,
    scaleMax: detail.scaleMax,
    scaleLabelMinEs: detail.scaleLabelMinEs ?? '',
    scaleLabelMaxEs: detail.scaleLabelMaxEs ?? '',
    scaleLabelMinEn: detail.scaleLabelMinEn ?? '',
    scaleLabelMaxEn: detail.scaleLabelMaxEn ?? '',
    options: detail.options.map((option) => option.labelEn ?? option.value).join('\n'),
    owner: detail.companyId === null ? 'global' : 'company',
  }
}

/** Both languages, trimmed and non-empty — the server refuses anything less (`:347-351`). */
export function bothLanguages(draft: Pick<LibraryDraft, 'textEs' | 'textEn'>): boolean {
  return draft.textEs.trim() !== '' && draft.textEn.trim() !== ''
}

function optional(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function parseOptions(raw: string): { labelEn: string; labelEs: string }[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => ({ labelEn: line, labelEs: line }))
}

/** The fields create and update share, carried whole so an edit never drops one. */
function shared(draft: LibraryDraft) {
  const options = parseOptions(draft.options)
  return {
    questionCategoryId: draft.questionCategoryId,
    textEn: draft.textEn.trim(),
    textEs: draft.textEs.trim(),
    scaleMin: draft.scaleMin ?? undefined,
    scaleMax: draft.scaleMax ?? undefined,
    scaleLabelMinEn: optional(draft.scaleLabelMinEn),
    scaleLabelMinEs: optional(draft.scaleLabelMinEs),
    scaleLabelMaxEn: optional(draft.scaleLabelMaxEn),
    scaleLabelMaxEs: optional(draft.scaleLabelMaxEs),
    dimension: optional(draft.dimension),
    tags: draft.tags,
    options: options.length > 0 ? options : undefined,
  }
}

/** `PUT /admin/question-library/{id}` — no `type` and no `companyId`, both immutable. */
export function updateBody(draft: LibraryDraft): UpdateQuestionLibraryItemInput {
  return shared(draft)
}

/** `POST /admin/question-library`; `ownerCompanyId` undefined creates a global row. */
export function createBody(draft: LibraryDraft, ownerCompanyId: string | undefined): CreateQuestionLibraryItemInput {
  return { ...shared(draft), type: draft.type, ...(ownerCompanyId ? { companyId: ownerCompanyId } : {}) }
}
