import { useEffect, useRef, useState } from 'react'
import { calendarDay } from '../../../lib/calendarDay'
import type { TranslateFn } from '../../../i18n'
import { cn } from '../../../lib/cn'
import { bindShortWords, timelineLabelSlots, type DueTimeline as DueTimelineData, type TimelineAnchor } from './derive'

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
/** The artboard's drawing height: the axis, the dates at y=46 and the names at y=60. */
const HEIGHT = 64
/** The names' baseline is the artboard's y=60; a 12px line box at 10px type starts 9px above it. */
const NAME_TOP = 51

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

/** The label's line sits in its box as the date above it sits on its dot. */
const ALIGN: Record<TimelineAnchor, string> = { start: 'text-left', middle: 'text-center', end: 'text-right' }

/** How an HTML label hangs from its dot — the SVG `text-anchor` the dates use, as CSS. */
function hang(anchor: TimelineAnchor, x: number, width: number): React.CSSProperties {
  if (anchor === 'start') return { left: x }
  if (anchor === 'end') return { right: width - x }
  return { left: x, transform: 'translateX(-50%)' }
}

/**
 * "Cuándo vence cada plan" — every open plan's due date on one axis from today, drawn
 * as the ActionPlansList artboard draws it: a hairline axis, today as an ink dot, each
 * plan a dot with its date in mono over its name, and a red run from today to the last
 * plan that is due before this month is out.
 *
 * The names are one line each, as the artboard's are: HTML over the drawing, each box as wide
 * as `timelineLabelSlots` leaves it before its neighbour's. The title wraps at word boundaries
 * inside that box and only its first line shows, so it prints whole where the axis has room and
 * stops after its last WHOLE word where it does not — "Reducir la carga de trabajo", never
 * "Reducir la carga de trabajo en …" cut mid-word — and never on a short word like "en" or
 * "la", which `bindShortWords` ties to the word after it. The whole title is in `title`.
 *
 * Colour is never the only signal: the run and the red dots are the urgent ones, and
 * the table below says the same thing in words ("en 20 días · este mes"). The list under
 * the drawing is the accessible form of it — a screen reader skips the SVG and the labels
 * and reads the dates and names in order.
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
  const xs = timeline.points.map((point) => xOf(point.position))
  const slots = timelineLabelSlots(xs, axisStart, axisEnd, width)
  const todayLabel = calendarDay(Date.parse(asOf), locale)
  const svgAnchor = (anchor: TimelineAnchor) => anchor

  return (
    <div ref={ref} className="relative w-full min-w-0">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
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
        {timeline.points.map((point, index) => (
          <g key={point.id} data-urgent={point.urgent ? 'true' : 'false'}>
            <circle
              cx={xs[index]}
              cy={AXIS_Y}
              r={6}
              className={point.urgent ? 'fill-accent-red stroke-surface-card' : 'fill-accent-blue stroke-surface-card'}
              strokeWidth={2}
            />
            <text x={xs[index]} y={46} fontSize={11} textAnchor={svgAnchor(slots[index].anchor)} className="fill-fg-primary font-mono">
              {calendarDay(Date.parse(point.dueDate), locale)}
            </text>
          </g>
        ))}
      </svg>
      {timeline.points.map((point, index) => (
        <span
          key={point.id}
          aria-hidden="true"
          title={point.name}
          data-slot="due-timeline-label"
          data-anchor={slots[index].anchor}
          className={cn(
            'pointer-events-auto absolute block max-h-[1lh] overflow-hidden whitespace-normal text-[10px] leading-3 text-fg-label',
            ALIGN[slots[index].anchor],
          )}
          style={{ top: NAME_TOP, width: slots[index].room, ...hang(slots[index].anchor, xs[index], width) }}
        >
          {bindShortWords(point.name)}
        </span>
      ))}
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
