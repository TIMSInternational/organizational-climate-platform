import { authFetch } from '../../../api/authFetch'

/**
 * The server-rendered microclimate export (`MicroclimateEndpoints.cs`, `GET
 * /microclimates/{id}/export/csv`, #131).
 *
 * ## The endpoint existed for a month with no caller
 *
 * `/export/csv` is registered, privacy-suppressed on the server (a microclimate below the
 * disclosure floor exports its reason code and no words — `MicroclimateExportProjection`),
 * and covered by ~20 integration tests in `MicroclimateLifecycleEndpointsTests.cs`. Until
 * this module nothing in `web/src` called it, so a working export was reachable only by
 * someone who knew the URL and could send a bearer token by hand.
 *
 * ## Why a fetch and not a link
 *
 * Same reason as `surveyExport.ts`: the route is authorized, an `<a href>` sends cookies and
 * not headers, so the file arrives as a response body that `downloadBlobFile` hands to the
 * user. The document is bounded by one microclimate's questions and word list, so holding it
 * in memory for a moment is fine.
 *
 * ## Why `/export/csv` and not `/export?format=csv`
 *
 * Both answer with the same file. The path form is the one the endpoint's own tests call the
 * canonical shape; the query form is kept for a legacy caller and is not what a new caller
 * should copy.
 */
function exportCsvUrl(baseUrl: string, microclimateId: string, lang?: string): string {
  // `lang` last and optional, per the house rule `surveyExport.ts` records.
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : ''
  return `${baseUrl}/microclimates/${encodeURIComponent(microclimateId)}/export/csv${query}`
}

/**
 * The CSV document. `lang` is a request, not a promise: the server resolves the
 * microclimate's own content language and renders the headings in the locale the reader is
 * reading, the same `resolvedLocale` contract the detail carries.
 */
export async function getMicroclimateCsv(
  baseUrl: string,
  microclimateId: string,
  lang?: string,
): Promise<Blob> {
  const response = await authFetch(exportCsvUrl(baseUrl, microclimateId, lang))
  return response.blob()
}

/** The download name, matching what the server puts in `Content-Disposition`. */
export function microclimateCsvFileName(microclimateId: string): string {
  return `microclimate-${microclimateId}.csv`
}
