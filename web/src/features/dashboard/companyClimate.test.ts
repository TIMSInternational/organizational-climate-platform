import { describe, it, expect } from 'vitest'
import {
  belowTarget,
  measurableDepartments,
  organisationResponseRate,
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
