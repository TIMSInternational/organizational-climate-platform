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

/**
 * What a report contains — the artboard's "Contiene" column, read from the report's own
 * stored document (`reportOutput` → `parseReportDocument` → `contentsOf`).
 *
 * ## Why a count and not just a name
 *
 * A report created through this app carries a section for EVERY survey of the company:
 * `CreateReportInput` has no survey field and `ReportFilters.SurveyIds` defaults to null,
 * which the generator records as `AllSurveys` (`ReportDtos.cs:217`). One name and one
 * response count would therefore describe one quarter of a four-survey document and read
 * as the whole of it, so `surveyCount` decides which sentence the cell says.
 */
export interface ReportContents {
  /**
   * The survey's own title — only when the document carries exactly one section that has
   * one. `null` otherwise, and the cell names the count instead of a survey.
   */
  surveyName: string | null
  /** How many survey sections the document carries. */
  surveyCount: number
  /**
   * Responses across every section. Under `floor` the report prints none — an absent
   * count is not a 0.
   */
  responses: number
  groups: readonly ReportGroup[]
  /**
   * The document's OWN suppression decision, carried rather than recomputed: true when
   * every section it holds is suppressed, so no section's numbers may be printed however
   * the totals add up. `derive.contentsReading` ORs it with its own re-floor, the same way
   * the leader dashboard re-floors what the server already floored (#490).
   */
  isSuppressed: boolean
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
  /**
   * What the report contains, from `GET /admin/reports/{id}`'s `reportOutput`. `null` when
   * there is nothing to describe: the report is not completed, so no document exists; or
   * the detail read failed, and a report whose document could not be read describes itself
   * as nothing rather than borrowing another's summary.
   */
  contents: ReportContents | null
}

export interface ReportsListModel {
  rows: readonly ReportRow[]
}
