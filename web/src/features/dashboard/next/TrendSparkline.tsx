import { isBelowTarget } from './derive'

/**
 * A 150×60 small multiple: one dimension's mean across the closed waves, a dashed
 * target line, and an emphasised endpoint that turns red when the latest reading
 * sits below the target.
 *
 * Why not `LineChart`: its API is a full chart — `data` + `series`, axes, 8px
 * markers with rings, a legend — and it has no reference line. Six of those in a
 * 3×2 grid at 150×60 is six charts, not six sparklines. This draws exactly the
 * marks the design has and nothing else.
 *
 * Colour: the three hexes are the SVG marks only (line, below-target endpoint,
 * target rule), as the design fixes them for both themes. All text is set in
 * theme tokens through `currentColor`, so the labels follow the theme.
 */
export interface TrendSparklineProps {
  values: readonly number[]
  target: number
  /** One per value, drawn under the points. */
  labels: readonly string[]
  /** Already-translated accessible description of the whole figure. */
  label: string
  width?: number
  height?: number
}

const LINE = '#6a6ece'
const BELOW_TARGET = '#dd0c15'
const TARGET = '#b9b6cc'
const PAD_X = 6
const PAD_TOP = 6
const PAD_BOTTOM = 16
const HALF_BAND = 0.25

export default function TrendSparkline({
  values,
  target,
  labels,
  label,
  width = 150,
  height = 60,
}: TrendSparklineProps) {
  const low = Math.min(...values, target) - HALF_BAND
  const high = Math.max(...values, target) + HALF_BAND
  const plotHeight = height - PAD_TOP - PAD_BOTTOM
  const plotWidth = width - PAD_X * 2
  const step = values.length > 1 ? plotWidth / (values.length - 1) : 0
  const x = (index: number) => PAD_X + index * step
  const y = (value: number) => PAD_TOP + ((high - value) / (high - low)) * plotHeight

  const points = values.map((value, index) => ({ x: x(index), y: y(value) }))
  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ')
  const last = points[points.length - 1]
  const lastValue = values[values.length - 1]
  const below = lastValue !== undefined && isBelowTarget(lastValue, target)

  return (
    <svg
      data-slot="trend-sparkline"
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block max-w-full text-fg-label"
    >
      <line
        data-slot="trend-target"
        x1={PAD_X}
        x2={width - PAD_X}
        y1={y(target)}
        y2={y(target)}
        stroke={TARGET}
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <path data-slot="trend-line" d={path} fill="none" stroke={LINE} strokeWidth={1.5} />
      {points.slice(0, -1).map((point, index) => (
        <circle key={index} cx={point.x} cy={point.y} r={2} fill={LINE} />
      ))}
      {last && (
        <circle
          data-slot="trend-end"
          data-below-target={below ? 'true' : 'false'}
          cx={last.x}
          cy={last.y}
          r={3.5}
          fill={below ? BELOW_TARGET : LINE}
        />
      )}
      {labels.map((text, index) => (
        <text
          key={text}
          x={x(index)}
          y={height - 3}
          textAnchor={index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle'}
          fill="currentColor"
          fontSize={9}
        >
          {text}
        </text>
      ))}
    </svg>
  )
}
