/** Shared shapes for the chart components. */

/** One row of a categorical chart: a label plus one value per series key. */
export interface ChartDatum {
  /** The category label shown on the axis. */
  label: string
  /** Value per series key. A missing key renders as a gap, not as zero. */
  values: Record<string, number | null>
}

/**
 * A named series.
 *
 * `key` is the stable identity the colour is assigned from — see
 * `palette.seriesColorFor`. It must not change when the visible set is filtered,
 * or the survivors get repainted.
 */
export interface ChartSeries {
  key: string
  /** Already-translated display name. Charts never translate their own series names. */
  name: string
}

/** Sizing shared by every chart. */
export interface ChartSizeProps {
  /**
   * Explicit pixel width. Omit in the app so the chart fills its container.
   *
   * **Tests must pass this.** `ResponsiveContainer` measures its parent with
   * `getBoundingClientRect`, which returns 0 under happy-dom, so a responsive
   * chart renders an empty `<div>` with no `<svg>` at all — verified rather than
   * assumed. See `ChartCanvas`.
   */
  width?: number
  /** Height in pixels. Charts have no intrinsic height to fall back on. */
  height?: number
}

/** State every chart handles, because analytics pages render before data arrives. */
export interface ChartStateProps {
  isLoading?: boolean
  /** Accessible title. Also used for the chart's `aria-label`. */
  title?: string
}
