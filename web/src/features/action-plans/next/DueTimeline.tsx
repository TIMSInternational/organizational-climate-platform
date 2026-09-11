import { useEffect, useRef, useState } from 'react'
import { calendarDay } from '../../../lib/calendarDay'
import type { TranslateFn } from '../../../i18n'
import { timelineLabelLines, type DueTimeline as DueTimelineData } from './derive'

/**
 * The drawing is laid out in real pixels: the viewBox is as wide as the card measures, so the
 * 11px dates and 10px names stay that size at 1024 as at 1440, instead of shrinking with a
 * fixed viewBox (the first build scaled a 1120-unit drawing to fit, and scrolled below 880px).
 * `FALLBACK_WIDTH` is the artboard's own drawing width, used until the card is measured and
 * wherever nothing measures it (the test DOM has no layout).
 */
const FALLBACK_WIDTH = 1120
/** Room at either end of the axis, as the artboard leaves it. */
const EDGE = 40
const AXIS_Y = 24
/** A two-line label is about this wide at 10px; a neighbour closer than this staggers down. */
const LABEL_ROOM = 164
/** The second line of a label. */
const LINE_HEIGHT = 12
/** The drop of a staggered label. */
const STAGGER = 40

function anchorFor(x: number, axisStart: number, axisEnd: number): 'start' | 'middle' | 'end' {
  if (x < axisStart + 60) return 'start'
  if (x > axisEnd - 60) return 'end'
  return 'middle'
}

/** The rendered width of the element `ref` points at, kept current as the page resizes. */
function useMeasuredWidth<T extends Element>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(FALLBACK_WIDTH)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const measured = Math.round(entries[0]?.contentRect.width ?? 0)
      if (measured > 0) setWidth(measured)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/**
 * "Cuándo vence cada plan" — every open plan's due date on one axis from today, drawn
 * as the ActionPlansList artboard draws it: a hairline axis, today as an ink dot, each
 * plan a dot with its date in mono over its name, and a red run from today to the last
 * plan that is due before this month is out.
 *
 * Colour is never the only signal: the run and the red dots are the urgent ones, and
 * the table below says the same thing in words ("en 20 días · este mes"). The list under
 * the drawing is the accessible form of it — a screen reader skips the SVG and reads the
 * dates and names in order.
 *
 * Label collisions: two plans due within a label's width of each other would print their
 * names over one another, so a label that would collide drops to a second line.
 */
export default function DueTimeline({
  timeline,
  asOf,
  locale,
  t,
}: {
  timeline: DueTimelineData
  asOf: string
  locale: string
  t: TranslateFn
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const axisStart = EDGE
  const axisEnd = Math.max(axisStart + 1, width - EDGE)
  const span = axisEnd - axisStart
  const xOf = (position: number) => axisStart + position * span
  const urgentEnd = timeline.points.filter((point) => point.urgent).reduce((end, point) => Math.max(end, xOf(point.position)), axisStart)

  // Today's own label sits at the start of the axis, so the first plan staggers off it too.
  let lastLabelledX = axisStart
  let lastRow = 0
  const placed = timeline.points.map((point) => {
    const x = xOf(point.position)
    const row = x - lastLabelledX < LABEL_ROOM ? (lastRow === 0 ? 1 : 0) : 0
    lastLabelledX = x
    lastRow = row
    return { point, x, row, lines: timelineLabelLines(point.name) }
  })
  const rows = placed.some((entry) => entry.row === 1) ? 2 : 1
  const twoLines = placed.some((entry) => entry.lines.length > 1)
  const height = 64 + (twoLines ? LINE_HEIGHT : 0) + (rows - 1) * STAGGER
  const todayLabel = calendarDay(Date.parse(asOf), locale)

  return (
    <div ref={ref} className="w-full min-w-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        className="block h-auto w-full"
        aria-hidden="true"
        data-slot="due-timeline"
      >
        <line x1={axisStart} y1={AXIS_Y} x2={axisEnd} y2={AXIS_Y} className="stroke-line-default" strokeWidth={2} />
        {urgentEnd > axisStart && (
          <line
            x1={axisStart}
            y1={AXIS_Y}
            x2={urgentEnd}
            y2={AXIS_Y}
            className="stroke-accent-red"
            strokeWidth={2}
            data-slot="due-timeline-urgent-run"
          />
        )}
        <circle cx={axisStart} cy={AXIS_Y} r={5} className="fill-fg-primary stroke-surface-card" strokeWidth={2} />
        <text x={axisStart} y={46} fontSize={11} textAnchor="middle" className="fill-fg-primary font-mono" fontWeight={600}>
          {todayLabel}
        </text>
        <text x={axisStart} y={60} fontSize={10} textAnchor="middle" className="fill-accent-red">
          {t('actionPlans.next.timelineToday')}
        </text>
        {placed.map(({ point, x, row, lines }) => {
          const anchor = anchorFor(x, axisStart, axisEnd)
          const dy = row * STAGGER
          return (
            <g key={point.id} data-urgent={point.urgent ? 'true' : 'false'}>
              <circle
                cx={x}
                cy={AXIS_Y}
                r={6}
                className={point.urgent ? 'fill-accent-red stroke-surface-card' : 'fill-accent-blue stroke-surface-card'}
                strokeWidth={2}
              />
              <text x={x} y={46 + dy} fontSize={11} textAnchor={anchor} className="fill-fg-primary font-mono">
                {calendarDay(Date.parse(point.dueDate), locale)}
              </text>
              {lines.map((line, index) => (
                <text
                  key={index}
                  x={x}
                  y={60 + dy + index * LINE_HEIGHT}
                  fontSize={10}
                  textAnchor={anchor}
                  className="fill-fg-label"
                  data-slot="due-timeline-label"
                >
                  {line}
                </text>
              ))}
            </g>
          )
        })}
      </svg>
      <ul className="sr-only">
        {timeline.points.map((point) => (
          <li key={point.id}>
            {t('actionPlans.next.timelineItem', { date: calendarDay(Date.parse(point.dueDate), locale), name: point.name })}
          </li>
        ))}
      </ul>
    </div>
  )
}
