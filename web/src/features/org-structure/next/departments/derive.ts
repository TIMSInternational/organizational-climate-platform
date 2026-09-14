import type { Department } from '../../api/departments'
import type { User } from '../../api/users'
import type { ActionPlan } from '../../../action-plans/api/actionPlans'
import type { ClimateTrendsResponse } from '../../../surveys/api/climateTrends'
import { waveOf } from '../../../dashboard/next/super/derive'

/**
 * Pure rules behind the Departments artboard (`/departments`). Every number the screen prints
 * is derived here from four existing payloads — departments, users, action plans and the
 * per-department climate trends — and nothing is typed.
 */

/** `ActionPlanValidation.ValidStatuses` minus the two that end a plan. */
const CLOSED_PLAN_STATUSES = new Set(['completed', 'cancelled'])

export function isOpenPlan(plan: Pick<ActionPlan, 'status'>): boolean {
  return !CLOSED_PLAN_STATUSES.has(plan.status)
}

/** Open and past its due day. `today` is a calendar day, `YYYY-MM-DD`. */
export function isOverduePlan(plan: Pick<ActionPlan, 'status' | 'dueDate'>, today: string): boolean {
  return isOpenPlan(plan) && plan.dueDate.slice(0, 10) < today
}

export interface PlansReading {
  open: number
  overdue: number
  /** Open plans still `not_started` — the artboard's "sin avances". */
  notStarted: number
}

export type ClimateReading =
  /** Under the floor, or suppressed by the server: no number, anywhere. */
  | { kind: 'protected' }
  | { kind: 'score'; mean: number; dimensions: number; lowest: { key: string; score: number } }
  /** No point for this department in the wave (or no wave at all) — a dash, never a zero. */
  | { kind: 'none' }

export interface DepartmentRow {
  id: string
  name: string
  isActive: boolean
  people: number
  /** `null` when `GET /admin/users` failed: the cell prints a dash, not "no leader". */
  leaders: string[] | null
  supervisors: string[] | null
  /** `null` when `GET /action-plans` failed. */
  plans: PlansReading | null
  climate: ClimateReading
}

export interface Wave {
  surveyId: string
  /** "Q3", or the survey's title when it carries no wave code. */
  code: string
}

/** The latest closed survey in the trends window — the wave the "Clima" column reads. */
export function latestClosedWave(trends: ClimateTrendsResponse | null): Wave | null {
  if (!trends) return null
  const closed = trends.surveys
    .filter((survey) => survey.status === 'closed')
    .sort((a, b) => b.endDate.localeCompare(a.endDate))[0]
  if (!closed) return null
  return { surveyId: closed.surveyId, code: waveOf(closed.title) ?? closed.title ?? '' }
}

export function climateOf(
  trends: ClimateTrendsResponse | null,
  departmentId: string,
  wave: Wave | null,
  floor: number,
): ClimateReading {
  if (!trends || !wave) return { kind: 'none' }
  const point = trends.groups.find((group) => group.key === departmentId)?.points.find((p) => p.surveyId === wave.surveyId)
  if (!point) return { kind: 'none' }
  // The server zeroes `respondentCount` on a suppressed point (measured on Meridiano's Q3:
  // Finanzas `respondentCount: 0, isSuppressed: true`), so the count is never printed and the
  // flag and the floor are BOTH checked.
  if (point.isSuppressed || point.respondentCount < floor) return { kind: 'protected' }
  const scored = point.scores.flatMap((score, index) =>
    score === null ? [] : [{ key: trends.dimensions[index]?.key ?? String(index), score }],
  )
  if (scored.length === 0) return { kind: 'none' }
  const mean = scored.reduce((total, entry) => total + entry.score, 0) / scored.length
  const lowest = scored.reduce((low, entry) => (entry.score < low.score ? entry : low))
  return { kind: 'score', mean, dimensions: scored.length, lowest }
}

function namesOf(users: readonly User[] | null, departmentId: string, role: string): string[] | null {
  if (!users) return null
  return users
    .filter((user) => user.isActive && user.role === role && user.departmentId === departmentId)
    .map((user) => user.name)
    .sort((a, b) => a.localeCompare(b))
}

function plansOf(plans: readonly ActionPlan[] | null, departmentId: string, today: string): PlansReading | null {
  if (!plans) return null
  const open = plans.filter((plan) => plan.departmentId === departmentId && isOpenPlan(plan))
  return {
    open: open.length,
    overdue: open.filter((plan) => isOverduePlan(plan, today)).length,
    notStarted: open.filter((plan) => plan.status === 'not_started').length,
  }
}

export function rowsOf(input: {
  departments: readonly Department[]
  users: readonly User[] | null
  plans: readonly ActionPlan[] | null
  trends: ClimateTrendsResponse | null
  today: string
  floor: number
  locale: string
}): DepartmentRow[] {
  const wave = latestClosedWave(input.trends)
  return [...input.departments]
    .sort((a, b) => a.name.localeCompare(b.name, input.locale))
    .map((department) => ({
      id: department.id,
      name: department.name,
      isActive: department.isActive,
      people: department.employeeCount,
      leaders: namesOf(input.users, department.id, 'leader'),
      supervisors: namesOf(input.users, department.id, 'supervisor'),
      plans: plansOf(input.plans, department.id, input.today),
      climate: climateOf(input.trends, department.id, wave, input.floor),
    }))
}

export interface DepartmentsSummary {
  active: number
  inactive: number
  /** People in active departments. */
  people: number
  /** `null` when the plans request failed. */
  plans: { open: number; overdue: number; firstOverdue: string | null } | null
}

/**
 * The four tiles. Plans count every open plan of the company, including the ones no department
 * owns (`departmentId: null`), which is why this is not the sum of the rows; the overdue line
 * names the department of the plan that went overdue first.
 */
export function summaryOf(
  rows: readonly DepartmentRow[],
  plans: readonly ActionPlan[] | null,
  today: string,
): DepartmentsSummary {
  const active = rows.filter((row) => row.isActive)
  const overdue = plans
    ? plans.filter((plan) => isOverduePlan(plan, today)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    : []
  const first = overdue[0]
  return {
    active: active.length,
    inactive: rows.length - active.length,
    people: active.reduce((total, row) => total + row.people, 0),
    plans: plans
      ? {
          open: plans.filter(isOpenPlan).length,
          overdue: overdue.length,
          firstOverdue: first ? (rows.find((row) => row.id === first.departmentId)?.name ?? null) : null,
        }
      : null,
  }
}

export type CardNote =
  | { kind: 'protected'; wave: string }
  | { kind: 'lowest'; key: string; score: number; wave: string }
  | { kind: 'supervisor'; names: string[] }
  | { kind: 'none' }

/**
 * The one line under each organigram card, most urgent first: a protected group says so; a
 * department whose mean is under the target names its lowest dimension; otherwise its
 * supervisor; otherwise nothing to observe.
 */
export function noteOf(row: DepartmentRow, wave: Wave | null, target: number): CardNote {
  if (row.climate.kind === 'protected' && wave) return { kind: 'protected', wave: wave.code }
  if (row.climate.kind === 'score' && wave && row.climate.mean < target) {
    return { kind: 'lowest', key: row.climate.lowest.key, score: row.climate.lowest.score, wave: wave.code }
  }
  if (row.supervisors && row.supervisors.length > 0) return { kind: 'supervisor', names: row.supervisors }
  return { kind: 'none' }
}
