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
const WORKBOOK_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * A refused request and the SPA's index.html (a 200, from a relative URL) both used to be saved
 * under an .xlsx name. Status and content type are both checked, as `responseExport.ts` does.
 */
async function companyWorkbook(url: string): Promise<Blob> {
  const response = await authFetch(url)
  if (!response.ok) throw new Error('workbook request failed')
  if (!(response.headers.get('content-type') ?? '').includes(WORKBOOK_TYPE)) throw new Error('not a workbook')
  return response.blob()
}

/**
 * `surveyIds` empty asks for every distributed survey and sends NO query, which is what this
 * function did before a picker existed — so the request the server sees is byte-for-byte the
 * old one. A non-empty list repeats `?survey=` once per sheet; the server refuses an id that is
 * not one of the company's distributed surveys rather than returning a workbook missing it.
 */
export function getCompanyStatusWorkbook(
  baseUrl: string,
  companyId: string,
  surveyIds: readonly string[] = [],
  format: StatusWorkbookFormat = 'standard',
): Promise<Blob> {
  const route = `${baseUrl}/admin/companies/${encodeURIComponent(companyId)}/participation/export`
  const parts = surveyIds.map((id) => `survey=${encodeURIComponent(id)}`)
  // The standard layout sends no `format`, so its request stays byte-for-byte the old one.
  if (format !== 'standard') parts.push(`format=${format}`)
  const query = parts.join('&')
  return companyWorkbook(query ? `${route}?${query}` : route)
}

/**
 * `standard` is every roster column; `progress` is ESPH's layout -- Nombre completo, Porcentaje
 * de Avance, Observaciones, the row coloured -- with the name whole (ruled 2026-11-08: a split
 * into Apellidos would be a guess). `StatusWorkbookLayout` on the server.
 */
export type StatusWorkbookFormat = 'standard' | 'progress'

/**
 * `GET /admin/companies/{id}/delivery-audit` — who never received the email and what their mail
 * server answered. Super admin only and internal to TIMS: never sent to the client.
 */
export function getDeliveryAuditWorkbook(baseUrl: string, companyId: string): Promise<Blob> {
  return companyWorkbook(`${baseUrl}/admin/companies/${encodeURIComponent(companyId)}/delivery-audit`)
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
