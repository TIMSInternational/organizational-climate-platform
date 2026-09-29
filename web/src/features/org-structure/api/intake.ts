import { authFetch } from '../../../api/authFetch'
import { getToken } from '../../../auth/token'
import type { BulkImportResponse } from './bulkImport'

/**
 * The people intake: any spreadsheet the client already has (or our template), read and mapped
 * by the server into reviewable rows, and the reviewed rows going in.
 *
 * ## The seam this module is shaped around
 *
 * `understandIntakeFile` is the ONLY function the wizard calls that knows the payload is a
 * spreadsheet. Everything downstream of it — the review table, the validation and the invitation
 * creation — consumes `IntakeRow[]` and nothing else, whoever wrote the mapping (Claude, our
 * template's fixed headers, header words, or the admin's correction). `parseIntakeWorkbook` is
 * the older template-only route, kept because the server still serves it.
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
  /**
   * Pre-assigned demographic answers keyed by field (the stored option value, not its label).
   * Only `/understand` produces these; the template path leaves them out.
   */
  demographics?: Record<string, string | null> | null
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
  /**
   * Departments the admin approved creating. Sent on the preview AND the approval: a row naming
   * one is only valid when the server has been told it is approved, so a preview without it
   * would show errors the approval then does not have.
   */
  newDepartments: string[] = [],
): Promise<BulkImportResponse> {
  const response = await authFetch(`${baseUrl}/admin/users/bulk-import/rows`, {
    method: 'POST',
    body: JSON.stringify({ companyId, preview, rows, newDepartments }),
  })

  if (!response.ok) {
    throw await failure(response)
  }

  return (await response.json()) as BulkImportResponse
}

/* ---------------------------------------------------------------------------------------------
 * `/understand`: any spreadsheet the client already has, read and mapped by the server.
 * ------------------------------------------------------------------------------------------- */

/** Who wrote the mapping: Claude, our template's fixed headers, header words, or the admin. */
export type IntakeSource = 'template' | 'ai' | 'heuristic' | 'manual'
export type IntakeConfidence = 'high' | 'medium' | 'low'
export type IntakeColumnTarget =
  | 'name'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'role'
  | 'department'
  | 'demographic'
  | 'ignore'
export type IntakeRoleTarget = 'employee' | 'leader' | 'supervisor'

export interface IntakeColumnMapping {
  column: number
  header: string
  target: IntakeColumnTarget
  demographicField: string | null
  confidence: IntakeConfidence
  reason: string | null
}

export interface IntakeRoleValueMapping {
  source: string
  target: IntakeRoleTarget
  confidence: IntakeConfidence
  reason: string | null
}

export interface IntakeDepartmentValueMapping {
  source: string
  department: string | null
  createNew: boolean
  confidence: IntakeConfidence
  reason: string | null
}

export interface IntakeDemographicValueMapping {
  field: string
  source: string
  target: string | null
  confidence: IntakeConfidence
}

export interface IntakeMapping {
  sheet: string
  headerRow: number
  nameOrder: 'first_last' | 'last_first'
  defaultRole: IntakeRoleTarget
  columns: IntakeColumnMapping[]
  roleValues: IntakeRoleValueMapping[]
  departmentValues: IntakeDepartmentValueMapping[]
  demographicValues: IntakeDemographicValueMapping[]
  /** Written by the model in the requested language; null from the template and header paths. */
  summary: string | null
}

/** Something worth a look before approving, with the spreadsheet rows it is about. */
export interface IntakeInsight {
  code: string
  rows: number[]
  value: string | null
  suggestion: string | null
}

export interface IntakeAiFacts {
  model: string
  inputTokens: number | null
  outputTokens: number | null
  durationMs: number
  cached: boolean
  /** Columns whose distinct values the model was shown (areas, job titles). */
  categoryColumns: string[]
  /** Columns the model saw only as masked samples (names, emails). */
  maskedColumns: string[]
}

export interface IntakeDemographicTarget {
  field: string
  label: string | null
  type: 'select' | 'text' | 'number' | 'date'
  options: string[] | null
  /** Each stored value's label in the reader's language ("san_jose" → "San José"). */
  optionLabels?: Record<string, string> | null
}

export interface IntakeTargets {
  companyName: string
  emailDomain: string | null
  departments: string[]
  demographics: IntakeDemographicTarget[]
}

export interface IntakeUnderstanding {
  source: IntakeSource
  failureCode: string | null
  mapping: IntakeMapping
  rows: IntakeRow[]
  newDepartments: string[]
  problems: IntakeParseProblem[]
  insights: IntakeInsight[]
  file: {
    fileName: string
    sheets: { name: string; rows: number; columns: number }[]
    namesNormalised: number
    /**
     * Rows under the header that held no person (a "Total colaboradores: 22" footer), skipped by
     * the server. Optional: a server older than this field simply omits it.
     */
    skippedRows?: number[]
  }
  ai: IntakeAiFacts | null
  targets: IntakeTargets
}

/**
 * Read any spreadsheet into a proposed mapping and the rows it produces. Creates nothing.
 *
 * With `mapping`, the server re-applies the admin's corrected mapping to the same file and calls
 * no model (the response's `source` is then `manual`); without it the server recognises its own
 * template, or asks the model, or — when the model cannot run — maps by header words and says so
 * in `failureCode`. `language` is the reader's: the model writes its summary and reasons in it.
 */
export async function understandIntakeFile(
  baseUrl: string,
  companyId: string,
  file: File,
  language: 'es' | 'en',
  mapping?: IntakeMapping,
): Promise<IntakeUnderstanding> {
  const form = new FormData()
  form.append('file', file)
  form.append('companyId', companyId)
  form.append('language', language)
  if (mapping) {
    form.append('mapping', JSON.stringify(mapping))
  }

  const response = await fetch(`${baseUrl}/admin/users/bulk-import/understand`, {
    method: 'POST',
    headers: multipartHeaders(),
    body: form,
  })

  if (!response.ok) {
    throw await failure(response)
  }

  return (await response.json()) as IntakeUnderstanding
}
