import { describe, it, expect } from 'vitest'
import {
  belowTarget,
  mapExtreme,
  measurableDepartments,
  organisationResponseRate,
  publishableDepartments,
  readDepartments,
} from './companyClimate'
import type { DashboardDepartmentSummary } from './api/dashboard'

function department(
  overrides: Partial<DashboardDepartmentSummary> & { id: string },
): DashboardDepartmentSummary {
  return { name: overrides.id, memberCount: 10, completedResponseCount: 10, ...overrides }
}

describe('organisationResponseRate', () => {
  it('is completed responses per 100 people, rounded', () => {
    expect(organisationResponseRate({ completedResponseCount: 18, userCount: 12 })).toBe(150)
    expect(organisationResponseRate({ completedResponseCount: 5, userCount: 8 })).toBe(63)
  })

  /**
   * A tenant with nobody in it has no rate. Returning 0 would be a measurement that was
   * never taken, and every department would then read as far above target.
   */
  it('is null when there is nobody to divide by', () => {
    expect(organisationResponseRate({ completedResponseCount: 4, userCount: 0 })).toBeNull()
    expect(organisationResponseRate(null)).toBeNull()
  })
})

describe('readDepartments', () => {
  it('reads each department as a rounded rate per 100 people', () => {
    const [engineering] = readDepartments([
      department({ id: 'e', name: 'Engineering', memberCount: 6, completedResponseCount: 5 }),
    ])

    expect(engineering.rate).toBe(83)
    expect(engineering.name).toBe('Engineering')
  })

  /**
   * The floor is decided on RESPONSES, not on headcount: a 40-person department with
   * three answers is exactly the case the anonymity floor exists for, and keying it off
   * `memberCount` would publish it.
   */
  it('suppresses a department by its response count, not by its headcount', () => {
    const [big, small] = readDepartments([
      department({ id: 'big', memberCount: 40, completedResponseCount: 3 }),
      department({ id: 'small', memberCount: 4, completedResponseCount: 9 }),
    ])

    expect(big.suppressed).toBe(true)
    expect(small.suppressed).toBe(false)
  })

  it('honours a company that has raised its anonymity floor', () => {
    const [only] = readDepartments([department({ id: 'd', completedResponseCount: 7 })], 10)

    expect(only.suppressed).toBe(true)
  })

  /** No members is not a rate of zero, it is the absence of anything to measure. */
  it('gives a department with no members no rate at all', () => {
    const [empty] = readDepartments([department({ id: 'd', memberCount: 0, completedResponseCount: 0 })])

    expect(empty.rate).toBeNull()
  })
})

describe('measurableDepartments', () => {
  it('drops only the departments that have no rate', () => {
    const readings = readDepartments([
      department({ id: 'has-people', memberCount: 5, completedResponseCount: 5 }),
      department({ id: 'nobody', memberCount: 0, completedResponseCount: 0 }),
    ])

    expect(measurableDepartments(readings).map((reading) => reading.id)).toEqual(['has-people'])
  })
})

describe('belowTarget', () => {
  const readings = () =>
    readDepartments([
      department({ id: 'ops', name: 'Operations', memberCount: 10, completedResponseCount: 12 }),
      department({ id: 'support', name: 'Support', memberCount: 10, completedResponseCount: 6 }),
      department({ id: 'sales', name: 'Sales', memberCount: 10, completedResponseCount: 8 }),
    ])

  it('names the department furthest behind first', () => {
    expect(belowTarget(readings(), 120).map((reading) => reading.id)).toEqual(['support', 'sales'])
  })

  /**
   * The dead band is the same neutral band `ClimateMap` paints grey. If this used a bare
   * `<` the grid and the prose could disagree: a department the map calls "on target"
   * would be counted below it.
   */
  it('leaves a department inside the neutral band alone', () => {
    const [, support] = readings()
    expect(support.rate).toBe(60)

    expect(belowTarget([support], 62)).toEqual([])
    expect(belowTarget([support], 63).map((reading) => reading.id)).toEqual(['support'])
  })

  /**
   * The floor has to hold in the prose as well as in the grid. A reader who sees one
   * hatched row and a below-target count of one has learned that row's polarity, which is
   * exactly what the hatch withholds.
   */
  it('never counts a suppressed department, however far behind it is', () => {
    const withheld = readDepartments([
      department({ id: 'finance', name: 'Finance', memberCount: 40, completedResponseCount: 2 }),
    ])
    expect(withheld[0].rate).toBe(5)

    expect(belowTarget(withheld, 120)).toEqual([])
  })

  it('breaks a tie on name, so the finding does not swap between reloads', () => {
    const tied = readDepartments([
      department({ id: 'z', name: 'Zeta', memberCount: 10, completedResponseCount: 6 }),
      department({ id: 'a', name: 'Alpha', memberCount: 10, completedResponseCount: 6 }),
    ])

    expect(belowTarget(tied, 120).map((reading) => reading.name)).toEqual(['Alpha', 'Zeta'])
  })
})

describe('publishableDepartments', () => {
  /**
   * The evidence test the "no department is behind" all-clear stands on. A department
   * with nobody in it has no reading, and one under the anonymity floor has one that may
   * not be published; neither is evidence about the organisation.
   */
  it('keeps only the departments whose reading may actually be shown', () => {
    const readings = readDepartments([
      department({ id: 'open', memberCount: 10, completedResponseCount: 9 }),
      department({ id: 'withheld', memberCount: 10, completedResponseCount: 2 }),
      department({ id: 'empty', memberCount: 0, completedResponseCount: 0 }),
    ])

    expect(publishableDepartments(readings).map((reading) => reading.id)).toEqual(['open'])
  })

  it('is empty when every department is under the floor', () => {
    const readings = readDepartments([
      department({ id: 'a', memberCount: 8, completedResponseCount: 4 }),
      department({ id: 'b', memberCount: 6, completedResponseCount: 1 }),
    ])

    expect(publishableDepartments(readings)).toEqual([])
  })
})

describe('mapExtreme', () => {
  /**
   * The defect it exists for. `ClimateMap`'s 10-point default is calibrated for a bounded
   * 0-100 score; measured against a real tenant on an unbounded rate, everything beyond
   * ten points from target saturated and the map stopped ranking. Here the target is 125
   * and the worst shortfall is 75, so the scale has to reach 75 rather than 10.
   */
  it('reaches the worst shortfall rather than a fixed ten points', () => {
    const readings = readDepartments([
      department({ id: 'marketing', memberCount: 12, completedResponseCount: 6 }),
      department({ id: 'support', memberCount: 18, completedResponseCount: 11 }),
      department({ id: 'it', memberCount: 7, completedResponseCount: 30 }),
    ])
    expect(readings.map((reading) => reading.rate)).toEqual([50, 61, 429])

    expect(mapExtreme(readings, 125)).toBe(75)
  })

  /**
   * A department far ABOVE the target does not stretch the scale. If it did, one
   * seven-person team that answered four surveys would flatten every other cell — the
   * far end is the worst shortfall, which is the finding the page is about.
   */
  it('is not stretched by a department far above the target', () => {
    const readings = readDepartments([
      department({ id: 'behind', memberCount: 20, completedResponseCount: 8 }),
      department({ id: 'ahead', memberCount: 10, completedResponseCount: 90 }),
    ])
    expect(readings.map((reading) => reading.rate)).toEqual([40, 900])

    // 60 behind against 800 ahead: the scale is the shortfall, not the overshoot.
    expect(mapExtreme(readings, 100)).toBe(60)
  })

  /**
   * The floor. Departments a point or two apart are noise, and stretching noise to full
   * saturation would paint a crisis; half the organisation's own rate is the smallest
   * shortfall worth the deepest colour, and it scales with the tenant.
   */
  it('does not amplify a tight cluster', () => {
    const readings = readDepartments([
      department({ id: 'a', memberCount: 10, completedResponseCount: 10 }),
      department({ id: 'b', memberCount: 10, completedResponseCount: 9 }),
    ])

    expect(mapExtreme(readings, 100)).toBe(50)
  })

  /**
   * A withheld department must not set the scale. Its own cell is hatched, so allowing it
   * to would let a row nobody can read visibly change every published colour on the grid.
   */
  it('is not set by a suppressed department', () => {
    const readings = readDepartments([
      department({ id: 'withheld', memberCount: 40, completedResponseCount: 2 }),
      department({ id: 'shown', memberCount: 10, completedResponseCount: 9 }),
    ])
    expect(readings[0].rate).toBe(5)

    // 5 is 115 behind; ignored, so the floor decides.
    expect(mapExtreme(readings, 120)).toBe(60)
  })

  /** Never zero: `ClimateMap` divides by `2 * extremeAt`. */
  it('is never zero, even for a tenant on a rate of nothing', () => {
    expect(mapExtreme([], 0)).toBe(1)
  })
})
