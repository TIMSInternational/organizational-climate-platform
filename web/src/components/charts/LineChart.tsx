import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as RechartsLineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import ChartCanvas from './ChartCanvas'
import ChartFrame from './ChartFrame'
import { CHART_AXIS, CHART_GRID, CHART_SURFACE_GAP, seriesColorFor } from './palette'
import type { ChartDatum, ChartSeries, ChartSizeProps, ChartStateProps } from './types'

interface LineChartProps extends ChartSizeProps, ChartStateProps {
  data: readonly ChartDatum[]
  series: readonly ChartSeries[]
}

/**
 * Line chart — change over time, which is the only job this form does better than
 * a bar chart. For comparing unordered categories use `BarChart`.
 *
 * Replaces legacy `AnimatedLineChart`, without framer-motion (see `BarChart`).
 *
 * Mark specs applied: 2px strokes, 8px markers with a 2px surface ring so
 * overlapping points stay countable, and `connectNulls={false}` so a gap in the
 * data reads as a gap. Connecting across a null invents a trend that the data does
 * not contain, which matters here because a survey period with no responses is
 * common and meaningful.
 *
 * **One y-axis, always.** Two measures of different scale are two charts, small
 * multiples, or indexed to a common base — never a second axis. A dual axis lets
 * the author place the crossing point anywhere, so the reader cannot tell a real
 * relationship from a chosen one.
 */
export default function LineChart({
  data,
  series,
  width,
  height = 280,
  title,
  isLoading,
}: LineChartProps) {
  const seriesKeys = series.map((s) => s.key)

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
        <RechartsLineChart width={width} height={height} data={rows}>
          <CartesianGrid stroke={CHART_GRID} vertical={false} />
          <XAxis dataKey="label" stroke={CHART_AXIS} tickLine={false} />
          <YAxis stroke={CHART_AXIS} tickLine={false} />
          <Tooltip />
          {series.length > 1 ? <Legend /> : null}
          {series.map((s) => {
            const colour = seriesColorFor(s.key, seriesKeys)
            return (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={colour}
                strokeWidth={2}
                // A gap stays a gap. See the note above on invented trends.
                connectNulls={false}
                dot={{ r: 4, fill: colour, stroke: CHART_SURFACE_GAP, strokeWidth: 2 }}
                activeDot={{ r: 6, fill: colour, stroke: CHART_SURFACE_GAP, strokeWidth: 2 }}
              />
            )
          })}
        </RechartsLineChart>
      </ChartCanvas>
    </ChartFrame>
  )
}
