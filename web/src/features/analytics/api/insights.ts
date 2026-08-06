import { authFetch } from '../../../api/authFetch'

/**
 * Typed client for `/admin/ai-insights`.
 *
 * **The backend for this route does not exist yet.** #207 landed only Tasks 1 and 2 of the
 * reports-and-analytics plan (reports and benchmarks); Task 4, the AIInsight endpoints, is
 * still open as #86 and `MapAIInsightEndpoints` is absent from Program.cs. Calling anything
 * here today returns 404. It is written now because #93 scopes it and #95's AIInsightsPage
 * consumes it, and because pinning the wire contract up front is what stops the page and
 * the endpoint from being built to two different shapes.
 *
 * The shapes below are transcribed from the approved plan's `AIInsightDtos.cs` (Task 4,
 * `docs/superpowers/plans/2026-08-01-reports-analytics.md`) and cross-checked against the
 * `AIInsight` entity, which does already exist. If #86 ships something different, this file
 * is what has to move -- not the page.
 */

/** A row of `GET /admin/ai-insights` -- the planned `AIInsightListItem`. */
export interface AIInsightListItem {
  id: string
  companyId: string
  type: string
  category: string
  title: string
  priority: string
  isAcknowledged: boolean
}

/** The full record returned by get/acknowledge -- the planned `AIInsightDetail`. */
export interface AIInsight {
  id: string
  surveyId: string | null
  companyId: string
  departmentId: string | null
  type: string
  category: string
  title: string
  description: string
  /** An integer 0-100 on the entity, not a 0-1 fraction. */
  confidenceScore: number
  priority: string
  affectedSegments: string[]
  recommendedActions: string[]
  isAcknowledged: boolean
  /** The user id that acknowledged it -- #95 needs this to attribute the dismissal. */
  acknowledgedBy: string | null
  acknowledgedAt: string | null
}

export async function listAIInsights(baseUrl: string, companyId: string): Promise<AIInsightListItem[]> {
  const response = await authFetch(`${baseUrl}/admin/ai-insights?companyId=${encodeURIComponent(companyId)}`)
  return response.json() as Promise<AIInsightListItem[]>
}

export async function getAIInsight(baseUrl: string, id: string): Promise<AIInsight> {
  const response = await authFetch(`${baseUrl}/admin/ai-insights/${id}`)
  return response.json() as Promise<AIInsight>
}

/**
 * Marks an insight as acknowledged and returns it with `acknowledgedBy` / `acknowledgedAt`
 * filled in by the server from the caller's token. There is no un-acknowledge verb.
 *
 * No `createAIInsight` is exported: insights are machine-generated (#92), never authored in
 * the admin UI, so a create client would be dead code with no caller in #94 or #95.
 */
export async function acknowledgeAIInsight(baseUrl: string, id: string): Promise<AIInsight> {
  const response = await authFetch(`${baseUrl}/admin/ai-insights/${id}/acknowledge`, { method: 'POST' })
  return response.json() as Promise<AIInsight>
}
