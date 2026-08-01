import { getToken } from '../../../auth/token'

export interface BulkImportRowResult {
  rowNumber: number
  name: string
  email: string
  role: string
  department: string | null
  status: string
  errors: string[]
}

export interface BulkImportResponse {
  rows: BulkImportRowResult[]
  successCount: number
  errorCount: number
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
