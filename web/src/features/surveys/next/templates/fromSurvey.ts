import type { LocalizedInput } from '../../api/surveyCreate'
import type { SurveyDetail, SurveyQuestion } from '../../api/surveys'
import type { CreateSurveyTemplateInput, CreateSurveyTemplateQuestionInput } from '../../api/surveyTemplates'

/**
 * A new template from one of the company's surveys — what "Nueva plantilla" on the Templates
 * artboard does. `POST /survey-templates` (`SurveyTemplateEndpoints.CreateAsync`) takes the
 * questions themselves, and the survey's questions are the ones the company already wrote and
 * ran, so the template copies them: text, type, options with their stable values, scale and
 * scale labels, the comment prompt, the order and the dimension.
 *
 * `GET /surveys/{id}?lang=` resolves every text into ONE locale, so a survey authored in both
 * languages is read once per language and the readings are zipped back into `{ en, es }` — the
 * locale-keyed form the server accepts whatever the content language
 * (`LocalizedInput.TryResolve`). A value the server lists in that reading's `fallbackFields`
 * (`questions[<order>].text`, `questions[<order>].options[<order>].label`, … —
 * `SurveyEndpoints.cs`, `SurveyContent.ToOptionDtos`) was not written in that language and is
 * left out, so the template never files English text as Spanish.
 */

export type ContentLocale = 'en' | 'es'

/** The languages a survey is read in: its own one, or both. */
export function localesOf(language: string): ContentLocale[] {
  return language === 'en' || language === 'es' ? [language] : ['en', 'es']
}

/** One `GET /surveys/{id}?lang=<locale>` answer. */
export interface SurveyReading {
  locale: ContentLocale
  detail: Pick<SurveyDetail, 'questions' | 'fallbackFields'>
}

function localized(
  readings: readonly SurveyReading[],
  path: string,
  pick: (question: SurveyQuestion) => string | null | undefined,
  questionId: string,
): LocalizedInput | undefined {
  const value: Partial<Record<ContentLocale, string>> = {}
  for (const { locale, detail } of readings) {
    if (detail.fallbackFields.includes(path)) continue
    const question = detail.questions.find((candidate) => candidate.id === questionId)
    const text = question ? pick(question) : null
    if (text && text.trim()) value[locale] = text
  }
  return Object.keys(value).length > 0 ? value : undefined
}

export function templateQuestionsFrom(readings: readonly SurveyReading[]): CreateSurveyTemplateQuestionInput[] {
  const [first] = readings
  if (!first) return []
  return [...first.detail.questions]
    .sort((a, b) => a.order - b.order)
    .map((question) => {
      const path = `questions[${question.order}]`
      const input: CreateSurveyTemplateQuestionInput = {
        text: localized(readings, `${path}.text`, (q) => q.text, question.id) ?? {},
        type: question.type,
        required: question.required,
        commentRequired: question.commentRequired,
        order: question.order,
      }
      if (question.options && question.options.length > 0) {
        input.options = [...question.options]
          .sort((a, b) => a.order - b.order)
          .map((option) => {
            const label = localized(
              readings,
              `${path}.options[${option.order}].label`,
              (q) => q.options?.find((candidate) => candidate.order === option.order)?.label,
              question.id,
            )
            return label ? { value: option.value, label } : { value: option.value }
          })
      }
      if (question.scaleMin !== null) input.scaleMin = question.scaleMin
      if (question.scaleMax !== null) input.scaleMax = question.scaleMax
      const scaleLabelMin = localized(readings, `${path}.scaleLabelMin`, (q) => q.scaleLabelMin, question.id)
      if (scaleLabelMin) input.scaleLabelMin = scaleLabelMin
      const scaleLabelMax = localized(readings, `${path}.scaleLabelMax`, (q) => q.scaleLabelMax, question.id)
      if (scaleLabelMax) input.scaleLabelMax = scaleLabelMax
      const commentPrompt = localized(readings, `${path}.commentPrompt`, (q) => q.commentPrompt, question.id)
      if (commentPrompt) input.commentPrompt = commentPrompt
      if (question.category) input.category = question.category
      return input
    })
}

export interface TemplateFromSurvey {
  readings: readonly SurveyReading[]
  survey: { id: string; language: string }
  companyId: string
  name: string
  description: string
  category: string
}

/** The whole `POST /survey-templates` body; the name and description as the admin typed them. */
export function templateInputFrom({ readings, survey, companyId, name, description, category }: TemplateFromSurvey): CreateSurveyTemplateInput {
  return {
    name,
    description,
    category,
    companyId,
    questions: templateQuestionsFrom(readings),
    sourceSurveyId: survey.id,
    language: survey.language,
  }
}
