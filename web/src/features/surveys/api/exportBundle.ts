import { authFetch } from '../../../api/authFetch'

/**
 * `GET /admin/companies/{companyId}/exports/bundle` (`CompanyExportEndpoints.cs`): the
 * «Descargar en Excel» wizard's one download -- a workbook when one file is asked for, a .zip
 * of them when several are.
 */

/** The four files, in the order the wizard lists them and the zip holds them. */
export const EXPORT_FILES = ['responses', 'questionnaire', 'status', 'results'] as const
export type ExportFile = (typeof EXPORT_FILES)[number]

export interface ExportBundleChoice {
  /** Empty for every distributed survey of the company. */
  surveyIds: readonly string[]
  files: readonly ExportFile[]
  /** Breakdowns for the results workbook: `department` and/or demographic field keys. */
  groups: readonly string[]
  statusFormat: 'standard' | 'progress'
  includeAnswers: boolean
  lang: 'es' | 'en'
}

export function exportBundleQuery(choice: ExportBundleChoice): string {
  const query = new URLSearchParams()
  for (const id of choice.surveyIds) query.append('survey', id)
  for (const file of choice.files) query.append('file', file)
  if (choice.files.includes('results')) for (const group of choice.groups) query.append('group', group)
  if (choice.files.includes('status') && choice.statusFormat !== 'standard') query.set('format', choice.statusFormat)
  if (choice.files.includes('responses') && !choice.includeAnswers) query.set('answers', 'false')
  query.set('lang', choice.lang)
  return query.toString()
}

export interface ExportBundleDownload {
  blob: Blob
  /** The name the server gave the file, read off `Content-Disposition`. */
  fileName: string | null
}

export async function getExportBundle(
  baseUrl: string,
  companyId: string,
  choice: ExportBundleChoice,
): Promise<ExportBundleDownload> {
  const response = await authFetch(
    `${baseUrl}/admin/companies/${encodeURIComponent(companyId)}/exports/bundle?${exportBundleQuery(choice)}`,
  )
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('zip') && !type.includes('spreadsheetml')) throw new Error('not a download')
  return { blob: await response.blob(), fileName: fileNameFrom(response.headers.get('content-disposition')) }
}

/** The file name in a `Content-Disposition` header, preferring the RFC 5987 `filename*` form. */
export function fileNameFrom(disposition: string | null): string | null {
  if (!disposition) return null
  const extended = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition)
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''))
    } catch {
      // A malformed escape falls through to the plain form.
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)
  return plain ? plain[1].trim() : null
}

/**
 * The name to save under when the header is not readable (a CORS response exposes only the
 * safelisted headers unless the API lists `Content-Disposition`): kind, company and day, as the
 * server names it.
 */
export function exportBundleFallbackName(choice: ExportBundleChoice, companyName: string, today: Date): string {
  const kinds: Record<ExportFile, [string, string]> = {
    responses: ['respuestas', 'responses'],
    questionnaire: ['cuestionario', 'questionnaire'],
    status: ['estado', 'status'],
    results: ['resultados', 'results'],
  }
  const spanish = choice.lang === 'es'
  const kind = choice.files.length === 1 ? kinds[choice.files[0]][spanish ? 0 : 1] : spanish ? 'descargas' : 'downloads'
  const day = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-')
  const slug = companyName
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  const extension = choice.files.length === 1 ? 'xlsx' : 'zip'
  return slug ? `${kind}-${slug}-${day}.${extension}` : `${kind}-${day}.${extension}`
}
