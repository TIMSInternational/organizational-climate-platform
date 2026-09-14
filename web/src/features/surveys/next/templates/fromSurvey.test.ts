import { describe, it, expect } from 'vitest'
import type { SurveyQuestion } from '../../api/surveys'
import { localesOf, templateInputFrom, templateQuestionsFrom, type SurveyReading } from './fromSurvey'

/**
 * The first question of Meridiano's running Q4 as `GET /surveys/4c9c8c8c-…?lang=es` answered it
 * on 11 Sep (`scripts/shot-fixtures/org-meridiano.json`), with its English reading beside it —
 * the survey is authored in both languages (`"language": "both"`).
 */
const q4Es: SurveyQuestion = {
  id: 'bdca477a-e031-4a51-87b3-c762151dbb46',
  text: 'Puedo plantear preocupaciones sin miedo a represalias.',
  type: 'likert',
  options: null,
  scaleMin: 1,
  scaleMax: 5,
  scaleLabelMin: 'Muy en desacuerdo',
  scaleLabelMax: 'Muy de acuerdo',
  required: true,
  commentRequired: true,
  commentPrompt: null,
  order: 0,
  category: 'psychological_safety',
}
const q4En: SurveyQuestion = {
  ...q4Es,
  text: 'I can raise concerns without fear of retaliation.',
  scaleLabelMin: 'Strongly disagree',
  scaleLabelMax: 'Strongly agree',
}

/** A multiple-choice question whose second option was never translated to Spanish. */
const choiceEn: SurveyQuestion = {
  id: 'q-choice',
  text: 'How do you work?',
  type: 'multiple_choice',
  options: [
    { order: 0, value: 'on_site', label: 'On site' },
    { order: 1, value: 'remote', label: 'Remote' },
  ],
  scaleMin: null,
  scaleMax: null,
  scaleLabelMin: null,
  scaleLabelMax: null,
  required: false,
  commentRequired: false,
  commentPrompt: 'Anything else?',
  order: 1,
  category: null,
}
const choiceEs: SurveyQuestion = {
  ...choiceEn,
  text: '¿Cómo trabaja?',
  // The server fell back to English for this label and says so in `fallbackFields`.
  options: [
    { order: 0, value: 'on_site', label: 'Presencial' },
    { order: 1, value: 'remote', label: 'Remote' },
  ],
  commentPrompt: 'Anything else?',
}

const readings: SurveyReading[] = [
  { locale: 'en', detail: { questions: [choiceEn, q4En], fallbackFields: [] } },
  {
    locale: 'es',
    detail: { questions: [choiceEs, q4Es], fallbackFields: ['questions[1].options[1].label', 'questions[1].commentPrompt'] },
  },
]

describe('templateQuestionsFrom', () => {
  it('zips the two readings of a bilingual survey into locale-keyed questions, in order, keeping values, scale and dimension', () => {
    expect(templateQuestionsFrom(readings)).toEqual([
      {
        text: { en: 'I can raise concerns without fear of retaliation.', es: 'Puedo plantear preocupaciones sin miedo a represalias.' },
        type: 'likert',
        required: true,
        commentRequired: true,
        order: 0,
        scaleMin: 1,
        scaleMax: 5,
        scaleLabelMin: { en: 'Strongly disagree', es: 'Muy en desacuerdo' },
        scaleLabelMax: { en: 'Strongly agree', es: 'Muy de acuerdo' },
        category: 'psychological_safety',
      },
      {
        text: { en: 'How do you work?', es: '¿Cómo trabaja?' },
        type: 'multiple_choice',
        required: false,
        commentRequired: false,
        order: 1,
        // The fallback label and prompt are English only: never filed as Spanish.
        options: [
          { value: 'on_site', label: { en: 'On site', es: 'Presencial' } },
          { value: 'remote', label: { en: 'Remote' } },
        ],
        commentPrompt: { en: 'Anything else?' },
      },
    ])
  })

  it('reads a single-language survey once, in its own language', () => {
    expect(localesOf('es')).toEqual(['es'])
    expect(localesOf('en')).toEqual(['en'])
    expect(localesOf('both')).toEqual(['en', 'es'])
    const spanishOnly = templateQuestionsFrom([{ locale: 'es', detail: { questions: [q4Es], fallbackFields: [] } }])
    expect(spanishOnly[0].text).toEqual({ es: 'Puedo plantear preocupaciones sin miedo a represalias.' })
  })
})

describe('templateInputFrom', () => {
  it('builds the whole POST body: the admin’s name and description, the company, the source survey and its language', () => {
    const body = templateInputFrom({
      readings,
      survey: { id: 's-q4', language: 'both' },
      companyId: 'c1',
      name: 'Clima trimestral',
      description: 'Las preguntas de la Q4.',
      category: 'climate',
    })
    expect(body).toMatchObject({
      name: 'Clima trimestral',
      description: 'Las preguntas de la Q4.',
      category: 'climate',
      companyId: 'c1',
      sourceSurveyId: 's-q4',
      language: 'both',
    })
    expect(body.questions.map((question) => question.order)).toEqual([0, 1])
  })
})
