import { authFetch } from '../../../../api/authFetch'

/**
 * `GET /surveys/{id}/participation/export` — the "Quién ya respondió" roster as a CSV
 * (`SurveyParticipationEndpoints.ExportAsync`, `SurveyRosterCsv.cs`). The server writes it from
 * the same loader as the JSON the panel draws, in the company's language.
 *
 * A `fetch` and a `Blob`, never an `<a href>`: the route is authorized by the bearer header,
 * and a link sends cookies, not headers (CLAUDE.md; `surveyExport.ts` says the same).
 */
export async function getSurveyRosterCsv(baseUrl: string, surveyId: string): Promise<Blob> {
  const response = await authFetch(`${baseUrl}/surveys/${encodeURIComponent(surveyId)}/participation/export`)
  return response.blob()
}

/**
 * The name the browser saves the file under: `estado-<title>-<yyyy-mm-dd>.csv`.
 *
 * Computed here and not read from `Content-Disposition`, which a cross-origin `fetch` cannot see
 * (the API exposes no response headers — `reports.ts` `reportFileName` records the measurement).
 * Same shape as the server's `SurveyRosterCsv.FileName`: the title folded to ASCII letters and
 * digits, every other run one hyphen, capped at 60 like `ReportFormats`, and the day appended
 * after the cap so a long title cannot cut it off. The day is the reader's own; the server uses
 * the company's, and the two differ only around midnight.
 */
export function surveyRosterCsvFileName(prefix: string, title: string, today: Date): string {
  const day = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-')
  const slug = `${prefix} ${title}`
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return `${slug}-${day}.csv`
}
