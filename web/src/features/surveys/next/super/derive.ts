import { waveCode } from '../../../dashboard/next/compose'
import { sectionOf } from '../list/derive'
import type { SurveyRow, SurveySection } from '../list/model'
import { calendarDayOf, todayCalendarDay } from '../../../../lib/calendarDay'
import { daysBetween } from '../../../dashboard/next/derive'

/**
 * The pure readings behind the super administrator's Todas las Encuestas (`/surveys`): the
 * platform-wide list `GET /surveys` answers that role (no company predicate,
 * `api/surveys.ts`), cut by company and summarised per section. Every sentence the page
 * prints over a section is derived here from the rows it sits over — never typed.
 */

/** The company filter's "every company" value. */
export const ALL_COMPANIES = ''

export function forCompany(rows: readonly SurveyRow[], companyId: string): SurveyRow[] {
  return companyId === ALL_COMPANIES ? [...rows] : rows.filter((row) => row.companyId === companyId)
}

/** How many companies the rows span — "12 encuestas en 2 empresas". */
export function companyCount(rows: readonly SurveyRow[]): number {
  return new Set(rows.map((row) => row.companyId)).size
}

/**
 * The wave every open survey belongs to, when they all share one ("La ola Q4 de cada
 * empresa"); `null` when they do not, or when a title names no wave.
 */
export function sharedOpenWave(rows: readonly SurveyRow[]): string | null {
  const open = rows.filter((row) => sectionOf(row.status) === 'open')
  if (open.length === 0) return null
  // `waveCode` falls back to the whole title when it names no wave; that is not a code.
  const codeOf = (row: SurveyRow) => {
    const title = (row.title ?? '').trim()
    const code = waveCode(title, '')
    return code !== '' && code !== title ? code : ''
  }
  const codes = new Set(open.map(codeOf))
  const [only] = [...codes]
  return codes.size === 1 && only !== '' ? only : null
}

export type UpcomingKind = 'drafts' | 'scheduled' | 'mixed'

/** What the not-yet-open block holds, for its heading: "Borradores", "Programadas", or both. */
export function upcomingKind(rows: readonly SurveyRow[]): UpcomingKind {
  const upcoming = rows.filter((row) => sectionOf(row.status) === 'upcoming')
  if (upcoming.every((row) => row.status === 'draft')) return 'drafts'
  if (upcoming.every((row) => row.status === 'scheduled')) return 'scheduled'
  return 'mixed'
}

export interface DraftsNote {
  /** The one company every draft belongs to, or `null` when they span several. */
  companyId: string | null
  /** Every draft carries exactly one question. */
  oneQuestion: boolean
  /** The earliest draft's creation instant. */
  since: string
}

/** "Todos de Acme, de una sola pregunta, desde el 8 de agosto" — each clause only when true. */
export function draftsNote(rows: readonly SurveyRow[]): DraftsNote | null {
  const drafts = rows.filter((row) => sectionOf(row.status) === 'upcoming')
  if (drafts.length === 0) return null
  const companies = new Set(drafts.map((row) => row.companyId))
  const since = [...drafts].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0].createdAt
  return {
    companyId: companies.size === 1 ? drafts[0].companyId : null,
    oneQuestion: drafts.every((row) => row.questionCount === 1),
    since,
  }
}

export interface ClosedNote {
  /** The response count every closed survey shares, or `null` when they differ. */
  each: number | null
  /** No closed survey carries an invitation list, so no participation can be computed. */
  noInviteLists: boolean
}

export function closedNote(rows: readonly SurveyRow[]): ClosedNote | null {
  const closed = rows.filter((row) => sectionOf(row.status) === 'closed')
  if (closed.length === 0) return null
  const counts = new Set(closed.map((row) => row.responseCount))
  return {
    each: counts.size === 1 ? closed[0].responseCount : null,
    noInviteLists: closed.every((row) => row.targetAudienceCount === null),
  }
}

/**
 * A closed survey's place among its own company's closed surveys, oldest first — 1 is the
 * company's first measurement. Printed when the climate move is not available (a company
 * whose trends were not read, or a wave the floor withheld): the place is a fact of the list
 * itself, where a move would need the trends payload.
 */
export function closedOrdinal(row: SurveyRow, rows: readonly SurveyRow[]): number {
  const own = rows
    .filter((candidate) => candidate.companyId === row.companyId && sectionOf(candidate.status) === 'closed')
    .sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate))
  return own.findIndex((candidate) => candidate.id === row.id) + 1
}

/** Companies with at least one closed survey — whose climate trends are worth reading. */
export function companiesWithClosed(rows: readonly SurveyRow[]): string[] {
  return [...new Set(rows.filter((row) => sectionOf(row.status) === 'closed').map((row) => row.companyId))]
}

/**
 * Whole days until a survey's close, counted calendar day to calendar day: today in the
 * reader's calendar (`todayCalendarDay`) against the close's own day (`calendarDayOf`).
 * Acme's open survey closes at 18:21 UTC on 26 Sep; on 10 Sep that is 16 days, where the
 * count against the full instant rounded 16.76 up to 17.
 */
export function daysLeft(endDate: string, today: string = todayCalendarDay()): number {
  return daysBetween(today, calendarDayOf(endDate))
}

/** The artboard's block order: what is open, what closed, the drafts, and the archive last. */
export const SUPER_SECTIONS: readonly SurveySection[] = ['open', 'closed', 'upcoming', 'archived']

/**
 * The platform list cut into its blocks, "ordenadas por estado y fecha": the blocks in
 * `SUPER_SECTIONS` order and, inside each, the latest first — by close, then by creation.
 * The SuperSurveysList artboard reads that way in every block: Meridiano's wave closing
 * 10 Oct above Acme's closing 26 Sep, the closed waves newest first, the drafts newest
 * first. (The company administrator's list runs its open block closing-soonest; with one
 * company's surveys that is one row.)
 */
export function groupSuperSections(rows: readonly SurveyRow[]): { section: SurveySection; rows: SurveyRow[] }[] {
  const latestFirst = (a: SurveyRow, b: SurveyRow) =>
    Date.parse(b.endDate) - Date.parse(a.endDate) || Date.parse(b.createdAt) - Date.parse(a.createdAt)
  return SUPER_SECTIONS.map((section) => ({
    section,
    rows: rows.filter((row) => sectionOf(row.status) === section).sort(latestFirst),
  })).filter((entry) => entry.rows.length > 0)
}
