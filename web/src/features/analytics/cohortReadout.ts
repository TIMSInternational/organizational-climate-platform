import type { BenchmarkMetric } from './api/benchmarks'
import type { SurveyQuestionResult } from '../surveys/api/surveyResults'

/**
 * Turning one closed survey plus one cohort benchmark into the Benchmarks read-out.
 *
 * Kept out of the page and free of React so the arithmetic can be tested at values the UI
 * would take a fixture and a render to reach — a dimension the cohort does not carry, a
 * survey question with no category, an unanswered scale.
 *
 * ## The two number systems, and why the conversion lives here
 *
 * A survey question's `average` is on the **1-5 likert scale** it was answered on. Every
 * benchmark figure, and every number the design prints, is on a **0-100 index**. The two
 * are not interchangeable and mixing them silently is the failure worth guarding: a raw
 * 3.75 rendered where an index belongs reads as a catastrophic score rather than a decent
 * one. One function converts, in one direction, and nothing else in the feature does the
 * arithmetic.
 */

/** The likert scale every seeded and authored climate question uses. */
const SCALE_MIN = 1
const SCALE_MAX = 5

/**
 * A 1-5 mean as the 0-100 index the cohort is expressed on.
 *
 * `null` in, `null` out: a question nobody answered has no mean, and inventing a 0 for it
 * would put a dimension at the floor of the chart and read as the worst possible score
 * rather than as an absence.
 */
export function toIndex(average: number | null): number | null {
  if (average === null || !Number.isFinite(average)) return null
  const clamped = Math.max(SCALE_MIN, Math.min(SCALE_MAX, average))
  return Math.round(((clamped - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100)
}

/** The metric a cohort benchmark carries for the whole index rather than one dimension. */
export const OVERALL_METRIC = 'overall_index'

export interface CohortReadout {
  /** This company's index across every dimension the survey scored, or null if none did. */
  yourIndex: number | null
  /** The cohort's median index, or null when the benchmark does not carry one. */
  cohortMedian: number | null
  /** Where this company sits in the cohort, 0-100, or null when not published. */
  percentile: number | null
  /** How many companies the cohort speaks for, or null when not published. */
  cohortSize: number | null
  dimensions: {
    key: string
    score: number | null
    cohortMedian: number | null
  }[]
}

/**
 * Compose the read-out.
 *
 * Dimensions come from the SURVEY, not from the benchmark: the screen answers "how did we
 * do", so a dimension this company asked about belongs on it whether or not the cohort has
 * a median for it (that row simply shows no tick and no delta). Driving the list from the
 * benchmark instead would silently drop a dimension the company measured and the cohort
 * does not — the one case where the reader most needs to see the gap.
 */
export function buildCohortReadout(
  questions: readonly SurveyQuestionResult[],
  metrics: readonly BenchmarkMetric[],
): CohortReadout {
  const cohortByName = new Map(metrics.map((metric) => [metric.metricName, metric]))
  const overall = cohortByName.get(OVERALL_METRIC)

  // One row per dimension the survey scored, in the order the questions were asked, and
  // averaged when a dimension carries more than one question.
  const byDimension = new Map<string, number[]>()
  for (const question of questions) {
    const category = question.category
    if (!category || category === OVERALL_METRIC) continue
    const index = toIndex(question.average)
    if (index === null) continue
    const scores = byDimension.get(category) ?? []
    scores.push(index)
    byDimension.set(category, scores)
  }

  const dimensions = [...byDimension.entries()].map(([key, scores]) => ({
    key,
    score: Math.round(scores.reduce((total, score) => total + score, 0) / scores.length),
    cohortMedian: cohortByName.get(key)?.value ?? null,
  }))

  const scored = dimensions.map((dimension) => dimension.score)
  const yourIndex = scored.length
    ? Math.round(scored.reduce((total, score) => total + score, 0) / scored.length)
    : null

  return {
    yourIndex,
    cohortMedian: overall?.value ?? null,
    percentile: overall?.percentile ?? null,
    // Any metric may carry it; the overall one is preferred because it describes the
    // cohort as a whole rather than one dimension's sample.
    cohortSize: overall?.sampleSize ?? metrics.find((m) => m.sampleSize != null)?.sampleSize ?? null,
    dimensions,
  }
}
