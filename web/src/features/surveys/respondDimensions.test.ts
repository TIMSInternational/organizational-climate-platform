import { describe, it, expect } from 'vitest'
import { respondDimensions } from './respondDimensions'
import { UNCATEGORISED_DIMENSION, dimensionKeyOf } from './surveyResultsMap'
import type { SurveyRespondQuestion } from './api/surveyResponses'

function question(overrides: Partial<SurveyRespondQuestion> = {}): SurveyRespondQuestion {
  return {
    id: 'q1',
    text: 'In my team I can raise a problem without it being held against me.',
    type: 'likert',
    options: null,
    scaleMin: 1,
    scaleMax: 5,
    scaleLabelMin: 'Never',
    scaleLabelMax: 'Always',
    required: true,
    commentRequired: false,
    commentPrompt: null,
    order: 0,
    category: null,
    ...overrides,
  }
}

/** The categorised twelve-question form the approved design draws. */
function safetyThenWorkload(): SurveyRespondQuestion[] {
  return [
    question({ id: 'a', category: 'Psychological safety' }),
    question({ id: 'b', category: 'Psychological safety' }),
    question({ id: 'c', category: 'Workload' }),
    question({ id: 'd', category: 'In your words', type: 'open_ended' }),
  ]
}

describe('respondDimensions', () => {
  it('groups the questions under their category', () => {
    const model = respondDimensions(safetyThenWorkload(), false)
    expect(model.sectioned).toBe(true)
    expect(model.sections.map((section) => section.key)).toEqual([
      'Psychological safety',
      'Workload',
      'In your words',
    ])
    expect(model.sections.map((section) => section.questions.map((q) => q.id))).toEqual([
      ['a', 'b'],
      ['c'],
      ['d'],
    ])
  })

  it('orders the sections by first appearance, not alphabetically', () => {
    // The author grouped the questions. Sorting the headings would put the
    // constructs in an order nobody chose — the rule `climateDimensions` follows
    // for the map's columns, applied to the form that produces them.
    const model = respondDimensions(
      [
        question({ id: 'a', category: 'Workload' }),
        question({ id: 'b', category: 'Belonging' }),
      ],
      false,
    )
    expect(model.sections.map((section) => section.key)).toEqual(['Workload', 'Belonging'])
  })

  it('never reorders the questions inside a section', () => {
    const model = respondDimensions(
      [
        question({ id: 'third', category: 'Workload', order: 2 }),
        question({ id: 'first', category: 'Workload', order: 0 }),
      ],
      false,
    )
    // Two distinct keys are needed for a sectioned model, so this pairs the
    // out-of-order run with a second dimension.
    const withSecond = respondDimensions(
      [
        question({ id: 'third', category: 'Workload', order: 2 }),
        question({ id: 'first', category: 'Workload', order: 0 }),
        question({ id: 'other', category: 'Belonging', order: 1 }),
      ],
      false,
    )
    expect(model.sections[0].questions.map((q) => q.id)).toEqual(['third', 'first'])
    expect(withSecond.sections[0].questions.map((q) => q.id)).toEqual(['third', 'first'])
  })

  it('numbers each section against the order the questions are read in', () => {
    const model = respondDimensions(safetyThenWorkload(), false)
    expect(
      model.sections.map((section) => [section.firstIndex, section.lastIndex]),
    ).toEqual([
      [1, 2],
      [3, 3],
      [4, 4],
    ])
  })

  it('numbers an interleaved category by where the questions end up, not where they arrived', () => {
    // A, B, A. The third question is pulled up under the first heading, so a range
    // taken from the arrival order would claim question 2 sits under A.
    const model = respondDimensions(
      [
        question({ id: 'a1', category: 'Workload' }),
        question({ id: 'b1', category: 'Belonging' }),
        question({ id: 'a2', category: 'Workload' }),
      ],
      false,
    )
    expect(model.sections.map((section) => section.questions.map((q) => q.id))).toEqual([
      ['a1', 'a2'],
      ['b1'],
    ])
    expect(
      model.sections.map((section) => [section.firstIndex, section.lastIndex]),
    ).toEqual([
      [1, 2],
      [3, 3],
    ])
  })

  it('does not section a randomised survey, whatever its categories say', () => {
    // `orderQuestions` has already shuffled this list. Grouping it would gather the
    // questions back into their dimensions and undo the randomisation the author
    // asked for.
    const model = respondDimensions(safetyThenWorkload(), true)
    expect(model.sectioned).toBe(false)
    expect(model.sections).toHaveLength(1)
    expect(model.sections[0].questions.map((q) => q.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps the randomised order exactly as it was handed over', () => {
    const shuffled = [
      question({ id: 'c', category: 'Workload' }),
      question({ id: 'a', category: 'Psychological safety' }),
      question({ id: 'b', category: 'Psychological safety' }),
    ]
    expect(
      respondDimensions(shuffled, true).sections[0].questions.map((q) => q.id),
    ).toEqual(['c', 'a', 'b'])
  })

  it('does not section when no question carries a category', () => {
    const model = respondDimensions([question({ id: 'a' }), question({ id: 'b' })], false)
    expect(model.sectioned).toBe(false)
    expect(model.sections).toHaveLength(1)
    expect(model.sections[0].questions.map((q) => q.id)).toEqual(['a', 'b'])
  })

  it('does not section when a category is blank rather than null', () => {
    const model = respondDimensions(
      [question({ id: 'a', category: '   ' }), question({ id: 'b', category: '' })],
      false,
    )
    expect(model.sectioned).toBe(false)
  })

  it('does not section when every question shares one category', () => {
    // One heading over the whole form is a title, not a section.
    const model = respondDimensions(
      [
        question({ id: 'a', category: 'Workload' }),
        question({ id: 'b', category: 'Workload' }),
      ],
      false,
    )
    expect(model.sectioned).toBe(false)
    expect(model.sections[0].questions).toHaveLength(2)
  })

  it('leaves an unsectioned run unnamed, so no heading can be printed over it', () => {
    const model = respondDimensions(
      [
        question({ id: 'a', category: 'Workload' }),
        question({ id: 'b', category: 'Workload' }),
      ],
      false,
    )
    expect(model.sections[0].key).toBe(UNCATEGORISED_DIMENSION)
  })

  it('spans the whole form with the unsectioned run', () => {
    const model = respondDimensions(safetyThenWorkload(), true)
    expect([model.sections[0].firstIndex, model.sections[0].lastIndex]).toEqual([1, 4])
  })

  it('returns no section at all for a form with no questions', () => {
    // Not one empty section: that renders a heading and a "1–0 of 0" reading over
    // nothing.
    expect(respondDimensions([], false)).toEqual({ sectioned: false, sections: [] })
    expect(respondDimensions([], true)).toEqual({ sectioned: false, sections: [] })
  })

  it('keeps the uncategorised questions as their own section beside the named ones', () => {
    // Dropping them would remove them from the form; filing them under a
    // neighbouring heading would attribute them to a construct nobody chose.
    const model = respondDimensions(
      [
        question({ id: 'a', category: 'Workload' }),
        question({ id: 'b', category: null }),
      ],
      false,
    )
    expect(model.sectioned).toBe(true)
    expect(model.sections.map((section) => section.key)).toEqual([
      'Workload',
      UNCATEGORISED_DIMENSION,
    ])
  })

  it('normalises a category exactly as the results screen does', () => {
    // Not a restatement of the rule: the expectation comes from `dimensionKeyOf`
    // itself, so a second normaliser growing here fails rather than quietly asking
    // under two headings what is reported under one.
    const rows = [
      question({ id: 'a', category: ' Workload ' }),
      question({ id: 'b', category: 'Workload' }),
      question({ id: 'c', category: '  ' }),
      question({ id: 'd', category: null }),
    ]
    const model = respondDimensions(rows, false)
    expect(model.sections.map((section) => section.key)).toEqual([
      dimensionKeyOf(rows[0]),
      dimensionKeyOf(rows[2]),
    ])
    // The trimmed and untrimmed spellings are one section, and the blank and the
    // null are the other.
    expect(model.sections.map((section) => section.questions.map((q) => q.id))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('accounts for every question exactly once, sectioned or not', () => {
    for (const randomize of [false, true]) {
      const rows = safetyThenWorkload()
      const model = respondDimensions(rows, randomize)
      const seen = model.sections.flatMap((section) => section.questions.map((q) => q.id))
      expect(seen.sort()).toEqual(['a', 'b', 'c', 'd'])
      // The last section's reading is the count the page prints as the denominator.
      expect(model.sections[model.sections.length - 1].lastIndex).toBe(rows.length)
    }
  })

  it('does not reorder the caller array', () => {
    // The page keeps the flat list for `answeredCount` and `missingRequired`.
    const rows = [
      question({ id: 'a1', category: 'Workload' }),
      question({ id: 'b1', category: 'Belonging' }),
      question({ id: 'a2', category: 'Workload' }),
    ]
    respondDimensions(rows, false)
    expect(rows.map((q) => q.id)).toEqual(['a1', 'b1', 'a2'])
  })
})
