import type { BenchmarkListItem } from '../api/benchmarks'
import type { ChartDatum } from '../../../components/charts'

/**
 * Aggregation for `BenchmarkQualityChart`, in its own module rather than beside the
 * component: a file that exports both a component and a helper loses react-refresh
 * (`react(only-export-components)`), and the web lint budget has no headroom for that.
 */

/** The single series key. Stable and locale-independent, so the colour never moves. */
export const QUALITY_SERIES_KEY = 'quality'

/**
 * Average `qualityScore` per benchmark category, alphabetically by category.
 *
 * Pure, so the aggregation is testable without rendering recharts — which needs an
 * explicit pixel width under happy-dom to emit an `<svg>` at all.
 *
 * Categories are server data, not copy: they are used verbatim as the axis labels rather
 * than routed through the catalogue, because the set is open (a CompanyAdmin types the
 * category when creating a benchmark) and a key per unknown value cannot exist.
 *
 * A category whose benchmarks all score 0 still produces a row with 0, not a gap: zero is
 * a measured score here, and `ChartDatum` reserves `null` for "not measured".
 *
 * A benchmark whose `qualityScore` is `null` has NOT been measured — the rule has never
 * run on it — and is left out of its category's mean rather than counted as a 0. It still
 * puts the category on the axis, and a category in which nothing has been scored charts
 * as a gap, which is the one thing `ChartDatum`'s `null` is for. Before the score was
 * nullable every unvalidated row arrived as 0, so three verified benchmarks at 90 beside
 * two fresh ones charted at 54.
 */
export function averageQualityByCategory(
  benchmarks: readonly BenchmarkListItem[],
): ChartDatum[] {
  const totals = new Map<string, { sum: number; count: number }>()

  for (const benchmark of benchmarks) {
    const existing = totals.get(benchmark.category) ?? { sum: 0, count: 0 }
    totals.set(
      benchmark.category,
      benchmark.qualityScore === null
        ? existing
        : { sum: existing.sum + benchmark.qualityScore, count: existing.count + 1 },
    )
  }

  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, { sum, count }]) => ({
      label: category,
      values: { [QUALITY_SERIES_KEY]: count === 0 ? null : sum / count },
    }))
}
