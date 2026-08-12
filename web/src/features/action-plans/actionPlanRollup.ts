import type { ActionPlan } from './api/actionPlans'

/**
 * The four readings in the Action Plans KPI strip, and the one per-row judgement
 * the table needs, derived from the listing the page already fetched.
 *
 * ## Why a separate module rather than four `.filter()` calls in the page
 *
 * Two of these are calendar arithmetic and calendar arithmetic in this repository
 * has already been wrong once. `ActionPlansListPage` counted a plan overdue with
 * `new Date(plan.dueDate) < new Date()`, and `dueDate` is a *calendar date* the
 * API sends as UTC midnight (see `api/actionPlans.ts`'s `normalizeDueDate`, and
 * the `timeZone: 'UTC'` formatting in `components/ActionPlanList.tsx`). So a plan
 * due **today** compares as already past its date from 00:00:01 UTC onward — for a
 * reader in Bogotá, from 7pm the evening before. A strip that tells an admin to
 * chase a plan that is due today is telling them something false.
 *
 * Pulled out here so the rule is stated once, tested directly, and the page stays
 * a page.
 *
 * ## The day scale these functions compare on
 *
 * Both sides are reduced to a **day number** — days since the epoch — before
 * anything is compared, so no comparison ever depends on a time of day:
 *
 * - the due date contributes the UTC day it names, because that is the calendar
 *   date the user picked and the one rendered back to them;
 * - "today" contributes the viewer's *local* calendar date, re-expressed on the
 *   same scale. Local, not UTC: overdue is a judgement about the reader's day.
 */

/** Milliseconds in a day. Due dates are whole days, so this never needs a leap second. */
const MS_PER_DAY = 86_400_000

/**
 * Statuses that mean the plan is finished and no longer wants a date.
 *
 * `cancelled` sits beside `completed` deliberately: `ActionPlanValidation.ValidStatuses`
 * carries both, a cancelled plan is not work in flight, and counting one as overdue
 * would put permanent red on a strip nobody can clear.
 */
const CLOSED_STATUSES: ReadonlySet<string> = new Set(['completed', 'cancelled'])

/** Whether a plan is still work in flight. */
export function isOpenPlan(status: string): boolean {
  return !CLOSED_STATUSES.has(status)
}

/** The day number a UTC-midnight due date names, or `null` when it is unparseable. */
function dueDay(dueDate: string): number | null {
  const parsed = Date.parse(dueDate)
  return Number.isNaN(parsed) ? null : Math.floor(parsed / MS_PER_DAY)
}

/** Today, in the viewer's own calendar, on the same day scale as `dueDay`. */
function todayDay(now: Date): number {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY)
}

/**
 * Whether an open plan is past due.
 *
 * A plan due today is **not** past due, which is the whole reason this is a
 * function. A closed plan is never past due whatever its date says: delivered late
 * is delivered, and flagging it would send someone to chase finished work.
 *
 * ## Why the recorded status is consulted at all
 *
 * `overdue` is one of `ActionPlanValidation.ValidStatuses` — the C# array is
 * `["not_started", "in_progress", "completed", "overdue", "cancelled"]` — and
 * nothing under `src/` ever computes it, so it arrives only because a client sent
 * it on a PUT. That makes it a *statement*, and a plan can therefore be marked
 * overdue while its date is still in the future.
 *
 * Reading the date alone left the same row saying two things at once: a Status
 * badge reading "Overdue" while the strip above counted the plan under ON TRACK,
 * "still inside their date". Whichever of the two a reader believes, one of them
 * was lying. Honouring the status makes the badge and the strip agree, and it errs
 * the safe way — towards showing work as needing attention rather than hiding it.
 */
export function isPastDue(plan: Pick<ActionPlan, 'status' | 'dueDate'>, now: Date): boolean {
  if (!isOpenPlan(plan.status)) return false
  if (plan.status === 'overdue') return true
  const due = dueDay(plan.dueDate)
  return due !== null && due < todayDay(now)
}

/** Whether a due date falls in the viewer's current calendar month. */
function isDueThisMonth(dueDate: string, now: Date): boolean {
  const parsed = Date.parse(dueDate)
  if (Number.isNaN(parsed)) return false
  const due = new Date(parsed)
  return due.getUTCFullYear() === now.getFullYear() && due.getUTCMonth() === now.getMonth()
}

export interface ActionPlanRollup {
  /** Plans still in flight — neither completed nor cancelled. */
  open: number
  /** Open plans whose date has not gone by. */
  onTrack: number
  /** Open plans past their due date. */
  atRisk: number
  /** Plans marked completed. Cancelled ones are counted in neither this nor `open`. */
  completed: number
  /** Open plans due before this month is out, including the ones already past due. */
  dueThisMonth: number
}

/**
 * Counts every tile in one pass over the listing.
 *
 * `now` is a parameter rather than read from the clock inside, so a test can state
 * which day it is instead of arranging one.
 */
export function rollUpActionPlans(plans: readonly ActionPlan[], now: Date): ActionPlanRollup {
  const rollup: ActionPlanRollup = { open: 0, onTrack: 0, atRisk: 0, completed: 0, dueThisMonth: 0 }

  for (const plan of plans) {
    if (plan.status === 'completed') rollup.completed += 1
    if (!isOpenPlan(plan.status)) continue

    rollup.open += 1
    if (isPastDue(plan, now)) rollup.atRisk += 1
    else rollup.onTrack += 1
    if (isDueThisMonth(plan.dueDate, now)) rollup.dueThisMonth += 1
  }

  return rollup
}
