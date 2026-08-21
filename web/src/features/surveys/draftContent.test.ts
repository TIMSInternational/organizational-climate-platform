import { describe, it, expect } from 'vitest'
import {
  SURVEY_DRAFT_CONTENT_VERSION,
  draftLocalized,
  draftValuesFrom,
  hasDraftableContent,
  toDraftContent,
} from './draftContent'
import { emptyQuestion, emptyWizardValues, type SurveyWizardValues } from './wizardValues'

function filled(): SurveyWizardValues {
  return {
    ...emptyWizardValues('both'),
    templateId: 'tpl-7',
    titleEn: 'Quarterly pulse',
    titleEs: 'Pulso trimestral',
    descriptionEn: 'How the quarter went',
    descriptionEs: 'Cómo fue el trimestre',
    type: 'pulse',
    startDate: '2026-09-01T09:00',
    endDate: '2026-09-08T17:00',
    departmentIds: ['dept-1', 'dept-2'],
    targetAudienceCount: '40',
    anonymous: false,
    allowPartialResponses: false,
    showProgress: false,
    questions: [
      {
        ...emptyQuestion('k-0'),
        textEn: 'Rate the quarter',
        textEs: 'Califica el trimestre',
        type: 'multiple_choice',
        required: false,
        options: [
          { key: 'k-1', labelEn: 'Good', labelEs: 'Bueno' },
          { key: 'k-2', labelEn: 'Bad', labelEs: 'Malo' },
        ],
        // The dimension and the scale ends ride the same round trip as the text —
        // a recovered draft that had lost its categories would restore every
        // question as uncategorised, silently.
        category: 'psychological_safety',
        scaleLabelMinEn: 'Strongly disagree',
        scaleLabelMinEs: 'Muy en desacuerdo',
        scaleLabelMaxEn: 'Strongly agree',
        scaleLabelMaxEs: 'Muy de acuerdo',
        // And the NUMBERS at those ends. Unlike every other field here they cannot
        // be recovered by retyping — nothing in the wizard collects a bound, they
        // arrive only from a picked library item, and a lost bound reads as the
        // default 1-5 rather than as blank.
        scaleMin: 0,
        scaleMax: 10,
      },
    ],
  }
}

describe('toDraftContent / draftValuesFrom', () => {
  it('round trips every field the wizard collects', () => {
    const original = filled()

    const restored = draftValuesFrom(toDraftContent(original), 'p', 'en')

    // Compared without the keys, which are deliberately regenerated rather than stored.
    const strip = (values: SurveyWizardValues) => ({
      ...values,
      questions: values.questions.map((question) => ({
        ...question,
        key: undefined,
        options: question.options.map((option) => ({ ...option, key: undefined })),
      })),
    })
    expect(strip(restored!)).toEqual(strip(original))
  })

  it('regenerates keys in a shape the page cannot mint, so React cannot reconcile two questions onto one node', () => {
    // The page mints `${prefix}-${n}` with a plain integer. A restored key colliding with
    // one of those is the bug this shape exists to make impossible.
    const values = { ...filled(), questions: [emptyQuestion('a'), emptyQuestion('b')] }

    const restored = draftValuesFrom(toDraftContent(values), 'p', 'en')!

    const keys = restored.questions.map((question) => question.key)
    expect(keys).toEqual(['p-q0', 'p-q1'])
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) {
      expect(key).not.toMatch(/^p-\d+$/)
    }
  })

  it('restores a draft from before the dimension picker with blanks, not by refusing it', () => {
    // Drafts live for the whole retention window, so the parser will meet the
    // pre-picker question shape. The seven new fields are additive and deliberately
    // did NOT bump `SURVEY_DRAFT_CONTENT_VERSION` — a bump would make every stored
    // draft unrecoverable for the sake of fields it never held.
    const legacy = toDraftContent(filled()) as unknown as Record<string, unknown>
    legacy.questions = (legacy.questions as Record<string, unknown>[]).map((question) => {
      const {
        category: _category,
        scaleLabelMinEn: _minEn,
        scaleLabelMinEs: _minEs,
        scaleLabelMaxEn: _maxEn,
        scaleLabelMaxEs: _maxEs,
        scaleMin: _min,
        scaleMax: _max,
        ...rest
      } = question
      return rest
    })

    const restored = draftValuesFrom(legacy, 'p', 'en')!

    expect(restored.questions[0].textEn).toBe('Rate the quarter')
    expect(restored.questions[0].category).toBe('')
    expect(restored.questions[0].scaleLabelMinEn).toBe('')
    expect(restored.questions[0].scaleLabelMaxEs).toBe('')
    // Null, not 1 and 5: a draft that never held a bound had the product default,
    // and inventing numbers here would file an author choice nobody made.
    expect(restored.questions[0].scaleMin).toBeNull()
    expect(restored.questions[0].scaleMax).toBeNull()
  })

  it('keeps a picked question scale bounds across an autosave and a recovery', () => {
    // The round-trip test above compares whole objects, which would also pass if
    // both sides lost the same field. This names it: a 0-10 question recovered as a
    // 1-5 one is the drop this branch fixed, arriving one refresh later instead.
    const restored = draftValuesFrom(toDraftContent(filled()), 'p', 'en')!

    expect(restored.questions[0].scaleMin).toBe(0)
    expect(restored.questions[0].scaleMax).toBe(10)
  })

  it('refuses a stored bound that is not a whole number rather than carrying it to a 400', () => {
    // `content` is arbitrary JSON the server never interprets, so the parser meets
    // whatever is in that column. `Question.ScaleMin` is an `int?`: a 2.5 or a NaN
    // would be refused on create, and a draft that cannot be submitted is worse
    // than one that lost a bound.
    const content = toDraftContent(filled()) as unknown as Record<string, unknown>
    ;(content.questions as Record<string, unknown>[])[0].scaleMin = 2.5
    ;(content.questions as Record<string, unknown>[])[0].scaleMax = 'ten'

    const restored = draftValuesFrom(content, 'p', 'en')!

    expect(restored.questions[0].scaleMin).toBeNull()
    expect(restored.questions[0].scaleMax).toBeNull()
  })

  it('gives an option a key distinct from every question key', () => {
    const restored = draftValuesFrom(toDraftContent(filled()), 'p', 'en')!

    const optionKeys = restored.questions.flatMap((q) => q.options.map((o) => o.key))
    expect(optionKeys).toEqual(['p-q0-o0', 'p-q0-o1'])
    expect(optionKeys).not.toContain('p-q0')
  })

  it('refuses a payload from a different content version', () => {
    const content = { ...toDraftContent(filled()), version: SURVEY_DRAFT_CONTENT_VERSION + 1 }

    expect(draftValuesFrom(content, 'p', 'en')).toBeNull()
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not a draft'],
    ['an array', [1, 2, 3]],
    ['an object with no version', { titleEn: 'x' }],
  ])('refuses %s rather than half-restoring it', (_label, content) => {
    expect(draftValuesFrom(content, 'p', 'en')).toBeNull()
  })

  it('keeps a draft whose individual fields are the wrong type, defaulting only those', () => {
    // Losing one field is retypeable; discarding the draft is the loss this prevents.
    const content = {
      version: SURVEY_DRAFT_CONTENT_VERSION,
      titleEn: 'Survives',
      titleEs: 42,
      anonymous: 'yes',
      departmentIds: ['ok', 7, null],
      questions: 'not an array',
    }

    const restored = draftValuesFrom(content, 'p', 'en')!

    expect(restored.titleEn).toBe('Survives')
    expect(restored.titleEs).toBe('')
    expect(restored.anonymous).toBe(true)
    expect(restored.departmentIds).toEqual(['ok'])
    expect(restored.questions).toEqual([])
  })

  it('drops a malformed question without shifting the keys of the ones that survive', () => {
    const content = {
      version: SURVEY_DRAFT_CONTENT_VERSION,
      questions: ['garbage', { textEn: 'Real one' }, null, { textEn: 'Another' }],
    }

    const restored = draftValuesFrom(content, 'p', 'en')!

    expect(restored.questions.map((q) => q.textEn)).toEqual(['Real one', 'Another'])
    expect(restored.questions.map((q) => q.key)).toEqual(['p-q0', 'p-q1'])
  })

  it('drops a malformed option rather than restoring it as a blank row', () => {
    // A blank option is not harmless: `questionErrors` refuses to continue past a
    // choice question with fewer than two *labelled* options, so a restored draft would
    // show an empty box the author has to find and delete before the wizard will move.
    const content = {
      version: SURVEY_DRAFT_CONTENT_VERSION,
      questions: [{ textEn: 'q', options: ['garbage', { labelEn: 'Real' }, null] }],
    }

    const restored = draftValuesFrom(content, 'p', 'en')!

    expect(restored.questions[0].options).toEqual([
      { key: 'p-q0-o0', labelEn: 'Real', labelEs: '' },
    ])
  })

  it('falls back to the given language when the stored one is not a content language', () => {
    const content = { version: SURVEY_DRAFT_CONTENT_VERSION, language: 'fr' }

    expect(draftValuesFrom(content, 'p', 'es')!.language).toBe('es')
  })

  it('keeps a stored language that is valid', () => {
    const content = { version: SURVEY_DRAFT_CONTENT_VERSION, language: 'both' }

    expect(draftValuesFrom(content, 'p', 'en')!.language).toBe('both')
  })

  it('preserves an unrecognised question type instead of rewriting it', () => {
    const content = {
      version: SURVEY_DRAFT_CONTENT_VERSION,
      questions: [{ textEn: 'q', type: 'invented_type' }],
    }

    expect(draftValuesFrom(content, 'p', 'en')!.questions[0].type).toBe('invented_type')
  })
})

describe('draftLocalized', () => {
  it('sends the object form for a bilingual draft, which is the only form the server accepts there', () => {
    expect(draftLocalized('both', ' Hello ', ' Hola ')).toEqual({ en: 'Hello', es: 'Hola' })
  })

  it('sends the column that matches a single-language draft', () => {
    expect(draftLocalized('en', 'Hello', 'Hola')).toBe('Hello')
    expect(draftLocalized('es', 'Hello', 'Hola')).toBe('Hola')
  })

  it('sends an empty string rather than nothing when a field is cleared', () => {
    // An omitted field is merged into the stored one server-side, so the draft would keep
    // a title the author had deleted.
    expect(draftLocalized('en', '   ', '')).toBe('')
    expect(draftLocalized('both', '', '')).toEqual({ en: '', es: '' })
  })
})

describe('hasDraftableContent', () => {
  it('is false for an untouched form, so opening the wizard leaves nothing behind', () => {
    expect(hasDraftableContent(emptyWizardValues('en'))).toBe(false)
    expect(hasDraftableContent(emptyWizardValues('both'))).toBe(false)
  })

  it('is false when only the seeded fields differ, since those were never typed', () => {
    const seeded = { ...emptyWizardValues('en'), language: 'es' as const, type: 'exit' }

    expect(hasDraftableContent(seeded)).toBe(false)
  })

  it('is false when only the pre-checked settings were toggled off', () => {
    // Arguable, and chosen deliberately: three booleans that arrive checked are not a
    // survey, and offering that back as "unfinished work" is the prompt people learn to
    // dismiss.
    const toggled = {
      ...emptyWizardValues('en'),
      anonymous: false,
      allowPartialResponses: false,
      showProgress: false,
    }

    expect(hasDraftableContent(toggled)).toBe(false)
  })

  it.each([
    ['an English title', { titleEn: 'x' }],
    ['a Spanish title', { titleEs: 'x' }],
    ['a description', { descriptionEn: 'x' }],
    ['a start date', { startDate: '2026-09-01T09:00' }],
    ['an end date', { endDate: '2026-09-01T09:00' }],
    ['an audience target', { targetAudienceCount: '10' }],
    ['a department', { departmentIds: ['d-1'] }],
  ])('is true once there is %s', (_label, patch) => {
    expect(hasDraftableContent({ ...emptyWizardValues('en'), ...patch })).toBe(true)
  })

  it('is true once a template is chosen, even with nothing else filled in', () => {
    // In template mode the choice IS the survey -- there are no questions of one's own
    // to count -- so leaving it out would mean such a draft was never saved.
    const values = { ...emptyWizardValues('en'), templateId: 'tpl-7' }

    expect(hasDraftableContent(values)).toBe(true)
  })

  it('is true for an added question even before it has any text', () => {
    const values = { ...emptyWizardValues('en'), questions: [emptyQuestion('k-0')] }

    expect(hasDraftableContent(values)).toBe(true)
  })

  it('ignores whitespace-only text', () => {
    expect(hasDraftableContent({ ...emptyWizardValues('en'), titleEn: '   ' })).toBe(false)
  })
})
