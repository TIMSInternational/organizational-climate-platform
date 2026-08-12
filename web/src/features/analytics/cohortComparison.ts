import type { Benchmark } from './api/benchmarks'
import { buildComparison } from './benchmarkAnalysis'

/**
 * The arithmetic behind the "this benchmark against its cohort" bars.
 *
 * ## Why this is not the comparison matrix
 *
 * `buildComparison` answers "what does every selected benchmark say about every
 * metric" — an N-column table. That is the right shape for auditing values and the
 * wrong shape for the question the page is actually for: *is this one above or
 * below the others*. Reading that off a matrix means the eye differencing two
 * columns of digits, per row, every time.
 *
 * So this folds the same matrix into one reading per metric: the subject's value,
 * the **median** of the cohort's, and the difference. The component then draws one
 * zero-anchored bar per metric with the cohort median as a tick mark *inside* it.
 * A tick rather than a second bar because the question is position, not two
 * magnitudes — and a second measure drawn to its own scale is the dual axis
 * `charts/palette.ts` rules out.
 *
 * ## Median, not mean
 *
 * A cohort here is a handful of benchmarks, often three or fewer, and one
 * mis-entered value (a rate recorded as 85 where every other row says 0.85) moves
 * a mean of three by 28 points. The median ignores it. This is the same reason
 * published salary and industry benchmarks quote medians.
 *
 * ## The subject is the first selection, and that is a real ordering
 *
 * `BenchmarksPage` keeps `selectedIds` in click order, so `benchmarks[0]` is the
 * benchmark the admin ticked first. `buildComparison` already relies on exactly
 * that ordering for its row order ("the benchmark the admin picked first keeps its
 * own metric order"), so this adds no new assumption — and the component names the
 * subject in prose above the bars rather than leaving the reader to infer it.
 */

/** One metric, folded to a subject reading and a cohort position. */
export interface CohortRow {
  metricName: string
  /**
   * The subject's value, or `null` where the subject does not record this metric —
   * which happens whenever a cohort member records something the subject does not.
   */
  subject: number | null
  /**
   * Median of the cohort members that record this metric — `null` if none do, and
   * also `null` when {@link unitsDiffer}, because a median across two units is a
   * category error rather than a number.
   */
  cohortMedian: number | null
  /** `subject - cohortMedian`, or `null` when either side is missing. */
  delta: number | null
  /**
   * The unit to print beside the reading — the subject's, falling back to the
   * first cohort member that has one. `null` when nobody recorded a unit.
   */
  unit: string | null
  /**
   * True when the benchmarks that carry this metric disagree about its unit.
   * Carried straight through from {@link buildComparison}; a row flagged here is
   * drawn without bars, because 1.2 s and 1200 ms on one axis is a lie.
   */
  unitsDiffer: boolean
  /**
   * The top of this row's axis: {@link niceMax} of the largest value on the row,
   * or 0 when every value is missing or non-positive.
   *
   * **Per row, never per table.** Units differ between metrics — a percentage and
   * a headcount share no axis — so each row gets its own, and the bars are
   * comparable *within* a row only. The component prints `0` and this number under
   * every track so the row says what its own scale is.
   *
   * It is rounded UP to a round number rather than set to the largest value,
   * which is not cosmetic. A row holds two numbers, the subject and the cohort
   * median; scaled to the larger of them, the larger one fills the track *every
   * time*, and a bar that is always full carries no information. Rendered and
   * looked at: with the subject at 74 and the cohort at 69 the bar ran to the end
   * of its track on five rows out of six.
   */
  scaleMax: number
}

/**
 * The smallest 1/2/5 × 10ⁿ that is at least `value` — the round number an axis
 * should stop at.
 *
 * 74 → 100, 12 → 20, 1.2 → 2, 1200 → 2000, 0.92 → 1. Zero and anything negative
 * give 0, which {@link trackFraction} reads as "no track".
 */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 5]) {
    // A hair of tolerance so a value that IS the round number does not get pushed
    // to the next step by the floating-point error in `log10`/`**`.
    if (value <= step * magnitude * (1 + 1e-9)) return step * magnitude
  }
  return 10 * magnitude
}

/**
 * The middle value, or the mean of the two middle values for an even count.
 *
 * Returns `null` for an empty list rather than `NaN`: "no cohort recorded this"
 * is a state the caller has to render differently, and `NaN` would sail through
 * every arithmetic check below it and surface as a blank bar.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Folds the selected benchmarks into one row per metric.
 *
 * `benchmarks[0]` is the subject; the rest are the cohort. Fewer than two
 * benchmarks yields an empty list — there is no cohort to compare against, and the
 * page does not render this panel at all in that case.
 */
export function buildCohortRows(benchmarks: readonly Benchmark[]): CohortRow[] {
  if (benchmarks.length < 2) return []

  return buildComparison([...benchmarks]).map((row): CohortRow => {
    const [subjectCell, ...cohortCells] = row.cells
    const subject = subjectCell.value
    const cohortValues = cohortCells
      .map((cell) => cell.value)
      .filter((value): value is number => value !== null)
    // A median across units is not a number, it is a category error. Found by
    // rendering: with the subject recording 1.2 s and the cohort 1200 ms, this row
    // printed a cohort median of "1,200 s" — the cohort's magnitude wearing the
    // subject's unit — and a change of "−1,198.8". Both are worse than saying
    // nothing, which is what `null` here makes the component say.
    const cohortMedian = row.unitsDiffer ? null : median(cohortValues)

    const present = subject === null ? cohortValues : [subject, ...cohortValues]
    return {
      metricName: row.metricName,
      subject,
      cohortMedian,
      delta: subject !== null && cohortMedian !== null ? subject - cohortMedian : null,
      unit: subjectCell.unit ?? cohortCells.find((cell) => cell.unit !== null)?.unit ?? null,
      unitsDiffer: row.unitsDiffer,
      // Zero-anchored, so `Math.max` starts at 0 rather than at -Infinity: a row
      // whose values are all negative gets an empty track, not an inverted one.
      scaleMax: niceMax(Math.max(0, ...present)),
    }
  })
}

/**
 * Where a value sits on a row's track, as a 0..1 fraction.
 *
 * Clamped, and 0 for a non-positive scale. Bars are anchored at zero — this
 * project's locked rule for bars (`charts/BarChart.tsx`) — so a negative value
 * draws nothing rather than being re-based to make it visible, which would put the
 * zero line somewhere other than the left edge without saying so.
 */
export function trackFraction(value: number, scaleMax: number): number {
  if (scaleMax <= 0) return 0
  return Math.min(1, Math.max(0, value / scaleMax))
}
