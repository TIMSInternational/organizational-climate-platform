import { Cell, Legend, Pie, PieChart as RechartsPieChart, Tooltip } from 'recharts'
import { useTranslation } from '../../i18n'
import ChartCanvas from './ChartCanvas'
import ChartFrame from './ChartFrame'
import { foldExtraSlices, type PieSlice } from './foldSlices'
import { CHART_SURFACE_GAP, seriesColor } from './palette'
import type { ChartSizeProps, ChartStateProps } from './types'

interface PieChartProps extends ChartSizeProps, ChartStateProps {
  data: readonly PieSlice[]
  /** Render as a donut. A donut leaves room for a centre label and is easier to read. */
  donut?: boolean
}

/**
 * Part-to-whole for a small number of categories.
 *
 * Replaces legacy `AnimatedPieChart` (framer-motion, not ported).
 *
 * Extra slices fold into "Other" rather than cycling the palette — see
 * `foldSlices.ts` for why, and for what the legacy component did instead.
 *
 * A pie is frequently the wrong form. Beyond about six slices, or when the job is
 * comparing magnitudes rather than showing composition, a bar chart reads better:
 * angle is harder to judge than length. The palette ceiling is therefore also a ceiling on
 * what this form should be asked to show.
 */
export default function PieChart({
  data,
  donut = false,
  width,
  height = 280,
  title,
  isLoading,
}: PieChartProps) {
  const { t } = useTranslation()

  // Negative values have no meaning in a part-to-whole chart — there is no such
  // thing as a negative share of a total — so they are dropped rather than rendered
  // as a wedge of nonsensical angle. Zero has no wedge either.
  const usable = data.filter((slice) => Number.isFinite(slice.value) && slice.value > 0)
  const isEmpty = usable.length === 0

  const slices = foldExtraSlices(usable, (count) =>
    t('charts.otherSlices', { count: String(count) }),
  )
  const sliceKeys = slices.map((slice) => slice.key)

  const rows = slices.map((slice) => ({ name: slice.name, value: slice.value }))

  return (
    <ChartFrame
      title={title}
      isLoading={isLoading}
      isEmpty={isEmpty}
      height={height}
      series={slices.map((slice) => ({ key: slice.key, name: slice.name }))}
      data={slices.map((slice) => ({
        label: slice.name,
        values: { [slice.key]: slice.value },
      }))}
    >
      <ChartCanvas width={width} height={height}>
        <RechartsPieChart width={width} height={height}>
          <Tooltip />
          {/* Always legended: a wedge carries no label of its own, so colour would
              otherwise be the only identity — the one thing that must never be true. */}
          <Legend />
          <Pie
            data={rows}
            dataKey="value"
            nameKey="name"
            innerRadius={donut ? '55%' : 0}
            outerRadius="80%"
            // The 2px surface-coloured ring separates adjacent wedges. Without it two
            // similar hues read as one wedge.
            stroke={CHART_SURFACE_GAP}
            strokeWidth={2}
          >
            {slices.map((slice) => (
              <Cell key={slice.key} fill={seriesColor(sliceKeys.indexOf(slice.key))} />
            ))}
          </Pie>
        </RechartsPieChart>
      </ChartCanvas>
    </ChartFrame>
  )
}
