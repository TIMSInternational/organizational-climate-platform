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

/** How many dimensions sit below their median, and which sits furthest below. */
export function belowSummary(dimensions: readonly BenchmarkDimension[]): {
  count: number
  widest: BenchmarkDimension | null
} {
  let count = 0
  let widest: BenchmarkDimension | null = null
  let widestDelta = 0
  for (const dimension of dimensions) {
    const { standing, delta } = dimensionStanding(dimension.score, dimension.median)
    if (standing !== 'below' || delta === null) continue
    count += 1
    // Strictly less: on a tie the dimension asked first keeps the title.
    if (widest === null || delta < widestDelta) {
      widest = dimension
      widestDelta = delta
    }
  }
  return { count, widest }
}

/** "−8", "+3", "±0": an explicit sign both ways, and the real minus sign. */
export function signedDelta(delta: number, locale?: string): string {
  if (delta === 0) return '±0'
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString(locale)}`
}

// ── The index and the percentile ───────────────────────────────────────────────────────

export type Band = 'upper' | 'middle' | 'lower'

/** Thirds, as `CohortReadoutSection` has labelled them since the first read-out. */
export function percentileBand(percentile: number): Band {
  if (percentile >= 67) return 'upper'
  if (percentile >= 34) return 'middle'
  return 'lower'
}

const BAND_UNIT: Record<Band, string> = {
  upper: 'benchmarks.next.bandUpper',
  middle: 'benchmarks.next.bandMiddle',
  lower: 'benchmarks.next.bandLower',
}

const BAND_PHRASE: Record<Band, string> = {
  upper: 'benchmarks.next.bandUpperPhrase',
  middle: 'benchmarks.next.bandMiddlePhrase',
  lower: 'benchmarks.next.bandLowerPhrase',
}

export function bandUnit(t: TranslateFn, percentile: number | null): string | undefined {
  return percentile === null ? undefined : t(BAND_UNIT[percentileBand(percentile)])
}

/** "1 punto bajo la mediana" — the company's index against the cohort's, rounded. */
export function indexGapPhrase(t: TranslateFn, yourIndex: number | null, median: number | null): string | null {
  if (yourIndex === null || median === null) return null
  const gap = Math.round(yourIndex - median)
  if (gap === 0) return t('benchmarks.next.gapLevel')
  const points = Math.abs(gap)
  if (gap < 0) return points === 1 ? t('benchmarks.next.gapBelowOne') : t('benchmarks.next.gapBelow', { count: points })
  return points === 1 ? t('benchmarks.next.gapAboveOne') : t('benchmarks.next.gapAbove', { count: points })
}

/** "1 punto bajo la mediana, por encima de dos tercios del grupo". */
export function percentileSub(
  t: TranslateFn,
  yourIndex: number | null,
  median: number | null,
  percentile: number | null,
): string | null {
  const gap = indexGapPhrase(t, yourIndex, median)
  const band = percentile === null ? null : t(BAND_PHRASE[percentileBand(percentile)])
  if (gap !== null && band !== null) return t('benchmarks.next.percentileSub', { gap, band })
  return gap ?? band
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
