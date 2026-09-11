import type { AuthoringQuestion } from '../../api/surveyQuestionAuthoring'
import type { AuthoredText } from '../../api/surveyInvitationCopy'
import type { QuestionLibraryItemDetail } from '../../../questions/api/questionLibrary'
import { questionTypeLabel } from '../../surveyVocabulary'
import type { SurveyTemplateQuestion } from '../../api/surveyTemplates'
import type { Locale } from '../../../../i18n'

/**
 * Editar preguntas and Detalle de plantilla, redesigned, as data.
 *
 * Both screens are fed entirely by `GET /surveys/{id}` (read once per authored language,
 * `surveyQuestionAuthoring.ts`) and `GET /survey-templates/{id}`; no region is sample-fed.
 * Everything counted on screen — dimensions, required questions, languages, the uniform
 * scale — is computed here.
 */

/**
 * Whether the server will accept a content edit. `SurveyEndpoints` refuses twice: a status
 * other than draft/scheduled, and any response at all. `responseCount` is the server's fast
 * path, so a 0 here is a hint and the save's 409 stays the truth.
 */
export function isEditable(status: string, responseCount: number): boolean {
  return (status === 'draft' || status === 'scheduled') && responseCount === 0
}

/** The locales a question is actually written in — an unauthored locale is not a translation. */
export function authoredLocales(question: AuthoringQuestion, locales: Locale[]): Locale[] {
  return locales.filter((locale) => question.text[locale]?.authored && question.text[locale].text.trim() !== '')
}

export interface AuthoringSummary {
  dimensions: number
  required: number
  withComment: number
  total: number
  /** Every question written in every language the survey is written in. */
  fullyTranslated: boolean
  /** Questions with no dimension: the results map cannot place them. */
  uncategorised: number
}

export function summarise(questions: AuthoringQuestion[], locales: Locale[]): AuthoringSummary {
  return {
    dimensions: new Set(questions.map((q) => q.category).filter((c): c is string => !!c)).size,
    required: questions.filter((q) => q.required).length,
    withComment: questions.filter((q) => q.commentRequired).length,
    total: questions.length,
    fullyTranslated: questions.every((q) => authoredLocales(q, locales).length === locales.length),
    uncategorised: questions.filter((q) => !q.category).length,
  }
}

/** Move one question and renumber `order` to the new positions — the PUT sends `order`. */
export function moveQuestion(questions: AuthoringQuestion[], from: number, to: number): AuthoringQuestion[] {
  if (from === to || from < 0 || to < 0 || from >= questions.length || to >= questions.length) return questions
  const next = [...questions]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next.map((question, index) => ({ ...question, order: index }))
}

export function removeQuestion(questions: AuthoringQuestion[], index: number): AuthoringQuestion[] {
  return questions.filter((_, i) => i !== index).map((question, i) => ({ ...question, order: i }))
}

/** "Likert 1–5" when every question shares one scaled type and range; otherwise null. */
export function uniformScale(
  questions: Pick<SurveyTemplateQuestion, 'type' | 'scaleMin' | 'scaleMax' | 'scaleLabelMin' | 'scaleLabelMax' | 'required'>[],
): { type: string; min: number; max: number; minLabel: string | null; maxLabel: string | null; allRequired: boolean } | null {
  const first = questions[0]
  if (!first || first.scaleMin === null || first.scaleMax === null) return null
  const same = questions.every(
    (q) => q.type === first.type && q.scaleMin === first.scaleMin && q.scaleMax === first.scaleMax,
  )
  if (!same) return null
  return {
    type: first.type,
    min: first.scaleMin,
    max: first.scaleMax,
    minLabel: first.scaleLabelMin,
    maxLabel: first.scaleLabelMax,
    allRequired: questions.every((q) => q.required),
  }
}

/** Questions grouped by dimension, in the order the dimensions first appear. */
export function groupByDimension<T extends { category: string | null }>(questions: T[]): { key: string | null; questions: T[] }[] {
  const groups: { key: string | null; questions: T[] }[] = []
  for (const question of questions) {
    const group = groups.find((g) => g.key === question.category)
    if (group) group.questions.push(question)
    else groups.push({ key: question.category, questions: [question] })
  }
  return groups
}

/** A new, blank Likert 1–5 question at the end — the only kind the editor adds in place. */
export function blankQuestion(order: number, locales: Locale[]): AuthoringQuestion {
  const empty = () =>
    Object.fromEntries(locales.map((locale) => [locale, { text: '', authored: false }])) as AuthoringQuestion['text']
  return {
    id: `new-${order}-${Date.now()}`,
    type: 'likert',
    order,
    category: null,
    required: true,
    commentRequired: false,
    scaleMin: 1,
    scaleMax: 5,
    text: empty(),
    scaleLabelMin: empty(),
    scaleLabelMax: empty(),
    commentPrompt: Object.fromEntries(locales.map((locale) => [locale, { text: '', authored: false }])) as AuthoringQuestion['text'],
    options: null,
  }
}

/** The two types that are a numeric scale — the only ones a scale can be swapped between. */
export function isScaleType(type: string): boolean {
  return type === 'likert' || type === 'rating'
}

/**
 * The scale choices the Escala select may offer for one question: the scaled types at the
 * question's OWN range. A different range would change the answers' numbers and break the
 * comparison with earlier waves the field's hint promises, and a non-scaled type has no
 * compatible change at all — so it offers only itself and the select is disabled.
 */
export function compatibleScaleTypes(question: Pick<AuthoringQuestion, 'type' | 'scaleMin' | 'scaleMax'>): string[] {
  if (question.scaleMin === null || question.scaleMax === null || !isScaleType(question.type)) return [question.type]
  return ['likert', 'rating']
}

/** The short name the boards print on a scale chip: "Likert 1–5", not "Escala Likert 1–5". */
export function scaleName(t: Parameters<typeof questionTypeLabel>[0], type: string): string {
  return isScaleType(type) ? t(`surveys.next.authoring.scaleName.${type}`) : questionTypeLabel(t, type)
}

/**
 * The dimensions the survey was loaded with that the edited list no longer asks about. A
 * dimension left without a question disappears from the results map and from the
 * comparison with earlier waves, so the footer names it instead of ticking.
 */
export function dimensionsWithout(original: AuthoringQuestion[], current: AuthoringQuestion[]): string[] {
  const asked = new Set(current.map((q) => q.category).filter((c): c is string => !!c))
  return [...new Set(original.map((q) => q.category).filter((c): c is string => !!c))].filter((c) => !asked.has(c))
}

/**
 * A library question copied into the survey being edited. Every option keeps the library's
 * stored `value` verbatim — the aggregation key (see `surveyQuestionAuthoring.ts`) — and a
 * language the library row has no text for arrives unauthored, so the summary says
 * "falta traducir" rather than filing one language's words under the other.
 */
export function questionFromLibraryItem(item: QuestionLibraryItemDetail, order: number, locales: Locale[]): AuthoringQuestion {
  const pick = (enText: string | null, esText: string | null) =>
    Object.fromEntries(
      locales.map((locale) => {
        const text = (locale === 'es' ? esText : enText) ?? ''
        return [locale, { text, authored: text.trim() !== '' }]
      }),
    ) as Record<Locale, AuthoredText>
  return {
    id: `library-${item.id}-${order}-${Date.now()}`,
    type: item.type,
    order,
    category: item.dimension,
    required: true,
    commentRequired: false,
    scaleMin: item.scaleMin,
    scaleMax: item.scaleMax,
    text: pick(item.textEn, item.textEs),
    scaleLabelMin: pick(item.scaleLabelMinEn, item.scaleLabelMinEs),
    scaleLabelMax: pick(item.scaleLabelMaxEn, item.scaleLabelMaxEs),
    commentPrompt: pick(null, null),
    options:
      item.options.length > 0
        ? [...item.options].sort((x, y) => x.order - y.order).map((option) => ({ value: option.value, label: pick(option.labelEn, option.labelEs) }))
        : null,
  }
}
