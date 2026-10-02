import { useTranslation } from '../../../../i18n'
import { BAND_PAINT, RESULT_BAND_ORDER, SCALE_MAX, SCALE_MIN, bandOf, bandShortName, type ResultBandKey, type ResultBands } from '../../../../components/charts'
import { trendAxis, type TrendAxis } from './derive'

/**
 * One dimension across the closed waves, read in the company's result bands — the
 * canvas's chart: a 330×150 figure with the three areas laid behind the line in their
 * tints and named in their corner, a dashed rule at each boundary, a recessive 0.5-step
 * grid, a 2px line with ringed 8px markers and the value over each, the latest marker a
 * step larger and in its band's colour, and the wave under each point.
 *
 * ## One axis for the page
 *
 * `axis` is the one the page computed for ALL six charts (`sharedTrendAxis`), so two
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
 * Colour: the line is the one fixed hex, as `TrendSparkline` draws it; the zones, the
 * boundaries, the endpoint, the grid, the marker rings and every label are theme tokens,
 * so the figure follows the theme. The zone names are what keep the areas from being
 * told by colour alone.
 */
export interface DimensionTrendChartProps {
  values: readonly (number | null)[]
  /** Per value: `true` when the floor withheld that wave. Omitted means none was. */
  withheld?: readonly boolean[]
  /** The company's result bands: the zones behind the line, and the endpoint's colour. */
  bands: ResultBands
  /** The y axis, shared by every chart on the page; derived from `values` when omitted. */
  axis?: TrendAxis
  /** One per value, drawn under the points. */
  labels: readonly string[]
  /** Already-translated accessible description of the whole figure. */
  label: string
  /** Already-translated word drawn where a wave is withheld. */
  withheldText: string
  /** How a reading prints: one decimal in the reader's locale. */
  format: (value: number) => string
  width?: number
  height?: number
}

const LINE = '#4d76c7'
const BOUNDARY = 'var(--admin-line-control)'
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
  bands,
  axis: sharedAxis,
  labels,
  label,
  withheldText,
  format,
  width = 330,
  height = 150,
}: DimensionTrendChartProps) {
  const { t } = useTranslation()
  const { low, high, ticks } = sharedAxis ?? trendAxis(values, bands)
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

  // The three areas, clipped to the drawn range. Each zone's name goes in a corner where
  // it collides with no point and no value printed over one — top left, top right, then
  // the bottom two — and is left out when the zone is too thin or every corner is taken:
  // the legend above the charts names every area either way.
  const taken: Box[] = values.flatMap((value, index) =>
    value === null ? [] : [{ x1: x(index) - 16, x2: x(index) + 16, y1: y(value) - 21, y2: y(value) + 6 }],
  )
  const plotLeft = AXIS_LEFT
  const plotRight = width - AXIS_RIGHT
  const edges: Record<ResultBandKey, [number, number]> = {
    critical: [SCALE_MIN, bands.opportunityMin],
    opportunity: [bands.opportunityMin, bands.strengthMin],
    strength: [bands.strengthMin, SCALE_MAX],
  }
  const zones = RESULT_BAND_ORDER.flatMap((band) => {
    const from = Math.max(edges[band][0], low)
    const to = Math.min(edges[band][1], high)
    if (to <= from) return []
    const top = y(to)
    const bottom = y(from)
    const name = bandShortName(band, bands, t).toLocaleUpperCase()
    const labelWidth = name.length * 5.4
    const candidates = [
      { x: plotLeft + 4, y: top + 10, anchor: 'start' as const, box: { x1: plotLeft, x2: plotLeft + 4 + labelWidth, y1: top + 1, y2: top + 12 } },
      { x: plotRight - 4, y: top + 10, anchor: 'end' as const, box: { x1: plotRight - 4 - labelWidth, x2: plotRight, y1: top + 1, y2: top + 12 } },
      { x: plotLeft + 4, y: bottom - 3, anchor: 'start' as const, box: { x1: plotLeft, x2: plotLeft + 4 + labelWidth, y1: bottom - 12, y2: bottom - 1 } },
      { x: plotRight - 4, y: bottom - 3, anchor: 'end' as const, box: { x1: plotRight - 4 - labelWidth, x2: plotRight, y1: bottom - 12, y2: bottom - 1 } },
    ]
    const spot = bottom - top >= 13 ? candidates.find((candidate) => !taken.some((box) => overlaps(box, candidate.box))) : undefined
    return [{ band, top, bottom, name, spot }]
  })
  const boundaries = [bands.opportunityMin, bands.strengthMin].filter((value) => value > low && value < high)

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
      {zones.map((zone) => (
        <rect
          key={zone.band}
          data-slot="trend-zone"
          data-band={zone.band}
          x={plotLeft}
          y={zone.top}
          width={plotRight - plotLeft}
          height={zone.bottom - zone.top}
          fill={BAND_PAINT[zone.band].zone}
        />
      ))}
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
      {boundaries.map((boundary) => (
        <line
          key={boundary}
          data-slot="trend-boundary"
          x1={plotLeft}
          x2={plotRight}
          y1={y(boundary)}
          y2={y(boundary)}
          stroke={BOUNDARY}
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      ))}
      {zones.map((zone) =>
        zone.spot ? (
          <text
            key={zone.band}
            data-slot="trend-zone-label"
            data-band={zone.band}
            x={zone.spot.x}
            y={zone.spot.y}
            textAnchor={zone.spot.anchor}
            fill={BAND_PAINT[zone.band].ink}
            fontSize={9}
            fontWeight={600}
            letterSpacing="0.06em"
          >
            {zone.name}
          </text>
        ) : null,
      )}
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
                stroke={BOUNDARY}
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
        const band = isLast ? bandOf(value, bands) : null
        return (
          <g key={index}>
            <circle
              data-slot={isLast ? 'trend-end' : 'trend-point'}
              data-band={band ?? undefined}
              cx={x(index)}
              cy={y(value)}
              r={isLast ? 5 : 4}
              fill={band ? BAND_PAINT[band].line : LINE}
              className="stroke-surface-card"
              strokeWidth={2}
            />
            <text
              x={x(index)}
              y={y(value) - 10}
              textAnchor="middle"
              fontSize={11}
              data-slot="trend-value" className="fill-fg-primary font-mono"
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
