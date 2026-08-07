import { describe, it, expect } from 'vitest'
import type {
  SurveyBreakdown,
  SurveyQuestionResult,
  SurveySegmentResult,
} from './api/surveyResults'
import {
  EMPTY_QUESTION_FILTER,
  OVERALL_SERIES_KEY,
  RESPONSES_SERIES_KEY,
  SEGMENT_SERIES_KEY,
  breakdownAccountsForEveryone,
  bucketLabel,
  disclosedSegments,
  distributionChartData,
  filterQuestions,
  isOpenEnded,
  questionCategories,
  questionTypes,
  segmentComparisonData,
  segmentHeatMapCells,
  withheldSegments,
  wordCloudData,
} from './surveyResultsView'

function question(overrides: Partial<SurveyQuestionResult> = {}): SurveyQuestionResult {
  return {
    questionId: 'q1',
    order: 1,
    type: 'likert',
    text: 'I feel safe raising concerns',
    category: 'safety',
    answeredCount: 10,
    distribution: [],
    average: null,
    median: null,
    words: [],
    suppressedWordCount: 0,
    ...overrides,
  }
}

function segment(overrides: Partial<SurveySegmentResult> = {}): SurveySegmentResult {
  return {
    dimension: 'department',
    key: 'd1',
    label: 'Support',
    respondentCount: 8,
    participationRate: 80,
    isSuppressed: false,
    questions: [],
    ...overrides,
  }
}

function breakdown(overrides: Partial<SurveyBreakdown> = {}): SurveyBreakdown {
  return {
    dimension: 'department',
    segments: [],
    suppressedSegmentCount: 0,
    suppressedRespondentCount: 0,
    unsegmentedRespondentCount: 0,
    ...overrides,
  }
}

const shortLabel = (q: SurveyQuestionResult) => `Q${q.order}`
const nameOf = (s: SurveySegmentResult) => s.label ?? s.key

describe('bucketLabel', () => {
  it('prefers the resolved label', () => {
    expect(bucketLabel({ value: 'agree', label: 'De acuerdo', count: 1, percentage: 1, averageRank: null })).toBe(
      'De acuerdo',
    )
  })

  it('falls back to the stable value, not to a placeholder', () => {
    // The value is what the option actually IS. Showing it lets an admin recognise
    // the option and go and translate it; a placeholder would not.
    expect(bucketLabel({ value: 'agree', label: null, count: 1, percentage: 1, averageRank: null })).toBe('agree')
  })
})

describe('distributionChartData', () => {
  it('keeps the server bucket order rather than sorting by count', () => {
    // Sorting by count would reorder a Likert scale into a ranking and destroy the
    // only axis a scale question has.
    const rows = distributionChartData(
      question({
        distribution: [
          { value: '1', label: 'Strongly disagree', count: 1, percentage: 10, averageRank: null },
          { value: '2', label: 'Disagree', count: 7, percentage: 70, averageRank: null },
          { value: '3', label: 'Agree', count: 2, percentage: 20, averageRank: null },
        ],
      }),
    )

    expect(rows.map((row) => row.label)).toEqual(['Strongly disagree', 'Disagree', 'Agree'])
    expect(rows.map((row) => row.values[RESPONSES_SERIES_KEY])).toEqual([1, 7, 2])
  })

  it('groups nothing of its own — one row per server bucket, even when labels collide', () => {
    // Two options whose resolved labels collide in this locale but whose stable
    // values differ must stay two rows. Merging on the label here would undo the
    // #195 property #121's aggregator was built around.
    const rows = distributionChartData(
      question({
        distribution: [
          { value: 'weekly', label: 'Regularly', count: 3, percentage: 50, averageRank: null },
          { value: 'daily', label: 'Regularly', count: 3, percentage: 50, averageRank: null },
        ],
      }),
    )

    expect(rows).toHaveLength(2)
  })
})

describe('wordCloudData', () => {
  it('carries the language as the colour category rather than merging the two', () => {
    // A word spelled identically in both languages stays two entries: they are two
    // populations, and merging them is a translation decision an adapter may not take.
    const words = wordCloudData(
      question({
        type: 'open_ended',
        words: [
          { language: 'en', word: 'total', count: 4, responseCount: 4 },
          { language: 'es', word: 'total', count: 2, responseCount: 2 },
        ],
      }),
    )

    expect(words).toEqual([
      { text: 'total', value: 4, category: 'en' },
      { text: 'total', value: 2, category: 'es' },
    ])
  })
})

describe('isOpenEnded', () => {
  it('branches on the type, not on an empty distribution', () => {
    expect(isOpenEnded({ type: 'open_ended' })).toBe(true)
    // A multiple-choice question nobody answered also has an empty distribution and
    // must not be mistaken for free text.
    expect(isOpenEnded({ type: 'multiple_choice' })).toBe(false)
  })
})

describe('segment disclosure', () => {
  const withheld = segment({ key: 'd2', label: 'Legal', respondentCount: 0, participationRate: null, isSuppressed: true })
  const shown = segment()

  it('splits the segments the server disclosed from the ones it withheld', () => {
    const value = breakdown({ segments: [shown, withheld] })
    expect(disclosedSegments(value)).toEqual([shown])
    expect(withheldSegments(value)).toEqual([withheld])
  })
})

describe('segmentHeatMapCells', () => {
  const scored = question({ questionId: 'q1', order: 1, average: 4.2 })

  it('never emits a cell for a withheld segment', () => {
    // This is the privacy property. A suppressed segment arrives with
    // respondentCount 0 and no questions; a cell for it would either colour a row at
    // the bottom of the ramp -- a claim that the group scored zero -- or vanish
    // without trace, and both are wrong in the same way.
    const cells = segmentHeatMapCells(
      breakdown({
        segments: [
          segment({ key: 'd1', label: 'Support', questions: [{ questionId: 'q1', answeredCount: 8, average: 3.1 }] }),
          segment({
            key: 'd2',
            label: 'Legal',
            respondentCount: 0,
            isSuppressed: true,
            // Defensive: even if a future server regression left numbers on a
            // suppressed segment, they must not reach the grid.
            questions: [{ questionId: 'q1', answeredCount: 2, average: 1.0 }],
          }),
        ],
        suppressedSegmentCount: 1,
        suppressedRespondentCount: 2,
      }),
      [scored],
      shortLabel,
      nameOf,
    )

    expect(cells).toEqual([{ x: 'Q1', y: 'Support', value: 3.1 }])
    expect(cells.some((cell) => cell.y === 'Legal')).toBe(false)
  })

  it('omits a cell rather than emitting a zero when a segment has no average for a question', () => {
    const cells = segmentHeatMapCells(
      breakdown({
        segments: [segment({ questions: [{ questionId: 'q1', answeredCount: 0, average: null }] })],
      }),
      [scored],
      shortLabel,
      nameOf,
    )

    expect(cells).toEqual([])
  })

  it('skips questions that have no survey-wide average, such as free text', () => {
    const cells = segmentHeatMapCells(
      breakdown({
        segments: [segment({ questions: [{ questionId: 'q9', answeredCount: 8, average: 2 }] })],
      }),
      [question({ questionId: 'q9', order: 9, type: 'open_ended', average: null })],
      shortLabel,
      nameOf,
    )

    expect(cells).toEqual([])
  })
})

describe('segmentComparisonData', () => {
  it('puts the segment beside the whole survey, and leaves a gap where there is no number', () => {
    const rows = segmentComparisonData(
      segment({ questions: [{ questionId: 'q1', answeredCount: 8, average: 3.1 }] }),
      [question({ questionId: 'q1', order: 1, average: 4.2 }), question({ questionId: 'q2', order: 2, average: 3.9 })],
      shortLabel,
    )

    expect(rows).toEqual([
      { label: 'Q1', values: { [SEGMENT_SERIES_KEY]: 3.1, [OVERALL_SERIES_KEY]: 4.2 } },
      // null, not 0: `BarChart` renders a missing value as a gap, and a zero here
      // would claim the group scored the floor on a question it never answered.
      { label: 'Q2', values: { [SEGMENT_SERIES_KEY]: null, [OVERALL_SERIES_KEY]: 3.9 } },
    ])
  })

  it('drops questions neither side has a number for', () => {
    const rows = segmentComparisonData(
      segment({ questions: [] }),
      [question({ questionId: 'q1', order: 1, type: 'open_ended', average: null })],
      shortLabel,
    )

    expect(rows).toEqual([])
  })
})

describe('question filters', () => {
  const questions = [
    question({ questionId: 'q1', order: 1, type: 'likert', category: 'safety' }),
    question({ questionId: 'q2', order: 2, type: 'open_ended', category: 'safety' }),
    question({ questionId: 'q3', order: 3, type: 'likert', category: '  ' }),
    question({ questionId: 'q4', order: 4, type: 'likert', category: null }),
  ]

  it('lists categories in first-seen order, ignoring blank and absent ones', () => {
    expect(questionCategories(questions)).toEqual(['safety'])
  })

  it('lists types in first-seen order', () => {
    expect(questionTypes(questions)).toEqual(['likert', 'open_ended'])
  })

  it('passes everything through when nothing is selected', () => {
    expect(filterQuestions(questions, EMPTY_QUESTION_FILTER)).toHaveLength(4)
  })

  it('intersects category and type', () => {
    expect(filterQuestions(questions, { category: 'safety', type: 'likert' }).map((q) => q.questionId)).toEqual(['q1'])
  })
})

describe('breakdownAccountsForEveryone', () => {
  it('reconciles disclosed, withheld and unsegmented against the completed count', () => {
    const value = breakdown({
      segments: [
        segment({ key: 'd1', respondentCount: 8 }),
        segment({ key: 'd2', respondentCount: 0, isSuppressed: true }),
      ],
      suppressedSegmentCount: 1,
      suppressedRespondentCount: 3,
      unsegmentedRespondentCount: 2,
    })

    expect(breakdownAccountsForEveryone(value, 13)).toBe(true)
    expect(breakdownAccountsForEveryone(value, 14)).toBe(false)
  })
})
