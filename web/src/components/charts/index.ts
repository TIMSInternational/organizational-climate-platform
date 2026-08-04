/**
 * Public surface of the chart library (#79).
 *
 * Import from here rather than from individual files, so the set of charts a page
 * can reach is visible in one place.
 */

export { default as BarChart } from './BarChart'
export { default as LineChart } from './LineChart'
export { default as PieChart } from './PieChart'
export { default as HeatMap } from './HeatMap'
export { default as Counter } from './Counter'
export { default as WordCloud } from './WordCloud'
export { default as KPIDisplay } from './KPIDisplay'
export { default as ParticipationTracker } from './ParticipationTracker'
export { default as RealTimeChartContainer } from './RealTimeChartContainer'
export { default as SentimentVisualization } from './SentimentVisualization'
export { default as RecommendationCard } from './RecommendationCard'
export { default as ChartFrame } from './ChartFrame'
export { default as ChartCanvas } from './ChartCanvas'

export type { ChartDatum, ChartSeries, ChartSizeProps, ChartStateProps } from './types'
export type { PieSlice } from './foldSlices'
export { foldExtraSlices, OTHER_SLICE_KEY } from './foldSlices'
export type { HeatMapCell } from './HeatMap'
export type { WordFrequency } from './WordCloud'
export type { Kpi } from './KPIDisplay'
export type {
  EffortImpact,
  RecommendationKind,
  RecommendationPriority,
  RecommendedAction,
} from './RecommendationCard'

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

export { changeDirection, deltaFraction, formatMetric, type MetricFormat } from './formatMetric'

export {
  OTHER_CATEGORY_KEY,
  WORD_SIZE_CLASSES,
  categoryColorKeyList,
  categoryColorKeys,
  wordSizeClass,
} from './wordScale'

export {
  bandStatus,
  formatMinutes,
  participationBand,
  participationRate,
  type ParticipationBand,
} from './participation'

export {
  sentimentBreakdown,
  type SentimentBreakdown,
  type SentimentCounts,
  type SentimentShare,
} from './sentiment'

export {
  MAX_POLL_MS,
  MIN_POLL_MS,
  usePolling,
  type PollingOptions,
  type PollingState,
} from './usePolling'

// Deliberately NOT re-exported: `sentimentStub`. It is placeholder data pending
// #67, and a barrel export is exactly how a stub ends up imported by a real page
// without anyone noticing. Import it by path, from the gallery or from a test.
