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

function dims(questions: readonly SurveyRespondQuestion[], randomize: boolean) {
  return respondDimensions(questions, randomize)
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
    const model = dims(safetyThenWorkload(), false)
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
    const model = dims(
      [
        question({ id: 'a', category: 'Workload' }),
        question({ id: 'b', category: 'Belonging' }),
      ],
      false,
    )
    expect(model.sections.map((section) => section.key)).toEqual(['Workload', 'Belonging'])
  })

  it('never reorders the questions inside a section', () => {
    const model = dims(
      [
        question({ id: 'third', category: 'Workload', order: 2 }),
        question({ id: 'first', category: 'Workload', order: 0 }),
      ],
      false,
    )
    // Two distinct keys are needed for a sectioned model, so this pairs the
    // out-of-order run with a second dimension.
    const withSecond = dims(
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
    const model = dims(safetyThenWorkload(), false)
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
    const model = dims(
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

  it('prints no heading at all on a randomised survey, however many categories it has', () => {
    // Reversed 2026-10-18, restoring the behaviour #556 replaced. A respondent who can
    // read the construct above a question can answer it as that construct, which is the
    // bias the shuffle exists to remove -- PROCOMER's 12 Aug minuta and ESPH's review
    // both state it. The module note carries the argument.
    const model = dims(safetyThenWorkload(), true)
    expect(model.sectioned).toBe(false)
    expect(model.sections).toHaveLength(1)
    // Unnamed, so there is nothing a call site could print even if it tried.
    expect(model.sections[0].key).toBe(UNCATEGORISED_DIMENSION)
  })

  it('asks a randomised survey in the exact order it was handed, gathering nothing', () => {
    // The guarantee ESPH's review asks for, and the one #556 took away: a dimension's
    // questions must NOT end up consecutive. Grouping and then laying the sections end to
    // end asks A, A, B -- the respondent reads the grouping off the screen without ever
    // being shown its name. `orderQuestions` has already shuffled this list; the only
    // correct thing left to do with it is nothing.
    const interleaved = [
      question({ id: 'a1', category: 'Psychological safety' }),
      question({ id: 'b1', category: 'Workload' }),
      question({ id: 'a2', category: 'Psychological safety' }),
      question({ id: 'b2', category: 'Workload' }),
    ]
    const asked = dims(interleaved, true).sections.flatMap((section) =>
      section.questions.map((q) => q.id),
    )
    expect(asked).toEqual(['a1', 'b1', 'a2', 'b2'])

    // The control: the same list unrandomised DOES gather, which is what sections are for.
    const grouped = dims(interleaved, false).sections.flatMap((section) =>
      section.questions.map((q) => q.id),
    )
    expect(grouped).toEqual(['a1', 'a2', 'b1', 'b2'])
  })

  it('keeps the order WITHIN a section exactly as it was handed over', () => {
    // Sections never re-sort: 'b' precedes 'a' here only because the caller handed them
    // over that way -- a function that re-sorted by `order` would return ['a', 'b'] and
    // fail. Unrandomised, because a randomised form has no sections to look up.
    const shuffled = [
      question({ id: 'b', category: 'Psychological safety' }),
      question({ id: 'c', category: 'Workload' }),
      question({ id: 'a', category: 'Psychological safety' }),
    ]
    const safety = dims(shuffled, false).sections.find(
      (section) => section.key === 'Psychological safety',
    )
    expect(safety?.questions.map((q) => q.id)).toEqual(['b', 'a'])
  })

  it('does not section when no question carries a category', () => {
    const model = dims([question({ id: 'a' }), question({ id: 'b' })], false)
    expect(model.sectioned).toBe(false)
    expect(model.sections).toHaveLength(1)
    expect(model.sections[0].questions.map((q) => q.id)).toEqual(['a', 'b'])
  })

  it('does not section when a category is blank rather than null', () => {
    const model = dims(
      [question({ id: 'a', category: '   ' }), question({ id: 'b', category: '' })],
      false,
    )
    expect(model.sectioned).toBe(false)
  })

  it('does not section when every question shares one category', () => {
    // One heading over the whole form is a title, not a section.
    const model = dims(
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
    const model = dims(
      [
        question({ id: 'a', category: 'Workload' }),
        question({ id: 'b', category: 'Workload' }),
      ],
      false,
    )
    expect(model.sections[0].key).toBe(UNCATEGORISED_DIMENSION)
  })

  it('still numbers the whole form when randomised, as one run', () => {
    const model = dims(safetyThenWorkload(), true)
    expect(model.sections[0].firstIndex).toBe(1)
    expect(model.sections[model.sections.length - 1].lastIndex).toBe(4)
  })

  it('returns no section at all for a form with no questions', () => {
    // Not one empty section: that renders a heading and a "1–0 of 0" reading over
    // nothing.
    expect(dims([], false)).toEqual({ sectioned: false, sections: [] })
    expect(dims([], true)).toEqual({ sectioned: false, sections: [] })
  })

  it('keeps the uncategorised questions as their own section beside the named ones', () => {
    // Dropping them would remove them from the form; filing them under a
    // neighbouring heading would attribute them to a construct nobody chose.
    const model = dims(
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
    const model = dims(rows, false)
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
      const model = dims(rows, randomize)
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
    dims(rows, false)
    expect(rows.map((q) => q.id)).toEqual(['a1', 'b1', 'a2'])
  })
})
