/**
 * Public surface of the chart library (#79).
 *
 * Import from here rather than from individual files, so the set of charts a page
 * can reach is visible in one place.
 */

export { default as BarChart } from './BarChart'
export { default as LineChart } from './LineChart'
export { default as Counter } from './Counter'
export { default as ChartFrame } from './ChartFrame'
export { default as ChartCanvas } from './ChartCanvas'

export type { ChartDatum, ChartSeries, ChartSizeProps, ChartStateProps } from './types'

export {
  CHART_AXIS,
  CHART_GRID,
  CHART_SURFACE_GAP,
  DIVERGING_COLORS,
  MAX_SERIES,
  SEQUENTIAL_COLORS,
  SERIES_COLORS,
  divergingColor,
  sequentialColor,
  seriesColor,
  seriesColorFor,
} from './palette'
