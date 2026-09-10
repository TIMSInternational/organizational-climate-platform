import { canDistribute } from '../../api/surveyInvitationCopy'
import type { SurveyRow, SurveySection } from './model'

/** The design's stacking order: what is open first, what is archived last. */
export const SECTION_ORDER: readonly SurveySection[] = ['open', 'upcoming', 'closed', 'archived']

export function sectionOf(status: string): SurveySection {
  if (status === 'active') return 'open'
  if (status === 'closed') return 'closed'
  if (status === 'archived') return 'archived'
  return 'upcoming'
}

function time(iso: string): number {
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Sort by section, then by date within it: the open survey closing soonest first,
 * drafts and scheduled ones starting soonest first, closed and archived ones newest
 * first (the latest wave sits under the open one, which is how the cycle reads).
 * The old page ordered by creation date, which put an archived rehearsal copy at the
 * top — the defect the triage named.
 */
export function orderSurveys(rows: readonly SurveyRow[]): SurveyRow[] {
  const rank = (row: SurveyRow) => SECTION_ORDER.indexOf(sectionOf(row.status))
  return [...rows].sort((a, b) => {
    const bySection = rank(a) - rank(b)
    if (bySection !== 0) return bySection
    const section = sectionOf(a.status)
    if (section === 'open') return time(a.endDate) - time(b.endDate)
    if (section === 'upcoming') return time(a.startDate) - time(b.startDate)
    return time(b.endDate) - time(a.endDate)
  })
}

export interface SurveySectionRows {
  section: SurveySection
  rows: SurveyRow[]
}

/** The ordered rows, cut into the non-empty sections in `SECTION_ORDER`. */
export function groupBySection(rows: readonly SurveyRow[]): SurveySectionRows[] {
  const ordered = orderSurveys(rows)
  return SECTION_ORDER.map((section) => ({
    section,
    rows: ordered.filter((row) => sectionOf(row.status) === section),
  })).filter((entry) => entry.rows.length > 0)
}

export type PrimaryActionKind = 'distribution' | 'results' | 'open'

export interface PrimaryAction {
  kind: PrimaryActionKind
  to: string
}

/** The two capabilities a row's action depends on — `auth/viewerCapabilities.ts`. */
export interface RowCapabilities {
  canAuthorSurveys: boolean
  canOpenResults: (survey: { companyId: string }) => boolean
}

/**
 * Exactly one action per row, by status, and only one the server would answer:
 * an open survey is distributed (`canDistribute` is the detail page's own predicate,
 * and distribution is an author's action), a closed one is read
 * (`GET /surveys/{id}/results`, gated by `canOpenResults`), a draft or scheduled one
 * is opened, and an archived one offers nothing — its name still links to the
 * detail page, where it can be restored. When the viewer lacks the capability for
 * the natural action, the row falls back to opening, which every role may do today.
 */
export function primaryActionFor(row: SurveyRow, capabilities: RowCapabilities): PrimaryAction | null {
  const open: PrimaryAction = { kind: 'open', to: `/surveys/${row.id}` }
  const results: PrimaryAction = { kind: 'results', to: `/surveys/${row.id}/results` }
  switch (sectionOf(row.status)) {
    case 'open':
      if (canDistribute(row.status) && capabilities.canAuthorSurveys) {
        return { kind: 'distribution', to: `/surveys/${row.id}/distribution` }
      }
      return capabilities.canOpenResults(row) ? results : open
    case 'closed':
      return capabilities.canOpenResults(row) ? results : open
    case 'upcoming':
      return open
    case 'archived':
      return null
  }
}
