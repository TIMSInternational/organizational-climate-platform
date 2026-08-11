import type { MetricFormat } from '../../components/charts'

/**
 * How a benchmark's quality score is set, wherever it is printed.
 *
 * `Benchmark.QualityScore` is a bare `double` on the entity with no precision
 * constraint anywhere behind it — `BenchmarkEndpoints` seeds it at `0` and nothing
 * rounds it — so the number of digits it arrives with is not a fact this UI may
 * lean on. Two things went wrong because of that, in opposite directions, on the
 * same screen:
 *
 * - `BenchmarkList` printed the raw JS number. `0.9` and `0.92` then sat in one
 *   column with different digit counts, so the column did not line up despite
 *   being set in tabular figures — and a raw number never localises, so it stayed
 *   `0.92` in Spanish while every other reading on that page took a decimal comma.
 * - `BenchmarkDetailPanel` passed `{ kind: 'number' }`, whose default precision is
 *   "however many this number needs, capped at ONE" (`charts/formatMetric.ts`).
 *   A stored 0.92 therefore rendered as `0.9` in the panel — a digit dropped off
 *   the very figure the panel exists to report, and disagreeing with the list row
 *   one section above it.
 *
 * Fixing the precision here answers both: every quality score is the same width
 * in the same place in both catalogues, and the two surfaces cannot disagree.
 * Two decimals rather than one because the score is a 0–1 fraction, where one
 * decimal leaves eleven distinguishable values and collapses 0.92 onto 0.88.
 */
export const QUALITY_SCORE_FORMAT: MetricFormat = { kind: 'number', decimals: 2 }
