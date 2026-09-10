import { axisTicks, standing } from './derive'

/**
 * One dimension across the closed waves, against the target — `TrendSparkline` from the
 * dashboard scaled up to a chart: a 0.5-step axis with gridlines, a dashed target rule
 * with its own label, a value printed at every point, and the wave under each point.
 *
 * ## A withheld wave breaks the line
 *
 * A `null` value is a wave the floor withheld (or one that never asked this dimension).
 * The line is drawn as one segment per run of disclosed readings and never across a
 * gap: a stroke from the wave before to the wave after would let a reader interpolate
 * the number the floor exists to protect. The gap is marked at the baseline with a
 * hollow marker and the word "withheld", so it reads as a decision rather than as a
 * missing point.
 *
 * Colour: the three hexes are the SVG marks only, as `TrendSparkline` fixes them for
 * both themes; every label is `currentColor`, so text follows the theme.
 */
export interface DimensionTrendChartProps {
  values: readonly (number | null)[]
  target: number
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
const GRID = 'currentColor'
const PAD_LEFT = 34
const PAD_RIGHT = 14
const PAD_TOP = 14
const PAD_BOTTOM = 22

export default function DimensionTrendChart({
  values,
  target,
  labels,
  label,
  withheldText,
  targetText,
  format,
  width = 330,
  height = 150,
}: DimensionTrendChartProps) {
  const ticks = axisTicks(values, target)
  const low = ticks[0] ?? target - 0.5
  const high = ticks[ticks.length - 1] ?? target + 0.5
  const plotHeight = height - PAD_TOP - PAD_BOTTOM
  const plotWidth = width - PAD_LEFT - PAD_RIGHT
  const step = values.length > 1 ? plotWidth / (values.length - 1) : 0
  const x = (index: number) => PAD_LEFT + index * step
  const y = (value: number) => PAD_TOP + ((high - value) / (high - low)) * plotHeight
  const baseline = PAD_TOP + plotHeight

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
    .map((points) =>
      points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
    )

  let lastIndex = -1
  values.forEach((value, index) => {
    if (value !== null) lastIndex = index
  })

  // The target's own label sits on the side whose endpoint is farther from the rule,
  // below the rule unless that endpoint is just under it — the two labels would
  // otherwise print on top of each other whenever a reading is near the target.
  const firstValue = values.find((value): value is number => value !== null) ?? target
  const lastValue = lastIndex === -1 ? target : (values[lastIndex] ?? target)
  const gapLeft = Math.abs(y(firstValue) - y(target))
  const gapRight = Math.abs(y(lastValue) - y(target))
  const onLeft = gapLeft >= gapRight
  const sideValue = onLeft ? firstValue : lastValue
  const sideGap = onLeft ? gapLeft : gapRight
  const crowdedBelow = sideValue < target && sideGap < 26
  const targetLabel = {
    x: onLeft ? PAD_LEFT + 2 : width - PAD_RIGHT,
    y: crowdedBelow ? y(target) - 4 : y(target) + 11,
    anchor: (onLeft ? 'start' : 'end') as 'start' | 'end',
  }

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
            x1={PAD_LEFT}
            x2={width - PAD_RIGHT}
            y1={y(tick)}
            y2={y(tick)}
            stroke={GRID}
            strokeOpacity={0.12}
            strokeWidth={1}
          />
          <text x={PAD_LEFT - 6} y={y(tick) + 3} textAnchor="end" fill="currentColor" fontSize={9} className="font-mono">
            {format(tick)}
          </text>
        </g>
      ))}
      <line
        data-slot="trend-target"
        x1={PAD_LEFT}
        x2={width - PAD_RIGHT}
        y1={y(target)}
        y2={y(target)}
        stroke={TARGET}
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <text
        data-slot="trend-target-label"
        x={targetLabel.x}
        y={targetLabel.y}
        textAnchor={targetLabel.anchor}
        fill="currentColor"
        fontSize={9}
      >
        {targetText}
      </text>
      {paths.map((d, index) => (
        <path key={index} data-slot="trend-segment" d={d} fill="none" stroke={LINE} strokeWidth={1.5} />
      ))}
      {values.map((value, index) => {
        if (value === null) {
          return (
            <g key={index} data-slot="trend-withheld">
              <circle cx={x(index)} cy={baseline} r={3.5} fill="none" stroke={TARGET} strokeDasharray="2 2" />
              <text x={x(index)} y={baseline - 8} textAnchor="middle" fill="currentColor" fontSize={9}>
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
              r={isLast ? 3.5 : 2.5}
              fill={below ? BELOW_TARGET : LINE}
            />
            <text
              x={index === 0 ? x(index) + 2 : x(index)}
              y={y(value) - 8}
              textAnchor={index === 0 ? 'start' : index === values.length - 1 ? 'end' : 'middle'}
              fill="currentColor"
              fontSize={10}
              className="font-mono"
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
          y={height - 6}
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
