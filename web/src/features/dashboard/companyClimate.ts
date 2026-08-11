import { isSuppressed, participationRate } from '../../components/charts'
import type { CompanyAdminDashboard, DashboardDepartmentSummary } from './api/dashboard'

/**
 * The arithmetic behind the company dashboard's climate map, in one place.
 *
 * ## What is actually being measured, and why it is not a climate score
 *
 * The redesign's hero is a diverging map of *score against target*. `GET
 * /dashboard/company-admin` carries no scores: `DashboardDtos.cs` gives this page
 * counts only — `UserCount`, `CompletedResponseCount`, `OpenActionPlanCount`, and a
 * `Departments` list of `(Id, Name, MemberCount, CompletedResponseCount)`. There is
 * no dimension, no per-question average and no previous period anywhere on the
 * payload, so a climate index or a Safety/Workload/Trust grid could only be
 * invented.
 *
 * The one quantity the payload does support as a polarity is **completed responses
 * per person**. `DashboardQueries.DepartmentSummaries` counts it identically for every
 * department — completed responses carrying that department id, over the users carrying
 * it — and `DashboardQueries.ResponseCounts` / `UserCounts` count the tenant's the same
 * way over the whole company. Every department is therefore measured on exactly the same
 * rule as every other, over the same window, which is what makes the grid comparable
 * across rows.
 *
 * The company figure is the *whole tenant*, so it also includes completed responses that
 * carry no department at all and users who belong to none. That is the right target — it
 * is the organisation, not the mean of its departments — but it is why the departments do
 * not average out to it.
 *
 * **The target is therefore the organisation's own rate**, not a number chosen here.
 * That is the part worth keeping if per-dimension scores ever arrive: measuring a
 * group against a constant nobody set is how a map ends up all one colour.
 *
 * ## Why the reading can exceed 100 and is not called a percentage
 *
 * It counts responses, not people: a tenant running three surveys can collect three
 * completed responses from one person. So it is stated as *responses per 100 people*
 * (`dashboard.responsesPer100`) rather than as a participation percentage, which at
 * 150% would read as a bug instead of as a measurement.
 *
 * ## Suppression is applied here, not only at the cell
 *
 * `ClimateMap` hatches a row under the floor by itself. This module *also* keeps
 * suppressed departments out of {@link belowTarget}, which is what feeds the
 * "below target" reading and the "needs attention" finding. Counting a hatched
 * department among the departments below target would publish the very comparison
 * the hatch withholds — a reader who sees one hatched row and a below-target count
 * of one has learned that row's polarity. The floor has to hold in the prose as well
 * as in the grid.
 */

/** One department, read as a rate the map can plot. */
export interface DepartmentReading {
  /** Stable id, straight off the payload. */
  id: string
  name: string
  memberCount: number
  completedResponseCount: number
  /**
   * Completed responses per person, ×100 and rounded — the number the map paints.
   * `null` when the department has nobody in it, which is not a measurement of zero
   * but the absence of anything to measure.
   */
  rate: number | null
  /**
   * Below the anonymity floor. The rate is still computed (the map needs a number to
   * hatch over) but must never be published, named or counted.
   */
  suppressed: boolean
}

/**
 * The organisation's own completed-responses-per-person rate — the map's target.
 *
 * `null` when the tenant has no users, because dividing by an empty headcount would
 * make every department infinitely above target.
 */
export function organisationResponseRate(
  data: Pick<CompanyAdminDashboard, 'completedResponseCount' | 'userCount'> | null | undefined,
): number | null {
  if (!data) return null
  const rate = participationRate(data.completedResponseCount, data.userCount)
  return rate === null ? null : Math.round(rate)
}

/**
 * Every department, in payload order, with its rate and its suppression decided.
 *
 * `threshold` is the company's anonymity floor and is passed through rather than
 * assumed — Company Settings can raise it (see `ProtectedCell`).
 */
export function readDepartments(
  departments: readonly DashboardDepartmentSummary[],
  threshold = 5,
): DepartmentReading[] {
  return departments.map((department) => {
    const rate = participationRate(department.completedResponseCount, department.memberCount)
    return {
      id: department.id,
      name: department.name,
      memberCount: department.memberCount,
      completedResponseCount: department.completedResponseCount,
      rate: rate === null ? null : Math.round(rate),
      suppressed: isSuppressed(department.completedResponseCount, threshold),
    }
  })
}

/**
 * The departments that can be plotted at all.
 *
 * A department with no members has no rate, and `ClimateMap` has no "not measurable"
 * cell — its two states are a number and the hatch, and hatching this one would
 * announce an anonymity guarantee that is not what happened. They are counted out
 * loud under the map instead.
 */
export function measurableDepartments(readings: readonly DepartmentReading[]): DepartmentReading[] {
  return readings.filter((reading) => reading.rate !== null)
}

/**
 * Departments far enough below the target to be worth acting on, worst first.
 *
 * "Far enough" is `deadBand` points, the same neutral band `ClimateMap` paints grey,
 * so this list and the colours on the grid can never disagree about what counts as
 * below. Suppressed departments are excluded — see the module comment.
 *
 * Ties break on name so the "needs attention" finding does not swap between two
 * equally-behind departments on every reload.
 */
export function belowTarget(
  readings: readonly DepartmentReading[],
  target: number,
  deadBand = 2,
): DepartmentReading[] {
  return readings
    .filter((reading) => !reading.suppressed)
    .filter((reading) => reading.rate !== null && reading.rate < target - deadBand)
    .sort((left, right) => (left.rate ?? 0) - (right.rate ?? 0) || left.name.localeCompare(right.name))
}
