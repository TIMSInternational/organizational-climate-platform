import { isBelowTarget } from './derive'

/**
 * A 150×60 small multiple, as the Dashboard artboard draws it (10 Sep): one dimension's
 * mean across the closed waves in a 2px line, a dashed target rule, a hairline baseline,
 * 5px markers and a ringed endpoint that turns red when the latest reading sits below
 * the target — and the wave codes in a row UNDER the figure, spread to the card's edges.
 *
 * Why not `LineChart`: its API is a full chart — `data` + `series`, axes, 8px
 * markers with rings, a legend — and it has no reference line. Six of those in a
 * 3×2 grid at 150×60 is six charts, not six sparklines. This draws exactly the
 * marks the design has and nothing else.
 *
 * `domain` is the value range the page chose for ALL six, so their slopes are on one
 * scale; left out, the sparkline fits itself.
 *
 * Colour: the three hexes are the SVG marks only (line, below-target endpoint,
 * target rule), as the design fixes them for both themes. The baseline, the endpoint's
 * ring and the labels are theme tokens, so they follow the theme.
 */
export interface TrendSparklineProps {
  values: readonly number[]
  target: number
  /** One per value, drawn under the figure. */
  labels: readonly string[]
  /** Already-translated accessible description of the whole figure. */
  label: string
  /** The value range shared by every sparkline on the page; fitted to this one when omitted. */
  domain?: readonly [number, number]
  width?: number
  height?: number
}

const LINE = '#6a6ece'
const BELOW_TARGET = '#dd0c15'
const TARGET = '#b9b6cc'
const PAD_X = 12
const PAD_TOP = 6
/** From the bottom: the hairline the canvas draws under the line. */
const BASELINE_GAP = 12
const HALF_BAND = 0.25

export default function TrendSparkline({
  values,
  target,
  labels,
  label,
  domain,
  width = 150,
  height = 60,
}: TrendSparklineProps) {
  const low = domain ? domain[0] : Math.min(...values, target) - HALF_BAND
  const high = domain ? domain[1] : Math.max(...values, target) + HALF_BAND
  const baseline = height - BASELINE_GAP
  const plotHeight = baseline - 4 - PAD_TOP
  const step = values.length > 1 ? (width - PAD_X * 2) / (values.length - 1) : 0
  const x = (index: number) => (values.length > 1 ? PAD_X + index * step : width / 2)
  const y = (value: number) => PAD_TOP + ((high - value) / (high - low)) * plotHeight

  const points = values.map((value, index) => ({ x: x(index), y: y(value) }))
  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ')
  const last = points[points.length - 1]
  const lastValue = values[values.length - 1]
  const below = lastValue !== undefined && isBelowTarget(lastValue, target)

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        data-slot="trend-sparkline"
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        className="block h-15 w-full max-w-full"
      >
        <line
          data-slot="trend-target"
          x1={6}
          x2={width - 6}
          y1={y(target)}
          y2={y(target)}
          stroke={TARGET}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <line x1={6} x2={width - 6} y1={baseline} y2={baseline} className="stroke-line-light" strokeWidth={1} />
        <path
          data-slot="trend-line"
          d={path}
          fill="none"
          stroke={LINE}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.slice(0, -1).map((point, index) => (
          <circle key={index} cx={point.x} cy={point.y} r={2.5} fill={LINE} />
        ))}
        {last && (
          <circle
            data-slot="trend-end"
            data-below-target={below ? 'true' : 'false'}
            cx={last.x}
            cy={last.y}
            r={4}
            fill={below ? BELOW_TARGET : LINE}
            className="stroke-surface-card"
            strokeWidth={2}
          />
        )}
      </svg>
      <div data-slot="trend-labels" aria-hidden="true" className="flex justify-between font-mono text-2xs leading-normal text-fg-label">
        {labels.map((text, index) => (
          <span key={`${index}-${text}`}>{text}</span>
        ))}
      </div>
    </div>
  )
}
