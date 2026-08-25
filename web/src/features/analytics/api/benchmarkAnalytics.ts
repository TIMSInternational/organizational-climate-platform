import { authFetch } from '../../../api/authFetch'
import type { BenchmarkMetric } from './benchmarks'

/**
 * Typed client for the analytical half of `/admin/benchmarks` (#90) —
 * `BenchmarkAnalyticsEndpoints.cs`.
 *
 * Separate from `benchmarks.ts`, which stores benchmarks; this file reads them against each
 * other. The two rules a caller has to carry across from the server:
 *
 * - **A null `delta` is a decision, not a gap.** Both `compare` and `trends` withhold the
 *   difference when the two sides record a metric in different units. `BenchmarkMetric.unit`
 *   is a free string, so 0.68 as a fraction differenced against 70 as a percent reads as a
 *   69-point collapse that did not happen. Both units come back so a screen can say why the
 *   change is missing instead of printing a dash.
 * - **A short trend is not necessarily a complete one.** `stopReason` says why the walk
 *   ended, and `'withheld'` means the chain continues into rows this caller may not read.
 */

/** One benchmark on one side of a comparison — `BenchmarkComparisonMember`. */
export interface BenchmarkComparisonMember {
  id: string
  name: string
  category: string
  type: string
  /** `null` means a global benchmark, readable by every tenant. */
  companyId: string | null
  industry: string | null
  companySize: string | null
  region: string | null
}

/**
 * One metric read against the baseline's same metric — `BenchmarkMetricComparisonDto`.
 *
 * `delta` is null when either side lacks the metric **or** the two record it in different
 * units. `changeRatio` is additionally null when `baselineValue` is 0.
 */
export interface BenchmarkMetricComparison {
  metricName: string
  value: number | null
  unit: string | null
  baselineValue: number | null
  baselineUnit: string | null
  delta: number | null
  changeRatio: number | null
}

export interface BenchmarkComparisonEntry {
  benchmark: BenchmarkComparisonMember
  metrics: BenchmarkMetricComparison[]
}

export interface BenchmarkComparison {
  baseline: BenchmarkComparisonMember
  baselineMetrics: BenchmarkMetric[]
  comparisons: BenchmarkComparisonEntry[]
}

/** One period of a trend — `BenchmarkTrendPeriod`. */
export interface BenchmarkTrendPeriod {
  id: string
  name: string
  createdAt: string
  priorPeriodStatus: string
}

/** One metric's reading in one period. `delta` is against the period *before* it. */
export interface BenchmarkTrendPoint {
  benchmarkId: string
  value: number | null
  unit: string | null
  delta: number | null
  changeRatio: number | null
}

/** `points` is parallel to `BenchmarkTrend.periods` and always the same length. */
export interface BenchmarkTrendSeries {
  metricName: string
  points: BenchmarkTrendPoint[]
}

/**
 * Why a trend walk ended — `BenchmarkTrendStopReasons`.
 *
 * `'none'` is an answer (the oldest period declares nothing precedes it); `'unlinked'` is our
 * own data entry not having caught up; `'withheld'` means the chain runs on into rows this
 * caller may not read. A screen that renders all three the same way is the conflation #89
 * spent itself ending, one level up.
 */
export type BenchmarkTrendStopReason = 'none' | 'unlinked' | 'withheld' | 'cap' | 'cycle'

export interface BenchmarkTrend {
  benchmarkId: string
  benchmarkName: string
  /** Oldest first, so a chart plots them left to right without reversing. */
  periods: BenchmarkTrendPeriod[]
  series: BenchmarkTrendSeries[]
  stopReason: BenchmarkTrendStopReason
}

export interface BenchmarkIndustryFilters {
  industry?: string
  companySize?: string
  region?: string
  category?: string
  type?: string
  /**
   * Places this benchmark inside the sector, and defaults `industry` and `category` from it.
   * The subject is **excluded** from the aggregate it is measured against.
   */
  benchmarkId?: string
}

/** One metric aggregated across a sector, in one unit — `BenchmarkIndustryMetric`. */
export interface BenchmarkIndustryMetric {
  metricName: string
  /** Grouped by unit as well as name: a mean across two units is true of neither benchmark. */
  unit: string
  benchmarkCount: number
  totalSampleSize: number
  mean: number
  median: number
  min: number
  max: number
  subjectValue: number | null
  /** `subjectValue - mean`: how far this benchmark sits from its sector. */
  subjectDelta: number | null
  subjectChangeRatio: number | null
  /** Share of peers reading strictly below the subject, 0..100. Null when there are no peers. */
  subjectPercentileRank: number | null
}

export interface BenchmarkIndustryReading {
  filters: {
    industry: string | null
    companySize: string | null
    region: string | null
    category: string | null
    type: string | null
  }
  /** Peers in the aggregate, **excluding** the subject. A "sector" of one is not one. */
  benchmarkCount: number
  subject: BenchmarkComparisonMember | null
  metrics: BenchmarkIndustryMetric[]
}

/** A category in the caller's readable scope — `BenchmarkCategorySummary`. */
export interface BenchmarkCategorySummary {
  category: string
  benchmarkCount: number
  /** How many are global rows, which a CompanyAdmin may read but not edit. */
  globalCount: number
  activeCount: number
  types: string[]
  averageQualityScore: number
}

/** One component of the quality rule — `BenchmarkQualityComponent`. */
export interface BenchmarkQualityComponent {
  /** `metrics` | `sample-size` | `distribution` | `attribution` | `unit-consistency`. */
  name: string
  weight: number
  score: number
  weightedScore: number
  satisfied: number
  total: number
}

export interface BenchmarkValidation {
  benchmarkId: string
  status: string
  qualityScore: number
  previousStatus: string
  previousQualityScore: number
  /** Every component with its weight and counts, so the score can be recomputed by hand. */
  components: BenchmarkQualityComponent[]
}

export interface ImportBenchmarkMetricInput {
  metricName: string
  value: number
  unit: string
  percentile?: number
  sampleSize?: number
}

export interface ImportBenchmarkInput {
  name: string
  description: string
  type: string
  category: string
  source: string
  industry?: string
  companySize?: string
  region?: string
  /**
   * Required to state, and nullable on purpose — the same reason `CreateBenchmarkInput` makes
   * it explicit. `null` imports a GLOBAL benchmark, which the server allows only for a
   * SuperAdmin, and it checks **every item**, not the caller once.
   */
  companyId: string | null
  metrics?: ImportBenchmarkMetricInput[]
}

export interface ImportedBenchmarkSummary {
  index: number
  /** Null on a validate-only run: nothing was created, so there is no id to give. */
  id: string | null
  name: string
  companyId: string | null
  metrics: number
  qualityScore: number
  validationStatus: string
}

export interface BenchmarkImportResult {
  applied: boolean
  benchmarks: number
  metrics: number
  created: ImportedBenchmarkSummary[]
}

/**
 * Compares two or more benchmarks against one of them.
 *
 * The ids go over as one comma-separated `ids` parameter, which is the shape the server
 * parses; `baselineId` must be one of them and defaults to the first.
 */
export async function compareBenchmarks(
  baseUrl: string,
  ids: readonly string[],
  baselineId?: string,
): Promise<BenchmarkComparison> {
  const query = new URLSearchParams({ ids: ids.join(',') })
  if (baselineId) query.set('baselineId', baselineId)
  const response = await authFetch(`${baseUrl}/admin/benchmarks/compare?${query.toString()}`)
  return response.json() as Promise<BenchmarkComparison>
}

/** Every period behind a benchmark, oldest first, walked and differenced by the server. */
export async function getBenchmarkTrend(baseUrl: string, id: string): Promise<BenchmarkTrend> {
  const response = await authFetch(`${baseUrl}/admin/benchmarks/${id}/trends`)
  return response.json() as Promise<BenchmarkTrend>
}

/**
 * Aggregates a sector, and optionally places one benchmark inside it.
 *
 * An absent filter is left OFF the query string rather than sent empty: `?industry=` would be
 * read as a filter and an `undefined` stringified into the URL would filter on the literal
 * word, either of which returns an empty sector for a question that had none.
 */
export async function getIndustryBenchmarks(
  baseUrl: string,
  filters: BenchmarkIndustryFilters = {},
): Promise<BenchmarkIndustryReading> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, value)
  }
  const suffix = query.toString()
  const response = await authFetch(`${baseUrl}/admin/benchmarks/industry${suffix ? `?${suffix}` : ''}`)
  return response.json() as Promise<BenchmarkIndustryReading>
}

/** The categories present in the caller's readable scope. */
export async function listBenchmarkCategories(baseUrl: string): Promise<BenchmarkCategorySummary[]> {
  const response = await authFetch(`${baseUrl}/admin/benchmarks/categories`)
  return response.json() as Promise<BenchmarkCategorySummary[]>
}

/**
 * Runs the quality rule and stores what it said.
 *
 * A write: a CompanyAdmin may not validate a global benchmark, for the same reason they may
 * not create one.
 */
export async function validateBenchmark(baseUrl: string, id: string): Promise<BenchmarkValidation> {
  const response = await authFetch(`${baseUrl}/admin/benchmarks/${id}/validate`, { method: 'POST' })
  return response.json() as Promise<BenchmarkValidation>
}

/**
 * Creates many benchmarks with their metrics in one all-or-nothing request.
 *
 * `validateOnly` checks and scores everything and writes nothing. One rejected item fails the
 * whole import — deliberately, because a partial import leaves the caller's file and the
 * database disagreeing, and re-running the file then duplicates whatever did land.
 */
export async function importBenchmarks(
  baseUrl: string,
  benchmarks: readonly ImportBenchmarkInput[],
  options: { validateOnly?: boolean } = {},
): Promise<BenchmarkImportResult> {
  const response = await authFetch(`${baseUrl}/admin/benchmarks/import`, {
    method: 'POST',
    body: JSON.stringify({ benchmarks, validateOnly: options.validateOnly ?? false }),
  })
  return response.json() as Promise<BenchmarkImportResult>
}
