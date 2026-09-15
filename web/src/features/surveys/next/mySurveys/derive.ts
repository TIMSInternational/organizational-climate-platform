import type { CompanyScope } from '../../../../company-context'
import { estimatedMinutes, isUnderAMinute } from '../../respondEstimate'
import type { MySurveyListItem } from '../../api/surveys'

/**
 * Pure rules behind the MySurveys artboards (`/surveys/my`): which group a row belongs to,
 * how long is left, and whether this reader belongs to a company at all.
 *
 * Pure so the arithmetic is tested without a DOM — happy-dom computes no layout and the
 * view below only draws.
 */

/** One row of `GET /surveys/my`, as the page reads it. */
export interface MySurveyRow {
  id: string
  /** The survey's own title, already resolved for the locale; `null` when it has none. */
  name: string | null
  questionCount: number
  /** `estimatedMinutes(questionCount)` — computed, never typed. */
  minutes: number
  /** Whether the estimate is best said as "under a minute" rather than as a number. */
  underAMinute: boolean
  /** ISO timestamp the survey stops accepting answers. */
  closesAt: string
  /**
   * Whole calendar days from today to the closing day, or `null` for an unparseable date,
   * which draws no chip at all rather than a guessed countdown. Negative once past.
   */
  daysLeft: number | null
}

export interface MySurveyGroups {
  /** Still answerable, soonest to close first — the server's own order, kept. */
  open: MySurveyRow[]
  /** The answering window has already ended. Empty for every payload the API can serve today. */
  closed: MySurveyRow[]
}

const MS_PER_DAY = 86_400_000

/** Days from today to the closing day, past which the chip goes amber and the row lights up. */
export const CLOSING_SOON_DAYS = 7

/**
 * Whole calendar days from `now` until the survey's closing day, or `null` when the date
 * does not parse.
 *
 * Counted in **UTC calendar days**, not in elapsed milliseconds, for the reason
 * `lib/calendarDay.ts` gives at length: `EndDate` is a calendar day stored as a UTC
 * midnight, so `2026-09-12T00:00:00Z` means "the twelfth" and not an instant. Dividing the
 * raw difference by a day would make "closes today" flip to "1 day left" at any hour except
 * midnight, and would disagree with the date printed beside it.
 */
export function daysUntilClose(endDate: string, now: number): number | null {
  const end = Date.parse(endDate)
  if (Number.isNaN(end)) return null
  return Math.floor(end / MS_PER_DAY) - Math.floor(now / MS_PER_DAY)
}

function toRow(survey: MySurveyListItem, now: number): MySurveyRow {
  return {
    id: survey.id,
    name: survey.title,
    questionCount: survey.questionCount,
    // `respondEstimate`, the module Home and the respond page both read, rather than a
    // second ratio here: two spellings of "6 preguntas · unos 4 minutos" for one survey is
    // how the two screens drift apart.
    minutes: estimatedMinutes(survey.questionCount),
    underAMinute: isUnderAMinute(survey.questionCount),
    closesAt: survey.endDate,
    daysLeft: daysUntilClose(survey.endDate, now),
  }
}

/**
 * The two groups, from one clock reading.
 *
 * `now` is taken once for the whole render so every row agrees about which day today is —
 * two `Date.now()` calls either side of a midnight tick would put one row in the open group
 * and the next in the closed one.
 *
 * An unparseable date is treated as open: a survey the reader might still owe an answer to
 * is the safer side of that guess.
 */
export function groupMySurveys(surveys: readonly MySurveyListItem[], now: number): MySurveyGroups {
  const rows = surveys.map((survey) => toRow(survey, now))
  return {
    open: rows.filter((row) => row.daysLeft === null || row.daysLeft >= 0),
    closed: rows.filter((row) => row.daysLeft !== null && row.daysLeft < 0),
  }
}

/** Whether the row closes soon enough to light up and wear the amber chip. */
export function isClosingSoon(row: MySurveyRow): boolean {
  return row.daysLeft !== null && row.daysLeft <= CLOSING_SOON_DAYS
}

/**
 * **Whether this reader's own account belongs to no company** — the MySurveysSinEmpresa
 * artboard's condition.
 *
 * Two roles reach it, and the page tells them apart:
 *
 * - A **super administrator**. `User.CompanyId` is NULL for a global super_admin since
 *   #191, so `GET /surveys/my` returns an empty list for them by construction
 *   (`SurveyEndpoints.ListMineAsync`) and `navSections.ts` does not offer them the entry.
 *   `resolveCompanyScope` reports their status as `needs-selection` or `ready` depending on
 *   which tenant they are *administering*, which is a different question from which tenant
 *   they *belong to* — hence `isSuperAdmin` and not `status`.
 * - **Anyone else whose token names no tenant**, which `resolveCompanyScope` calls
 *   `no-company`.
 */
export function belongsToNoCompany(scope: CompanyScope): boolean {
  return scope.isSuperAdmin || scope.status === 'no-company'
}

const ROLE_LABEL_KEY: Readonly<Record<string, string>> = {
  employee: 'users.employee',
  leader: 'users.leader',
  supervisor: 'users.supervisor',
}

/**
 * The catalogue key naming the reader's role, or `null` for one this page does not know —
 * which contributes no word to the eyebrow rather than a guessed one. The same three roles
 * `EmployeeHomeView` names, because the two screens print the same eyebrow.
 */
export function roleLabelKey(role: string | undefined): string | null {
  if (role === undefined) return null
  return ROLE_LABEL_KEY[role] ?? null
}
