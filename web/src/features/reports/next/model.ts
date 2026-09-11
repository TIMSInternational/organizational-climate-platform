import type { ReportShareSummary } from '../api/reportShares'

/**
 * The typed model behind the redesigned Informes — `/admin/companies/:companyId/reports`,
 * drawn as the ReportsList artboard (10 Sep).
 *
 * Every number the page prints is derived from this shape in `derive.ts` — the report
 * count, the formats sentence, the active links and their first expiry, the scheduled
 * count, "4 of 5 groups" — never typed as a string. `useReportsListModel()` is the one
 * place it is wired to the API; the page below it never fetches.
 *
 * Naming: payload content (a report's own title, a survey's name, a department's name)
 * sits in `title`/`name`/`surveyName` fields that `noHardcodedStrings.test.ts` does not
 * read as copy; every string the UI itself says goes through `t()`.
 */

/** One group of the survey a report was built from. */
export interface ReportGroup {
  name: string
  /**
   * Under the privacy floor: the report prints no number for it in any format. Only the
   * name survives, which is what "Finanzas protegido" says — never a count, never a 0.
   */
  isProtected: boolean
}

/** What a report contains — the artboard's "Contiene" column. */
export interface ReportContents {
  surveyName: string
  /** Whole-survey responses. Under `floor` the report is suppressed and prints none. */
  responses: number
  groups: readonly ReportGroup[]
  /** The floor the document was generated under (`minimumGroupSize`). */
  floor: number
}

/** One row of the list: `ReportListItem` plus what the page reads beside it. */
export interface ReportRow {
  id: string
  title: string
  type: string
  format: string
  status: string
  createdAt: string
  isRecurring: boolean
  recurrencePattern: string | null
  nextGeneration: string | null
  /**
   * The report's public links (`GET /admin/reports/{id}/shares`), or `null` when they were
   * not read: the viewer may not list them (`canShareReports`), the report is not
   * completed (a link to it resolves to nothing — `ReportShareEndpoints.ResolveAsync`), or
   * the read failed. `null` is never shown as "none": that would be a claim nobody made.
   */
  shares: readonly ReportShareSummary[] | null
  /** What the report contains. Sample-fed until phase 2 — see `sampleModel.ts`. */
  contents: ReportContents | null
}

export interface ReportsListModel {
  /** True while any row's `contents` comes from `sampleModel.ts`; drives the sample chip. */
  isSample: boolean
  rows: readonly ReportRow[]
}
