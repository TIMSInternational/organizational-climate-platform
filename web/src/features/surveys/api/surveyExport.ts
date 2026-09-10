import { authFetch } from '../../../api/authFetch'

/**
 * The server-rendered survey export (`SurveyExportEndpoints.cs`, #122).
 *
 * ## Why a fetch and not a link
 *
 * `GET /surveys/{id}/export/pdf` is authorized, so the browser has to send the bearer token —
 * and an `<a href>` sends cookies, not headers. The file therefore arrives as a response body
 * this module turns into a `Blob`, which `downloadBlobFile` hands to the user. The cost is
 * that the whole document is in memory in the tab for a moment, which is fine for a report
 * bounded by the instrument and the org chart and is the reason the *raw* format on the server
 * side is the streaming one.
 *
 * ## The PDF, and the server's CSV beside the page's own
 *
 * The server serves both, and the page keeps its own CSVs (`surveyResultsCsv.ts`): those
 * write translated headings for the payload the reader is looking at, while the server's
 * writes machine-readable reason codes in a single long-format document. They are different
 * artefacts for different readers, and neither re-derives a suppression decision. There was
 * no PDF at all before #122 — that is the gap this closes. The server's CSV is offered too,
 * behind the header's overflow menu, for the reader who wants the machine-readable one.
 */
function exportUrl(baseUrl: string, surveyId: string, format: string, lang?: string): string {
  // `lang` last and optional, per the house rule a prior bug taught: an optional `baseUrl`
  // ahead of the required arguments broke five call sites.
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : ''
  return `${baseUrl}/surveys/${encodeURIComponent(surveyId)}/export/${format}${query}`
}

/**
 * The formatted results document.
 *
 * `lang` is a request, not a promise: the server resolves the survey's own content language
 * and renders the document's chrome in the locale the reader is actually reading, which is the
 * same `resolvedLocale` contract the results payload carries.
 */
export async function getSurveyResultsPdf(
  baseUrl: string,
  surveyId: string,
  lang?: string,
): Promise<Blob> {
  const response = await authFetch(exportUrl(baseUrl, surveyId, 'pdf', lang))
  return response.blob()
}

/** The download name, matching what the server puts in `Content-Disposition`. */
export function surveyResultsPdfFileName(surveyId: string): string {
  return `survey-${surveyId}-results.pdf`
}

/**
 * The server's long-format CSV (`GET /surveys/{id}/export/csv`) — one row per reading, with
 * reason codes where the page prints words. Same authorized `fetch` + `Blob` route as the
 * PDF, for the same reason.
 */
export async function getSurveyResultsCsv(
  baseUrl: string,
  surveyId: string,
  lang?: string,
): Promise<Blob> {
  const response = await authFetch(exportUrl(baseUrl, surveyId, 'csv', lang))
  return response.blob()
}

/** The download name, matching `SurveyExport.CsvFileName` on the server. */
export function surveyResultsCsvFileName(surveyId: string): string {
  return `survey-${surveyId}-results.csv`
}
