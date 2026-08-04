/**
 * The data-visualisation palette, as CSS custom-property references.
 *
 * Charts read colours from here, never as literals. Every value is a
 * `var(--admin-chart-*)` reference, so a chart re-colours itself when the theme
 * attribute flips without any JS listening for the change — the same reason the
 * token layer is CSS rather than runtime-injected (see `styles/tokens.css`).
 *
 * ## Why charts do not use the accent palette (#79)
 *
 * The `--admin-accent-*` colours are a UI palette, not a series palette, and
 * this was measured rather than argued. Feeding the six accents to the dataviz
 * validator as a categorical palette FAILS three checks:
 *
 * - `--admin-accent-blue` `#2e9098` has chroma 0.089, below the 0.1 floor — as a
 *   fill it reads gray.
 * - orange `#ea580c` against amber `#d97706` is ΔE 1.6 for deuteranopia and
 *   **6.7 for normal vision** — indistinguishable even with full colour vision.
 *
 * Four of the six are also status colours. Status is reserved: green/amber/red
 * mean good/warning/critical, and a palette where "critical" also means
 * "series 3" makes every dashboard ambiguous.
 *
 * ## Rules that are not negotiable
 *
 * - **Fixed order, never cycled.** `seriesColor(i)` deliberately does not wrap.
 *   A 7th series is not a generated hue — it folds into "Other", becomes small
 *   multiples, or the chart is the wrong form for the data.
 * - **Colour follows the entity, not its rank.** Assign by a stable key, so a
 *   filter that removes series 2 does not repaint 3 as 2. `seriesColorFor` is
 *   the helper for that; prefer it over indexing by array position.
 * - **Never a dual-axis chart.** Two measures of different scale are two
 *   charts, or indexed to a common base.
 * - **Text wears text tokens, never the series colour.** Values, labels and
 *   legend text stay in `--admin-font-*`; the coloured swatch beside them
 *   carries identity.
 */

/** Categorical series colours, in assignment order. Do not reorder. */
export const SERIES_COLORS = [
  'var(--admin-chart-series-1)',
  'var(--admin-chart-series-2)',
  'var(--admin-chart-series-3)',
  'var(--admin-chart-series-4)',
  'var(--admin-chart-series-5)',
  'var(--admin-chart-series-6)',
] as const

export const MAX_SERIES = SERIES_COLORS.length

/** Sequential ramp for magnitude — one hue, ordered light→dark in light mode. */
export const SEQUENTIAL_COLORS = [
  'var(--admin-chart-seq-1)',
  'var(--admin-chart-seq-2)',
  'var(--admin-chart-seq-3)',
  'var(--admin-chart-seq-4)',
  'var(--admin-chart-seq-5)',
  'var(--admin-chart-seq-6)',
  'var(--admin-chart-seq-7)',
] as const

/**
 * Diverging scale — two hues around a **neutral gray** midpoint. The midpoint is
 * deliberately not a hue: a coloured middle reads as a third category rather
 * than as "neither".
 */
export const DIVERGING_COLORS = [
  'var(--admin-chart-div-neg-2)',
  'var(--admin-chart-div-neg-1)',
  'var(--admin-chart-div-mid)',
  'var(--admin-chart-div-pos-1)',
  'var(--admin-chart-div-pos-2)',
] as const

export const CHART_GRID = 'var(--admin-chart-grid)'
export const CHART_AXIS = 'var(--admin-chart-axis)'
/** The surface colour, used as the 2px spacer between adjacent or stacked fills. */
export const CHART_SURFACE_GAP = 'var(--admin-chart-surface-gap)'

/**
 * Colour for the i-th series.
 *
 * Throws past {@link MAX_SERIES} rather than wrapping. Wrapping would silently
 * give two series the same colour, which is worse than a loud failure: the chart
 * still renders and the reader cannot tell the duplicate pair apart. A caller
 * with more than six series needs a different form, not a recycled hue.
 */
export function seriesColor(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_SERIES) {
    throw new RangeError(
      `series index ${index} is out of range (0-${MAX_SERIES - 1}). ` +
        'The palette is not cycled: fold extra series into "Other", or use small multiples.',
    )
  }
  return SERIES_COLORS[index]
}

/**
 * Stable colour for a named entity.
 *
 * Assigns by position in `keys`, which the caller holds fixed across renders, so
 * filtering the *data* does not repaint the survivors. Pass the full key list,
 * not the currently-visible subset — that is the whole point.
 */
export function seriesColorFor(key: string, keys: readonly string[]): string {
  const index = keys.indexOf(key)
  if (index < 0) {
    throw new RangeError(`"${key}" is not in the series key list, so it has no stable colour.`)
  }
  return seriesColor(index)
}

/**
 * Bucket a 0..1 magnitude onto the sequential ramp.
 *
 * Clamps rather than throwing: magnitudes are usually computed from data and a
 * rounding error at the edge should not blank a heatmap cell.
 */
export function sequentialColor(fraction: number): string {
  if (Number.isNaN(fraction)) {
    return SEQUENTIAL_COLORS[0]
  }
  const clamped = Math.min(1, Math.max(0, fraction))
  const index = Math.min(
    SEQUENTIAL_COLORS.length - 1,
    Math.floor(clamped * SEQUENTIAL_COLORS.length),
  )
  return SEQUENTIAL_COLORS[index]
}

/**
 * Colour for a -1..1 polarity, e.g. sentiment.
 *
 * The dead band around zero maps to the neutral midpoint so "roughly neutral"
 * does not read as weakly positive or negative.
 */
export function divergingColor(value: number, deadBand = 0.1): string {
  if (Number.isNaN(value)) {
    return DIVERGING_COLORS[2]
  }
  if (value <= -0.5) return DIVERGING_COLORS[0]
  if (value < -deadBand) return DIVERGING_COLORS[1]
  if (value <= deadBand) return DIVERGING_COLORS[2]
  if (value < 0.5) return DIVERGING_COLORS[3]
  return DIVERGING_COLORS[4]
}
