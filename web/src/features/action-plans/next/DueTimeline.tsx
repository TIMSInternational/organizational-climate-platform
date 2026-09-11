import { calendarDay } from '../../../lib/calendarDay'
import type { TranslateFn } from '../../../i18n'
import type { DueTimeline as DueTimelineData } from './derive'

/** The artboard's axis: a 1120-wide viewBox with 40 units of room at either end. */
const VIEW_WIDTH = 1120
const AXIS_START = 40
const AXIS_END = 1080
const AXIS_Y = 24
/** A label wider than this would run into its neighbour's, so a close pair staggers. */
const LABEL_ROOM = 170
const LABEL_CHARS = 28

function truncate(name: string): string {
  return name.length <= LABEL_CHARS ? name : `${name.slice(0, LABEL_CHARS - 1).trimEnd()}…`
}

function anchorFor(x: number): 'start' | 'middle' | 'end' {
  if (x < AXIS_START + 60) return 'start'
  if (x > AXIS_END - 60) return 'end'
  return 'middle'
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
  const span = AXIS_END - AXIS_START
  const xOf = (position: number) => AXIS_START + position * span
  const urgentEnd = timeline.points.filter((point) => point.urgent).reduce((end, point) => Math.max(end, xOf(point.position)), AXIS_START)

  let lastLabelledX = Number.NEGATIVE_INFINITY
  let lastRow = 0
  const placed = timeline.points.map((point) => {
    const x = xOf(point.position)
    const row = x - lastLabelledX < LABEL_ROOM ? (lastRow === 0 ? 1 : 0) : 0
    lastLabelledX = x
    lastRow = row
    return { point, x, row }
  })
  const rows = placed.some((entry) => entry.row === 1) ? 2 : 1
  const height = 64 + (rows - 1) * 28
  const todayLabel = calendarDay(Date.parse(asOf), locale)

  return (
    <>
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
        className="block h-auto w-full"
        aria-hidden="true"
        data-slot="due-timeline"
      >
        <line x1={AXIS_START} y1={AXIS_Y} x2={AXIS_END} y2={AXIS_Y} className="stroke-line-default" strokeWidth={2} />
        {urgentEnd > AXIS_START && (
          <line
            x1={AXIS_START}
            y1={AXIS_Y}
            x2={urgentEnd}
            y2={AXIS_Y}
            className="stroke-accent-red"
            strokeWidth={2}
            data-slot="due-timeline-urgent-run"
          />
        )}
        <circle cx={AXIS_START} cy={AXIS_Y} r={5} className="fill-fg-primary stroke-surface-card" strokeWidth={2} />
        <text x={AXIS_START} y={46} fontSize={11} textAnchor="middle" className="fill-fg-primary font-mono" fontWeight={600}>
          {todayLabel}
        </text>
        <text x={AXIS_START} y={60} fontSize={10} textAnchor="middle" className="fill-accent-red">
          {t('actionPlans.next.timelineToday')}
        </text>
        {placed.map(({ point, x, row }) => {
          const anchor = anchorFor(x)
          const dy = row * 28
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
              <text x={x} y={60 + dy} fontSize={10} textAnchor={anchor} className="fill-fg-label">
                {truncate(point.name)}
              </text>
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
    </>
  )
}
