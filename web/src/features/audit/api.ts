import { authFetch } from '../../api/authFetch'

/**
 * `GET /audit/logs` (`AuditEndpoints.ListAsync`, #143): one page of the trail, newest first.
 *
 * A super_admin may filter to any company; a company_admin is held to their own whatever this
 * sends (`ResolveCompanyFilter` ignores the parameter for them), and every other role gets 403.
 * The page always sends the company it is scoped to, so a super_admin reads one tenant's trail
 * in that tenant's time zone rather than every tenant's mixed together.
 */
export interface AuditLogItem {
  id: string
  /** `audit_logs` here; `survey_audit_logs` appears only on the per-entity trail, not this list. */
  source: string
  userId: string | null
  /** Null for a row written by a scheduled job, or by an account since erased. */
  userName: string | null
  userEmail: string | null
  /** A code derived from the route that wrote it, e.g. `surveys.status.update`. Never shown raw. */
  action: string
  resource: string
  resourceId: string | null
  success: boolean
  errorMessage: string | null
  ipAddress: string | null
  /** An instant (ISO 8601). Shown in the company's zone. */
  timestamp: string
}

export interface AuditLogPage {
  items: AuditLogItem[]
  total: number
  page: number
  pageSize: number
}

export interface AuditLogQuery {
  companyId: string
  action?: string
  /** Instants, ISO 8601. */
  from?: string
  to?: string
  page: number
  pageSize: number
}

export async function getAuditLogs(baseUrl: string, query: AuditLogQuery): Promise<AuditLogPage> {
  const params = new URLSearchParams({
    companyId: query.companyId,
    page: String(query.page),
    pageSize: String(query.pageSize),
  })
  if (query.action) params.set('action', query.action)
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  const response = await authFetch(`${baseUrl}/audit/logs?${params.toString()}`)
  return response.json() as Promise<AuditLogPage>
}
