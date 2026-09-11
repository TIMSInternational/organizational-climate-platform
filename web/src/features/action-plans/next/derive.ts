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

/** A no-break space: the two words either side of it wrap as one. */
const NBSP = '\u00A0'
/** A lowercase word of one to three letters: "la", "de", "en", "con", "y", "the", "of". */
const SHORT_WORD = /^\p{Ll}{1,3}$/u

/**
 * A plan's title with each short lowercase word ("la", "de", "en", "con", "y") tied to the word
 * after it by a no-break space, so a line that stops at a word boundary never ends on one.
 *
 * The timeline labels and the Seguimiento tile show the first line of a title and hide the rest
 * (it wraps at word boundaries inside one line box). Untied, "Reuniones abiertas con la
 * dirección" stops at "Reuniones abiertas con la" and "Reducir la carga de trabajo en
 * Operaciones" at "…de trabajo en": each reads as a cut rather than a phrase. Tied, the line
 * stops before the short word: "Reuniones abiertas", "Reducir la carga de trabajo". It is the
 * rule Spanish typesetting keeps for short words at a line end. The words printed are the same;
 * the plain title still reaches `title` and the screen reader.
 */
export function bindShortWords(text: string): string {
  const words = text.split(/\s+/).filter(Boolean)
  return words
    .map((word, index) => (index === words.length - 1 ? word : word + (SHORT_WORD.test(word) ? NBSP : ' ')))
    .join('')
}

export type TimelineAnchor = 'start' | 'middle' | 'end'

/** Where one plan's label sits under its dot: how it hangs from the dot, and how wide it may run. */
export interface TimelineLabelSlot {
  anchor: TimelineAnchor
  /** Pixels the label may take before it would meet its neighbour's; it stops after the last whole word that fits. */
  room: number
}

/** Room kept clear between two labels. */
const LABEL_GAP = 8
/** Half of today's own label ("10 sept" over "hoy"), which the first plan's label must clear. */
const TODAY_HALF = 28
/** A dot this close to an end of the axis hangs its label inward rather than centring it. */
const EDGE_ANCHOR = 60

/**
 * The one-line label under each plan's dot on "Cuándo vence cada plan", as the ActionPlansList
 * artboard draws them: one line each, no stagger, so the drawing keeps the artboard's 64px.
 *
 * Each label is the plan's own title (the artboard's hand-shortened "Carga · Operaciones" is
 * half finding dimension, which no endpoint carries — `sampleModel.ts`). It prints whole where
 * the axis leaves it room and stops after its last whole word where a neighbour's label begins,
 * so a wide screen shows more of each title and a narrow one less, never two labels over each
 * other and never a word cut in half.
 *
 * Laid out left to right: a centred label takes the same room either side of its dot, up to
 * the end of the label before it and the midpoint to the dot after it; a label at an end of
 * the axis hangs inward and takes the room on that side.
 *
 * `xs` are the dots' x positions in pixels, ascending; `width` is the drawing's.
 */
export function timelineLabelSlots(xs: readonly number[], axisStart: number, axisEnd: number, width: number): TimelineLabelSlot[] {
  let leftLimit = axisStart + TODAY_HALF + LABEL_GAP
  return xs.map((x, index) => {
    const next = xs[index + 1]
    const rightLimit = next === undefined ? width : (x + next) / 2 - LABEL_GAP / 2
    const anchor: TimelineAnchor = x < axisStart + EDGE_ANCHOR ? 'start' : x > axisEnd - EDGE_ANCHOR ? 'end' : 'middle'
    const room =
      anchor === 'start'
        ? rightLimit - Math.max(x, leftLimit)
        : anchor === 'end'
          ? x - leftLimit
          : 2 * Math.min(x - leftLimit, rightLimit - x)
    const clamped = Math.max(0, Math.floor(room))
    const rightEdge = anchor === 'start' ? x + clamped : anchor === 'end' ? x : x + clamped / 2
    leftLimit = rightEdge + LABEL_GAP
    return { anchor, room: clamped }
  })
}
