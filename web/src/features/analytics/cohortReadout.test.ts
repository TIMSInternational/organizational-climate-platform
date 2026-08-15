import { describe, it, expect } from 'vitest'
import { buildCohortReadout, toIndex } from './cohortReadout'
import type { BenchmarkMetric } from './api/benchmarks'
import type { SurveyQuestionResult } from '../surveys/api/surveyResults'

function question(overrides: Partial<SurveyQuestionResult> = {}): SurveyQuestionResult {
  return {
    questionId: 'q1',
    order: 0,
    type: 'likert',
    text: 'A question',
    category: 'safety',
    answeredCount: 24,
    distribution: [],
    average: 3.75,
    median: 4,
    ...overrides,
  } as SurveyQuestionResult
}

function metric(overrides: Partial<BenchmarkMetric> = {}): BenchmarkMetric {
  return {
    id: 'm1',
    benchmarkId: 'b1',
    metricName: 'safety',
    value: 69,
    unit: 'index',
    percentile: null,
    sampleSize: 42,
    confidenceIntervalLower: null,
    confidenceIntervalUpper: null,
    ...overrides,
  } as BenchmarkMetric
}

describe('toIndex', () => {
  /**
   * The whole point of the function. A likert mean and a benchmark index are different
   * number systems, and 3.75 printed where an index belongs reads as a catastrophe rather
   * than as the decent score it is.
   */
  it('rescales a 1-5 mean onto the 0-100 index', () => {
    expect(toIndex(1)).toBe(0)
    expect(toIndex(3)).toBe(50)
    expect(toIndex(5)).toBe(100)
    expect(toIndex(3.75)).toBe(69)
  })

  /** An unanswered scale has no mean, and a 0 would render as the worst possible score. */
  it('answers null for a question with no average', () => {
    expect(toIndex(null)).toBeNull()
  })

  it('does not let a value outside the scale escape the track', () => {
    expect(toIndex(7)).toBe(100)
    expect(toIndex(-2)).toBe(0)
  })
})

describe('buildCohortReadout', () => {
  it('pairs each dimension with its cohort median', () => {
    const readout = buildCohortReadout(
      [
        question({ questionId: 'a', category: 'safety', average: 3.75 }),
        question({ questionId: 'b', category: 'workload', average: 3.21 }),
      ],
      [metric({ metricName: 'safety', value: 69 }), metric({ metricName: 'workload', value: 66 })],
    )

    expect(readout.dimensions).toEqual([
      { key: 'safety', score: 69, cohortMedian: 69 },
      { key: 'workload', score: 55, cohortMedian: 66 },
    ])
  })

  /**
   * Driven by the SURVEY, not by the benchmark. A dimension this company measured and the
   * cohort has no median for is the row the reader most needs to see; taking the list from
   * the benchmark would drop it silently.
   */
  it('keeps a dimension the cohort does not carry, with no median', () => {
    const readout = buildCohortReadout(
      [question({ category: 'belonging', average: 3.92 })],
      [metric({ metricName: 'safety', value: 69 })],
    )

    expect(readout.dimensions).toEqual([{ key: 'belonging', score: 73, cohortMedian: null }])
  })

  it('averages a dimension asked by more than one question', () => {
    const readout = buildCohortReadout(
      [
        question({ questionId: 'a', category: 'safety', average: 3 }),
        question({ questionId: 'b', category: 'safety', average: 5 }),
      ],
      [],
    )

    expect(readout.dimensions).toEqual([{ key: 'safety', score: 75, cohortMedian: null }])
  })

  it('ignores questions with no category, which carry no dimension', () => {
    const readout = buildCohortReadout(
      [question({ category: null }), question({ questionId: 'b', category: 'trust', average: 3 })],
      [],
    )

    expect(readout.dimensions.map((d) => d.key)).toEqual(['trust'])
  })

  /** An unanswered question contributes nothing rather than dragging the index to the floor. */
  it('leaves an unanswered dimension out of the index', () => {
    const readout = buildCohortReadout(
      [
        question({ questionId: 'a', category: 'safety', average: 5 }),
        question({ questionId: 'b', category: 'growth', average: null }),
      ],
      [],
    )

    expect(readout.dimensions.map((d) => d.key)).toEqual(['safety'])
    expect(readout.yourIndex).toBe(100)
  })

  it('reads the cohort median, percentile and size off the overall metric', () => {
    const readout = buildCohortReadout(
      [question({ category: 'safety', average: 3.75 })],
      [
        metric({ metricName: 'safety', value: 69 }),
        metric({ metricName: 'overall_index', value: 68, percentile: 68, sampleSize: 42 }),
      ],
    )

    expect(readout.cohortMedian).toBe(68)
    expect(readout.percentile).toBe(68)
    expect(readout.cohortSize).toBe(42)
  })

  /** The overall metric is a property of the cohort, never a row in the dimension list. */
  it('does not render the overall metric as a dimension', () => {
    const readout = buildCohortReadout(
      [question({ category: 'overall_index', average: 4 }), question({ questionId: 'b', category: 'trust', average: 3 })],
      [],
    )

    expect(readout.dimensions.map((d) => d.key)).toEqual(['trust'])
  })

  /** A company with no closed survey gets an empty read-out, not a zero. */
  it('answers null rather than zero when nothing was scored', () => {
    const readout = buildCohortReadout([], [metric({ metricName: 'overall_index', value: 68 })])

    expect(readout.yourIndex).toBeNull()
    expect(readout.dimensions).toEqual([])
  })

  it('falls back to any metric for the cohort size when the overall one omits it', () => {
    const readout = buildCohortReadout(
      [],
      [metric({ metricName: 'safety', sampleSize: 42 }), metric({ metricName: 'overall_index', value: 68, sampleSize: null })],
    )

    expect(readout.cohortSize).toBe(42)
  })
})
