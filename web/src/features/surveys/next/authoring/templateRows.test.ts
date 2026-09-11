import { describe, expect, it } from 'vitest'
import type { AuthoringQuestion } from '../../api/surveyQuestionAuthoring'
import type { SurveyTemplateDetail } from '../../api/surveyTemplates'
import { emptyWizardValues, type SurveyWizardValues } from '../../wizardValues'
import { arrangedQuestions, arrangementChanged, bankQuestion, materialiseTemplate, templateCovers } from './templateRows'

function read(locale: 'es' | 'en', over: Partial<SurveyTemplateDetail> = {}): SurveyTemplateDetail {
  const es = locale === 'es'
  return {
    id: 't1', name: 'Instrumento', description: '', category: 'climate', industry: null, companySize: null, isPublic: true,
    companyId: 'c1', isGlobal: false, tags: [], usageCount: 0, rating: 0, language: 'both', resolvedLocale: locale,
    fallbackFields: [], sourceSurveyId: null, lastUsed: null, createdAt: '', updatedAt: '',
    questions: [
      { id: 'tq2', text: es ? 'Mi carga es sostenible.' : 'My workload is sustainable.', type: 'likert', options: null, scaleMin: 1, scaleMax: 5,
        scaleLabelMin: es ? 'Muy en desacuerdo' : 'Strongly disagree', scaleLabelMax: es ? 'Muy de acuerdo' : 'Strongly agree',
        required: true, commentRequired: false, commentPrompt: null, order: 1, category: 'workload' },
      { id: 'tq1', text: es ? '¿Cómo llega?' : 'How do you commute?', type: 'multiple_choice', scaleMin: null, scaleMax: null,
        options: [{ order: 1, value: 'bus', label: es ? 'Bus' : 'Bus' }, { order: 0, value: 'walk', label: es ? 'A pie' : 'On foot' }],
        scaleLabelMin: null, scaleLabelMax: null, required: false, commentRequired: true, commentPrompt: null, order: 0, category: null },
    ],
    ...over,
  }
}

describe('templateCovers', () => {
  it('offers a bilingual template every language, and a single-language one only its own', () => {
    expect(templateCovers('both', 'es')).toBe(true)
    expect(templateCovers('both', 'both')).toBe(true)
    expect(templateCovers('es', 'es')).toBe(true)
    expect(templateCovers('es', 'en')).toBe(false)
    expect(templateCovers('es', 'both')).toBe(false)
  })
})

describe('materialiseTemplate', () => {
  it("copies the template's questions in its order, both columns, options by value, each with the order it came from", () => {
    const rows = materialiseTemplate([read('es'), read('en')], ['k0', 'k1'])
    expect(rows.map((row) => [row.templateOrder, row.textEs, row.textEn, row.required, row.category])).toEqual([
      [0, '¿Cómo llega?', 'How do you commute?', false, ''],
      [1, 'Mi carga es sostenible.', 'My workload is sustainable.', true, 'workload'],
    ])
    expect(rows[0].options.map((o) => [o.labelEs, o.labelEn])).toEqual([['A pie', 'On foot'], ['Bus', 'Bus']])
    expect([rows[1].scaleMin, rows[1].scaleMax, rows[1].scaleLabelMinEs, rows[1].scaleLabelMaxEn]).toEqual([1, 5, 'Muy en desacuerdo', 'Strongly agree'])
    expect(rows.map((row) => row.key)).toEqual(['k0', 'k1'])
  })

  it('leaves a column blank rather than filing the other language in it', () => {
    const english = read('en', { fallbackFields: ['questions[1].text'] })
    const rows = materialiseTemplate([read('es'), english], ['k0', 'k1'])
    expect(rows[1].textEn).toBe('')
    expect(rows[1].textEs).toBe('Mi carga es sostenible.')
    // A read that came back in Spanish when English was asked for fills no English column.
    expect(materialiseTemplate([read('es'), read('es')], ['k0', 'k1'])[1].textEn).toBe('')
  })
})

describe('arrangementChanged', () => {
  const template = read('es')
  const rows = () => materialiseTemplate([template], ['k0', 'k1'])
  it('is false for the rows as the template has them, so an untouched template costs only /use', () => {
    expect(arrangementChanged(rows(), template)).toBe(false)
  })
  it('is true for a moved, dropped, added or re-flagged row', () => {
    expect(arrangementChanged([...rows()].reverse(), template)).toBe(true)
    expect(arrangementChanged(rows().slice(1), template)).toBe(true)
    expect(arrangementChanged([...rows(), { ...rows()[0], templateOrder: undefined, key: 'x' }], template)).toBe(true)
    expect(arrangementChanged(rows().map((row, i) => (i === 1 ? { ...row, required: false } : row)), template)).toBe(true)
  })
})

describe('arrangedQuestions', () => {
  const authored = (text: string) => ({ es: { text, authored: true }, en: { text: '', authored: false } })
  const blank = { es: { text: '', authored: false }, en: { text: '', authored: false } }
  const copied: AuthoringQuestion[] = [
    { id: 's0', type: 'multiple_choice', order: 0, category: null, required: false, commentRequired: true, scaleMin: null, scaleMax: null,
      text: authored('¿Cómo llega?'), scaleLabelMin: blank, scaleLabelMax: blank, commentPrompt: authored('¿Algo más?'),
      options: [{ value: 'walk', label: authored('A pie') }, { value: 'bus', label: authored('Bus') }] },
    { id: 's1', type: 'likert', order: 1, category: 'workload', required: true, commentRequired: false, scaleMin: 1, scaleMax: 5,
      text: authored('Mi carga es sostenible.'), scaleLabelMin: authored('Muy en desacuerdo'), scaleLabelMax: authored('Muy de acuerdo'),
      commentPrompt: blank, options: null },
  ]

  it("sends the copy's own question at the row's position, with the row's required flag and the option values verbatim", () => {
    const rows = materialiseTemplate([read('es')], ['k0', 'k1']).reverse()
    rows[1] = { ...rows[1], required: true }
    const values: SurveyWizardValues = { ...emptyWizardValues('es'), templateId: 't1', titleEs: 'Q1', questions: rows }
    const sent = arrangedQuestions(values, copied) as Record<string, unknown>[]
    expect(sent.map((q) => [q.text, q.order, q.required])).toEqual([
      [{ es: 'Mi carga es sostenible.' }, 0, true],
      [{ es: '¿Cómo llega?' }, 1, true],
    ])
    expect(sent[1].options).toEqual([{ value: 'walk', label: { es: 'A pie' } }, { value: 'bus', label: { es: 'Bus' } }])
    expect(sent[1].commentPrompt).toEqual({ es: '¿Algo más?' })
  })

  it('sends an added row as POST /surveys would, bank provenance included', () => {
    const rows = materialiseTemplate([read('es')], ['k0', 'k1'])
    const added = { ...rows[1], key: 'x', templateOrder: undefined, textEs: 'Del banco.', sourceQuestionBankItemId: 'b1' }
    const values: SurveyWizardValues = { ...emptyWizardValues('es'), templateId: 't1', titleEs: 'Q1', questions: [...rows, added] }
    const sent = arrangedQuestions(values, copied) as Record<string, unknown>[]
    expect(sent).toHaveLength(3)
    expect(sent[2]).toMatchObject({ text: 'Del banco.', order: 2, sourceQuestionBankItemId: 'b1' })
  })
})

describe('bankQuestion', () => {
  it("files the bank's one language in its column and keeps the item it came from", () => {
    const row = bankQuestion(
      {
        id: 'b1', companyId: null, text: 'Me siento escuchado.', language: 'es', type: 'likert', category: 'trust ', subcategory: null,
        industry: null, companySize: null, usageCount: 0, responseRate: 0, insightScore: 0, lastUsedAt: null, isActive: true,
        isAiGenerated: false, version: 1, parentQuestionBankItemId: null, tags: [], scaleMin: 1, scaleMax: 5,
        scaleLabelMin: 'Nunca', scaleLabelMax: 'Siempre', variationCount: 0, createdAt: '', updatedAt: '', options: [],
      },
      'k9',
    )
    expect([row.textEs, row.textEn, row.scaleLabelMinEs, row.category, row.sourceQuestionBankItemId, row.templateOrder]).toEqual([
      'Me siento escuchado.', '', 'Nunca', 'trust', 'b1', undefined,
    ])
  })
})
