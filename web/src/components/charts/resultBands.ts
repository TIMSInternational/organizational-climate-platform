import type { TranslateFn } from '../../i18n/translate'
import type { ChipTone } from '../ui/chipVariants'

/**
 * A company's result bands: the three areas a 1–5 mean is read in. They replace the
 * single "meta 3,7" the screens used to print (`CLIMATE_TARGET`, a mockup constant that
 * no tenant ever chose).
 *
 * ## The shape
 *
 * The scale is always 1,00 to 5,00 and the areas are contiguous, so two boundaries decide
 * it: where the opportunity area starts and where the strength area starts. The API stores
 * exactly that (`ResultBandsDto`), so no screen can meet a gap or an overlap.
 *
 * ## Which number is judged
 *
 * **The printed one.** A cell that prints "4,0" is in the strength area even when the
 * unrounded mean is 3,96, because a reader holds the figure against the legend's
 * "4,00 a 5,00" and a 4,0 painted amber is a contradiction on the page. `bandOf` therefore
 * takes the precision the caller prints at and rounds before it compares.
 *
 * ## The colours
 *
 * Fixed by the product, never by the tenant: critical is the red chip pair, opportunity the
 * amber, strength the green (`--admin-chip-*`, measured for contrast in both themes by
 * `styles/chipVariantContrast.test.ts`). Colour is never the only signal: every band also
 * carries its name and its glyph (`BandGlyph`).
 */
export type ResultBandKey = 'critical' | 'opportunity' | 'strength'

export interface ResultBands {
  /** The first value in the opportunity area, two decimals (3,00 by default). */
  opportunityMin: number
  /** The first value in the strength area, two decimals (4,00 by default). */
  strengthMin: number
  /** The company's own names; `null` is the product's default name in the reader's language. */
  names: Readonly<Record<ResultBandKey, string | null>>
}

export const SCALE_MIN = 1
export const SCALE_MAX = 5
/** The smallest step between two boundaries: the scale is edited at two decimals. */
export const BOUNDARY_STEP = 0.01

/** The product default for every tenant: under 3,00 critical, 3,00–3,99 opportunity, 4,00 up strength. */
export const DEFAULT_RESULT_BANDS: ResultBands = {
  opportunityMin: 3,
  strengthMin: 4,
  names: { critical: null, opportunity: null, strength: null },
}

/** Highest first — the order every legend and the settings card read in. */
export const RESULT_BAND_ORDER: readonly ResultBandKey[] = ['strength', 'opportunity', 'critical']

/** The chip tone each band paints with. */
export const BAND_TONE: Readonly<Record<ResultBandKey, ChipTone>> = {
  strength: 'good',
  opportunity: 'warning',
  critical: 'critical',
}

/**
 * The tokens a band paints with, as CSS values so a style prop and an SVG fill read the
 * same token. `fill`/`ink` are the opaque chip pair (text sits on them); `ring` is the
 * tone's 20% border; `line` is the accent, for a rule or a swatch's top edge; `zone` is
 * the translucent tint a chart lays behind its line.
 */
export const BAND_PAINT: Readonly<Record<ResultBandKey, { fill: string; ink: string; ring: string; line: string; zone: string }>> = {
  strength: {
    fill: 'var(--admin-chip-bg-good)',
    ink: 'var(--admin-chip-ink-good)',
    ring: 'var(--admin-accent-border-green)',
    line: 'var(--admin-accent-green)',
    zone: 'var(--admin-accent-bg-green)',
  },
  opportunity: {
    fill: 'var(--admin-chip-bg-warning)',
    ink: 'var(--admin-chip-ink-warning)',
    ring: 'var(--admin-accent-border-amber)',
    line: 'var(--admin-accent-amber)',
    zone: 'var(--admin-accent-bg-amber)',
  },
  critical: {
    fill: 'var(--admin-chip-bg-critical)',
    ink: 'var(--admin-chip-ink-critical)',
    ring: 'var(--admin-accent-border-red)',
    line: 'var(--admin-accent-red)',
    zone: 'var(--admin-accent-bg-red)',
  },
}

/** A cell painted as its band: the opaque fill, its ink, and the tone's ring as the border. */
export function bandCellStyle(key: ResultBandKey): { backgroundColor: string; color: string; borderColor: string } {
  const paint = BAND_PAINT[key]
  return { backgroundColor: paint.fill, color: paint.ink, borderColor: paint.ring }
}

/** A value rounded the way it is printed. `EPSILON` so 2,95 rounds up like the printed "3,0". */
export function printed(value: number, decimals: number): number {
  const scale = 10 ** decimals
  return Math.round((value + Number.EPSILON) * scale) / scale
}

/** The band a mean falls in, judged at the precision it is printed at (one decimal by default). */
export function bandOf(value: number, bands: ResultBands, decimals = 1): ResultBandKey {
  const shown = printed(value, decimals)
  // A hair under the boundary so a printed 4.0 compared with a stored 4.00 is never lost
  // to the last bit of a float.
  if (shown >= bands.strengthMin - 1e-9) return 'strength'
  if (shown >= bands.opportunityMin - 1e-9) return 'opportunity'
  return 'critical'
}

/** The inclusive two-decimal range of a band: critical 1,00–2,99, opportunity 3,00–3,99 … */
export function bandRange(key: ResultBandKey, bands: ResultBands): { min: number; max: number } {
  const below = (boundary: number) => Math.round((boundary - BOUNDARY_STEP) * 100) / 100
  if (key === 'critical') return { min: SCALE_MIN, max: below(bands.opportunityMin) }
  if (key === 'opportunity') return { min: bands.opportunityMin, max: below(bands.strengthMin) }
  return { min: bands.strengthMin, max: SCALE_MAX }
}

/** The band's name: the company's own when it chose one, else the product's ("Área crítica"). */
export function bandName(key: ResultBandKey, bands: ResultBands, t: TranslateFn): string {
  return bands.names[key] ?? t(`resultBands.name.${key}`)
}

/**
 * The band's name where a cell has room for one word: the product's short word
 * ("Crítica") for a default name, the company's own name verbatim otherwise — a custom
 * name cannot be shortened without inventing a word the company never chose, so the cell
 * truncates it and carries the whole name in its title and its accessible label.
 */
export function bandShortName(key: ResultBandKey, bands: ResultBands, t: TranslateFn): string {
  return bands.names[key] ?? t(`resultBands.short.${key}`)
}

/** Two decimals in the reader's locale ("3,00"), the precision the scale is defined at. */
export function boundaryText(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

/** "4,00 a 5,00" / "menos de 3,00" — the range a legend prints beside the name. */
export function bandRangeText(key: ResultBandKey, bands: ResultBands, t: TranslateFn, locale: string): string {
  const { min, max } = bandRange(key, bands)
  if (key === 'critical') return t('resultBands.range.under', { value: boundaryText(bands.opportunityMin, locale) })
  return t('resultBands.range.between', { min: boundaryText(min, locale), max: boundaryText(max, locale) })
}

/** The whole reading in words, for an accessible label: "2,4 — Área crítica". */
export function bandReading(valueText: string, key: ResultBandKey, bands: ResultBands, t: TranslateFn): string {
  return t('resultBands.reading', { value: valueText, band: bandName(key, bands, t) })
}

export interface BandScaleSegment {
  /** A band, or `gap` for a stretch of the scale no band covers (the settings card's error). */
  key: ResultBandKey | 'gap'
  from: number
  to: number
}

/** The three bands laid end to end over 1–5, as a valid scale has them. */
export function segmentsOf(bands: ResultBands): BandScaleSegment[] {
  return [
    { key: 'critical', from: SCALE_MIN, to: bands.opportunityMin },
    { key: 'opportunity', from: bands.opportunityMin, to: bands.strengthMin },
    { key: 'strength', from: bands.strengthMin, to: SCALE_MAX },
  ]
}
