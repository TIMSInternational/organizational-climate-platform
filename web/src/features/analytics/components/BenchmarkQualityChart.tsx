import type { BenchmarkListItem } from '../api/benchmarks'
import { averageQualityByCategory, QUALITY_SERIES_KEY } from './benchmarkQuality'
import { BarChart, type ChartSeries } from '../../../components/charts'
import { useTranslation } from '../../../i18n'

interface BenchmarkQualityChartProps {
  benchmarks: readonly BenchmarkListItem[]
  isLoading?: boolean
}

/**
 * Quality by category, from the #79 shared chart library rather than inlined — the
 * palette, the empty state, the loading state and the "show as table" fallback all come
 * with it, and none of them are per-page decisions.
 *
 * A bar chart specifically: the y-axis is zero-anchored (see `BarChart`'s `YAxis` note),
 * which is what a score compared across categories needs.
 */
export default function BenchmarkQualityChart({
  benchmarks,
  isLoading,
}: BenchmarkQualityChartProps) {
  const { t } = useTranslation()
  const series: ChartSeries[] = [
    { key: QUALITY_SERIES_KEY, name: t('analytics.averageQualityScore') },
  ]

  return (
    <BarChart
      title={t('analytics.qualityByCategory')}
      data={averageQualityByCategory(benchmarks)}
      series={series}
      isLoading={isLoading}
    />
  )
}
