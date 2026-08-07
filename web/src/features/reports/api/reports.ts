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
   * `{ generationNote, aiInsights }`. Aggregation is still stubbed backend-side (#88) --
   * `generationNote` says so -- but `aiInsights` is real, so this is no longer an opaque
   * placeholder string. It is still not a rendered document; do not display it raw.
   */
  reportOutput: string | null
  downloadCount: number
  generationStartedAt: string | null
  generationCompletedAt: string | null
  createdAt: string
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

/**
 * Registers a download. This is a POST that increments `downloadCount` and returns the
 * updated record -- it does not stream a file, because nothing is rendered yet. The
 * backend rejects it with 400 unless `status === 'completed'`.
 */
export async function downloadReport(baseUrl: string, id: string): Promise<Report> {
  const response = await authFetch(`${baseUrl}/admin/reports/${id}/download`, { method: 'POST' })
  return response.json() as Promise<Report>
}
