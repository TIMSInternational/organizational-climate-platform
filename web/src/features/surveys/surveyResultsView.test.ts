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
  distributionStripModel,
  filterQuestions,
  isOpenEnded,
  questionCategories,
  questionTypes,
  segmentComparisonData,
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
    scaleMin: null,
    scaleMax: null,
    scaleLabelMin: null,
    scaleLabelMax: null,
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
    headcount: 10,
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

describe('distributionStripModel', () => {
  const bucket = (value: string, count: number, label: string | null = null) => ({
    value,
    label,
    count,
    percentage: 0,
    averageRank: null,
  })

  it('positions each bucket at its own scale point, in the server order', () => {
    const model = distributionStripModel(
      question({
        average: 3.5,
        scaleMin: 1,
        scaleMax: 5,
        distribution: [bucket('1', 2, 'Strongly disagree'), bucket('4', 22, 'Agree')],
      }),
    )!

    expect(model.buckets.map((entry) => entry.position)).toEqual([1, 4])
    expect(model.buckets.map((entry) => entry.label)).toEqual(['Strongly disagree', 'Agree'])
    expect(model.min).toBe(1)
    expect(model.max).toBe(5)
    expect(model.total).toBe(24)
  })

  it('refuses a question the server refused a mean for — codes are not readings', () => {
    // `average: null` is `NumericStats`' own statement that these values are
    // codes, and a diverging ramp over codes claims an order nobody authored.
    expect(
      distributionStripModel(
        question({
          type: 'multiple_choice',
          average: null,
          distribution: [bucket('1', 4, 'Remote'), bucket('4', 6, 'Office')],
        }),
      ),
    ).toBeNull()
  })

  it('falls back to the answered extremes when the question carries no configured scale', () => {
    const model = distributionStripModel(
      question({
        average: 2.5,
        scaleMin: null,
        scaleMax: null,
        distribution: [bucket('2', 5), bucket('3', 5)],
      }),
    )!
    expect(model.min).toBe(2)
    expect(model.max).toBe(3)
  })

  it('refuses a degenerate axis where the scale has no width', () => {
    expect(
      distributionStripModel(
        question({ average: 3, scaleMin: null, scaleMax: null, distribution: [bucket('3', 9)] }),
      ),
    ).toBeNull()
  })

  it('falls back to the stable value when a bucket has no label', () => {
    const model = distributionStripModel(
      question({ average: 3, scaleMin: 1, scaleMax: 5, distribution: [bucket('3', 9, null)] }),
    )!
    expect(model.buckets[0].label).toBe('3')
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
