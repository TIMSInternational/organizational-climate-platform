import type { Benchmark } from './api/benchmarks'

/**
 * The arithmetic behind the comparison matrix and the trend table.
 *
 * Pure and separate from the components on purpose: these are the two places on
 * the benchmarks page where a quiet mistake produces a *plausible* number rather
 * than a visible break, so they are worth asserting directly rather than through
 * a render.
 */

/** One benchmark's value for one metric, or `null` where that benchmark has no such metric. */
export interface ComparisonCell {
  benchmarkId: string
  value: number | null
  unit: string | null
  percentile: number | null
}

export interface ComparisonRow {
  metricName: string
  cells: ComparisonCell[]
  /**
   * True when the benchmarks that *do* carry this metric disagree about its unit.
   *
   * Two benchmarks can both have a "response time" metric, one in `s` and one in
   * `ms`, and nothing upstream stops that — `BenchmarkMetric.Unit` is a free
   * string. Rendered side by side, 1.2 and 1200 look like a catastrophic
   * regression rather than the same number twice. The row carries the fact so the
   * table can mark it instead of silently inviting the comparison.
   */
  unitsDiffer: boolean
}

/**
 * Builds the metric-by-benchmark matrix.
 *
 * Row order follows first appearance across the selected benchmarks rather than
 * alphabetical: the benchmark the admin picked first keeps its own metric order,
 * which is the order they were looking at a moment ago.
 */
export function buildComparison(benchmarks: Benchmark[]): ComparisonRow[] {
  const metricNames: string[] = []
  for (const benchmark of benchmarks) {
    for (const metric of benchmark.metrics) {
      if (!metricNames.includes(metric.metricName)) metricNames.push(metric.metricName)
    }
  }

  return metricNames.map((metricName) => {
    const cells = benchmarks.map((benchmark): ComparisonCell => {
      const metric = benchmark.metrics.find((candidate) => candidate.metricName === metricName)
      return {
        benchmarkId: benchmark.id,
        value: metric ? metric.value : null,
        unit: metric ? metric.unit : null,
        percentile: metric?.percentile ?? null,
      }
    })
    const units = new Set(cells.map((cell) => cell.unit).filter((unit): unit is string => unit !== null))
    return { metricName, cells, unitsDiffer: units.size > 1 }
  })
}

export interface TrendPoint {
  benchmarkId: string
  benchmarkName: string
  value: number | null
  unit: string | null
  /** Change from the previous period, or `null` for the first period or a gap. */
  delta: number | null
  /** `delta` as a fraction of the previous value, or `null` when that value is 0 or missing. */
  changeRatio: number | null
}

export interface TrendSeries {
  metricName: string
  points: TrendPoint[]
}

/**
 * Turns a prior-period chain into one series per metric.
 *
 * `chain` arrives **newest first**, the order {@link followPriorPeriodChain}
 * produces it in, and comes back oldest first so a reader gets left-to-right
 * chronology. `delta` compares against the previous *period*, not the previous
 * non-null point: if a metric is absent from an intervening benchmark the delta
 * is `null` rather than silently spanning the gap, because a two-period jump
 * presented as a one-period change is the failure mode worth avoiding here.
 */
export function buildTrend(chain: Benchmark[]): TrendSeries[] {
  const chronological = [...chain].reverse()
  const metricNames: string[] = []
  for (const benchmark of chronological) {
    for (const metric of benchmark.metrics) {
      if (!metricNames.includes(metric.metricName)) metricNames.push(metric.metricName)
    }
  }

  return metricNames.map((metricName) => {
    let previous: number | null = null
    const points = chronological.map((benchmark): TrendPoint => {
      const metric = benchmark.metrics.find((candidate) => candidate.metricName === metricName)
      const value = metric ? metric.value : null
      const delta = value !== null && previous !== null ? value - previous : null
      const changeRatio = delta !== null && previous !== null && previous !== 0 ? delta / previous : null
      previous = value
      return {
        benchmarkId: benchmark.id,
        benchmarkName: benchmark.name,
        value,
        unit: metric ? metric.unit : null,
        delta,
        changeRatio,
      }
    })
    return { metricName, points }
  })
}

/**
 * Walks `priorPeriodBenchmarkId` back through time, newest first.
 *
 * `load` is passed in rather than imported so this stays testable without a
 * network stub, and so the page can serve it from the detail cache it already
 * holds.
 *
 * Two guards, both of which the API can hand us today:
 *
 * - **Cycles.** `PriorPeriodBenchmarkId` is validated on create only against
 *   "does this row exist" — nothing stops A→B→A, and an unguarded walk would hang
 *   the page. The visited set stops at the first repeat.
 * - **A link the caller cannot read.** A CompanyAdmin's benchmark may point at a
 *   prior period belonging to another tenant; `GET /admin/benchmarks/{id}` answers
 *   403 for that. A rejected load ends the chain rather than failing the page, so
 *   the trend shows the periods the caller is entitled to and stops.
 */
export async function followPriorPeriodChain(
  head: Benchmark,
  load: (id: string) => Promise<Benchmark>,
  maxPeriods = 12,
): Promise<Benchmark[]> {
  const chain: Benchmark[] = [head]
  const visited = new Set<string>([head.id])
  let cursor = head.priorPeriodBenchmarkId

  while (cursor !== null && !visited.has(cursor) && chain.length < maxPeriods) {
    visited.add(cursor)
    let prior: Benchmark
    try {
      prior = await load(cursor)
    } catch {
      break
    }
    chain.push(prior)
    cursor = prior.priorPeriodBenchmarkId
  }

  return chain
}
