import type { AuthoringOption, AuthoringQuestion } from '../../api/surveyQuestionAuthoring'
import type { AuthoredText } from '../../api/surveyInvitationCopy'
import type { QuestionLibraryItemDetail } from '../../../questions/api/questionLibrary'
import { questionTypeLabel } from '../../surveyVocabulary'
import type { SurveyTemplateQuestion } from '../../api/surveyTemplates'
import { LOCALES, type Locale } from '../../../../i18n'

/**
 * Editar preguntas and Detalle de plantilla, redesigned, as data.
 *
 * Both screens are fed entirely by `GET /surveys/{id}` (read once per authored language,
 * `surveyQuestionAuthoring.ts`) and `GET /survey-templates/{id}`; no region is sample-fed.
 * Everything counted on screen — dimensions, required questions, languages, the uniform
 * scale — is computed here.
 */

/**
 * Whether the server will accept a QUESTIONS edit. `SurveyEndpoints` refuses twice: a status
 * other than draft/scheduled, and any response at all. `responseCount` is the server's fast
 * path, so a 0 here is a hint and the save's 409 stays the truth -- it counts results, so a
 * survey whose only answer TIMS excluded reads 0 here and is still refused there.
 *
 * `operator` (a super admin) also edits an ACTIVE survey nobody has answered (ruled 2026-11-11,
 * `docs/decisions/operators-edit-a-live-survey.md`); a client's administrator does not.
 */
export function isEditable(status: string, responseCount: number, operator = false): boolean {
  return (status === 'draft' || status === 'scheduled' || (operator && status === 'active')) && responseCount === 0
}

/**
 * Whether «Editar nombre» is offered: a draft nobody has answered, for anyone who administers
 * the survey; past draft, a super admin for as long as it is not archived -- with answers too,
 * because no stored answer points at a survey's name or description (ruled 2026-11-11).
 */
export function isTextEditable(status: string, responseCount: number, operator: boolean): boolean {
  if (status === 'draft') return responseCount === 0
  return operator && (status === 'scheduled' || status === 'active' || status === 'closed')
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

/** A new, blank question at the end. It starts as Likert 1–5; «Tipo de pregunta» changes it (`withQuestionType`). */
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

/**
 * The most points a scale may have and still be offered a word for each answer. A five-point
 * frequency or agreement scale is what clients label word by word (ESPH's workbook requires
 * exactly five, `ClimateWorkbook.cs`); an eNPS 0–10 is numbers by definition, and eleven words
 * would be a list nobody reads as a scale.
 */
export const MAX_LABELLED_POINTS = 7

/** A scale's points, low to high; empty when the question has no range. */
export function scalePoints(question: Pick<AuthoringQuestion, 'scaleMin' | 'scaleMax'>): number[] {
  const { scaleMin: min, scaleMax: max } = question
  if (min === null || max === null || max < min) return []
  return Array.from({ length: max - min + 1 }, (_, i) => min + i)
}

/**
 * Whether «Cómo se ven las respuestas» is offered for one question.
 *
 * Only a numeric scale of at most `MAX_LABELLED_POINTS` points, and only while its answers ARE
 * its points: no option set yet, or one whose values are exactly "1".."5" (in any order -- EAGLE's
 * instrument lists the positives first). A question whose options carry other keys (a library
 * question keyed `nunca`/`siempre`) is not offered it, because turning it into numbers or
 * rewriting its words here would change the key every answer is stored under.
 */
export function canLabelAnswers(question: Pick<AuthoringQuestion, 'type' | 'scaleMin' | 'scaleMax' | 'options'>): boolean {
  if (!isScaleType(question.type)) return false
  const points = scalePoints(question)
  if (points.length < 2 || points.length > MAX_LABELLED_POINTS) return false
  const options = question.options ?? []
  if (options.length === 0) return true
  const values = options.map((option) => option.value).sort()
  const expected = points.map(String).sort()
  return values.length === expected.length && values.every((value, i) => value === expected[i])
}

/**
 * Whether the respondent meets this scale as a list of words rather than a row of numbers.
 *
 * The respond screen decides it the same way: a scale with options renders one line per option
 * (`RespondQuestionField` → `ChoiceAnswer`), a scale without them a numbered row with the two
 * ends under it (`ScaleAnswer`). So "words for each answer" is nothing more than an option set
 * whose values are the points -- the exact shape ESPH's workbook import wrote.
 */
export function hasAnswerLabels(question: Pick<AuthoringQuestion, 'type' | 'scaleMin' | 'scaleMax' | 'options'>): boolean {
  return canLabelAnswers(question) && (question.options?.length ?? 0) > 0
}

function blankByLocale(): Record<Locale, AuthoredText> {
  return Object.fromEntries(LOCALES.map((locale) => [locale, { text: '', authored: false }])) as Record<Locale, AuthoredText>
}

function copyByLocale(from: Record<Locale, AuthoredText>): Record<Locale, AuthoredText> {
  return Object.fromEntries(
    LOCALES.map((locale) => [locale, { ...(from[locale] ?? { text: '', authored: false }) }]),
  ) as Record<Locale, AuthoredText>
}

/**
 * Show this scale as a list: one option per point, keyed by the point itself ("1".."5"), so
 * every answer is stored exactly as it was as a number and the results, the mean and the
 * comparison with earlier waves do not move. The lowest and highest answers start with the
 * scale's two end words; the ones between start empty, for the author to write -- the editor
 * does not invent a client's wording.
 */
export function withAnswerLabels(question: AuthoringQuestion): AuthoringQuestion {
  if (hasAnswerLabels(question) || !canLabelAnswers(question)) return question
  const points = scalePoints(question)
  const options: AuthoringOption[] = points.map((point) => ({
    value: String(point),
    label:
      point === question.scaleMin
        ? copyByLocale(question.scaleLabelMin)
        : point === question.scaleMax
          ? copyByLocale(question.scaleLabelMax)
          : blankByLocale(),
  }))
  return { ...question, options }
}

/** Back to a row of numbers. The two end words stay: they already hold the first and last answers' words. */
export function withoutAnswerLabels(question: AuthoringQuestion): AuthoringQuestion {
  if (!hasAnswerLabels(question)) return question
  return { ...question, options: null }
}

/**
 * One answer's words in one language. The lowest and highest answers also write the scale's
 * two ends, which is what the workbook import stores (`scaleLabelMin` = the first answer's
 * words): the respond screen hides ends that repeat the first and last lines, and every
 * report that prints "1 = … 5 = …" reads them.
 */
export function setAnswerLabel(question: AuthoringQuestion, value: string, locale: Locale, text: string): AuthoringQuestion {
  const entry: AuthoredText = { text, authored: text.trim() !== '' }
  const point = Number(value)
  return {
    ...question,
    options: (question.options ?? []).map((option) =>
      option.value === value ? { ...option, label: { ...option.label, [locale]: entry } } : option,
    ),
    scaleLabelMin: point === question.scaleMin ? { ...question.scaleLabelMin, [locale]: entry } : question.scaleLabelMin,
    scaleLabelMax: point === question.scaleMax ? { ...question.scaleLabelMax, [locale]: entry } : question.scaleLabelMax,
  }
}

/**
 * «Usar estas respuestas en todas las preguntas»: copy one question's answer words onto every
 * question on the same range that may take them (`canLabelAnswers`). A question on another
 * range, or whose options carry other keys, is left exactly as it was. `count` is how many
 * questions show these words afterwards, the source included.
 */
export function applyAnswerLabels(questions: AuthoringQuestion[], source: AuthoringQuestion): { questions: AuthoringQuestion[]; count: number } {
  if (!hasAnswerLabels(source)) return { questions, count: 0 }
  let count = 0
  const next = questions.map((question) => {
    if (question.id === source.id) {
      count += 1
      return question
    }
    if (!canLabelAnswers(question) || question.scaleMin !== source.scaleMin || question.scaleMax !== source.scaleMax) return question
    count += 1
    return {
      ...question,
      options: (source.options ?? []).map((option) => ({ value: option.value, label: copyByLocale(option.label) })),
      scaleLabelMin: copyByLocale(source.scaleLabelMin),
      scaleLabelMax: copyByLocale(source.scaleLabelMax),
    }
  })
  return { questions: next, count }
}

/**
 * The 1-based positions of the questions shown as a list with an answer left without words, in
 * a language the question itself is written in. Saved like that, the respondent would read a
 * bare "3" among four words. A language the question's own text is not written in is the
 * untranslated state the summary already reports, and is not demanded here either.
 */
export function questionsMissingAnswerLabels(questions: AuthoringQuestion[], locales: Locale[]): number[] {
  return questions.flatMap((question, index) => {
    if (!hasAnswerLabels(question)) return []
    const written = authoredLocales(question, locales)
    const blank = (question.options ?? []).some((option) => written.some((locale) => !option.label[locale]?.text.trim()))
    return blank ? [index + 1] : []
  })
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

/**
 * The disabled look for an authoring button whose label the user still has to read: Guardar
 * borrador and Atrás on the builder, and a status verb («Programar», «Activar») or «Editar
 * audiencia» that the detail page holds disabled for a reason it states beside it. The Button's
 * `disabled:opacity-45` faded such a label to #989899 on white, 2.88:1. They keep full opacity
 * and drop to the label ink instead (#6c6c71, 5.22:1 on white), so disabled still reads quieter
 * than the primary ink.
 */
export const QUIET_DISABLED = 'disabled:opacity-100 disabled:text-fg-label'

/**
 * The types «Tipo de pregunta» offers a question added in this session, in the order the select
 * lists them: the old TIMS platform's «Tipo de elección» minus the two the survey cannot store
 * (several answers to one question, and a ranking nobody can author yet).
 */
export const NEW_QUESTION_TYPES = ['likert', 'rating', 'multiple_choice', 'open_ended', 'yes_no'] as const

/**
 * A question added blank in this editing session (`blankQuestion`'s id). Only such a question may
 * change type: nothing is stored against it, and no earlier wave asked it, so the comparison the
 * Escala field's hint promises for every other question cannot break. A library question keeps
 * the library's type, and a saved question its own.
 */
export function isNewQuestion(question: Pick<AuthoringQuestion, 'id'>): boolean {
  return question.id.startsWith('new-')
}

let draftSequence = 0

/** An option with no words yet and a placeholder value no other option of the question holds. */
function draftOption(existing: AuthoringOption[]): AuthoringOption {
  let value: string
  do {
    draftSequence += 1
    value = `draft-${draftSequence}`
  } while (existing.some((option) => option.value === value))
  return { value, label: blankByLocale(), draft: true }
}

/**
 * The question as `type`, carrying over only what that type uses.
 *
 * A scale keeps its range and words when it only changes between Likert and Valoración, and
 * starts at 1–5 otherwise. «Opción múltiple» starts with two empty options, the fewest the
 * server accepts (`SurveyEndpoints.PrepareQuestion`). The others drop the range, the end words
 * and the options, so nothing the respondent will never see is saved with them; a «Respuesta
 * abierta» also drops «El comentario es obligatorio», because its answer already is the text and
 * the respond screen shows it no comment box (`commentIsRequired`, `respondAnswers.ts`).
 */
export function withQuestionType(question: AuthoringQuestion, type: string): AuthoringQuestion {
  if (type === question.type) return question
  if (isScaleType(type)) {
    if (isScaleType(question.type)) return { ...question, type }
    return { ...question, type, scaleMin: 1, scaleMax: 5, options: null }
  }
  const unscaled: AuthoringQuestion = { ...question, type, scaleMin: null, scaleMax: null, scaleLabelMin: blankByLocale(), scaleLabelMax: blankByLocale() }
  if (type === 'multiple_choice') {
    const first = draftOption([])
    return { ...unscaled, options: [first, draftOption([first])] }
  }
  return { ...unscaled, options: null, commentRequired: type === 'open_ended' ? false : question.commentRequired }
}

/** Whether the editor shows the question's own options to write: «Opción múltiple», one answer. */
export function editsOptions(question: Pick<AuthoringQuestion, 'type'>): boolean {
  return question.type === 'multiple_choice'
}

export function withOptionAdded(question: AuthoringQuestion): AuthoringQuestion {
  const options = question.options ?? []
  return { ...question, options: [...options, draftOption(options)] }
}

export function withoutOption(question: AuthoringQuestion, value: string): AuthoringQuestion {
  return { ...question, options: (question.options ?? []).filter((option) => option.value !== value) }
}

/** One option's words in one language. Its value never moves: a saved option keeps the key its answers point at. */
export function setOptionLabel(question: AuthoringQuestion, value: string, locale: Locale, text: string): AuthoringQuestion {
  const entry: AuthoredText = { text, authored: text.trim() !== '' }
  return {
    ...question,
    options: (question.options ?? []).map((option) => (option.value === value ? { ...option, label: { ...option.label, [locale]: entry } } : option)),
  }
}

/**
 * The 1-based positions of the «Opción múltiple» questions the server would refuse or the
 * respondent could not read: fewer than two options, an option without words in a language the
 * question is written in (the respondent would read its stored key), or two options with the same
 * words in one language (a respondent cannot tell them apart, and saved they would share a key).
 * A question written in no language yet is checked in every language of the survey.
 */
export function questionsWithIncompleteOptions(questions: AuthoringQuestion[], locales: Locale[]): number[] {
  return questions.flatMap((question, index) => {
    if (!editsOptions(question)) return []
    const options = question.options ?? []
    const written = authoredLocales(question, locales)
    const checked = written.length > 0 ? written : locales
    const blank = options.some((option) => checked.some((locale) => !option.label[locale]?.text.trim()))
    const repeated = checked.some((locale) => {
      const words = options.map((option) => (option.label[locale]?.text ?? '').trim().toLocaleLowerCase()).filter((word) => word !== '')
      return new Set(words).size !== words.length
    })
    return options.length < 2 || blank || repeated ? [index + 1] : []
  })
}

/**
 * Give every option added in this session its stored value, by the server's own rule for an
 * option that arrives without one (`SurveyValidation.DeriveOptionValue`): its English words,
 * else its Spanish ones, trimmed. That is what a library question's options get too, so a new
 * option reads as itself in the response workbook rather than as a number. A value another option
 * of the question already holds gets " (2)", " (3)"…: the server refuses a duplicate. Options
 * read from the server are returned untouched — their value is the key their answers point at.
 */
export function settleOptionValues(questions: AuthoringQuestion[]): AuthoringQuestion[] {
  return questions.map((question) => {
    const options = question.options
    if (!options?.some((option) => option.draft)) return question
    const used = new Set(options.filter((option) => !option.draft).map((option) => option.value))
    return {
      ...question,
      options: options.map((option) => {
        if (!option.draft) return option
        const words = (option.label.en?.text.trim() || option.label.es?.text.trim() || option.value).slice(0, 480)
        let value = words
        for (let n = 2; used.has(value); n += 1) value = `${words} (${n})`
        used.add(value)
        return { value, label: option.label }
      }),
    }
  })
}
