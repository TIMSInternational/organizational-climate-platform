import type { TranslateFn } from '../../../../i18n'
import type { BenchmarkDimension, BenchmarkReference } from './model'

/**
 * The arithmetic and the vocabulary behind the redesigned Puntos de Referencia. Pure, so
 * each reading is asserted at the values a fixture would take a render to reach.
 */

// ── Standing against the median ────────────────────────────────────────────────────────

export type Standing = 'below' | 'at' | 'above' | 'none'

export interface DimensionStanding {
  standing: Standing
  /** Rounded `score − median`; `null` when either side is missing. */
  delta: number | null
}

/**
 * Where one dimension sits against its cohort median — rounded first, then compared, as
 * `CohortDimensionBars` has always done, so the chip and the printed delta cannot
 * disagree ("±0" is always "en la mediana").
 */
export function dimensionStanding(score: number | null, median: number | null): DimensionStanding {
  if (score === null || median === null) return { standing: 'none', delta: null }
  // `|| 0` folds the `-0` that `Math.round(-0.4)` returns into a plain zero.
  const delta = Math.round(score - median) || 0
  return { standing: delta < 0 ? 'below' : delta > 0 ? 'above' : 'at', delta }
}

/**
 * How many dimensions sit below their median, and which sits furthest below.
 *
 * `compared` is false when not one dimension had both a score and a median: then "none
 * below" would be a claim about a comparison nobody made, and the card must not print it.
 */
export function belowSummary(dimensions: readonly BenchmarkDimension[]): {
  count: number
  widest: BenchmarkDimension | null
  compared: boolean
} {
  let count = 0
  let widest: BenchmarkDimension | null = null
  let widestDelta = 0
  let compared = false
  for (const dimension of dimensions) {
    const { standing, delta } = dimensionStanding(dimension.score, dimension.median)
    if (standing !== 'none') compared = true
    if (standing !== 'below' || delta === null) continue
    count += 1
    // Strictly less: on a tie the dimension asked first keeps the title.
    if (widest === null || delta < widestDelta) {
      widest = dimension
      widestDelta = delta
    }
  }
  return { count, widest, compared }
}

/** "−8", "+3", "±0": an explicit sign both ways, and the real minus sign. */
export function signedDelta(delta: number, locale?: string): string {
  if (delta === 0) return '±0'
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString(locale)}`
}

// ── The index, and the percentile no payload gives ─────────────────────────────────────

/**
 * An index as the tiles print it: a whole number on the 0–100 scale. Every gap the page
 * prints between two readings is taken AFTER this, so a printed change is always the
 * difference of the printed readings — a company at 67 against a median of 67.6 reads
 * "68" and "1 punto bajo la mediana", never "67,6" beside a gap of one point.
 */
export function printedIndex(value: number | null): number | null {
  // `|| 0` folds the `-0` that `Math.round(-0.4)` returns into a plain zero.
  return value === null ? null : Math.round(value) || 0
}

/** "1 punto bajo la mediana" — the printed index against the printed median. */
export function indexGapPhrase(t: TranslateFn, yourIndex: number | null, median: number | null): string | null {
  const mine = printedIndex(yourIndex)
  const theirs = printedIndex(median)
  if (mine === null || theirs === null) return null
  const gap = mine - theirs
  if (gap === 0) return t('benchmarks.next.gapLevel')
  const points = Math.abs(gap)
  if (gap < 0) return points === 1 ? t('benchmarks.next.gapBelowOne') : t('benchmarks.next.gapBelow', { count: points })
  return points === 1 ? t('benchmarks.next.gapAboveOne') : t('benchmarks.next.gapAbove', { count: points })
}

/**
 * The line under "Tu percentil" — a tile that prints no percentile, and says why.
 *
 * The one percentile any payload carries here is `percentile` on the COHORT's
 * `overall_index` reading (`BenchmarkMetric.Percentile`, `GET /admin/benchmarks/{id}`).
 * That is a property of the reading, not of a company: the decision record scores it as
 * the reading's own position in the cohort's distribution
 * (`docs/decisions/benchmark-analytics-endpoints.md`, the `distribution` component), and it
 * is stored once on a reference every tenant reads — so every company got the same number
 * whatever its index. Printed as "Tu percentil · tercio superior", it told Meridiano, one
 * point BELOW its group's median, that it sat above two thirds of the group.
 *
 * A company's percentile needs the group's distribution, which no endpoint returns. So the
 * tile reads "— sin calcular" (ruling 9 in PR #473), and this line keeps only what the
 * payload does measure — the gap to the median, whose sign is the gap's own — and names
 * what is missing. There is no band, so nothing here can disagree with that sign.
 */
export function percentileNote(t: TranslateFn, yourIndex: number | null, median: number | null): string | null {
  if (printedIndex(median) === null) return null
  const gap = indexGapPhrase(t, yourIndex, median)
  return gap === null ? t('benchmarks.next.percentileNoteNoGap') : t('benchmarks.next.percentileNote', { gap })
}

// ── References ─────────────────────────────────────────────────────────────────────────

export type QualityReading = { kind: 'unscored' } | { kind: 'score'; value: number }

/**
 * A reference's quality score, or "sin calcular" for one nobody has scored.
 *
 * PR #463 puts that on the wire as `qualityScore: null`; until it lands the list sends the
 * column's default `0` for such a row, and `validationStatus === 'pending'` is what the
 * detail says instead — `pending` is written by exactly one path, the create, and never
 * returned to (`BenchmarkQuality.ReportedScore` on that branch derives the same null from
 * the same status). A scored `0` is a verdict and keeps its number.
 */
export function qualityReading(reference: Pick<BenchmarkReference, 'qualityScore' | 'validationStatus'>): QualityReading {
  if (reference.qualityScore === null || reference.validationStatus === 'pending') return { kind: 'unscored' }
  return { kind: 'score', value: reference.qualityScore }
}

/** `BenchmarkTypes` (`ClimateProject.Domain`) is exactly `industry | internal`. */
const TYPE_KEYS: Record<string, string> = {
  industry: 'benchmarks.next.typeIndustry',
  internal: 'benchmarks.next.typeInternal',
}

/**
 * Categories are authored free text (a company_admin types one when creating a reference),
 * so this names the ones the product itself seeds and prints any other as authored.
 */
const CATEGORY_KEYS: Record<string, string> = {
  climate: 'benchmarks.next.categoryClimate',
  engagement: 'benchmarks.next.categoryEngagement',
}

export function benchmarkTypeLabel(t: TranslateFn, value: string): string {
  const key = TYPE_KEYS[value]
  return key ? t(key) : value
}

export function benchmarkCategoryLabel(t: TranslateFn, value: string): string {
  const key = CATEGORY_KEYS[value]
  return key ? t(key) : value
}

/** Whose reference it is, from where the viewer stands. */
export function scopeKey(companyId: string | null, viewerCompanyId: string | undefined): string {
  if (companyId === null) return 'benchmarks.next.scopePlatform'
  return viewerCompanyId !== undefined && companyId === viewerCompanyId
    ? 'benchmarks.next.scopeCompany'
    : 'benchmarks.next.scopeOther'
}
