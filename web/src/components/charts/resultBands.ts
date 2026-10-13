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
  /**
   * How a person reads a score: `mean` is the 1,00–5,00 mean itself; `percent` is the same
   * mean on 0–100 (`mean × 20`), the client's EAGLE convention. The data, the boundaries
   * above and every banding decision stay on 1–5 — only the printed figure changes, and it
   * changes in exactly one place (`scoreText` and its siblings below).
   */
  scale: ResultScale
}

export type ResultScale = 'mean' | 'percent'

export const SCALE_MIN = 1
export const SCALE_MAX = 5
/** The smallest step between two boundaries: the scale is edited at two decimals. */
export const BOUNDARY_STEP = 0.01

/** The product default for every tenant: under 3,00 critical, 3,00–3,99 opportunity, 4,00 up strength. */
export const DEFAULT_RESULT_BANDS: ResultBands = {
  opportunityMin: 3,
  strengthMin: 4,
  names: { critical: null, opportunity: null, strength: null },
  scale: 'mean',
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
 * ("Crítica") for a default name, the company's own name otherwise — never a word the
 * company did not write. One shortening is allowed because it invents nothing: when all
 * three names share leading words, those are dropped, since they are exactly the part
 * that cannot tell the bands apart. EAGLE's "Áreas de fortaleza / oportunidad / criticas"
 * truncated to three identical "ÁREAS DE…" cells (2026-10-12); they now read FORTALEZA,
 * OPORTUNIDAD, CRITICAS. The whole name stays in the cell's title and accessible label.
 */
export function bandShortName(key: ResultBandKey, bands: ResultBands, t: TranslateFn): string {
  const own = bands.names[key]
  if (own === null) return t(`resultBands.short.${key}`)
  const shared = sharedLeadingWords(bands)
  if (shared === 0) return own
  const rest = own.trim().split(/\s+/).slice(shared)
  // "Áreas criticas / de oportunidad / de fortaleza" share only "Áreas"; the connector left
  // in front ("de", "of") still pushed the word that matters out of a narrow cell.
  return (rest.length > 1 && rest[0].length <= 3 && rest[0] === rest[0].toLocaleLowerCase() ? rest.slice(1) : rest).join(' ')
}

/** How many leading words all three custom names share, leaving each at least one word. */
function sharedLeadingWords(bands: ResultBands): number {
  const all = [bands.names.critical, bands.names.opportunity, bands.names.strength]
  if (all.some((name) => name === null)) return 0
  const words = all.map((name) => name!.trim().split(/\s+/))
  const most = Math.min(...words.map((list) => list.length)) - 1
  let shared = 0
  while (shared < most && words.every((list) => list[shared].toLocaleLowerCase() === words[0][shared].toLocaleLowerCase())) shared += 1
  return shared
}

/** A wire value as a scale: anything but `"percent"` — absent included — is the 1–5 mean. */
export function parseResultScale(raw: unknown): ResultScale {
  return raw === 'percent' ? 'percent' : 'mean'
}

/** `mean × 20`: 1,00 → 20, 3,80 → 76, 5,00 → 100. */
export const PERCENT_PER_POINT = 20

/** The figure a reader sees for a 1–5 mean (or a 1–5 delta) on this scale. */
export function scaledValue(value: number, scale: ResultScale): number {
  return scale === 'percent' ? value * PERCENT_PER_POINT : value
}

/**
 * The decimals a value prints at on this scale. On 0–100 one decimal fewer than the 1–5
 * call asked for, because ×20 moves the figure one order up: 4,07 → "81,4", 4,1 → "81".
 */
export function scaleDecimals(decimals: number, scale: ResultScale): number {
  return scale === 'percent' ? Math.max(0, decimals - 1) : decimals
}

/** The top of the scale a reader is told ("de 5" / "de 100"). */
export function scaleMax(scale: ResultScale): number {
  return scale === 'percent' ? 100 : SCALE_MAX
}

/** "de 5" / "de 100" — the unit a headline score is printed with. */
export function scaleUnitText(scale: ResultScale, t: TranslateFn): string {
  return scale === 'percent' ? t('resultBands.scale.unitPercent') : t('resultBands.results.climateUnit')
}

function scoreFormat(value: number, scale: ResultScale, locale: string, decimals: number, signed: boolean): string {
  const places = scaleDecimals(decimals, scale)
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
    ...(signed ? { signDisplay: 'always' as const } : {}),
  }).format(scaledValue(value, scale))
}

/**
 * **The** place a 1–5 mean becomes reader text. `mean`: "4,1" (unchanged from before the
 * scale existed); `percent`: "81". `decimals` is the 1–5 precision the caller wants.
 */
export function scoreText(value: number, scale: ResultScale, locale: string, decimals = 1): string {
  return scoreFormat(value, scale, locale, decimals, false)
}

/** A change between two means with its sign always shown: "+0,32" / "+6,4". */
export function signedScoreText(delta: number, scale: ResultScale, locale: string, decimals = 1): string {
  return scoreFormat(delta, scale, locale, decimals, true)
}

/**
 * A change as the results screens print one: rounded to what is shown first, then a plus
 * only when that figure is above zero — "+0,12", "0,00", "-0,3" (on 0–100: "+2,4", "0", "-6").
 */
export function deltaScoreText(delta: number, scale: ResultScale, locale: string, decimals = 1): string {
  const shown = shownDelta(delta, scale, decimals)
  const places = scaleDecimals(decimals, scale)
  const text = new Intl.NumberFormat(locale, { minimumFractionDigits: places, maximumFractionDigits: places }).format(shown)
  return shown > 0 ? `+${text}` : text
}

/** A change as the figure the reader sees, rounded the way it is printed (`|| 0` folds -0). */
export function shownDelta(delta: number, scale: ResultScale, decimals = 1): number {
  const step = 10 ** scaleDecimals(decimals, scale)
  return Math.round(scaledValue(delta, scale) * step) / step || 0
}

/**
 * A boundary in the reader's locale. `mean`: two decimals, the precision the scale is
 * defined at ("3,00"). `percent`: the 0–100 figure with at most one decimal, so EAGLE's
 * 3,80 / 4,30 read "76" / "86" and 2,99 reads "59,8".
 */
export function boundaryText(value: number, locale: string, scale: ResultScale = 'mean'): string {
  if (scale === 'percent') {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(
      Math.round(value * PERCENT_PER_POINT * 10) / 10,
    )
  }
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

/** "4,00 a 5,00" / "menos de 3,00" — the range a legend prints beside the name. */
export function bandRangeText(key: ResultBandKey, bands: ResultBands, t: TranslateFn, locale: string): string {
  const { min, max } = bandRange(key, bands)
  const text = (value: number) => boundaryText(value, locale, bands.scale)
  if (key === 'critical') return t('resultBands.range.under', { value: text(bands.opportunityMin) })
  return t('resultBands.range.between', { min: text(min), max: text(max) })
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
