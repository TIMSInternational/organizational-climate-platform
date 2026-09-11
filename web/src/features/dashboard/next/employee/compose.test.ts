import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { DashboardPendingSurvey, EmployeeDashboard, EmployeeLastOutcome } from '../../api/dashboard'
import { composeEmployeeHome, composeOutcome, daysUntil } from './compose'

/**
 * The employee Home's arithmetic, without a DOM.
 *
 * Every figure on the page is derived here — the countdown, the minutes, the list-versus-
 * count comparison, the de-duplicated plan departments — so each is pinned against the
 * payload shapes the local API returned for Grupo Meridiano (carlos.mata, 11 Sep 2026).
 */

function survey(overrides: Partial<DashboardPendingSurvey> = {}): DashboardPendingSurvey {
  return {
    id: '4c9c8c8c-03e1-4033-8224-8c80b242c558',
    title: 'Encuesta de Clima Q4 (abierta)',
    type: 'periodic',
    startDate: '2026-09-03T02:03:39.148+00:00',
    endDate: '2026-10-10T02:03:39.148+00:00',
    questionCount: 6,
    anonymous: false,
    ...overrides,
  }
}

function dashboard(overrides: Partial<EmployeeDashboard> = {}): EmployeeDashboard {
  return {
    name: 'Carlos Mata',
    companyId: '16c97c29-07f8-4522-86fc-e6cc56298829',
    departmentId: '5bfdb04e-8847-4baa-89c8-d4411654a129',
    departmentName: 'Ingeniería',
    pendingSurveyCount: 1,
    completedSurveyCount: 2,
    unreadNotificationCount: 0,
    nextDeadline: '2026-10-10T02:03:39.148+00:00',
    pendingSurveys: [survey()],
    ...overrides,
  }
}

/** `GET /dashboard/employee/last-outcome` for Meridiano, verbatim. */
function outcome(overrides: Partial<EmployeeLastOutcome> = {}): EmployeeLastOutcome {
  return {
    surveyId: '38b2002f-66da-468d-b136-ec112ba3204b',
    surveyTitle: 'Encuesta de Clima Q3',
    closedOn: '2026-08-06T02:05:22.922+00:00',
    responseCount: 24,
    departmentCount: 5,
    protectedDepartmentCount: 1,
    minimumGroupSize: 5,
    plansOpenedSince: [
      { departmentName: 'Personas', createdAt: '2026-09-10T02:05:50.263923+00:00' },
      { departmentName: 'Operaciones', createdAt: '2026-09-10T02:05:50.280646+00:00' },
      { departmentName: 'Ingeniería', createdAt: '2026-09-10T02:05:50.287727+00:00' },
      { departmentName: null, createdAt: '2026-09-10T02:05:50.294635+00:00' },
    ],
    openPlanCount: 4,
    ...overrides,
  }
}

/** 21:50 in Costa Rica on the canvas's date, 10 Sep — 03:50 UTC on the 11th. */
const CANVAS_EVENING = '2026-09-11T03:50:00.000Z'

/**
 * The countdown counts the reader's CALENDAR days, so the reader's zone is part of the
 * input. Pinned to Costa Rica — the tenant's zone, and the canvas's — because CI runs in
 * UTC, where 03:50 UTC on the 11th is already the 11th and every case below would be read
 * from the wrong evening. Node re-reads `TZ` on assignment, as `SurveyRespondForm.test.tsx`
 * relies on too.
 */
const ORIGINAL_TZ = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'America/Costa_Rica'
})
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ
})

describe('daysUntil', () => {
  it('reads the canvas’s "Cierra en 30 días" from the Q4 close on its own evening', () => {
    // 10 Sep in Costa Rica to 10 Oct, the day `formatDayMonth` prints beside the count.
    // Elapsed time says 28.9 days, which is how this read 29 against a printed date 30
    // days away.
    expect(daysUntil('2026-10-10T02:03:39.148+00:00', CANVAS_EVENING)).toBe(30)
  })

  it('counts the close’s calendar day, so tomorrow’s date is one day left however few hours remain', () => {
    expect(daysUntil('2026-09-11T20:00:00Z', CANVAS_EVENING)).toBe(1)
  })

  it('reads a close stamped with today’s date as closing today', () => {
    expect(daysUntil('2026-09-10T23:59:59Z', CANVAS_EVENING)).toBe(0)
  })

  it('reads a deadline already past as nothing left, never a negative', () => {
    expect(daysUntil('2026-09-01T00:00:00Z', CANVAS_EVENING)).toBe(0)
  })

  it('makes no claim for a date it cannot read', () => {
    expect(daysUntil('not a date', CANVAS_EVENING)).toBeNull()
  })
})

describe('composeEmployeeHome', () => {
  it('leads with the first survey the server listed and keeps the rest as quieter rows', () => {
    const model = composeEmployeeHome({
      dashboard: dashboard({
        pendingSurveyCount: 2,
        pendingSurveys: [survey(), survey({ id: 'copy', title: 'Encuesta de Clima Q4 (abierta) (Copia)' })],
      }),
      lastOutcome: null,
      leadAllowsSaveForLater: true,
      asOf: CANVAS_EVENING,
    })
    expect(model.lead?.id).toBe('4c9c8c8c-03e1-4033-8224-8c80b242c558')
    expect(model.others.map((s) => s.id)).toEqual(['copy'])
    expect(model.pendingCount).toBe(2)
  })

  it('computes the minutes from the question count — six questions, about four minutes', () => {
    const model = composeEmployeeHome({
      dashboard: dashboard(),
      lastOutcome: null,
      leadAllowsSaveForLater: null,
      asOf: CANVAS_EVENING,
    })
    expect(model.lead?.minutes).toBe(4)
    expect(model.lead?.daysLeft).toBe(30)
  })

  it('says more is outstanding only when the count exceeds the listed page', () => {
    const listed = { dashboard: dashboard({ pendingSurveyCount: 1 }), lastOutcome: null, leadAllowsSaveForLater: null, asOf: CANVAS_EVENING }
    expect(composeEmployeeHome(listed).beyondList).toBe(false)
    const capped = { ...listed, dashboard: dashboard({ pendingSurveyCount: 7 }) }
    expect(composeEmployeeHome(capped).beyondList).toBe(true)
  })

  it('reads anonymity as a promise only from a literal true', () => {
    const cases: [unknown, boolean][] = [
      [true, true],
      [false, false],
      [undefined, false],
      ['true', false],
    ]
    for (const [flag, expected] of cases) {
      const model = composeEmployeeHome({
        dashboard: dashboard({ pendingSurveys: [survey({ anonymous: flag as boolean })] }),
        lastOutcome: null,
        leadAllowsSaveForLater: null,
        asOf: CANVAS_EVENING,
      })
      expect(model.lead?.anonymous, `anonymous: ${String(flag)}`).toBe(expected)
    }
  })

  it('carries no save-for-later claim when there is no survey to make it about', () => {
    const model = composeEmployeeHome({
      dashboard: dashboard({ pendingSurveyCount: 0, pendingSurveys: [] }),
      lastOutcome: null,
      leadAllowsSaveForLater: true,
      asOf: CANVAS_EVENING,
    })
    expect(model.lead).toBeNull()
    expect(model.leadAllowsSaveForLater).toBeNull()
  })
})

describe('composeOutcome', () => {
  it('is absent, not empty, when nothing has closed', () => {
    expect(composeOutcome(null)).toBeNull()
  })

  it('lists the named plan departments once each and gives a nameless plan no name', () => {
    const composed = composeOutcome(
      outcome({
        plansOpenedSince: [
          { departmentName: 'Ingeniería', createdAt: '2026-09-10T02:05:50Z' },
          { departmentName: 'Ingeniería', createdAt: '2026-09-10T02:06:50Z' },
          { departmentName: null, createdAt: '2026-09-10T02:07:50Z' },
        ],
        openPlanCount: 3,
      }),
    )
    expect(composed?.planDepartments).toEqual(['Ingeniería'])
    expect(composed?.openPlanCount).toBe(3)
  })

  it('dates the plans from the first one opened, and carries the floor the server sent', () => {
    const composed = composeOutcome(outcome())
    expect(composed?.planDepartments).toEqual(['Personas', 'Operaciones', 'Ingeniería'])
    expect(composed?.firstPlanOpenedOn).toBe('2026-09-10T02:05:50.263923+00:00')
    expect(composed?.floor).toBe(5)
    expect(composed?.protectedDepartmentCount).toBe(1)
  })
})
