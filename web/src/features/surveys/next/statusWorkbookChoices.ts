/**
 * Which surveys the status workbook can hold, and in which order.
 *
 * Its own module rather than a second export from `StatusWorkbookButton.tsx`: a file that
 * exports both a component and a function breaks fast refresh, which `only-export-components`
 * reports as a lint warning, and this repository's lint budget is a hard ceiling.
 */

/** One pickable sheet: a survey that has been distributed, so it has a roster to report. */
export interface StatusWorkbookChoice {
  id: string
  title: string | null
  status: string
}

/**
 * The sheets the workbook will have, in the order it will have them.
 *
 * Mirrors the server's own rule deliberately — everything but a draft
 * (`s.Status != SurveyStatuses.Draft` in `SurveyParticipationEndpoints.ExportCompanyAsync`),
 * ordered by creation — because this list decides what "all of them" means. A UI list narrower
 * than the server's would send explicit ids for a partial pick and quietly leave out a survey
 * the server counts as distributed; a SCHEDULED survey is the case that bites, since it is not
 * a draft.
 */
export function distributedSurveys(
  rows: readonly { id: string; title: string | null; companyId: string; status: string; createdAt: string }[],
  companyId: string,
): StatusWorkbookChoice[] {
  return rows
    .filter((row) => row.companyId === companyId && row.status !== 'draft')
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((row) => ({ id: row.id, title: row.title, status: row.status }))
}
