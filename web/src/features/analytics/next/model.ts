import type { AIInsightListItem } from '../api/insights'
import type { BenchmarkListItem, Benchmark } from '../api/benchmarks'
import type { SurveyListItem } from '../../surveys/api/surveys'
import { INSIGHT_PRIORITIES } from '../insightVocabulary'

/**
 * The redesigned Información de IA and Analítica screens, as data.
 *
 * Every field below is read from an endpoint that exists today — `GET /admin/ai-insights`,
 * `GET /admin/benchmarks`, `GET /admin/benchmarks/{id}` and `GET /surveys` — so neither
 * screen carries a sample region. Nothing is typed as a number here: the counts, the
 * order and the group size are computed by the functions in this file.
 */

/** Critical first, then high, medium, low; within one priority the unreviewed come first. */
export function sortInsights(insights: AIInsightListItem[]): AIInsightListItem[] {
  const rank = (priority: string) => {
    const index = INSIGHT_PRIORITIES.indexOf(priority as (typeof INSIGHT_PRIORITIES)[number])
    // An unknown priority sorts last rather than first: it is not evidence of urgency.
    return index === -1 ? -1 : index
  }
  return [...insights].sort(
    (a, b) =>
      rank(b.priority) - rank(a.priority) ||
      Number(a.isAcknowledged) - Number(b.isAcknowledged) ||
      a.title.localeCompare(b.title),
  )
}

export function openInsightCount(insights: AIInsightListItem[]): number {
  return insights.filter((insight) => !insight.isAcknowledged).length
}

export interface BenchmarkRow {
  id: string
  name: string
  type: string
  category: string
  isActive: boolean
  /** `companyId === null` on the wire: every tenant reads it. */
  isGlobal: boolean
  /**
   * The cohort's size, read from the detail's metrics. `null` when the detail could not be
   * read or no metric records a sample size — printed as a dash, never as 0.
   */
  groupSize: number | null
  /** `null` when the benchmark has not been validated yet: "sin calcular", not a score of 0. */
  qualityScore: number | null
}

/**
 * A metric's `sampleSize` is per metric; a cohort's metrics normally share one. The largest
 * is the cohort — a metric recorded for fewer members is a gap in that metric, not a
 * smaller group.
 */
export function groupSizeOf(detail: Pick<Benchmark, 'metrics'> | null | undefined): number | null {
  const sizes = (detail?.metrics ?? [])
    .map((metric) => metric.sampleSize)
    .filter((size): size is number => typeof size === 'number' && size > 0)
  return sizes.length === 0 ? null : Math.max(...sizes)
}

export function benchmarkRows(
  benchmarks: BenchmarkListItem[],
  details: Map<string, Benchmark | null>,
): BenchmarkRow[] {
  return benchmarks.map((benchmark) => {
    const detail = details.get(benchmark.id) ?? null
    const pending = detail ? detail.validationStatus === 'pending' : benchmark.qualityScore === 0
    return {
      id: benchmark.id,
      name: benchmark.name,
      type: benchmark.type,
      category: benchmark.category,
      isActive: benchmark.isActive,
      isGlobal: benchmark.companyId === null,
      groupSize: groupSizeOf(detail),
      qualityScore: pending ? null : benchmark.qualityScore,
    }
  })
}

/** The wave the references are read against: the company's most recently closed survey. */
export function latestClosedSurvey(
  surveys: SurveyListItem[],
  companyId: string,
): SurveyListItem | null {
  const closed = surveys.filter((survey) => survey.companyId === companyId && survey.status === 'closed')
  if (closed.length === 0) return null
  return closed.reduce((latest, survey) =>
    new Date(survey.endDate).getTime() > new Date(latest.endDate).getTime() ? survey : latest,
  )
}
