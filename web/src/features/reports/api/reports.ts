import { authFetch } from '../../../api/authFetch'

/**
 * Typed client for `/admin/reports` (ReportEndpoints.cs).
 *
 * The list and detail shapes are deliberately separate types. `GET /admin/reports`
 * projects to `ReportListItem` -- seven columns -- while every other verb returns the
 * full `ReportDetail`. Typing the list as the detail (as the plan sketch did) would
 * promise `description`, `reportOutput` and `downloadCount` on rows that never carry
 * them, and a page reading `row.downloadCount` would render `undefined` with a clean
 * typecheck.
 */

/** A row of `GET /admin/reports` -- see `ReportListItem` in ReportDtos.cs. */
export interface ReportListItem {
  id: string
  title: string
  type: string
  companyId: string
  status: string
  format: string
  createdAt: string
  /**
   * The recurring schedule, on the LIST and not only on the detail.
   *
   * A recurring report is invisible from its own row otherwise, and "which of these mails
   * itself every month" is the question this screen is opened to answer. Fetching each
   * report to find out would be one request per row.
   */
  isRecurring: boolean
  recurrencePattern: string | null
  /** ISO 8601, UTC. `null` whenever `isRecurring` is false. */
  nextGeneration: string | null
}

/** The full record returned by create/get/download -- see `ReportDetail` in ReportDtos.cs. */
export interface Report {
  id: string
  title: string
  description: string | null
  type: string
  companyId: string
  createdBy: string
  templateId: string | null
  status: string
  format: string
  /**
   * A JSON-encoded `ReportOutputDocument` (ReportAIInsights.cs), camelCase:
   * `{ generationNote, surveys, aiInsights, benchmarks }`. Real aggregation (#88), and
   * `generationNote` names the sections the generator still does not build. It is the SOURCE
   * a file is rendered from, server-side, by `ReportRenderer` -- never a document itself, so
   * do not display it raw. `parseReportDocument` (../reportDocument) is the safe reader.
   */
  reportOutput: string | null
  downloadCount: number
  generationStartedAt: string | null
  generationCompletedAt: string | null
  createdAt: string
  isRecurring: boolean
  recurrencePattern: string | null
  nextGeneration: string | null
}

export interface CreateReportInput {
  title: string
  description?: string
  type: string
  companyId: string
  format: string
  templateId?: string
}

export async function listReports(baseUrl: string, companyId: string): Promise<ReportListItem[]> {
  const response = await authFetch(`${baseUrl}/admin/reports?companyId=${encodeURIComponent(companyId)}`)
  return response.json() as Promise<ReportListItem[]>
}

export async function createReport(baseUrl: string, input: CreateReportInput): Promise<Report> {
  const response = await authFetch(`${baseUrl}/admin/reports`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<Report>
}

export async function getReport(baseUrl: string, id: string): Promise<Report> {
  const response = await authFetch(`${baseUrl}/admin/reports/${id}`)
  return response.json() as Promise<Report>
}

/** Every format the server will render. Mirrors `ReportFormats.Supported` (C#). */
export const REPORT_FORMATS = ['pdf', 'csv'] as const

export type ReportFormat = (typeof REPORT_FORMATS)[number]

/**
 * Every recurrence the server will accept. Mirrors `RecurrenceSchedule.All` (C#).
 *
 * A named set rather than a cron field, and the C# side records why: the audience for this
 * screen cannot write a cron expression correctly, and "every 5 minutes" is expressible in
 * cron and is not a thing a climate report should ever be. Sending anything outside this list
 * earns a 400 that names the six values.
 */
export const REPORT_RECURRENCE_PATTERNS = [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'yearly',
] as const

export type ReportRecurrencePattern = (typeof REPORT_RECURRENCE_PATTERNS)[number]

export interface SetReportScheduleInput {
  pattern: ReportRecurrencePattern
  /**
   * ISO 8601 instant for the first run. Omit and the server schedules one period from now,
   * computed in the COMPANY's timezone rather than this browser's — a report is an
   * organisational artefact, so "the monthly report" means the tenant's month.
   *
   * The server refuses a value in the past (400) rather than advancing it, so that "start on
   * the 1st" cannot silently become a different date.
   */
  startAt?: string
}

/** Sets or replaces the recurring schedule. Returns the whole report, schedule included. */
export async function setReportSchedule(
  baseUrl: string,
  id: string,
  input: SetReportScheduleInput,
): Promise<Report> {
  const response = await authFetch(`${baseUrl}/admin/reports/${id}/schedule`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<Report>
}

/** Stops the report recurring, clearing all three schedule columns. */
export async function clearReportSchedule(baseUrl: string, id: string): Promise<Report> {
  const response = await authFetch(`${baseUrl}/admin/reports/${id}/schedule`, { method: 'DELETE' })
  return response.json() as Promise<Report>
}

/**
 * Downloads the rendered report.
 *
 * ## Why a fetch and not a link
 *
 * The same reason `features/surveys/api/surveyExport.ts` gives, plus one more. The route is
 * authorized, and an `<a href>` sends cookies rather than the bearer header — so the file has
 * to arrive as a response body this module turns into a `Blob`. And the route is a **POST**:
 * it increments `download_count`, which is the record answering "who exported this data"
 * (#143), so an anchor could not reach it at all.
 *
 * The whole document is in memory in the tab for a moment. That is fine for a report bounded
 * by the instrument, the org chart and the company's survey count — the unbounded export in
 * this product is a survey's raw CSV, and that one streams server-side.
 *
 * The backend rejects the call with 400 unless `status === 'completed'`; `authFetch` turns a
 * non-2xx into a throw, so a page never sees a half-successful download.
 */
export async function downloadReport(baseUrl: string, id: string): Promise<Blob> {
  const response = await authFetch(`${baseUrl}/admin/reports/${id}/download`, { method: 'POST' })
  return response.blob()
}

/**
 * The name the browser saves the file under.
 *
 * ## Why this is computed here and not read from the response
 *
 * The server puts a title-derived name in `Content-Disposition` (`ReportFormats.FileName`),
 * and the browser cannot read it: `Content-Disposition` is not a CORS-safelisted response
 * header and the API does not call `WithExposedHeaders` (`Program.cs` configures the
 * "Frontend" policy with `AllowAnyHeader().AllowAnyMethod()` and nothing else). So
 * `response.headers.get('content-disposition')` is `null` in the deployed app, and a name
 * parsed from it would be `null` in production and correct in a unit test.
 *
 * `downloadBlobFile` sets `link.download`, which wins over the header regardless — so this
 * is the name the user actually gets, and it is derived from the id because the id is the one
 * thing the caller is certain of. Exposing the header server-side would let both names agree;
 * that is a one-line CORS change in `Program.cs`, outside this slice.
 */
export function reportFileName(id: string, format: string): string {
  const extension = format === 'csv' ? 'csv' : 'pdf'
  return `report-${id}.${extension}`
}
