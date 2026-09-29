import { authFetch } from '../../../api/authFetch'
import { getToken } from '../../../auth/token'
import type { BulkImportResponse } from './bulkImport'

/**
 * The Excel intake: a template the client fills in, a parse that turns it into reviewable rows,
 * and the reviewed rows going in.
 *
 * ## The seam this module is shaped around
 *
 * `parseIntakeWorkbook` is the ONLY function here that knows the payload is a spreadsheet. The
 * wizard downstream of it consumes `IntakeParseResult` and nothing else, so the eventual
 * document-extraction step (Bedrock, #92/#111/#119, blocked on provider approval) replaces this
 * one call and leaves the review table, the validation and the invitation creation untouched.
 * Keep the row-shaped types free of anything spreadsheet-specific for that reason.
 */

/** A problem with the file itself rather than with one of its rows. */
export interface IntakeParseProblem {
  sheet: string
  /** English, for logs. The screen says `code` in the reader's language. */
  message: string
  code: string
  /** What the code is about, when it is about something: the missing column's name. */
  value?: string | null
}

/**
 * A refused request, keeping the server's stable `code` beside its English `message`: the
 * screen translates the code, and a message the reader's language has no sentence for is never
 * printed at them raw.
 */
export class IntakeRequestError extends Error {
  readonly code: string | null
  readonly status: number

  constructor(message: string, code: string | null, status: number) {
    super(message)
    this.name = 'IntakeRequestError'
    this.code = code
    this.status = status
  }
}

export interface IntakeRow {
  rowNumber: number
  name: string
  email: string
  role: string
  department: string | null
}

export interface IntakeParseResult {
  rows: IntakeRow[]
  problems: IntakeParseProblem[]
}

/**
 * `authFetch` sets `Content-Type: application/json` unconditionally, which is right for every
 * other call in the app and wrong for these two: a multipart body needs the browser to write
 * the header itself, because only it knows the boundary it generated. So these build their own
 * headers, exactly as `bulkImport.ts` already does.
 */
function multipartHeaders(): Headers {
  const headers = new Headers()
  const token = getToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return headers
}

async function failure(response: Response): Promise<IntakeRequestError> {
  const body = (await response.json().catch(() => null)) as { message?: string; code?: string } | null
  return new IntakeRequestError(body?.message ?? `Request failed: ${response.status}`, body?.code ?? null, response.status)
}

/**
 * The workbook for this company, as a Blob.
 *
 * A `fetch` rather than an `<a href>`: the route is authorized, and an anchor sends cookies
 * rather than the bearer header — the rule `surveyExport.ts` exists to state.
 */
export async function getIntakeTemplate(baseUrl: string, companyId: string): Promise<Blob> {
  const response = await fetch(
    `${baseUrl}/admin/users/bulk-import/template?companyId=${encodeURIComponent(companyId)}`,
    { headers: multipartHeaders() },
  )

  if (!response.ok) {
    throw await failure(response)
  }

  return response.blob()
}

/** Read a filled workbook into rows. Creates nothing. */
export async function parseIntakeWorkbook(
  baseUrl: string,
  companyId: string,
  file: File,
): Promise<IntakeParseResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('companyId', companyId)

  const response = await fetch(`${baseUrl}/admin/users/bulk-import/parse`, {
    method: 'POST',
    headers: multipartHeaders(),
    body: form,
  })

  if (!response.ok) {
    throw await failure(response)
  }

  return (await response.json()) as IntakeParseResult
}

/**
 * The reviewed rows. `preview` is the same flag the CSV upload carries and reaches the same
 * server-side body, so what the review step shows is what approving it will do.
 */
export async function submitIntakeRows(
  baseUrl: string,
  companyId: string,
  rows: IntakeRow[],
  preview: boolean,
): Promise<BulkImportResponse> {
  const response = await authFetch(`${baseUrl}/admin/users/bulk-import/rows`, {
    method: 'POST',
    body: JSON.stringify({ companyId, preview, rows }),
  })

  if (!response.ok) {
    throw await failure(response)
  }

  return (await response.json()) as BulkImportResponse
}
