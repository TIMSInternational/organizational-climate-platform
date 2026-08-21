import { describe, it, expect } from 'vitest'
import type { QuestionLibraryItemDetail } from '../questions/api/questionLibrary'
import { buildCreateInput, derivedOptionValue, emptyWizardValues, questionFromLibrary } from './wizardValues'

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

describe('questionFromLibrary (survey wizard)', () => {
  it('carries both languages, the type and the scale-end words', () => {
    const question = questionFromLibrary(detail(), 'k1')

    expect(question.textEn).toBe('My manager keeps their word')
    expect(question.textEs).toBe('Mi jefe cumple su palabra')
    expect(question.type).toBe('likert')
    expect(question.scaleLabelMinEn).toBe('Never')
    expect(question.scaleLabelMaxEs).toBe('Siempre')
  })

  it('carries the scale BOUNDS, which a null reads as 1-5 rather than as absent', () => {
    // The words and the numbers are one fact. `respondAnswers.ts` answers a null
    // bound with DEFAULT_SCALE_MIN/MAX (1 and 5), so an item authored 0-10 whose
    // bounds were dropped is not an incomplete question, it is a five-point question
    // wearing an eleven-point question's labels.
    const question = questionFromLibrary(detail({ scaleMin: 0, scaleMax: 10 }), 'k1')

    expect(question.scaleMin).toBe(0)
    expect(question.scaleMax).toBe(10)
  })

  it('leaves the bounds null when the library item sets none', () => {
    // Null is the product default, and the honest value for it: inventing 1 and 5
    // here would file an author choice that was never made.
    const question = questionFromLibrary(detail({ scaleMin: null, scaleMax: null }), 'k1')

    expect(question.scaleMin).toBeNull()
    expect(question.scaleMax).toBeNull()
  })

  it('files the library dimension as the RAW category key', () => {
    // `Question.Category` is what the climate map, the standings table and the
    // respond page group on. A display name here would mint a second dimension
    // beside every survey that stored the key.
    expect(questionFromLibrary(detail(), 'k1').category).toBe('psychological_safety')
  })

  it('leaves the category blank when the library item has no dimension', () => {
    expect(questionFromLibrary(detail({ dimension: null }), 'k1').category).toBe('')
  })

  it('gives every option a distinct key derived from the question key', () => {
    // The page's `makeKey()` reads its counter out of a render closure, so N calls
    // in one handler return the SAME string. Two options sharing a React key remount
    // each other on every keystroke.
    const question = questionFromLibrary(
      detail({
        type: 'multiple_choice',
        options: [
          { order: 0, value: 'weekly', labelEn: 'Weekly', labelEs: 'Semanalmente' },
          { order: 1, value: 'monthly', labelEn: 'Monthly', labelEs: 'Mensualmente' },
        ],
      }),
      'k7',
    )

    expect(question.options.map((option) => option.key)).toEqual(['k7-o0', 'k7-o1'])
    expect(new Set(question.options.map((option) => option.key)).size).toBe(2)
  })

  it('reproduces the library stable option value through the wizard own derivation', () => {
    // The server derives an omitted option value from the English label
    // (`NormaliseOptions`), and so does the wizard (`derivedOptionValue`). Carrying
    // the English label across is what makes two surveys built from one library item
    // aggregate together.
    const question = questionFromLibrary(
      detail({
        type: 'multiple_choice',
        options: [{ order: 0, value: 'Weekly', labelEn: 'Weekly', labelEs: 'Semanalmente' }],
      }),
      'k1',
    )

    expect(derivedOptionValue(question.options[0])).toBe('Weekly')
  })

  it('falls back to the stable value when the item carries no English label', () => {
    const question = questionFromLibrary(
      detail({
        type: 'multiple_choice',
        options: [{ order: 0, value: 'semanal', labelEn: null, labelEs: 'Semanalmente' }],
      }),
      'k1',
    )

    expect(question.options[0].labelEn).toBe('semanal')
  })

  it('starts required, because the library stores a question and not a policy', () => {
    expect(questionFromLibrary(detail(), 'k1').required).toBe(true)
  })

  it('reaches the wire as a real question on the POST body', () => {
    // The mapping is only worth anything if `buildCreateInput` can serialise what it
    // produced — a shape that is right in the wizard and wrong on the wire is the
    // failure this whole seam exists to avoid.
    const values = emptyWizardValues('both')
    // `buildCreateInput` puts both dates through `new Date(...).toISOString()`, which
    // throws on the empty seed. The dates are not what this test is about; they just
    // have to be real.
    values.titleEn = 'Q3 climate'
    values.titleEs = 'Clima Q3'
    values.startDate = '2026-09-01T09:00'
    values.endDate = '2026-09-15T17:00'
    values.questions = [questionFromLibrary(detail(), 'k1')]
    const body = buildCreateInput(values, 'company-1')

    expect(body.questions?.[0]).toMatchObject({
      text: { en: 'My manager keeps their word', es: 'Mi jefe cumple su palabra' },
      type: 'likert',
      category: 'psychological_safety',
      // 0-based here; the microclimate wizard is 1-based. Not this slice's to
      // reconcile, but worth pinning so a picked question is not the thing that
      // discovers it.
      order: 0,
    })
  })
})
