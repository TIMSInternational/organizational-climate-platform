import { describe, it, expect } from 'vitest'
import type { QuestionLibraryItemDetail } from '../questions/api/questionLibrary'
import { buildCreateInput, emptyWizardValues, questionFromLibrary } from './wizardValues'

function detail(overrides: Partial<QuestionLibraryItemDetail> = {}): QuestionLibraryItemDetail {
  return {
    id: 'lib-1',
    companyId: null,
    questionCategoryId: 'trust',
    textEn: 'My manager keeps their word',
    textEs: 'Mi jefe cumple su palabra',
    type: 'likert',
    dimension: 'psychological_safety',
    usageCount: 0,
    lastUsedAt: null,
    isActive: true,
    version: 1,
    tags: [],
    language: 'both',
    scaleMin: 1,
    scaleMax: 5,
    scaleLabelMinEn: 'Never',
    scaleLabelMinEs: 'Nunca',
    scaleLabelMaxEn: 'Always',
    scaleLabelMaxEs: 'Siempre',
    previousVersionId: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    options: [],
    ...overrides,
  }
}

describe('questionFromLibrary (microclimate wizard)', () => {
  it('carries both languages and the type', () => {
    const question = questionFromLibrary(detail(), 'k1')

    expect(question.textEn).toBe('My manager keeps their word')
    expect(question.textEs).toBe('Mi jefe cumple su palabra')
    expect(question.type).toBe('likert')
    expect(question.required).toBe(true)
  })

  it('gives every option a distinct key derived from the question key', () => {
    const question = questionFromLibrary(
      detail({
        type: 'multiple_choice',
        options: [
          { order: 0, value: 'weekly', labelEn: 'Weekly', labelEs: 'Semanalmente' },
          { order: 1, value: 'monthly', labelEn: 'Monthly', labelEs: 'Mensualmente' },
        ],
      }),
      'k3',
    )

    expect(question.options.map((option) => option.key)).toEqual(['k3-o0', 'k3-o1'])
  })

  it('reaches the wire as a real question on the POST body', () => {
    const values = emptyWizardValues('both')
    values.questions = [
      questionFromLibrary(
        detail({
          type: 'multiple_choice',
          options: [
            { order: 0, value: 'weekly', labelEn: 'Weekly', labelEs: 'Semanalmente' },
            { order: 1, value: 'monthly', labelEn: 'Monthly', labelEs: 'Mensualmente' },
          ],
        }),
        'k1',
      ),
    ]
    const body = buildCreateInput(values, 'company-1')

    expect(body.questions?.[0]).toMatchObject({
      text: { en: 'My manager keeps their word', es: 'Mi jefe cumple su palabra' },
      type: 'multiple_choice',
      required: true,
      order: 1,
    })
    expect(body.questions?.[0].options).toEqual([
      { label: { en: 'Weekly', es: 'Semanalmente' } },
      { label: { en: 'Monthly', es: 'Mensualmente' } },
    ])
  })
})
