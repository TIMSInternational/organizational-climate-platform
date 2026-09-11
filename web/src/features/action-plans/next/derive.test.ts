import { describe, it, expect } from 'vitest'
import {
  applyFilters,
  daysToDue,
  dueTimeline,
  EMPTY_PLAN_FILTERS,
  findingReading,
  groupOf,
  groupRows,
  isDueThisMonth,
  ownerReading,
  summarize,
  timelineLabelSlots,
  bindShortWords,
} from './derive'
import type { PlanRow } from './model'

/** Every row the demo tenant's `GET /action-plans` answered on 10 Sep, as the hook maps it. */
function row(overrides: Partial<PlanRow> & Pick<PlanRow, 'id' | 'name' | 'status' | 'dueDate'>): PlanRow {
  return {
    departmentId: null,
    departmentName: null,
    priority: 'medium',
    createdAt: '2026-09-10T02:05:50.263923+00:00',
    finding: null,
    ownerName: null,
    ...overrides,
  }
}

const ASOF = '2026-09-10'

const MERIDIANO: PlanRow[] = [
  row({ id: 'p1', name: 'Programa de reconocimiento entre pares', status: 'not_started', dueDate: '2026-09-30T02:05:50.251+00:00', departmentId: 'd-personas', departmentName: 'Personas', priority: 'high', finding: { dimensionKey: 'recognition' } }),
  row({ id: 'c1', name: 'Buzón anónimo de sugerencias', status: 'cancelled', dueDate: '2026-10-10T00:00:00+00:00' }),
  row({ id: 'c2', name: 'Almuerzos mensuales por departamento', status: 'cancelled', dueDate: '2026-10-10T00:00:00+00:00' }),
  row({ id: 'c3', name: 'Piloto de horario flexible en Ventas', status: 'cancelled', dueDate: '2026-10-10T00:00:00+00:00' }),
  row({ id: 'p2', name: 'Reducir la carga de trabajo en Operaciones', status: 'not_started', dueDate: '2026-10-15T02:05:50.278+00:00', departmentId: 'd-ops', departmentName: 'Operaciones', priority: 'high', finding: { dimensionKey: 'workload' } }),
  row({ id: 'p3', name: 'Reuniones abiertas con la dirección', status: 'not_started', dueDate: '2026-10-25T02:05:50.292+00:00' }),
  row({ id: 'p4', name: 'Plan de desarrollo de carrera en Ingeniería', status: 'not_started', dueDate: '2026-11-09T03:05:50.285+00:00', departmentId: 'd-ing', departmentName: 'Ingeniería', finding: { dimensionKey: 'growth' } }),
]

describe('groupOf', () => {
  it('files a cancelled or completed plan under its closed group whatever its date says', () => {
    expect(groupOf({ status: 'cancelled', dueDate: '2026-01-01T00:00:00Z' }, ASOF)).toBe('cancelled')
    expect(groupOf({ status: 'completed', dueDate: '2026-01-01T00:00:00Z' }, ASOF)).toBe('completed')
  })

  it('files an open plan past its date as overdue, and one due TODAY as not yet overdue', () => {
    expect(groupOf({ status: 'not_started', dueDate: '2026-09-09T00:00:00Z' }, ASOF)).toBe('overdue')
    expect(groupOf({ status: 'in_progress', dueDate: '2026-09-09T00:00:00Z' }, ASOF)).toBe('overdue')
    expect(groupOf({ status: 'not_started', dueDate: '2026-09-10T00:00:00Z' }, ASOF)).toBe('notStarted')
  })

  it('honours a recorded overdue status even before the date', () => {
    expect(groupOf({ status: 'overdue', dueDate: '2026-12-01T00:00:00Z' }, ASOF)).toBe('overdue')
  })

  it('files in_progress as en marcha and every other open status as no iniciado', () => {
    expect(groupOf({ status: 'in_progress', dueDate: '2026-12-01T00:00:00Z' }, ASOF)).toBe('inProgress')
    expect(groupOf({ status: 'not_started', dueDate: '2026-12-01T00:00:00Z' }, ASOF)).toBe('notStarted')
  })
})

describe('groupRows', () => {
  it('puts the demo tenant four plans in No iniciados by due date and the three cancelled apart', () => {
    const groups = groupRows(MERIDIANO, ASOF)
    expect(groups.notStarted.map((r) => r.id)).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(groups.cancelled.map((r) => r.id).sort()).toEqual(['c1', 'c2', 'c3'])
    expect(groups.inProgress).toEqual([])
    expect(groups.overdue).toEqual([])
  })
})

describe('summarize', () => {
  it('reads the artboard tiles off the rows: 7 plans, 4 open, 3 cancelled, 1 due this month, none with progress', () => {
    expect(summarize(MERIDIANO, ASOF)).toEqual({
      total: 7,
      open: 4,
      cancelled: 3,
      completed: 0,
      dueThisMonth: 1,
      withProgress: 0,
      overdue: 0,
    })
  })

  it('counts a past-due plan as due this month and as overdue', () => {
    const rows = [row({ id: 'x', name: 'x', status: 'not_started', dueDate: '2026-08-20T00:00:00Z' })]
    expect(summarize(rows, ASOF)).toMatchObject({ open: 1, overdue: 1, dueThisMonth: 1 })
  })
})

describe('daysToDue and isDueThisMonth', () => {
  it('counts calendar days on the UTC day the plan names', () => {
    expect(daysToDue(MERIDIANO[0], ASOF)).toBe(20)
    expect(daysToDue(MERIDIANO[6], ASOF)).toBe(60)
    expect(daysToDue({ dueDate: 'not a date' }, ASOF)).toBeNull()
  })

  it('knows 30 September is this month and 15 October is not', () => {
    expect(isDueThisMonth(MERIDIANO[0], ASOF)).toBe(true)
    expect(isDueThisMonth(MERIDIANO[4], ASOF)).toBe(false)
  })
})

describe('findingReading and ownerReading', () => {
  it('counts the open plans with a finding and names their dimensions once, in due order', () => {
    expect(findingReading(MERIDIANO)).toEqual({ withFinding: 3, open: 4, dimensionKeys: ['recognition', 'workload', 'growth'] })
  })

  it('counts every open plan without an owner — the cancelled ones are not open', () => {
    expect(ownerReading(MERIDIANO)).toEqual({ unassigned: 4, open: 4 })
  })
})

describe('dueTimeline', () => {
  it('places each open plan from today (0) to the last due date (1), the first ahead in 20 days', () => {
    const timeline = dueTimeline(MERIDIANO, ASOF)
    expect(timeline.points.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(timeline.points[0].position).toBeCloseTo(20 / 60)
    expect(timeline.points[3].position).toBe(1)
    expect(timeline.firstAhead).toBe(20)
  })

  it('marks urgent exactly the plans due this month or already past', () => {
    const rows = [...MERIDIANO, row({ id: 'late', name: 'late', status: 'not_started', dueDate: '2026-08-20T00:00:00Z' })]
    const urgent = dueTimeline(rows, ASOF).points.filter((p) => p.urgent).map((p) => p.id)
    expect(urgent.sort()).toEqual(['late', 'p1'])
  })

  it('sits a past-due plan on the today mark rather than off the axis', () => {
    const rows = [row({ id: 'late', name: 'late', status: 'not_started', dueDate: '2026-08-20T00:00:00Z' })]
    expect(dueTimeline(rows, ASOF).points[0].position).toBe(0)
  })
})

describe('applyFilters', () => {
  it('narrows by status, priority and title together', () => {
    expect(applyFilters(MERIDIANO, EMPTY_PLAN_FILTERS)).toHaveLength(7)
    expect(applyFilters(MERIDIANO, { ...EMPTY_PLAN_FILTERS, status: 'cancelled' })).toHaveLength(3)
    expect(applyFilters(MERIDIANO, { ...EMPTY_PLAN_FILTERS, priority: 'high' }).map((r) => r.id)).toEqual(['p1', 'p2'])
    expect(applyFilters(MERIDIANO, { ...EMPTY_PLAN_FILTERS, q: 'CARGA' }).map((r) => r.id)).toEqual(['p2'])
  })
})

describe('timelineLabelSlots', () => {
  // The demo tenant's four open plans (20, 35, 45 and 60 days out) on the artboard's own
  // 1120px drawing: the axis runs 40 → 1080, so the dots sit at these x positions.
  const XS = [40 + (20 / 60) * 1040, 40 + (35 / 60) * 1040, 40 + (45 / 60) * 1040, 1080]

  it('gives each label one line of room, centred under its dot, and hangs the one at the end of the axis inward', () => {
    expect(timelineLabelSlots(XS, 40, 1080, 1120)).toEqual([
      { anchor: 'middle', room: 252 },
      { anchor: 'middle', room: 165 },
      { anchor: 'middle', room: 165 },
      { anchor: 'end', room: 169 },
    ])
  })

  it('never lets two labels meet: each ends at least 8px before the next begins, and the first clears today', () => {
    const extent = (x: number, slot: { anchor: string; room: number }) =>
      slot.anchor === 'start' ? [x, x + slot.room] : slot.anchor === 'end' ? [x - slot.room, x] : [x - slot.room / 2, x + slot.room / 2]
    for (const width of [1120, 686, 500]) {
      const xs = XS.map((x) => 40 + ((x - 40) / 1040) * (width - 80))
      const slots = timelineLabelSlots(xs, 40, width - 40, width)
      const spans = xs.map((x, index) => extent(x, slots[index]))
      expect(spans[0][0]).toBeGreaterThanOrEqual(40 + 28 + 8)
      for (let index = 1; index < spans.length; index += 1) {
        expect(spans[index][0] - spans[index - 1][1], `width ${width}, label ${index}`).toBeGreaterThanOrEqual(8)
      }
      expect(spans[spans.length - 1][1]).toBeLessThanOrEqual(width)
    }
  })

  it('hangs a plan already past due, which sits on today, from the start of the axis', () => {
    expect(timelineLabelSlots([40, 600], 40, 1080, 1120)[0].anchor).toBe('start')
  })
})

describe('bindShortWords', () => {
  const NBSP = '\u00A0'
  it('ties each short lowercase word to the next, so a line cut at a word boundary never ends on one', () => {
    expect(bindShortWords('Reducir la carga de trabajo en Operaciones')).toBe(`Reducir la${NBSP}carga de${NBSP}trabajo en${NBSP}Operaciones`)
    expect(bindShortWords('Reuniones abiertas con la dirección')).toBe(`Reuniones abiertas con${NBSP}la${NBSP}dirección`)
  })

  it('leaves longer words, capitalised ones and the last word as they are, and prints the same words', () => {
    expect(bindShortWords('Programa entre pares')).toBe('Programa entre pares')
    expect(bindShortWords('Plan IA de Ley')).toBe(`Plan IA de${NBSP}Ley`)
    expect(bindShortWords('Hablar con')).toBe('Hablar con')
    const title = 'Plan de desarrollo de carrera en Ingeniería'
    expect(bindShortWords(title).replaceAll(NBSP, ' ')).toBe(title)
  })
})
