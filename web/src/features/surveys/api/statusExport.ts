import { authFetch } from '../../../api/authFetch'

/**
 * `GET /admin/companies/{id}/participation/export` — every one of the company's distributed
 * surveys as ONE workbook, a sheet each
 * (`SurveyParticipationEndpoints.ExportCompanyAsync`, `StatusWorkbook.cs`).
 *
 * This is the file the client is sent. Until it existed, producing it meant downloading each
 * survey's roster and running a script over them — about twice a day through October 2026.
 *
 * A `fetch` and a `Blob`, never an `<a href>`: the route is authorized by the bearer header,
 * and an anchor sends cookies, not headers (CLAUDE.md; `rosterExport.ts` says the same).
 */
export async function getCompanyStatusWorkbook(baseUrl: string, companyId: string): Promise<Blob> {
  const response = await authFetch(`${baseUrl}/admin/companies/${encodeURIComponent(companyId)}/participation/export`)
  return response.blob()
}

/**
 * The name the browser saves it under: `estado-<empresa>-<yyyy-mm-dd>.xlsx`.
 *
 * Computed here rather than read from `Content-Disposition`, which a cross-origin `fetch`
 * cannot see — the same measurement `rosterExport.ts` and `reports.ts` record. The shape
 * matches the server's `StatusWorkbookFileName`: accents folded, anything that is not a letter
 * or digit collapsed to one hyphen, and the day appended after the cap so a long company name
 * cannot cut it off. The day is the reader's own; the server uses the company's, and the two
 * differ only around midnight.
 */
export function companyStatusFileName(prefix: string, companyName: string, today: Date): string {
  const day = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-')
  const slug = `${prefix} ${companyName}`
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return `${slug}-${day}.xlsx`
}
