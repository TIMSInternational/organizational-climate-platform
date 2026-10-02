import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import DueTimeline from './DueTimeline'
import type { DueTimeline as DueTimelineData, TimelinePoint } from './derive'

const t = (key: string) => key
const ASOF = '2026-09-30T12:00:00Z'

function point(id: string, dueDate: string, days: number, position: number): TimelinePoint {
  return { id, name: `Plan ${id}`, dueDate, days, position, urgent: days <= 30 }
}

function draw(points: TimelinePoint[]) {
  const timeline: DueTimelineData = { points, firstAhead: null }
  return render(<DueTimeline timeline={timeline} asOf={ASOF} locale="es" t={t} />)
}

afterEach(cleanup)

describe('DueTimeline today mark', () => {
  it('labels today when every plan is ahead of it', () => {
    const { container } = draw([point('a', '2026-10-15', 15, 0.4), point('b', '2026-11-09', 40, 1)])
    expect(container.querySelector('[data-slot="due-timeline-today"]')).not.toBeNull()
  })

  // 30 Sep 2026: a plan due that day printed "30 sept" twice over itself and its name over "hoy".
  it('does not print today over a plan that sits on today, due today or past due', () => {
    const dueToday = draw([point('a', '2026-09-30', 0, 0), point('b', '2026-11-09', 40, 1)])
    expect(dueToday.container.querySelector('[data-slot="due-timeline-today"]')).toBeNull()
    expect(dueToday.container.querySelectorAll('[data-slot="due-timeline-label"]')).toHaveLength(2)
    cleanup()

    const pastDue = draw([point('a', '2026-09-29', -1, 0), point('b', '2026-11-09', 40, 1)])
    expect(pastDue.container.querySelector('[data-slot="due-timeline-today"]')).toBeNull()
  })
})
