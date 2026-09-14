import { isUnread, type NotificationDetail } from '../api/notifications'
import { surveyRespondPathFor } from '../surveyLink'

/**
 * Pure rules behind the Notifications artboard (`/notifications`): which facet a notification
 * belongs to, the counts on the facet chips, the period filter, and the one action a row offers.
 */

export type NotificationKind = 'surveys' | 'plans' | 'reports' | 'other'
export type Facet = 'all' | 'unread' | NotificationKind
export type RowIcon = 'alert' | 'report' | 'survey' | 'reminder' | 'other'

/** What the inbox draws for one row of `GET /notifications/mine`. */
export interface InboxRow {
  id: string
  kind: NotificationKind
  icon: RowIcon
  unread: boolean
  /** The notification's own title and message, as its producer wrote them. */
  title: string
  body: string
  createdAt: string
  action: { labelKey: string; href: string } | null
}

const SURVEY_TYPES = new Set(['survey_invitation', 'survey_reminder', 'survey_completion', 'microclimate_invitation'])
const PLAN_TYPES = new Set(['action_plan_alert', 'deadline_reminder'])

/** The `data` document as an object, or `{}` — a malformed or non-object payload names nothing. */
export function dataOf(notification: Pick<NotificationDetail, 'data'>): Record<string, unknown> {
  if (!notification.data) return {}
  try {
    const parsed: unknown = JSON.parse(notification.data)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function idIn(data: Record<string, unknown>, key: string): string | null {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function kindOf(notification: NotificationDetail): NotificationKind {
  if (SURVEY_TYPES.has(notification.type)) return 'surveys'
  if (PLAN_TYPES.has(notification.type)) return 'plans'
  if (notification.type === 'system_notification' && idIn(dataOf(notification), 'reportId')) return 'reports'
  return 'other'
}

function iconOf(notification: NotificationDetail, kind: NotificationKind): RowIcon {
  if (kind === 'plans') return 'alert'
  if (kind === 'reports') return 'report'
  if (notification.type === 'survey_reminder') return 'reminder'
  if (kind === 'surveys') return 'survey'
  return 'other'
}

/**
 * The one way out of a row, and only where the target exists for this viewer: a respond link
 * for an invitation (`surveyLink.ts`), the results of a survey whose results this viewer may
 * open (`canOpenResults`), the plan an alert names, the company's reports for a report.
 */
export function actionOf(
  notification: NotificationDetail,
  canOpenResults: (survey: { companyId: string }) => boolean,
): InboxRow['action'] {
  const data = dataOf(notification)
  const respond = surveyRespondPathFor(notification)
  if (respond) return { labelKey: 'notifications.next.actionRespond', href: respond }
  const surveyId = idIn(data, 'surveyId')
  if (notification.type === 'survey_completion' && surveyId && canOpenResults({ companyId: notification.companyId })) {
    return { labelKey: 'notifications.next.actionResults', href: `/surveys/${surveyId}/results` }
  }
  const planId = idIn(data, 'actionPlanId')
  if (PLAN_TYPES.has(notification.type) && planId) {
    return { labelKey: 'notifications.next.actionPlan', href: `/action-plans/${planId}` }
  }
  if (kindOf(notification) === 'reports') {
    return { labelKey: 'notifications.next.actionReport', href: `/admin/companies/${notification.companyId}/reports` }
  }
  return null
}

export function rowOf(
  notification: NotificationDetail,
  canOpenResults: (survey: { companyId: string }) => boolean,
): InboxRow {
  const kind = kindOf(notification)
  return {
    id: notification.id,
    kind,
    icon: iconOf(notification, kind),
    unread: isUnread(notification),
    title: notification.title,
    body: notification.message,
    createdAt: notification.createdAt,
    action: actionOf(notification, canOpenResults),
  }
}

export function matchesFacet(row: InboxRow, facet: Facet): boolean {
  if (facet === 'all') return true
  if (facet === 'unread') return row.unread
  return row.kind === facet
}

export function facetCounts(rows: readonly InboxRow[]): Record<Facet, number> {
  const facets: Facet[] = ['all', 'unread', 'surveys', 'plans', 'reports', 'other']
  return Object.fromEntries(facets.map((facet) => [facet, rows.filter((row) => matchesFacet(row, facet)).length])) as Record<
    Facet,
    number
  >
}

/** The period select's options in days; `0` is every notification loaded. */
export const PERIODS: readonly number[] = [7, 30, 90, 365, 0]

export function withinPeriod(row: Pick<InboxRow, 'createdAt'>, days: number, now: Date): boolean {
  if (days === 0) return true
  return now.getTime() - Date.parse(row.createdAt) <= days * 24 * 60 * 60 * 1000
}

/** `GET /notifications/mine` answers at most this many rows, newest first. */
export const INBOX_CAP = 200

/**
 * The oldest day the loaded inbox reaches — and so the day before which there is nothing —
 * but only when the endpoint did not cap the answer: a capped inbox has older rows it did not
 * send, and "nothing before" would then be a claim the page cannot make.
 */
export function oldestShown(rows: readonly InboxRow[], loadedCount: number): string | null {
  if (rows.length === 0 || loadedCount >= INBOX_CAP) return null
  return rows.reduce((oldest, row) => (row.createdAt < oldest ? row.createdAt : oldest), rows[0].createdAt)
}
