import { describe, expect, it } from 'vitest'
import { draftValuesFrom, toDraftContent } from './draftContent'
import { buildCreateInput, buildInstantiateInput, emptyQuestion, emptyWizardValues, type SurveyWizardValues } from './wizardValues'

/**
 * The two optional fields the redesigned builder adds to a wizard question — the template
 * question a row was copied from and the bank item a row was picked from — and the language the
 * template path now sends. Each rides the payload or the draft only when set.
 */
function values(over: Partial<SurveyWizardValues> = {}): SurveyWizardValues {
  return {
    ...emptyWizardValues('es'),
    titleEs: 'Clima Q1',
    startDate: '2027-01-11T09:00',
    endDate: '2027-02-01T17:00',
    questions: [
      { ...emptyQuestion('k0'), textEs: 'Del banco.', category: 'trust', sourceQuestionBankItemId: 'b1' },
      { ...emptyQuestion('k1'), textEs: 'Escrita aquí.', category: 'trust' },
    ],
    ...over,
  }
}

describe('buildCreateInput — bank provenance (#110)', () => {
  it('sends sourceQuestionBankItemId for a question picked from the bank, and nothing for one written here', () => {
    const input = buildCreateInput(values(), 'c1')
    expect(input.questions[0].sourceQuestionBankItemId).toBe('b1')
    expect('sourceQuestionBankItemId' in input.questions[1]).toBe(false)
  })
})

describe('buildInstantiateInput — the content language', () => {
  it('sends the language the author chose, which UseSurveyTemplateRequest.Language honours', () => {
    expect(buildInstantiateInput(values({ templateId: 't1', language: 'es' }), 'c1').language).toBe('es')
    expect(buildInstantiateInput(values({ templateId: 't1', language: 'both', titleEn: 'Q1' }), 'c1').language).toBe('both')
  })
})

describe('the draft round trip', () => {
  it('keeps where a row came from, and restores a row that never had either without them', () => {
    const rows = [
      { ...emptyQuestion('k0'), textEs: 'Copiada.', templateOrder: 3 },
      { ...emptyQuestion('k1'), textEs: 'Del banco.', sourceQuestionBankItemId: 'b1' },
      { ...emptyQuestion('k2'), textEs: 'Escrita aquí.' },
    ]
    const content = toDraftContent(values({ templateId: 't1', questions: rows }))
    expect(content.questions.map((q) => [q.templateOrder, q.sourceQuestionBankItemId])).toEqual([
      [3, undefined],
      [undefined, 'b1'],
      [undefined, undefined],
    ])
    const restored = draftValuesFrom(JSON.parse(JSON.stringify(content)), 'r', 'es')
    expect(restored?.questions.map((q) => [q.templateOrder, q.sourceQuestionBankItemId])).toEqual([
      [3, undefined],
      [undefined, 'b1'],
      [undefined, undefined],
    ])
    expect(restored?.questions[2]).not.toHaveProperty('templateOrder')
  })

  it('refuses a stored template order that is not a whole number rather than inventing a row origin', () => {
    const content = toDraftContent(values({ questions: [{ ...emptyQuestion('k0'), textEs: 'x' }] })) as unknown as {
      questions: Record<string, unknown>[]
    }
    content.questions[0].templateOrder = 'first'
    expect(draftValuesFrom(content, 'r', 'es')?.questions[0].templateOrder).toBeUndefined()
  })
})
