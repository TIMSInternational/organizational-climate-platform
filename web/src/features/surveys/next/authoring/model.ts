import type { AuthoringQuestion } from '../../api/surveyQuestionAuthoring'
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
