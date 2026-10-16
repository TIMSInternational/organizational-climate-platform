import { authFetch } from '../../../api/authFetch'

/**
 * The platform-wide response workbook (`ResponseExportEndpoints.cs`).
 *
 * One row per response, one column per question, one sheet per climate — the spreadsheet TIMS
 * builds its work plan on, rather than the aggregate the product reports. Ruled 2026-10-15;
 * the reasoning and what it does not change are in
 * `docs/decisions/who-may-see-an-individual-answer.md`.
 *
 * ## A fetch, not a link
 *
 * The route is authorized, and an `<a href>` sends cookies rather than the bearer header — the
 * same reason `surveyExport.ts` gives. The body arrives as a `Blob` that `downloadBlobFile`
 * hands to the user.
 *
 * ## It is super admin only, and every call is audited
 *
 * The server decides that, not this module; the button is hidden from everyone else so the
 * refusal is never the first a reader hears of it.
 */
/** What the endpoint serves, and the only thing worth saving under an .xlsx name. */
const WORKBOOK_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function getAllResponsesWorkbook(baseUrl: string, surveyId?: string): Promise<Blob> {
  const query = surveyId ? `?surveyId=${encodeURIComponent(surveyId)}` : ''
  const response = await authFetch(`${baseUrl}/admin/exports/responses${query}`)
  if (!response.ok) throw new Error('surveys.next.super.exportFailed')

  // `response.ok` is not enough, and this cost a corrupt download to learn. With an empty
  // `baseUrl` the request is a RELATIVE path, so it resolves against the web origin instead
  // of the API, and the SPA host answers every unknown path with `index.html` and a 200. The
  // browser then saves the app shell under an .xlsx name and the reader opens 1 KB of HTML.
  // A 200 says the server replied, not that it replied with a workbook.
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes(WORKBOOK_TYPE)) throw new Error('surveys.next.super.exportFailed')
  return response.blob()
}

/**
 * The day is in the name, always. Two downloads a week apart are two different pictures of a
 * climate that is still being answered, and a folder of files called `respuestas-clima.xlsx`
 * is a folder in which nobody can tell which one is the later one.
 */
export function allResponsesFileName(now: Date, label?: string): string {
  const day = now.toISOString().slice(0, 10)
  const slug = (label ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return slug ? `respuestas-${slug}-${day}.xlsx` : `respuestas-clima-${day}.xlsx`
}
