import { authFetch } from '../../../api/authFetch'

/**
 * The server-rendered dashboard export (`DashboardEndpoints.cs`, #134).
 *
 * ## Why a fetch and not a link
 *
 * `GET /dashboard/company-admin/export` is authorized, so the browser has to send the bearer
 * token — and an `<a href>` sends cookies, not headers, which is the mistake
 * `surveyExport.ts` records having been made once already. The file arrives as a response
 * body this module turns into a `Blob` for `downloadBlobFile`.
 *
 * ## Why there is no client-side rendering here
 *
 * The page already holds the payload it is drawing, so building the CSV in the tab would
 * save a request. It would also mean two renderers deciding what a *withheld* figure looks
 * like, and the whole point of the server-side one is that a suppressed team prints the word
 * rather than a zero — a rule that has to be written once to be true once. The file the
 * administrator keeps is the file the server rendered.
 */

/** The two formats the server will produce. Anything else is a 400, not a downgrade. */
export type DashboardExportFormat = 'csv' | 'pdf'

/**
 * The company dashboard as a file.
 *
 * `companyId` is required for a SuperAdmin and ignored for a CompanyAdmin, exactly as
 * `getCompanyAdminDashboard` documents — the export shares that endpoint's loader, so it
 * shares its scoping rules too.
 */
export async function getCompanyDashboardExport(
  baseUrl: string,
  format: DashboardExportFormat,
  options: { companyId?: string; lang?: string } = {},
): Promise<Blob> {
  const response = await authFetch(
    exportUrl(baseUrl, '/dashboard/company-admin/export', format, {
      companyId: options.companyId,
      lang: options.lang,
    }),
  )
  return response.blob()
}

/** The department dashboard as a file. */
export async function getDepartmentDashboardExport(
  baseUrl: string,
  format: DashboardExportFormat,
  options: { departmentId?: string; lang?: string } = {},
): Promise<Blob> {
  const response = await authFetch(
    exportUrl(baseUrl, '/dashboard/department-admin/export', format, {
      departmentId: options.departmentId,
      lang: options.lang,
    }),
  )
  return response.blob()
}

/**
 * The download name.
 *
 * Deliberately built from what the dashboard is *of* rather than from an id: this is a file
 * a director keeps in a folder next to eleven others, and `dashboard-3f2a....pdf` is not
 * findable three months later. The day is included for the same reason — a dashboard is a
 * reading taken at a moment, and two exports a quarter apart must not collide.
 */
export function dashboardExportFileName(
  subject: string,
  format: DashboardExportFormat,
  today: Date = new Date(),
): string {
  // `today` last and optional, per the house rule a prior bug taught: an optional argument
  // ahead of the required ones broke five call sites.
  // Unicode letters and digits, not `[a-z0-9]`. The server builds the `Content-Disposition`
  // name with `char.IsLetterOrDigit`, which keeps `í` and `ñ`; an ASCII-only rule here would
  // give the same file two different names depending on whether it came through this button
  // or through `curl` — and it would render half this client's department names as a row of
  // hyphens.
  const slug =
    subject
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'dashboard'

  const day = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('')

  return `${slug}-${day}.${format}`
}

function exportUrl(
  baseUrl: string,
  path: string,
  format: DashboardExportFormat,
  params: Record<string, string | undefined>,
): string {
  const search = new URLSearchParams({ format })
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, value)
    }
  }
  return `${baseUrl}${path}?${search.toString()}`
}
