import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import ChartCanvas from './ChartCanvas'
import ChartFrame from './ChartFrame'
import { CHART_AXIS, CHART_GRID, CHART_SURFACE_GAP, seriesColorFor } from './palette'
import type { ChartDatum, ChartSeries, ChartSizeProps, ChartStateProps } from './types'

interface BarChartProps extends ChartSizeProps, ChartStateProps {
  data: readonly ChartDatum[]
  series: readonly ChartSeries[]
  /** Render series side by side (default) or stacked into one bar. */
  stacked?: boolean
}

/**
 * Grouped or stacked bar chart — the default form for comparing magnitude across
 * categories.
 *
 * Replaces legacy `AnimatedBarChart`. The name drops "Animated": that component's
 * animation was framer-motion, which this project does not port (~1700 legacy
 * lines dropped for #75-#77). recharts' own `isAnimationActive` covers the useful
 * part — bars growing from the baseline on first paint — with no dependency.
 *
 * Mark specs applied: 4px rounded top corners anchored to the baseline (so the
 * bar reads as growing *from* the axis, not floating), a 2px surface-coloured gap
 * between adjacent and stacked fills, and recessive grid/axis colours that do not
 * compete with the data.
 */
export default function BarChart({
  data,
  series,
  stacked = false,
  width,
  height = 280,
  title,
  isLoading,
}: BarChartProps) {
  const seriesKeys = series.map((s) => s.key)

  // Empty means "nothing to plot", which is not the same as "no rows": a row
  // whose every series value is null plots nothing.
  const isEmpty =
    data.length === 0 ||
    series.length === 0 ||
    data.every((datum) => seriesKeys.every((key) => datum.values[key] == null))

  const rows = data.map((datum) => ({ label: datum.label, ...datum.values }))

  return (
    <ChartFrame
      title={title}
      isLoading={isLoading}
      isEmpty={isEmpty}
      height={height}
      series={series}
      data={data}
    >
      <ChartCanvas width={width} height={height}>
        <RechartsBarChart width={width} height={height} data={rows} barGap={2} barCategoryGap="20%">
          <CartesianGrid stroke={CHART_GRID} vertical={false} />
          <XAxis dataKey="label" stroke={CHART_AXIS} tickLine={false} />
          {/* NO `domain` HERE, DELIBERATELY -- recharts' default is zero-anchored
              and that is required for bars. A bar encodes value as length measured
              from the axis, so moving the axis off zero makes a bar twice as long
              stop meaning twice as much.

              `LineChart` *does* fit its domain to the data, for the opposite reason:
              a line encodes position, so it reads slope rather than length. Do not
              make these two consistent with each other -- the difference is the
              point. The long version is at LineChart.tsx's YAxis. */}
          <YAxis stroke={CHART_AXIS} tickLine={false} />
          <Tooltip />
          {/* A legend is always present for two or more series -- identity must
              never rest on colour alone. One series needs none: the title names it. */}
          {series.length > 1 ? <Legend /> : null}
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId={stacked ? 'stack' : undefined}
              fill={seriesColorFor(s.key, seriesKeys)}
              // 4px on the top corners only. Rounding the baseline end would
              // detach the bar from the axis it is measured against.
              radius={[4, 4, 0, 0]}
              // The 2px spacer between stacked segments, in the surface colour so
              // it reads as a gap rather than as a thin extra series.
              stroke={stacked ? CHART_SURFACE_GAP : undefined}
              strokeWidth={stacked ? 2 : undefined}
            />
          ))}
        </RechartsBarChart>
      </ChartCanvas>
    </ChartFrame>
  )
}
