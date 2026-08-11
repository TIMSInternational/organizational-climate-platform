import { describe, it, expect } from 'vitest'
import { isOpenPlan, isPastDue, rollUpActionPlans } from './actionPlanRollup'
import type { ActionPlan } from './api/actionPlans'

/**
 * The KPI strip's arithmetic, and the one judgement the table makes per row.
 *
 * The case worth stating up front is `a plan due today is not past due`. The page
 * previously decided that with `new Date(plan.dueDate) < new Date()` against a
 * due date the API sends as **UTC midnight**, so a plan due today read as overdue
 * from 00:00:01 UTC — and for anyone west of UTC, from the evening before. Every
 * test here fixes `now` explicitly rather than reading the clock, so none of them
 * can pass or fail depending on what time the suite happened to run.
 */
function plan(overrides: Partial<ActionPlan> = {}): ActionPlan {
  return {
    id: 'p1',
    title: 'Raise engagement',
    companyId: 'c1',
    departmentId: null,
    dueDate: '2026-12-01T00:00:00.000Z',
    status: 'in_progress',
    priority: 'high',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('isOpenPlan', () => {
  it('treats completed and cancelled as finished and everything else as in flight', () => {
    expect(isOpenPlan('not_started')).toBe(true)
    expect(isOpenPlan('in_progress')).toBe(true)
    expect(isOpenPlan('overdue')).toBe(true)
    expect(isOpenPlan('completed')).toBe(false)
    expect(isOpenPlan('cancelled')).toBe(false)
  })
})

describe('isPastDue', () => {
  it('does not call a plan due today past due', () => {
    // The defect this module exists for. 08:00 local on the due date, in a zone
    // west of UTC, is the exact moment the old comparison got it wrong.
    const now = new Date(2026, 7, 11, 8, 0, 0)
    expect(isPastDue(plan({ dueDate: '2026-08-11T00:00:00.000Z' }), now)).toBe(false)
  })

  it('calls a plan past due the day after its date, and not the day before', () => {
    expect(isPastDue(plan({ dueDate: '2026-08-11T00:00:00.000Z' }), new Date(2026, 7, 12))).toBe(
      true,
    )
    expect(isPastDue(plan({ dueDate: '2026-08-11T00:00:00.000Z' }), new Date(2026, 7, 10))).toBe(
      false,
    )
  })

  it('never flags a finished plan, however long ago its date went by', () => {
    // Delivered late is delivered. Flagging it sends someone to chase work that
    // is already done.
    const long = { dueDate: '2020-01-01T00:00:00.000Z' }
    const now = new Date(2026, 7, 11)
    expect(isPastDue(plan({ ...long, status: 'completed' }), now)).toBe(false)
    expect(isPastDue(plan({ ...long, status: 'cancelled' }), now)).toBe(false)
    expect(isPastDue(plan({ ...long, status: 'in_progress' }), now)).toBe(true)
  })

  it('does not flag a plan whose due date cannot be read', () => {
    expect(isPastDue(plan({ dueDate: 'not-a-date' }), new Date(2026, 7, 11))).toBe(false)
  })

  it('honours a recorded overdue status against a date that has not gone by', () => {
    // `overdue` is in `ActionPlanValidation.ValidStatuses` and nothing under
    // `src/` ever computes it, so it can only have been sent by a client — which
    // means it can disagree with the date. Reading the date alone put a Status
    // badge saying "Overdue" on the same row the strip counted under ON TRACK,
    // "still inside their date".
    const now = new Date(2026, 7, 11)
    expect(isPastDue(plan({ status: 'overdue', dueDate: '2026-12-01T00:00:00.000Z' }), now)).toBe(
      true,
    )
    // Still not resurrected once it is finished: a plan can be closed out after
    // having been marked overdue, and chasing done work is the failure above.
    expect(isPastDue(plan({ status: 'completed', dueDate: '2020-01-01T00:00:00.000Z' }), now)).toBe(
      false,
    )
  })
})

describe('rollUpActionPlans', () => {
  const now = new Date(2026, 7, 11)

  it('counts open, on track, at risk and completed over the whole listing', () => {
    const rollup = rollUpActionPlans(
      [
        plan({ id: '1', status: 'in_progress', dueDate: '2026-12-01T00:00:00.000Z' }),
        plan({ id: '2', status: 'not_started', dueDate: '2026-12-02T00:00:00.000Z' }),
        plan({ id: '3', status: 'in_progress', dueDate: '2026-01-05T00:00:00.000Z' }),
        plan({ id: '4', status: 'completed', dueDate: '2026-01-05T00:00:00.000Z' }),
        plan({ id: '5', status: 'cancelled', dueDate: '2026-01-05T00:00:00.000Z' }),
      ],
      now,
    )

    expect(rollup.open).toBe(3)
    expect(rollup.onTrack).toBe(2)
    expect(rollup.atRisk).toBe(1)
    expect(rollup.completed).toBe(1)
  })

  it('splits every open plan into exactly one of on track and at risk', () => {
    const rollup = rollUpActionPlans(
      [
        plan({ id: '1', dueDate: '2026-08-01T00:00:00.000Z' }),
        plan({ id: '2', dueDate: '2026-08-11T00:00:00.000Z' }),
        plan({ id: '3', dueDate: '2026-09-30T00:00:00.000Z' }),
      ],
      now,
    )

    expect(rollup.onTrack + rollup.atRisk).toBe(rollup.open)
  })

  it('never puts a plan the API calls overdue under on track', () => {
    // The strip and the row's own Status badge read the same listing, so they
    // must not be able to contradict each other about the same plan.
    const rollup = rollUpActionPlans(
      [plan({ status: 'overdue', dueDate: '2026-12-01T00:00:00.000Z' })],
      now,
    )

    expect(rollup.open).toBe(1)
    expect(rollup.atRisk).toBe(1)
    expect(rollup.onTrack).toBe(0)
  })

  it('counts a cancelled plan as neither open nor completed', () => {
    // It is not work in flight and it was not delivered. Counting it either way
    // puts a number on the strip that nobody can act on.
    const rollup = rollUpActionPlans([plan({ status: 'cancelled' })], now)
    expect(rollup.open).toBe(0)
    expect(rollup.completed).toBe(0)
  })

  it('counts due-this-month over open plans only, and against the viewer own month', () => {
    const rollup = rollUpActionPlans(
      [
        plan({ id: '1', dueDate: '2026-08-01T00:00:00.000Z' }),
        plan({ id: '2', dueDate: '2026-08-31T00:00:00.000Z' }),
        plan({ id: '3', dueDate: '2026-09-01T00:00:00.000Z' }),
        plan({ id: '4', dueDate: '2026-07-31T00:00:00.000Z' }),
        plan({ id: '5', status: 'completed', dueDate: '2026-08-15T00:00:00.000Z' }),
      ],
      now,
    )

    // Both August ones, including the one already past. Not September, not July,
    // and not the completed August plan.
    expect(rollup.dueThisMonth).toBe(2)
  })

  it('reads an empty listing as four zeroes rather than throwing', () => {
    expect(rollUpActionPlans([], now)).toEqual({
      open: 0,
      onTrack: 0,
      atRisk: 0,
      completed: 0,
      dueThisMonth: 0,
    })
  })
})
