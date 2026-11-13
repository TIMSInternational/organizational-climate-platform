import { authFetch } from '../../../api/authFetch'
import { getToken } from '../../../auth/token'
import type { BulkImportResponse } from './bulkImport'
import { credentialModeOf, getCompanySettings, type CredentialMode } from './companySettings'

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
 *
 * ## One request, and why the approval is not
 *
 * This sends whatever it is given in a single request. A PREVIEW is called with the whole file
 * and must stay that way: the server's duplicate-within-this-file check lives in a set built per
 * request (`seenInThisFile`), so the only place an email repeated at rows 50 and 150 can be seen
 * as a repeat is a request holding both. The preview is also cheap — it hashes nothing and mails
 * nothing (`BulkImportEndpoints.cs` short-circuits every preview row before the credentials
 * branch) — so file size does not threaten it.
 *
 * An APPROVAL is called once per `IMPORT_CHUNK_ROWS` rows instead, by `IntakeWizard`, for the
 * request-budget reason set out on that constant. Chunking the approval is safe because every
 * set the server decides with is reloaded from the database on each request — the departments,
 * the existing emails (platform-wide), the live invitations, the usernames already taken — so a
 * later chunk sees what an earlier one committed: an approved new department is matched rather
 * than created twice, and a row repeating an earlier chunk's email comes back `already_user`
 * rather than creating a second account. The one thing that does change is the label on that
 * last case, and the preview over the whole file is where the admin sees it as `repeated_in_file`.
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
  /**
   * Mass invite (ruled 2026-10-13): create an ACCOUNT per row with a generated username and
   * password, emailed with the login link, and the Excel's demographics already on it — instead
   * of an invitation that asks the person to choose their own password.
   *
   * Sent on the preview too, although the server only acts on it when committing. The preview
   * and the approval must describe the same intent, or a future server-side difference between
   * the two modes would first appear as a verdict that did not match what happened.
   */
  withCredentials = false,
): Promise<BulkImportResponse> {
  // 400 handed back rather than thrown: its body carries a `code` the wizard says in the
  // reader's language (`credentials_not_available_per_survey`), and `authFetch`'s own error
  // keeps only the server's English message.
  const response = await authFetch(
    `${baseUrl}/admin/users/bulk-import/rows`,
    {
      method: 'POST',
      body: JSON.stringify({ companyId, preview, rows, newDepartments, withCredentials }),
    },
    { allowStatus: [400] },
  )

  if (!response.ok) {
    throw await failure(response)
  }

  return (await response.json()) as BulkImportResponse
}

/**
 * The company's credential mode, for the access choice on the review step: a `per_survey`
 * company refuses `withCredentials` (400 `credentials_not_available_per_survey`), so the
 * wizard must not offer it. `null` when the settings cannot be read — the wizard then offers
 * both choices, as it always did, and the refusal is still said in the reader's language.
 */
export async function getIntakeCredentialMode(baseUrl: string, companyId: string): Promise<CredentialMode | null> {
  try {
    const response = await getCompanySettings(baseUrl, companyId)
    return response?.settings ? credentialModeOf(response.settings) : null
  } catch {
    return null
  }
}

/**
 * Rows per commit request, and the reason the number is small.
 *
 * App Runner ends every HTTP request at 120 seconds and the limit is not configurable: *"There
 * is a total of 120 seconds request timeout limit on the HTTP requests. The 120 seconds include
 * the time the application takes to read the request, including the body, and complete writing
 * the HTTP response"* (AWS, *Developing application code for App Runner*).
 *
 * A credentialed import spends, inside that one request and sequentially by design
 * (`BulkImportEndpoints.cs`), a bcrypt hash per row at work factor 12
 * (`BcryptPasswordHasher.cs`) and then one email per row from a loop paced at ten a second
 * (`EmailOptions.DefaultMaxSendsPerSecond`). A bcrypt-12 verify was measured at 1.09s on the
 * 0.25 vCPU instance production ran before 2026-10-15, so about 0.27 vCPU-seconds of work; the
 * instance is 1 vCPU now. That puts the whole file in one request at roughly
 * `rows x 0.27 + rows / 10` seconds:
 *
 *     100 rows ~  37s        300 rows ~ 111s        800 rows ~ 296s
 *     200 rows ~  74s        400 rows ~ 148s
 *
 * So anything past about 300 rows is a request that cannot finish — and the band around 400 is
 * worse than the obvious disaster at 800, not better. The accounts are committed before the
 * first mail goes out, so a request killed in the mailing loop leaves real accounts behind and
 * takes down with it the response that would have named the people who were never mailed. The
 * admin cannot tell which, and re-running the file is the natural thing to try.
 *
 * 100 is the batch the credentials resend already sends (`MassInviteEndpoints.MaxBatch`), lands
 * inside a third of the budget, and leaves room for a cold instance or a retried send.
 */
export const IMPORT_CHUNK_ROWS = 100

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
