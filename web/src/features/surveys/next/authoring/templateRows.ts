import type { QuestionBankItemDetail } from '../../../questions/api/questionBank'
import { toQuestionInputs, type AuthoringQuestion } from '../../api/surveyQuestionAuthoring'
import type { SurveyTemplateDetail } from '../../api/surveyTemplates'
import {
  buildQuestionInputs,
  emptyQuestion,
  type ContentLanguage,
  type SurveyQuestionValues,
  type SurveyWizardValues,
} from '../../wizardValues'

/**
 * The builder's template mode, as data.
 *
 * The SurveyBuilder artboard draws a template's questions as rows like any other — a drag grip,
 * a live "Obligatoria" switch, a "•••" menu — so they are rows here: the template's questions
 * copied into the wizard's own `questions` (and so into its draft), each carrying the `order` of
 * the template question it came from. The survey is still created by
 * `POST /survey-templates/{id}/use`, which copies the template whole — values, comment prompts
 * and all — and only when the author changed the arrangement does
 * `PUT /surveys/{id}` (`questions` only, the question editor's own request) rearrange that copy.
 */

/** Whether a template's questions are written in `language` — the only languages it may be used in. */
export function templateCovers(templateLanguage: string, language: ContentLanguage): boolean {
  return templateLanguage === 'both' || templateLanguage === language
}

function columnOf(read: SurveyTemplateDetail): 'en' | 'es' | null {
  return read.resolvedLocale === 'es' ? 'es' : read.resolvedLocale === 'en' ? 'en' : null
}

/**
 * A template's questions as builder rows, in the template's order. `reads` are the template in
 * each language it is written in (`GET /survey-templates/{id}?lang=`); a field that had to reach
 * for the other language (`fallbackFields`, paths `questions[{order}].…`) is left blank rather
 * than filed under the wrong column. `keys` are fresh React keys, one per question.
 */
export function materialiseTemplate(
  reads: readonly SurveyTemplateDetail[],
  keys: readonly string[],
): SurveyQuestionValues[] {
  const primary = reads[0]
  if (primary === undefined) return []
  const ordered = [...primary.questions].sort((a, b) => a.order - b.order)
  return ordered.map((question, index) => {
    const key = keys[index] ?? `${primary.id}-${question.order}`
    const options = [...(question.options ?? [])].sort((a, b) => a.order - b.order)
    const row: SurveyQuestionValues = {
      ...emptyQuestion(key),
      type: question.type,
      required: question.required,
      category: question.category ?? '',
      scaleMin: question.scaleMin,
      scaleMax: question.scaleMax,
      options: options.map((_, optionIndex) => ({ key: `${key}-o${optionIndex}`, labelEn: '', labelEs: '' })),
      templateOrder: question.order,
    }
    const path = `questions[${question.order}]`
    for (const read of reads) {
      const column = columnOf(read)
      const same = read.questions.find((candidate) => candidate.order === question.order)
      if (column === null || same === undefined) continue
      const authored = (field: string, value: string | null) =>
        value !== null && !read.fallbackFields.includes(`${path}.${field}`) ? value : null
      const text = authored('text', same.text)
      const min = authored('scaleLabelMin', same.scaleLabelMin)
      const max = authored('scaleLabelMax', same.scaleLabelMax)
      if (column === 'es') {
        if (text !== null) row.textEs = text
        if (min !== null) row.scaleLabelMinEs = min
        if (max !== null) row.scaleLabelMaxEs = max
      } else {
        if (text !== null) row.textEn = text
        if (min !== null) row.scaleLabelMinEn = min
        if (max !== null) row.scaleLabelMaxEn = max
      }
      row.options = row.options.map((option, optionIndex) => {
        const match = same.options?.find((candidate) => candidate.value === options[optionIndex]?.value)
        const label = match === undefined ? null : authored(`options[${match.order}].label`, match.label)
        if (label === null) return option
        return column === 'es' ? { ...option, labelEs: label } : { ...option, labelEn: label }
      })
    }
    return row
  })
}

/**
 * Whether the rows differ from the template as `/use` will copy it: a row dropped, added or
 * moved, or a question made optional or required. Only then is the copy rearranged, so a
 * survey started from a template and left alone costs exactly the request it always did.
 */
export function arrangementChanged(rows: readonly SurveyQuestionValues[], template: SurveyTemplateDetail): boolean {
  const pristine = [...template.questions].sort((a, b) => a.order - b.order)
  if (rows.length !== pristine.length) return true
  return rows.some((row, index) => row.templateOrder !== pristine[index].order || row.required !== pristine[index].required)
}

/**
 * The `questions` of the `PUT /surveys/{id}` that rearranges a template's copy. A template row
 * sends the copied question itself (`toQuestionInputs` over `GET /surveys/{id}` in every
 * language — option values verbatim, comment prompts kept), matched on the `order` the copy
 * inherited (`SurveyTemplateInstantiation` keeps the template's), with the row's position and
 * required flag. A row the author added sends what `POST /surveys` would, bank provenance
 * included.
 */
export function arrangedQuestions(values: SurveyWizardValues, copied: readonly AuthoringQuestion[]): unknown[] {
  const byOrder = new Map(copied.map((question) => [question.order, question]))
  const own = buildQuestionInputs(values)
  return values.questions.map((row, index) => {
    const source = row.templateOrder === undefined ? undefined : byOrder.get(row.templateOrder)
    if (source !== undefined) return toQuestionInputs([{ ...source, required: row.required, order: index }])[0]
    // `buildCreateInput` maps the rows one to one, so this is the row's own create shape.
    return { ...(own[index] ?? {}), order: index }
  })
}

/**
 * A question-bank item (`GET /admin/question-bank/{id}`) as a builder row. The bank writes one
 * text in one language, so the text, the scale words and the option labels go in that language's
 * column and the other stays for the author to fill; `sourceQuestionBankItemId` rides along so
 * the survey records where the question came from (#110).
 */
export function bankQuestion(item: QuestionBankItemDetail, key: string): SurveyQuestionValues {
  const es = item.language === 'es'
  const text = item.text ?? ''
  const row: SurveyQuestionValues = {
    ...emptyQuestion(key),
    type: item.type,
    required: true,
    category: item.category.trim(),
    scaleMin: item.scaleMin,
    scaleMax: item.scaleMax,
    sourceQuestionBankItemId: item.id,
    options: [...item.options]
      .sort((a, b) => a.order - b.order)
      .map((option, index) => {
        const label = option.label ?? option.value
        return { key: `${key}-o${index}`, labelEn: es ? '' : label, labelEs: es ? label : '' }
      }),
  }
  if (es) {
    row.textEs = text
    row.scaleLabelMinEs = item.scaleLabelMin ?? ''
    row.scaleLabelMaxEs = item.scaleLabelMax ?? ''
  } else {
    row.textEn = text
    row.scaleLabelMinEn = item.scaleLabelMin ?? ''
    row.scaleLabelMaxEn = item.scaleLabelMax ?? ''
  }
  return row
}
