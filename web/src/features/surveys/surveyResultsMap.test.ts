import { describe, it, expect } from 'vitest'
import type {
  SurveyBreakdown,
  SurveyQuestionResult,
  SurveySegmentResult,
} from './api/surveyResults'
import type { ClimateMapModel } from './surveyResultsMap'
import {
  UNCATEGORISED_DIMENSION,
  buildClimateMap,
  climateDimensions,
  climateFindings,
  dimensionKeyOf,
  openTextThemes,
  segmentDimensionScore,
  surveyDimensionScore,
  surveyDimensionStandings,
  withheldWordCount,
} from './surveyResultsMap'

function question(overrides: Partial<SurveyQuestionResult> & { questionId: string }): SurveyQuestionResult {
  return {
    order: 1,
    type: 'likert',
    text: null,
    category: null,
    answeredCount: 10,
    distribution: [],
    average: null,
    median: null,
    words: [],
    suppressedWordCount: 0,
    ...overrides,
  }
}

function segment(
  overrides: Partial<SurveySegmentResult> & { key: string },
): SurveySegmentResult {
  return {
    dimension: 'department',
    label: null,
    respondentCount: 10,
    participationRate: null,
    isSuppressed: false,
    questions: [],
    ...overrides,
  }
}

function breakdown(segments: SurveySegmentResult[]): SurveyBreakdown {
  return {
    dimension: 'department',
    segments,
    suppressedSegmentCount: segments.filter((entry) => entry.isSuppressed).length,
    suppressedRespondentCount: 0,
    unsegmentedRespondentCount: 0,
  }
}

const nameOf = (entry: SurveySegmentResult) => entry.label ?? entry.key

/** Two dimensions, two disclosed groups and one withheld one. */
function fixture() {
  const questions = [
    question({ questionId: 'q1', order: 1, category: 'Safety', average: 4 }),
    question({ questionId: 'q2', order: 2, category: 'Safety', average: 3 }),
    question({ questionId: 'q3', order: 3, category: 'Workload', average: 2.5 }),
    // Not a scale question: no mean, so it can never enter the map.
    question({ questionId: 'q4', order: 4, type: 'open_ended', category: 'Culture' }),
  ]
  const segments = [
    segment({
      key: 'ops',
      label: 'Operations',
      respondentCount: 40,
      questions: [
        { questionId: 'q1', answeredCount: 40, average: 4.4 },
        { questionId: 'q2', answeredCount: 40, average: 3.6 },
        { questionId: 'q3', answeredCount: 40, average: 3 },
      ],
    }),
    segment({
      key: 'support',
      label: 'Support',
      respondentCount: 12,
      questions: [
        { questionId: 'q1', answeredCount: 12, average: 3 },
        { questionId: 'q2', answeredCount: 12, average: 2.4 },
        { questionId: 'q3', answeredCount: 12, average: 2 },
      ],
    }),
    segment({ key: 'legal', label: 'Legal', respondentCount: 0, isSuppressed: true }),
  ]
  return { questions, breakdown: breakdown(segments) }
}

describe('dimensionKeyOf', () => {
  it('trims a category', () => {
    expect(dimensionKeyOf({ category: '  Safety ' })).toBe('Safety')
  })

  it('sends a blank or absent category to the uncategorised sentinel', () => {
    expect(dimensionKeyOf({ category: null })).toBe(UNCATEGORISED_DIMENSION)
    expect(dimensionKeyOf({ category: '   ' })).toBe(UNCATEGORISED_DIMENSION)
  })
})

describe('climateDimensions', () => {
  it('groups the scale questions by category, in question order', () => {
    const { questions } = fixture()
    expect(climateDimensions(questions)).toEqual([
      { key: 'Safety', questionIds: ['q1', 'q2'] },
      { key: 'Workload', questionIds: ['q3'] },
    ])
  })

  it('excludes a question the server computed no mean for', () => {
    // `SurveyAggregation.NumericStats` returns null for anything outside
    // `QuestionTypes.NumericScale`, including multiple choice whose option values
    // happen to be numbers. Averaging codes would produce a number with no meaning
    // that the map would nonetheless colour.
    const keys = climateDimensions(fixture().questions).map((entry) => entry.key)
    expect(keys).not.toContain('Culture')
  })

  it('keeps an uncategorised scale question rather than dropping it', () => {
    const dimensions = climateDimensions([
      question({ questionId: 'q1', average: 3, category: null }),
    ])
    expect(dimensions).toEqual([{ key: UNCATEGORISED_DIMENSION, questionIds: ['q1'] }])
  })
})

describe('segmentDimensionScore', () => {
  it('is the unweighted mean of the group question means, to one decimal', () => {
    const { breakdown: data } = fixture()
    // (4.4 + 3.6) / 2 = 4.0, and the respondent counts do not weigh on it.
    expect(
      segmentDimensionScore(data.segments[0], { key: 'Safety', questionIds: ['q1', 'q2'] }),
    ).toBe(4)
  })

  it('is null, never zero, when the group has no mean in the dimension', () => {
    // A zero here would be coloured at the bottom of the ramp: a false measurement
    // rather than a missing one.
    expect(
      segmentDimensionScore(segment({ key: 'x' }), { key: 'Safety', questionIds: ['q1'] }),
    ).toBeNull()
  })

  it('ignores a question outside the dimension', () => {
    const entry = segment({
      key: 'x',
      questions: [
        { questionId: 'q1', answeredCount: 5, average: 4 },
        { questionId: 'q3', answeredCount: 5, average: 1 },
      ],
    })
    expect(segmentDimensionScore(entry, { key: 'Safety', questionIds: ['q1'] })).toBe(4)
  })
})

describe('surveyDimensionScore', () => {
  it('averages the whole survey question means inside the dimension', () => {
    const { questions } = fixture()
    expect(surveyDimensionScore(questions, { key: 'Safety', questionIds: ['q1', 'q2'] })).toBe(3.5)
  })

  it('is null when no question in the dimension has a mean', () => {
    const { questions } = fixture()
    expect(surveyDimensionScore(questions, { key: 'Culture', questionIds: ['q4'] })).toBeNull()
  })
})

describe('buildClimateMap', () => {
  it('draws a rectangular grid of the disclosed groups, with the target as the mean of the cells', () => {
    const { questions, breakdown: data } = fixture()
    const model = buildClimateMap(data, questions, 5, nameOf)

    expect(model).not.toBeNull()
    expect(model!.dimensions.map((entry) => entry.key)).toEqual(['Safety', 'Workload'])
    expect(model!.rows.map((row) => [row.label, row.scores])).toEqual([
      ['Operations', [4, 3]],
      ['Support', [2.7, 2]],
      ['Legal', []],
    ])
    // (4 + 3 + 2.7 + 2) / 4 = 2.925, rounded to the same precision as the cells.
    expect(model!.target).toBe(2.9)
  })

  it('keeps a withheld group as a row and never carries its count into a score', () => {
    const { questions, breakdown: data } = fixture()
    const model = buildClimateMap(data, questions, 5, nameOf)!
    const legal = model.rows.find((row) => row.label === 'Legal')!

    // Under the threshold, so `ClimateMap` renders every cell as a ProtectedCell.
    expect(legal.responses).toBeLessThan(model.threshold)
    expect(legal.scores).toEqual([])
  })

  it('never hands ClimateMap a threshold of zero', () => {
    // `isSuppressed(0, 0)` is false, and the withheld row would then try to read
    // scores it does not have.
    const { questions, breakdown: data } = fixture()
    expect(buildClimateMap(data, questions, 0, nameOf)!.threshold).toBe(1)
  })

  it('scales the ramp so the furthest cell saturates', () => {
    const { questions, breakdown: data } = fixture()
    const model = buildClimateMap(data, questions, 5, nameOf)!
    // The widest gap from the target of 2.9 is Operations/Safety at 4.
    expect(model.extremeAt).toBeCloseTo(1.1, 10)
    expect(model.deadBandAt).toBeCloseTo(0.22, 10)
  })

  it('floors the ramp when every group scores identically', () => {
    const questions = [question({ questionId: 'q1', category: 'Safety', average: 3 })]
    const data = breakdown([
      segment({ key: 'a', label: 'A', questions: [{ questionId: 'q1', answeredCount: 5, average: 3 }] }),
      segment({ key: 'b', label: 'B', questions: [{ questionId: 'q1', answeredCount: 5, average: 3 }] }),
    ])
    const model = buildClimateMap(data, questions, 5, nameOf)!

    // ClimateMap divides by `2 * extremeAt`, so zero spread must not reach it.
    expect(model.extremeAt).toBeGreaterThan(0)
    expect(model.target).toBe(3)
  })

  it('drops a dimension no disclosed group scores across the board, and says how many', () => {
    const { questions, breakdown: data } = fixture()
    const partial = breakdown([
      data.segments[0],
      // Support answered nothing in Workload.
      segment({
        key: 'support',
        label: 'Support',
        respondentCount: 12,
        questions: [{ questionId: 'q1', answeredCount: 12, average: 3 }],
      }),
    ])
    const model = buildClimateMap(partial, questions, 5, nameOf)!

    expect(model.dimensions.map((entry) => entry.key)).toEqual(['Safety'])
    expect(model.omittedDimensions).toEqual(['Workload'])
  })

  it('leaves a disclosed group with no scale answers out of the grid and names it', () => {
    const { questions, breakdown: data } = fixture()
    const withEmpty = breakdown([
      data.segments[0],
      segment({ key: 'newteam', label: 'New team', respondentCount: 8 }),
    ])
    const model = buildClimateMap(withEmpty, questions, 5, nameOf)!

    // Not hatched: nothing was measured, so there is nothing to protect, and a
    // padlock would claim a guarantee was enforced when none was.
    expect(model.rows.map((row) => row.label)).toEqual(['Operations'])
    expect(model.omittedSegments).toEqual(['New team'])
  })

  it('is null when no question carries a mean at all', () => {
    const data = fixture().breakdown
    expect(buildClimateMap(data, [question({ questionId: 'q4', type: 'open_ended' })], 5, nameOf))
      .toBeNull()
  })

  it('keeps every group as a protected row when the floor takes all of them', () => {
    // The strongest form of "protected is shown, never hidden". Returning null
    // here deleted the whole climate section from the page while the breakdown
    // table below it still listed these groups as withheld — the page saying the
    // groups exist in one place and that nothing was measured in another.
    const { questions } = fixture()
    const allWithheld = breakdown([
      segment({ key: 'legal', label: 'Legal', respondentCount: 0, isSuppressed: true }),
      segment({ key: 'finance', label: 'Finance', respondentCount: 0, isSuppressed: true }),
    ])
    const model = buildClimateMap(allWithheld, questions, 5, nameOf)!

    expect(model.rows.map((row) => row.label)).toEqual(['Legal', 'Finance'])
    // Every row is below the floor `ClimateMap` is handed, so every cell renders
    // through `ProtectedCell` rather than as a colour.
    expect(model.rows.every((row) => row.responses < model.threshold)).toBe(true)
    // No disclosed cell means no mean to take — and no number that could be
    // presented as one.
    expect(model.target).toBeNull()
    expect(model.dimensions.map((entry) => entry.key)).toEqual(['Safety', 'Workload'])
  })

  it('is null only when the breakdown holds no group at all', () => {
    const { questions } = fixture()
    expect(buildClimateMap(breakdown([]), questions, 5, nameOf)).toBeNull()
  })
})

describe('climateFindings', () => {
  it('names the cells below the target, worst first', () => {
    const { questions, breakdown: data } = fixture()
    const model = buildClimateMap(data, questions, 5, nameOf)!

    expect(climateFindings(model)).toEqual([
      { rowId: 'support', rowLabel: 'Support', dimensionKey: 'Workload', score: 2, shortfall: 0.9 },
      { rowId: 'support', rowLabel: 'Support', dimensionKey: 'Safety', score: 2.7, shortfall: 0.2 },
    ])
  })

  it('never turns a below-threshold row into a finding, even when it carries scores', () => {
    // `buildClimateMap` gives a withheld row an empty `scores` array, so through
    // that path the guard below is never the thing doing the work. A model
    // assembled by hand is what shows the guard itself keeps a protected group
    // out of the list -- without it this file would pass with the check deleted.
    const model: ClimateMapModel = {
      dimensions: [{ key: 'Workload', questionIds: ['q3'] }],
      rows: [
        { id: 'ops', label: 'Operations', responses: 40, scores: [3.4] },
        { id: 'legal', label: 'Legal', responses: 3, scores: [1.1] },
      ],
      target: 3,
      deadBandAt: 0.2,
      extremeAt: 1,
      threshold: 5,
      omittedDimensions: [],
      omittedSegments: [],
    }

    expect(climateFindings(model)).toEqual([])
  })

  it('produces nothing from a withheld group', () => {
    const { questions, breakdown: data } = fixture()
    const model = buildClimateMap(data, questions, 5, nameOf)!
    // Naming a group as a problem on the strength of a reading nobody may see
    // would leak exactly what the floor protects.
    expect(climateFindings(model).some((finding) => finding.rowId === 'legal')).toBe(false)
  })

  // No test for "a null target produces no findings": the early return is what
  // narrows `target` for the comparison below it, so removing it is a type error,
  // and every value it could plausibly be replaced with (`?? 0`) still yields an
  // empty list for any real score. A test there would be one that cannot go red.

  it('honours the limit', () => {
    const { questions, breakdown: data } = fixture()
    const model = buildClimateMap(data, questions, 5, nameOf)!
    expect(climateFindings(model, 1)).toHaveLength(1)
  })

  it('is empty when nothing sits below the target', () => {
    const questions = [question({ questionId: 'q1', category: 'Safety', average: 3 })]
    const data = breakdown([
      segment({ key: 'a', label: 'A', questions: [{ questionId: 'q1', answeredCount: 5, average: 3 }] }),
    ])
    expect(climateFindings(buildClimateMap(data, questions, 5, nameOf)!)).toEqual([])
  })
})

describe('surveyDimensionStandings', () => {
  it('ranks the dimensions lowest first against the mean of themselves', () => {
    const { questions } = fixture()
    const standings = surveyDimensionStandings(questions)!

    expect(standings.rows).toEqual([
      { key: 'Workload', questionCount: 1, score: 2.5 },
      { key: 'Safety', questionCount: 2, score: 3.5 },
    ])
    expect(standings.overall).toBe(3)
  })

  it('does not reuse the climate map target, which is a mean over different things', () => {
    const { questions, breakdown: data } = fixture()
    // The map averages group × dimension cells; this averages dimension scores.
    // They are 2.9 and 3.0 on the same payload, and a page that mixed them would
    // report a dimension as above one baseline and below the other.
    expect(surveyDimensionStandings(questions)!.overall).not.toBe(
      buildClimateMap(data, questions, 5, nameOf)!.target,
    )
  })

  it('is null when the survey has no scale question', () => {
    expect(surveyDimensionStandings([question({ questionId: 'q4', type: 'open_ended' })])).toBeNull()
  })
})

describe('openTextThemes', () => {
  it('merges a word across questions but never across languages', () => {
    const questions = [
      question({
        questionId: 'q1',
        type: 'open_ended',
        words: [
          { language: 'en', word: 'workload', count: 5, responseCount: 5 },
          { language: 'es', word: 'workload', count: 2, responseCount: 2 },
        ],
      }),
      question({
        questionId: 'q2',
        type: 'open_ended',
        words: [{ language: 'en', word: 'workload', count: 3, responseCount: 3 }],
      }),
    ]

    expect(openTextThemes(questions)).toEqual([
      { text: 'workload', value: 8, category: 'en' },
      { text: 'workload', value: 2, category: 'es' },
    ])
  })

  it('orders by frequency, breaking ties on the word so the cloud is stable', () => {
    const questions = [
      question({
        questionId: 'q1',
        type: 'open_ended',
        words: [
          { language: 'en', word: 'rota', count: 4, responseCount: 4 },
          { language: 'en', word: 'pay', count: 4, responseCount: 4 },
          { language: 'en', word: 'shifts', count: 9, responseCount: 7 },
        ],
      }),
    ]
    expect(openTextThemes(questions).map((word) => word.text)).toEqual(['shifts', 'pay', 'rota'])
  })
})

describe('withheldWordCount', () => {
  it('totals the withheld words across every question', () => {
    expect(
      withheldWordCount([
        question({ questionId: 'q1', suppressedWordCount: 4 }),
        question({ questionId: 'q2', suppressedWordCount: 3 }),
      ]),
    ).toBe(7)
  })
})
