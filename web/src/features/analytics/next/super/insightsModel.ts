import type { AIInsight, AIInsightListItem } from '../../api/insights'

/**
 * The typed model behind the redesigned Información de IA (`/analytics/ai-insights`).
 *
 * Everything here is read from existing clients — `GET /admin/ai-insights?companyId=` and
 * `GET /admin/ai-insights/{id}` (`api/insights.ts`), `GET /admin/users/{id}` for the
 * acknowledger's name, `GET /admin/companies` and `GET /surveys` for the choose-a-company
 * state — and every count the page prints is derived in `derive.ts`. Nothing is a sample,
 * so there is no `isSample` and no chip.
 */

/**
 * One finding: the list row, and its detail once read. The list DTO is deliberately narrow
 * (`AIInsightDtos.cs:13-14`) — no segment, no confidence, no acknowledgement date — so the
 * row reads its detail too; `null` while that read is pending or when it failed, and the
 * row then prints only what the list carries.
 */
export interface InsightRow {
  item: AIInsightListItem
  detail: AIInsight | null
}

/** One company on the choose-a-company card. */
export interface CompanyPick {
  id: string
  name: string
  /** `null` when this company's insight list could not be read. */
  insights: { total: number; acknowledged: number } | null
  /** Its surveys in `GET /surveys`, which a super administrator reads across every tenant. */
  surveys: number
  /**
   * When its findings were reviewed — "los dos revisados el 13 ago" — read from their details
   * (`GET /admin/ai-insights/{id}`), because the list DTO carries no date: the latest
   * acknowledgement and whether every one fell on that day. Absent or `null` while unread,
   * when a detail could not be read, or when not every finding is reviewed.
   */
  reviewed?: ReviewedOn | null
}

export interface ReviewedOn {
  /** The latest `acknowledgedAt`. */
  latest: string
  /** Every acknowledgement fell on the latest one's calendar day. */
  sameDay: boolean
}

export interface InsightsTally {
  total: number
  /** Not yet acknowledged. */
  open: number
  /** `high` or `critical` — "Prioridad alta". */
  high: number
  critical: number
  acknowledged: number
  /** The most recent acknowledgement among the details read, or `null` when none is dated. */
  latest: { by: string | null; at: string } | null
  /** Every dated acknowledgement names the same person. */
  oneAcknowledger: boolean
}
