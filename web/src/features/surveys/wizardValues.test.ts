import { describe, it, expect } from 'vitest'
import {
  SURVEY_WIZARD_STEPS,
  buildCreateInput,
  chosenDimensions,
  derivedOptionValue,
  emptyOption,
  emptyQuestion,
  emptyWizardValues,
  localizedFor,
  positionsWithoutDimension,
  scheduledDays,
  surveyQuestionCount,
  wizardStepErrors,
  type SurveyWizardValues,
} from './wizardValues'
import { CATALOGUES } from '../../i18n/locale'
import { createTranslator } from '../../i18n/translate'

const t = createTranslator(CATALOGUES.en)
const COMPANY = '22cc8ed9-2e02-401a-8d52-52068ff5e6c0'

/** A wizard filled in far enough that every step passes. */
function complete(overrides: Partial<SurveyWizardValues> = {}): SurveyWizardValues {
  return {
    ...emptyWizardValues('en'),
    titleEn: 'Q3 climate',
    startDate: '2026-09-01T09:00',
    endDate: '2026-09-15T17:00',
    questions: [{ ...emptyQuestion('q1'), textEn: 'How is it going?', type: 'open_ended' }],
    ...overrides,
  }
}

describe('survey wizard validation', () => {
  it('lets a completed wizard through every step', () => {
    const errors = wizardStepErrors(complete(), t)
    for (const step of SURVEY_WIZARD_STEPS) {
      expect(errors[step], `${step} should be clear`).toEqual([])
    }
  })

  it('needs a title, and needs both of them when the survey is bilingual', () => {
    expect(wizardStepErrors(complete({ titleEn: '  ' }), t).basics).toHaveLength(1)
    const bilingual = complete({ language: 'both', titleEn: 'Q3', titleEs: '' })
    expect(wizardStepErrors(bilingual, t).basics).toHaveLength(1)
    expect(wizardStepErrors({ ...bilingual, titleEs: 'T3' }, t).basics).toEqual([])
  })

  /**
   * A Spanish-only survey's title lives in the `titleEs` column, so filling the
   * English one must not satisfy it. This is the bug the language-aware branch exists
   * for and it is invisible from an English fixture.
   */
  it('reads the title from the column its own language uses', () => {
    expect(wizardStepErrors(complete({ language: 'es' }), t).basics).toHaveLength(1)
    expect(
      wizardStepErrors(complete({ language: 'es', titleEs: 'Clima Q3' }), t).basics,
    ).toEqual([])
  })

  it('requires an end after the start, not merely two dates', () => {
    expect(wizardStepErrors(complete({ endDate: '2026-09-01T09:00' }), t).schedule).toHaveLength(1)
    expect(wizardStepErrors(complete({ endDate: '2026-08-01T09:00' }), t).schedule).toHaveLength(1)
    expect(wizardStepErrors(complete({ startDate: '' }), t).schedule).toHaveLength(1)
  })

  /**
   * The audience step is entirely optional in the DTO. Blocking on a field the admin
   * deliberately left blank is how a wizard becomes a maze, so only a *typed* and
   * invalid target is an error.
   */
  it('accepts an empty audience target but not a nonsensical one', () => {
    expect(wizardStepErrors(complete({ targetAudienceCount: '' }), t).audience).toEqual([])
    expect(wizardStepErrors(complete({ targetAudienceCount: '25' }), t).audience).toEqual([])
    expect(wizardStepErrors(complete({ targetAudienceCount: '0' }), t).audience).toHaveLength(1)
    expect(wizardStepErrors(complete({ targetAudienceCount: '-3' }), t).audience).toHaveLength(1)
    expect(wizardStepErrors(complete({ targetAudienceCount: '2.5' }), t).audience).toHaveLength(1)
  })

  it('needs at least one question, with text', () => {
    expect(wizardStepErrors(complete({ questions: [] }), t).questions).toHaveLength(1)
    const blank = complete({ questions: [emptyQuestion('q1')] })
    expect(wizardStepErrors(blank, t).questions).toHaveLength(1)
  })

  it('needs two options on an option-based question, and rejects duplicates', () => {
    const withOptions = (labels: string[]) =>
      complete({
        questions: [
          {
            ...emptyQuestion('q1'),
            textEn: 'Pick one',
            type: 'multiple_choice',
            options: labels.map((label, i) => ({ ...emptyOption(`o${i}`), labelEn: label })),
          },
        ],
      })

    expect(wizardStepErrors(withOptions(['Yes']), t).questions).toHaveLength(1)
    expect(wizardStepErrors(withOptions(['Yes', 'No']), t).questions).toEqual([])
    expect(wizardStepErrors(withOptions(['Yes', 'Yes']), t).questions).toHaveLength(1)
    // An open-ended question has no options and must not be asked for any.
    expect(wizardStepErrors(complete(), t).questions).toEqual([])
  })

  it('gathers every step onto review, so submit cannot fire on invalid values', () => {
    const broken = complete({ titleEn: '', endDate: '', questions: [] })
    const errors = wizardStepErrors(broken, t)
    expect(errors.review.length).toBe(
      errors.basics.length + errors.schedule.length + errors.audience.length + errors.questions.length,
    )
    expect(errors.review.length).toBeGreaterThan(2)
  })

  it('renders no untranslated key paths', () => {
    const errors = wizardStepErrors(complete({ titleEn: '', questions: [] }), t)
    for (const message of errors.review) expect(message).not.toMatch(/^surveys\./)
  })
})

describe('localizedFor', () => {
  it('sends a bare string for a single-language survey and an object for a bilingual one', () => {
    expect(localizedFor('en', ' Hello ', '')).toBe('Hello')
    expect(localizedFor('es', '', ' Hola ')).toBe('Hola')
    expect(localizedFor('both', ' Hello ', ' Hola ')).toEqual({ en: 'Hello', es: 'Hola' })
  })

  it('is undefined when a single-language column is empty, so the field is omitted', () => {
    expect(localizedFor('en', '   ', 'Hola')).toBeUndefined()
  })
})

describe('derivedOptionValue', () => {
  // Mirrors the server's own rule; the duplicate check compares the same strings it will.
  it('is the English label, or the Spanish one when there is no English', () => {
    expect(derivedOptionValue({ key: 'a', labelEn: ' Yes ', labelEs: 'Sí' })).toBe('Yes')
    expect(derivedOptionValue({ key: 'a', labelEn: '', labelEs: ' Sí ' })).toBe('Sí')
    expect(derivedOptionValue({ key: 'a', labelEn: '', labelEs: '' })).toBeNull()
  })
})

describe('scheduledDays', () => {
  it('counts whole days, and is null when the range is unusable', () => {
    expect(scheduledDays(complete())).toBe(14)
    expect(scheduledDays(complete({ endDate: '' }))).toBeNull()
    expect(scheduledDays(complete({ endDate: '2026-08-01T09:00' }))).toBeNull()
  })
})

describe('buildCreateInput', () => {
  it('sends ISO dates, the language, and only the three settings the wizard asked about', () => {
    const input = buildCreateInput(complete({ anonymous: false }), COMPANY)
    expect(input.companyId).toBe(COMPANY)
    expect(input.language).toBe('en')
    expect(input.startDate).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
    expect(new Date(input.endDate).getTime()).toBeGreaterThan(new Date(input.startDate).getTime())
    expect(Object.keys(input.settings ?? {}).sort()).toEqual([
      'allowPartialResponses',
      'anonymous',
      'showProgress',
    ])
    expect(input.settings?.anonymous).toBe(false)
  })

  /**
   * Omitted rather than sent empty: `departmentIds: []` and `targetAudienceCount: 0`
   * are both meaningful values server-side, and neither is what "the admin left this
   * alone" means.
   */
  it('omits the optional fields the admin left alone', () => {
    const input = buildCreateInput(complete(), COMPANY)
    expect(input).not.toHaveProperty('departmentIds')
    expect(input).not.toHaveProperty('targetAudienceCount')
    expect(input).not.toHaveProperty('description')
  })

  it('sends them once they are set', () => {
    const input = buildCreateInput(
      complete({ departmentIds: ['d1'], targetAudienceCount: '25', descriptionEn: 'Why' }),
      COMPANY,
    )
    expect(input.departmentIds).toEqual(['d1'])
    expect(input.targetAudienceCount).toBe(25)
    expect(input.description).toBe('Why')
  })

  it('orders questions by position and never invents an option value', () => {
    const input = buildCreateInput(
      complete({
        questions: [
          {
            ...emptyQuestion('q1'),
            textEn: 'Pick',
            type: 'multiple_choice',
            options: [
              { ...emptyOption('o1'), labelEn: 'Yes' },
              { ...emptyOption('o2'), labelEn: 'No' },
              // Started and abandoned — dropped, which is what the duplicate check assumes.
              emptyOption('o3'),
            ],
          },
          { ...emptyQuestion('q2'), textEn: 'Tell me more', type: 'open_ended' },
        ],
      }),
      COMPANY,
    )
    expect(input.questions?.map((q) => q.order)).toEqual([0, 1])
    expect(input.questions?.[0].options).toEqual([{ label: 'Yes' }, { label: 'No' }])
    for (const option of input.questions?.[0].options ?? []) {
      expect(option).not.toHaveProperty('value')
    }
    // An open-ended question carries no options key at all.
    expect(input.questions?.[1]).not.toHaveProperty('options')
  })

  it('builds per-locale objects for a bilingual survey', () => {
    const input = buildCreateInput(
      complete({ language: 'both', titleEn: 'Q3', titleEs: 'T3' }),
      COMPANY,
    )
    expect(input.title).toEqual({ en: 'Q3', es: 'T3' })
  })

  /**
   * The picker's law: `Question.Category` is what the respond page and the results
   * pages group on, RAW. The value must cross the wire exactly as stored — a display
   * name, a trim-plus-reslug, any transformation at all would split this survey's
   * dimension away from every survey that stored the key.
   */
  it('sends the category exactly as stored, and omits it when blank', () => {
    const input = buildCreateInput(
      complete({
        questions: [
          { ...emptyQuestion('q1'), textEn: 'Safe?', category: 'psychological_safety' },
          // The author's own vocabulary, spaces and case intact.
          { ...emptyQuestion('q2'), textEn: 'Supported?', category: 'Team Support' },
          { ...emptyQuestion('q3'), textEn: 'Anything else?', type: 'open_ended' },
        ],
      }),
      COMPANY,
    )
    expect(input.questions?.[0].category).toBe('psychological_safety')
    expect(input.questions?.[1].category).toBe('Team Support')
    // Omitted, never sent as '': the server's null is the honest value for
    // "uncategorised", and an empty string is a different (and wrong) category key.
    expect(input.questions?.[2]).not.toHaveProperty('category')
  })

  it('sends the scale-end labels for scale questions and never for the rest', () => {
    const input = buildCreateInput(
      complete({
        questions: [
          {
            ...emptyQuestion('q1'),
            textEn: 'Safe?',
            scaleLabelMinEn: 'Strongly disagree',
            scaleLabelMaxEn: 'Strongly agree',
          },
          {
            // Typed while the card was a likert, then the type was changed: the words
            // survive in the state but must not be sent for a type with no scale.
            ...emptyQuestion('q2'),
            textEn: 'Anything else?',
            type: 'open_ended',
            scaleLabelMinEn: 'Strongly disagree',
            scaleLabelMaxEn: 'Strongly agree',
          },
        ],
      }),
      COMPANY,
    )
    // A single-language survey sends the bare-string form, like every other localized field.
    expect(input.questions?.[0].scaleLabelMin).toBe('Strongly disagree')
    expect(input.questions?.[0].scaleLabelMax).toBe('Strongly agree')
    expect(input.questions?.[1]).not.toHaveProperty('scaleLabelMin')
    expect(input.questions?.[1]).not.toHaveProperty('scaleLabelMax')
  })

  it('omits untouched scale labels, and sends only the filled half of a bilingual pair', () => {
    const input = buildCreateInput(
      complete({
        language: 'both',
        titleEn: 'Q3',
        titleEs: 'T3',
        questions: [
          {
            ...emptyQuestion('q1'),
            textEn: 'Safe?',
            textEs: '¿Seguro?',
            scaleLabelMinEn: 'Strongly disagree',
          },
        ],
      }),
      COMPANY,
    )
    // Not `{ en: 'Strongly disagree', es: '' }`: an empty string filed into the
    // Spanish column is not "not yet written", it is a written empty label.
    expect(input.questions?.[0].scaleLabelMin).toEqual({ en: 'Strongly disagree' })
    expect(input.questions?.[0]).not.toHaveProperty('scaleLabelMax')
  })
})

/**
 * The two dimension readings — the rail's "Dimensions so far" and the review's
 * coverage line both derive from these, so what counts as "a dimension" is decided
 * here once.
 */
describe('dimension coverage', () => {
  it('counts each dimension once, in first-use order, ignoring blanks', () => {
    const values = complete({
      questions: [
        { ...emptyQuestion('q1'), textEn: 'A', category: 'trust' },
        { ...emptyQuestion('q2'), textEn: 'B', category: 'workload' },
        // The same key again — one dimension, not two.
        { ...emptyQuestion('q3'), textEn: 'C', category: 'trust' },
        // Whitespace-only is blank, not a dimension named " ".
        { ...emptyQuestion('q4'), textEn: 'D', category: '  ' },
      ],
    })
    expect(chosenDimensions(values)).toEqual(['trust', 'workload'])
    expect(positionsWithoutDimension(values)).toEqual([4])
  })

  it('treats a padded key as the key it will aggregate as', () => {
    // `dimensionKeyOf` on the results side trims before grouping, so 'trust' and
    // 'trust ' are ONE dimension there and must be one here.
    const values = complete({
      questions: [
        { ...emptyQuestion('q1'), textEn: 'A', category: 'trust' },
        { ...emptyQuestion('q2'), textEn: 'B', category: ' trust ' },
      ],
    })
    expect(chosenDimensions(values)).toEqual(['trust'])
  })
})

/**
 * How many questions the survey will have — the number the review step reads out.
 *
 * Worth its own function and its own tests because the two sources cannot be told
 * apart by looking at them: in template mode the wizard's own `questions` array is
 * empty and correct, so a call site that reads `values.questions.length` reports 0 for
 * a twelve-question template and looks perfectly reasonable doing it.
 */
describe('surveyQuestionCount', () => {
  it('counts the wizard’s own questions for a blank survey, ignoring any template count', () => {
    const values = complete({
      questions: [
        { ...emptyQuestion('q1'), textEn: 'One' },
        { ...emptyQuestion('q2'), textEn: 'Two' },
      ],
    })
    // 9 is a template's count that must not be reachable here: no template is chosen.
    expect(surveyQuestionCount(values, 9)).toBe(2)
  })

  it("counts the template's questions in template mode, not the empty form's", () => {
    const values = complete({ templateId: 'tpl-1', questions: [] })
    expect(surveyQuestionCount(values, 12)).toBe(12)
  })

  it('reports zero for a template whose detail has not arrived', () => {
    // Not the form's own length, which is the wrong number and would let the review step
    // claim a count for a template it has not read.
    const values = complete({
      templateId: 'tpl-1',
      questions: [{ ...emptyQuestion('stale'), textEn: 'Left over from before' }],
    })
    expect(surveyQuestionCount(values, null)).toBe(0)
  })
})
