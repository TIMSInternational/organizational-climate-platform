import { axisTicks, standing } from './derive'

/**
 * One dimension across the closed waves, against the target — the canvas's chart
 * (ClimateTrends artboard, 10 Sep): a 330×150 figure with a recessive 0.5-step grid, a
 * dashed target rule labelled "meta 3,7", a 2px line with ringed 8px markers and the
 * value over each, the latest marker a step larger, and the wave under each point.
 *
 * ## One axis for the page
 *
 * `ticks` is the axis the page computed for ALL six charts (`sharedAxisTicks`), so two
 * slopes side by side are on the same scale. Left out, the chart derives its own from
 * its values, which is what a chart drawn alone wants.
 *
 * ## A withheld wave breaks the line
 *
 * A `null` value with `withheld[index]` set is a wave the floor withheld. The line is
 * drawn as one segment per run of disclosed readings and never across a gap: a stroke
 * from the wave before to the wave after would let a reader interpolate the number the
 * floor exists to protect. The gap is marked at the baseline with a hollow marker and the
 * word "protegido", so it reads as a decision rather than as a missing point. A `null`
 * that is NOT withheld is a wave that did not ask this dimension: the line breaks there
 * too, and nothing claims a protection that was not applied.
 *
 * Colour: the three hexes are the SVG marks only (line, below-target endpoint, target
 * rule), as `TrendSparkline` fixes them for both themes; the grid, the marker rings and
 * every label are theme tokens, so the figure follows the theme.
 */
export interface DimensionTrendChartProps {
  values: readonly (number | null)[]
  /** Per value: `true` when the floor withheld that wave. Omitted means none was. */
  withheld?: readonly boolean[]
  target: number
  /** The y axis, shared by every chart on the page; derived from `values` when omitted. */
  ticks?: readonly number[]
  /** One per value, drawn under the points. */
  labels: readonly string[]
  /** Already-translated accessible description of the whole figure. */
  label: string
  /** Already-translated word drawn where a wave is withheld. */
  withheldText: string
  /** Already-translated label of the target rule, e.g. "meta 3,7". */
  targetText: string
  /** How a reading prints: one decimal in the reader's locale. */
  format: (value: number) => string
  width?: number
  height?: number
}

const LINE = '#6a6ece'
const BELOW_TARGET = '#dd0c15'
const TARGET = '#b9b6cc'
/** Where the plot starts; the tick labels end 6px before it. */
const AXIS_LEFT = 30
const AXIS_RIGHT = 24
/** The first and last points sit this far inside the plot, as the canvas draws them. */
const INSET = 22
const PLOT_TOP = 16
/** From the bottom edge: the x labels live in this band. */
const LABEL_BAND = 26

interface Box {
  x1: number
  x2: number
  y1: number
  y2: number
}

function overlaps(a: Box, b: Box): boolean {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2
}

export default function DimensionTrendChart({
  values,
  withheld,
  target,
  ticks: sharedTicks,
  labels,
  label,
  withheldText,
  targetText,
  format,
  width = 330,
  height = 150,
}: DimensionTrendChartProps) {
  const ticks = sharedTicks && sharedTicks.length > 1 ? sharedTicks : axisTicks(values, target)
  const low = ticks[0] ?? target - 0.5
  const high = ticks[ticks.length - 1] ?? target + 0.5
  const plotBottom = height - LABEL_BAND
  const firstX = AXIS_LEFT + INSET
  const lastX = width - AXIS_RIGHT - INSET
  const step = values.length > 1 ? (lastX - firstX) / (values.length - 1) : 0
  const x = (index: number) => (values.length > 1 ? firstX + index * step : (firstX + lastX) / 2)
  const y = (value: number) => PLOT_TOP + ((high - value) / (high - low)) * (plotBottom - PLOT_TOP)

  // Runs of consecutive disclosed readings, each its own path — never one across a gap.
  const segments: { x: number; y: number }[][] = []
  values.forEach((value, index) => {
    if (value === null) {
      segments.push([])
      return
    }
    const current = segments[segments.length - 1]
    if (current === undefined) segments.push([{ x: x(index), y: y(value) }])
    else current.push({ x: x(index), y: y(value) })
  })
  const paths = segments
    .filter((points) => points.length > 1)
    .map((points) => points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '))

  let lastIndex = -1
  values.forEach((value, index) => {
    if (value !== null) lastIndex = index
  })

  // The target's label goes where it collides with no point and no value printed over
  // one: left above the rule, then left below, then the same two on the right.
  const taken: Box[] = values.flatMap((value, index) =>
    value === null ? [] : [{ x1: x(index) - 16, x2: x(index) + 16, y1: y(value) - 21, y2: y(value) + 6 }],
  )
  const ruleY = y(target)
  const labelWidth = targetText.length * 5.2
  const candidates = [
    { x: AXIS_LEFT + 2, y: ruleY - 4, anchor: 'start' as const, box: { x1: AXIS_LEFT, x2: AXIS_LEFT + 2 + labelWidth, y1: ruleY - 13, y2: ruleY - 2 } },
    { x: AXIS_LEFT + 2, y: ruleY + 12, anchor: 'start' as const, box: { x1: AXIS_LEFT, x2: AXIS_LEFT + 2 + labelWidth, y1: ruleY + 2, y2: ruleY + 14 } },
    { x: width - AXIS_RIGHT, y: ruleY - 4, anchor: 'end' as const, box: { x1: width - AXIS_RIGHT - labelWidth, x2: width - AXIS_RIGHT, y1: ruleY - 13, y2: ruleY - 2 } },
    { x: width - AXIS_RIGHT, y: ruleY + 12, anchor: 'end' as const, box: { x1: width - AXIS_RIGHT - labelWidth, x2: width - AXIS_RIGHT, y1: ruleY + 2, y2: ruleY + 14 } },
  ]
  const targetLabel = candidates.find((candidate) => !taken.some((box) => overlaps(box, candidate.box))) ?? candidates[0]

  const anchorAt = (index: number): 'start' | 'middle' | 'end' =>
    values.length > 1 && index === 0 ? 'start' : values.length > 1 && index === values.length - 1 ? 'end' : 'middle'

  return (
    <svg
      data-slot="dimension-trend-chart"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      className="block h-auto w-full max-w-full text-fg-label"
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={AXIS_LEFT}
            x2={width - AXIS_RIGHT}
            y1={y(tick)}
            y2={y(tick)}
            className="stroke-line-light"
            strokeWidth={1}
          />
          <text
            data-slot="trend-tick"
            x={AXIS_LEFT - 6}
            y={y(tick) + 3.5}
            textAnchor="end"
            fill="currentColor"
            fontSize={10}
            className="font-mono"
          >
            {format(tick)}
          </text>
        </g>
      ))}
      <line
        data-slot="trend-target"
        x1={AXIS_LEFT}
        x2={width - AXIS_RIGHT}
        y1={ruleY}
        y2={ruleY}
        stroke={TARGET}
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      <text
        data-slot="trend-target-label"
        x={targetLabel.x}
        y={targetLabel.y}
        textAnchor={targetLabel.anchor}
        fill="currentColor"
        fontSize={10}
      >
        {targetText}
      </text>
      {paths.map((d, index) => (
        <path
          key={index}
          data-slot="trend-segment"
          d={d}
          fill="none"
          stroke={LINE}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {values.map((value, index) => {
        if (value === null) {
          if (!withheld?.[index]) return null
          return (
            <g key={index} data-slot="trend-withheld">
              <circle
                cx={x(index)}
                cy={plotBottom}
                r={4}
                className="fill-surface-card"
                stroke={TARGET}
                strokeDasharray="2 2"
              />
              <text
                x={anchorAt(index) === 'start' ? x(index) - 4 : anchorAt(index) === 'end' ? x(index) + 4 : x(index)}
                y={plotBottom - 9}
                textAnchor={anchorAt(index)}
                fill="currentColor"
                fontSize={10}
              >
                {withheldText}
              </text>
            </g>
          )
        }
        const isLast = index === lastIndex
        const below = isLast && standing(value, target) === 'below'
        return (
          <g key={index}>
            <circle
              data-slot={isLast ? 'trend-end' : 'trend-point'}
              data-below-target={isLast ? (below ? 'true' : 'false') : undefined}
              cx={x(index)}
              cy={y(value)}
              r={isLast ? 5 : 4}
              fill={below ? BELOW_TARGET : LINE}
              className="stroke-surface-card"
              strokeWidth={2}
            />
            <text
              x={x(index)}
              y={y(value) - 10}
              textAnchor="middle"
              fontSize={11}
              className="fill-fg-primary font-mono"
            >
              {format(value)}
            </text>
          </g>
        )
      })}
      {labels.map((text, index) => (
        <text
          key={`${index}-${text}`}
          x={x(index)}
          y={height - 8}
          textAnchor="middle"
          fill="currentColor"
          fontSize={10}
          className="font-mono"
        >
          {text}
        </text>
      ))}
    </svg>
  )
}
