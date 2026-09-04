import { authFetch } from '../../../api/authFetch'
import type { QuestionCategory, QuestionLibraryItemDetail } from './questionLibrary'

/**
 * The WRITE half of the question library — the authoring surface #423 asked for.
 *
 * ## Why this is a separate module from `questionLibrary.ts`
 *
 * That module is the picker's client and says outright that it "deliberately does not"
 * carry POST or PUT, because the picker's contract ends at making an item readable. It
 * pointed authoring at a library admin screen that did not exist until #423. Bolting the
 * writes onto the read client would have dissolved the boundary it was written to keep;
 * a second module keeps the picker unable to write by construction, not by discipline.
 *
 * ## Both languages are mandatory here, unlike the bank
 *
 * `QuestionLibraryEndpoints.cs:109` refuses a category whose `NameEn` or `NameEs` is
 * blank, and the item create refuses the same for `TextEn`/`TextEs`. The page validates
 * before sending so the author is told which field is missing rather than shown a bare
 * 400, but the server is still the authority — this is a second guard, never the only one.
 *
 * ## What cannot be changed after creation
 *
 * `CompanyId` on both, and `Type` on an item. The update DTOs omit them
 * (`QuestionRepositoryDtos.cs`), so the edit form renders them read-only rather than
 * sending a field the server would ignore. Changing an item's type would make the library
 * disagree with questions already copied from it.
 */

/**
 * The types the library accepts.
 *
 * Server-side this is `QuestionTypes.ForSurvey ∩ ForMicroclimate`, ordered ordinally
 * (`QuestionRepositoryTypes.Supported`) — a library item must be instantiable into either
 * kind of instrument, so the intersection is the rule rather than a preference. Today that
 * evaluates to the five below; `ranking` is survey-only and `emoji_rating` is
 * microclimate-only, so both are excluded.
 *
 * Deliberately NOT imported from `questionBank.ts`, whose list happens to hold the same
 * five: the bank derives its vocabulary from a different place, and importing would turn a
 * coincidence into a coupling. `questionLibraryAdmin.test.ts` pins these values so a drift
 * on either side shows up as a failing test rather than as a 400 in front of an author.
 */
export const QUESTION_LIBRARY_TYPES = [
  'likert',
  'multiple_choice',
  'open_ended',
  'rating',
  'yes_no',
] as const

export type QuestionLibraryType = (typeof QUESTION_LIBRARY_TYPES)[number]

/** Only `multiple_choice` derives its meaning from a caller-supplied option set. */
export function requiresOptions(type: string): boolean {
  return type === 'multiple_choice'
}

/** An option as supplied on write. `value` may be omitted and is then derived server-side. */
export interface QuestionLibraryOptionInput {
  value?: string
  labelEn?: string
  labelEs?: string
}

export interface CreateQuestionCategoryInput {
  nameEn: string
  nameEs: string
  descriptionEn?: string
  descriptionEs?: string
  parentCategoryId?: string
  companyId?: string
  order?: number
  icon?: string
  color?: string
}

/** No `companyId`: it decides who may write the row and is immutable after creation. */
export interface UpdateQuestionCategoryInput {
  nameEn: string
  nameEs: string
  descriptionEn?: string
  descriptionEs?: string
  parentCategoryId?: string
  order?: number
  icon?: string
  color?: string
  isActive?: boolean
}

export interface CreateQuestionLibraryItemInput {
  questionCategoryId: string
  textEn: string
  textEs: string
  type: string
  companyId?: string
  scaleMin?: number
  scaleMax?: number
  scaleLabelMinEn?: string
  scaleLabelMinEs?: string
  scaleLabelMaxEn?: string
  scaleLabelMaxEs?: string
  dimension?: string
  tags?: string[]
  options?: QuestionLibraryOptionInput[]
}

/** No `companyId` and no `type`: both are immutable after creation. */
export interface UpdateQuestionLibraryItemInput {
  questionCategoryId: string
  textEn: string
  textEs: string
  scaleMin?: number
  scaleMax?: number
  scaleLabelMinEn?: string
  scaleLabelMinEs?: string
  scaleLabelMaxEn?: string
  scaleLabelMaxEs?: string
  dimension?: string
  isActive?: boolean
  tags?: string[]
  options?: QuestionLibraryOptionInput[]
}

export async function createQuestionCategory(
  baseUrl: string,
  input: CreateQuestionCategoryInput,
): Promise<QuestionCategory> {
  const response = await authFetch(`${baseUrl}/admin/question-categories`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<QuestionCategory>
}

export async function updateQuestionCategory(
  baseUrl: string,
  id: string,
  input: UpdateQuestionCategoryInput,
): Promise<QuestionCategory> {
  const response = await authFetch(`${baseUrl}/admin/question-categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<QuestionCategory>
}

export async function createQuestionLibraryItem(
  baseUrl: string,
  input: CreateQuestionLibraryItemInput,
): Promise<QuestionLibraryItemDetail> {
  const response = await authFetch(`${baseUrl}/admin/question-library`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<QuestionLibraryItemDetail>
}

export async function updateQuestionLibraryItem(
  baseUrl: string,
  id: string,
  input: UpdateQuestionLibraryItemInput,
): Promise<QuestionLibraryItemDetail> {
  const response = await authFetch(`${baseUrl}/admin/question-library/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<QuestionLibraryItemDetail>
}
