import { getToken } from '../../../auth/token'

export interface BulkImportRowResult {
  rowNumber: number
  name: string
  email: string
  role: string
  department: string | null
  status: string
  /** English sentences, one per reason. The screen prefers `issues`, which it can translate. */
  errors: string[]
  /** The same reasons as stable codes, in the same order as `errors`. */
  issues?: BulkImportIssue[]
}

export interface BulkImportIssue {
  code: string
  /** What the reason is about, when it is about something: the role or department named. */
  value?: string | null
}

export interface BulkImportResponse {
  rows: BulkImportRowResult[]
  successCount: number
  errorCount: number
  /**
   * What the import did about mail: `invitation` (a link to choose a password),
   * `credentials` (an account username and password) or `none` — and in a preview, what the
   * apply would do.
   *
   * The server decides it from the company's credential mode and the request together, so
   * the chosen access mode is NOT enough to say what happened: a company in `per_survey`
   * mode has no account credentials at all, and its import creates the accounts and mails
   * nobody. Read this, not the radio, before telling somebody an email went out.
   *
   * Optional only so that a client against an older API renders its old copy rather than
   * nothing.
   */
  delivery?: 'invitation' | 'credentials' | 'none'
}

export async function bulkImportUsers(baseUrl: string, companyId: string, file: File, preview: boolean): Promise<BulkImportResponse> {
  const form = new FormData()
  form.append('file', file)
  form.append('companyId', companyId)
  form.append('preview', String(preview))

  const token = getToken()
  const headers = new Headers()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${baseUrl}/admin/users/bulk-import`, {
    method: 'POST',
    headers,
    body: form,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error((body && body.message) || `Request failed: ${response.status}`)
  }

  return response.json() as Promise<BulkImportResponse>
}
