import { canDistribute } from '../../api/surveyInvitationCopy'
import { WHOLE_COMPANY_KEY, type ClimateTrendsResponse } from '../../api/climateTrends'
import type { SurveyStatusFacet } from '../../surveyListView'
import { waveCode } from '../../../dashboard/next/compose'
import { printedMove } from '../../../dashboard/next/derive'
import { withoutArchived } from '../trends/derive'
import type { SurveyRow, SurveySection, WaveReading } from './model'

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
 * detail page. When the viewer lacks the capability for the natural action, the row
 * falls back to opening, which every role may do today.
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

export type MenuItemKind = 'view' | 'duplicate'

/**
 * What the row's "···" menu offers, beyond its one primary action: the survey itself
 * (every role that sees the row may open it), and a duplicate for whoever may author —
 * `POST /surveys/{id}/duplicate` is `CanAdminister` (`SurveyEndpoints.cs:954-956`) and
 * works from any status, which is how an archived survey is run again. Nothing else:
 * an archived survey has no way back (`SurveyStatuses.cs:72`, `[Archived] = []`), so the
 * menu offers no "restore", and a status change from a list, one click from a mistake,
 * stays on the detail page where its confirmation lives.
 */
export function menuItemsFor(capabilities: Pick<RowCapabilities, 'canAuthorSurveys'>): MenuItemKind[] {
  return capabilities.canAuthorSurveys ? ['view', 'duplicate'] : ['view']
}

/**
 * The facets the chip row draws: "All", then every status that has a survey — plus the
 * one the reader chose, even at zero, so the pressed chip never vanishes under them.
 * The canvas draws Todas · Activas · Cerradas · Archivadas and no empty "Borradores · 0".
 */
export function visibleFacets(facets: readonly SurveyStatusFacet[], selected: string): SurveyStatusFacet[] {
  return facets.filter((facet) => facet.count > 0 || facet.status === selected)
}

function mean(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => typeof value === 'number')
  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0) / present.length
}

/**
 * Each closed survey's climate reading against the closed survey before it — the
 * "+0,29 frente a Q2" under a closed row's date — from `GET /surveys/climate-trends`,
 * the same reduction the Panel de Control's CLIMA tile and Clima en el tiempo print, so
 * the three screens say the same number.
 *
 * The climate of a wave is the mean of its six whole-company dimension scores. An
 * archived survey is not a wave (`withoutArchived`). A wave the floor withheld for the
 * whole company has no reading, and neither does the wave after it: a difference beside
 * one disclosed end would reconstruct the other.
 */
export function waveReadings(trends: ClimateTrendsResponse): Map<string, WaveReading> {
  const window = withoutArchived(trends)
  const company = window.groups.find((group) => group.key === WHOLE_COMPANY_KEY) ?? window.groups[0]
  const means = window.surveys.map((survey, index) => {
    const point = company?.points[index]
    return survey.isSuppressed || point === undefined || point.isSuppressed ? null : mean(point.scores)
  })
  const readings = new Map<string, WaveReading>()
  window.surveys.forEach((survey, index) => {
    const previous = window.surveys[index - 1]
    const here = means[index] ?? null
    const before = index > 0 ? (means[index - 1] ?? null) : null
    readings.set(survey.surveyId, {
      first: index === 0,
      // At the two decimals the row prints, as the CLIMA tile and Clima en el tiempo do: the
      // difference of the printed readings, never the rounding of the raw difference.
      delta: here !== null && before !== null ? printedMove(here, before, 2) : null,
      previousCode: previous ? waveCode(previous.title, previous.surveyId.slice(0, 8)) : null,
      completedCount: survey.completedCount,
    })
  })
  return readings
}

/**
 * "Cada una con 24 respuestas · 100 % completadas" over the closed section: the shared
 * count when every closed survey has the same one, and the completed share when the
 * trends payload has a completed count for every closed row. `null` when neither holds.
 */
export function closedSummary(
  rows: readonly SurveyRow[],
  readings: ReadonlyMap<string, WaveReading>,
): { each: number | null; completion: number | null } | null {
  if (rows.length === 0) return null
  const counts = new Set(rows.map((row) => row.responseCount))
  const each = counts.size === 1 ? rows[0].responseCount : null
  const completed = rows.map((row) => readings.get(row.id)?.completedCount)
  const responses = rows.reduce((sum, row) => sum + row.responseCount, 0)
  const completion =
    completed.every((count): count is number => typeof count === 'number') && responses > 0
      ? (completed.reduce((sum, count) => sum + count, 0) / responses) * 100
      : null
  return each === null && completion === null ? null : { each, completion }
}
