import { isOpenPlan, isPastDue } from '../actionPlanRollup'
import type { PlanGroup, PlanRow } from './model'

/**
 * Every derived reading of the Planes de Acción screen, as pure functions of the rows
 * and the day — the groups, the tile counts, the days to each due date, the timeline.
 * Nothing here is typed as a figure; the page prints what these return.
 *
 * ## The day scale
 *
 * A due date is a CALENDAR day the API sends as UTC midnight (`normalizeDueDate` in
 * `api/actionPlans.ts`), and `asOf` is the reader's own calendar day. Both are reduced
 * to a day number before anything is compared, exactly as `actionPlanRollup.ts` does, so
 * no reading depends on the time of day: a plan due today is due "hoy" until midnight,
 * never "vencido".
 */

const MS_PER_DAY = 86_400_000

/** The order the page draws the groups in: what needs chasing first, closed work last. */
export const GROUP_ORDER: readonly PlanGroup[] = ['overdue', 'inProgress', 'notStarted', 'completed', 'cancelled']

/** The UTC day number a due date names, or `null` when it is unparseable. */
function dueDay(dueDate: string): number | null {
  const parsed = Date.parse(dueDate)
  return Number.isNaN(parsed) ? null : Math.floor(parsed / MS_PER_DAY)
}

/** `YYYY-MM-DD` on the same scale — a date-only ISO string parses as UTC midnight. */
function asOfDay(asOf: string): number {
  return Math.floor(Date.parse(asOf) / MS_PER_DAY)
}

/** `asOf` as the local-midnight `Date` `actionPlanRollup.isPastDue` reads its day from. */
function asOfDate(asOf: string): Date {
  const [year, month, day] = asOf.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** Whole days from `asOf` to the plan's due day; negative once it has gone by. */
export function daysToDue(row: Pick<PlanRow, 'dueDate'>, asOf: string): number | null {
  const due = dueDay(row.dueDate)
  return due === null ? null : due - asOfDay(asOf)
}

/** Whether the due day falls in the calendar month of `asOf`. */
export function isDueThisMonth(row: Pick<PlanRow, 'dueDate'>, asOf: string): boolean {
  const parsed = Date.parse(row.dueDate)
  if (Number.isNaN(parsed)) return false
  const due = new Date(parsed)
  const [year, month] = asOf.split('-').map(Number)
  return due.getUTCFullYear() === year && due.getUTCMonth() === month - 1
}

/**
 * The group a plan is listed under.
 *
 * Closed statuses first — a cancelled or completed plan is never overdue, however old
 * its date (`actionPlanRollup.isPastDue`). An open plan past its date is overdue whatever
 * its status says; `in_progress` is the one status only a progress update writes, so it
 * is what "en marcha" means; every other open status is "no iniciado".
 */
export function groupOf(row: Pick<PlanRow, 'status' | 'dueDate'>, asOf: string): PlanGroup {
  if (row.status === 'cancelled') return 'cancelled'
  if (row.status === 'completed') return 'completed'
  if (isPastDue(row, asOfDate(asOf))) return 'overdue'
  if (row.status === 'in_progress') return 'inProgress'
  return 'notStarted'
}

function byDueThenName(a: PlanRow, b: PlanRow): number {
  const byDue = (dueDay(a.dueDate) ?? Number.MAX_SAFE_INTEGER) - (dueDay(b.dueDate) ?? Number.MAX_SAFE_INTEGER)
  return byDue !== 0 ? byDue : a.name.localeCompare(b.name)
}

/** Every group, each ordered by due date — "ordenados por fecha de vencimiento". */
export function groupRows(rows: readonly PlanRow[], asOf: string): Record<PlanGroup, PlanRow[]> {
  const groups: Record<PlanGroup, PlanRow[]> = {
    overdue: [],
    inProgress: [],
    notStarted: [],
    completed: [],
    cancelled: [],
  }
  for (const row of rows) groups[groupOf(row, asOf)].push(row)
  for (const group of GROUP_ORDER) groups[group].sort(byDueThenName)
  return groups
}

export interface ListSummary {
  total: number
  /** Neither completed nor cancelled. */
  open: number
  cancelled: number
  completed: number
  /** Open plans due before this month is out, the ones already past due included. */
  dueThisMonth: number
  /** Open plans with a progress update on record — `in_progress`, the status one writes. */
  withProgress: number
  /** Open plans past their date. */
  overdue: number
}

export function summarize(rows: readonly PlanRow[], asOf: string): ListSummary {
  const summary: ListSummary = { total: rows.length, open: 0, cancelled: 0, completed: 0, dueThisMonth: 0, withProgress: 0, overdue: 0 }
  for (const row of rows) {
    if (row.status === 'cancelled') summary.cancelled += 1
    if (row.status === 'completed') summary.completed += 1
    if (!isOpenPlan(row.status)) continue
    summary.open += 1
    if (row.status === 'in_progress') summary.withProgress += 1
    const group = groupOf(row, asOf)
    if (group === 'overdue') summary.overdue += 1
    if (group === 'overdue' || isDueThisMonth(row, asOf)) summary.dueThisMonth += 1
  }
  return summary
}

function openRowsByDue(rows: readonly PlanRow[]): PlanRow[] {
  return rows.filter((row) => isOpenPlan(row.status)).sort(byDueThenName)
}

export interface FindingReading {
  /** Open plans that name a finding. */
  withFinding: number
  open: number
  /** The dimensions those findings sit on, once each, in due-date order. */
  dimensionKeys: string[]
}

export function findingReading(rows: readonly PlanRow[]): FindingReading {
  const open = openRowsByDue(rows)
  const withFinding = open.filter((row) => row.finding !== null)
  const dimensionKeys = [...new Set(withFinding.map((row) => row.finding?.dimensionKey ?? ''))].filter(Boolean)
  return { withFinding: withFinding.length, open: open.length, dimensionKeys }
}

export interface OwnerReading {
  /** Open plans with no owner. */
  unassigned: number
  open: number
}

export function ownerReading(rows: readonly PlanRow[]): OwnerReading {
  const open = openRowsByDue(rows)
  return { unassigned: open.filter((row) => row.ownerName === null).length, open: open.length }
}

/** The earliest-due open plan that is past its date, or `null`. */
export function firstOverdue(rows: readonly PlanRow[], asOf: string): PlanRow | null {
  return openRowsByDue(rows).find((row) => groupOf(row, asOf) === 'overdue') ?? null
}

export interface TimelinePoint {
  id: string
  name: string
  dueDate: string
  /** Days from `asOf`; negative once past. */
  days: number
  /** Position on the axis, 0 (today) to 1 (the last due date). */
  position: number
  /** Past due, or due before this month is out — drawn red, and the red run reaches it. */
  urgent: boolean
}

export interface DueTimeline {
  points: TimelinePoint[]
  /** Days to the nearest due date that has not gone by, or `null` when none is ahead. */
  firstAhead: number | null
}

/**
 * "Cuándo vence cada plan": every open plan on one axis from today to the last due
 * date. A plan already past due sits on today's mark rather than off the left edge.
 */
export function dueTimeline(rows: readonly PlanRow[], asOf: string): DueTimeline {
  const dated = openRowsByDue(rows)
    .map((row) => ({ row, days: daysToDue(row, asOf) }))
    .filter((entry): entry is { row: PlanRow; days: number } => entry.days !== null)
  const span = Math.max(1, ...dated.map((entry) => entry.days))
  const points = dated.map(({ row, days }) => ({
    id: row.id,
    name: row.name,
    dueDate: row.dueDate,
    days,
    position: Math.min(1, Math.max(0, days / span)),
    urgent: days < 0 || isDueThisMonth(row, asOf),
  }))
  const ahead = points.filter((point) => point.days >= 0)
  return { points, firstAhead: ahead.length > 0 ? ahead[0].days : null }
}

export interface PlanFilters {
  /** Narrowed against the title. */
  q: string
  /** One of `ACTION_PLAN_STATUSES`, or `''` for every state. */
  status: string
  /** One of `ACTION_PLAN_PRIORITIES`, or `''` for every priority. */
  priority: string
}

export const EMPTY_PLAN_FILTERS: PlanFilters = { q: '', status: '', priority: '' }

/**
 * The three filters, all narrowed here: `ListAsync` returns the company's whole set in
 * one response (no paging), and the page needs every state at once to draw its groups,
 * so the status filter no longer travels on the wire.
 */
export function applyFilters(rows: readonly PlanRow[], filters: PlanFilters): PlanRow[] {
  const needle = filters.q.trim().toLocaleLowerCase()
  return rows.filter(
    (row) =>
      (!filters.status || row.status === filters.status) &&
      (!filters.priority || row.priority === filters.priority) &&
      (!needle || row.name.toLocaleLowerCase().includes(needle)),
  )
}

export function isFiltering(filters: PlanFilters): boolean {
  return filters.q.trim() !== '' || filters.status !== '' || filters.priority !== ''
}

/** How many characters one line of a timeline label holds at the axis's 10px. */
export const TIMELINE_LABEL_CHARS = 26

/**
 * A plan's name as the timeline prints it under its date: the whole title, broken at a word
 * onto at most two lines of `chars` characters. Only a title longer than two lines loses its
 * end, and then to an ellipsis on the second line, never a cut on the first.
 *
 * The artboard's labels are hand-shortened ("Carga · Operaciones"): half of each is the
 * finding's dimension, which no endpoint carries (`sampleModel.ts`), so the label is the
 * plan's own title, printed in full wherever two lines hold it.
 */
export function timelineLabelLines(name: string, chars: number = TIMELINE_LABEL_CHARS): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= chars || current === '') {
      current = candidate
      continue
    }
    lines.push(current)
    current = word
  }
  if (current) lines.push(current)
  const clip = (line: string) => (line.length > chars ? `${line.slice(0, chars - 1).trimEnd()}…` : line)
  if (lines.length <= 2) return lines.map(clip)
  return [clip(lines[0]), `${lines.slice(1).join(' ').slice(0, chars - 1).trimEnd()}…`]
}
