import { authFetch } from '../../../api/authFetch'

/**
 * One notification as the API returns it.
 *
 * Mirrors `NotificationDetail` in
 * `src/ClimateProject.Application/Notifications/NotificationDtos.cs` (#97). There
 * is deliberately **no `readAt`**: the server records first-open as `openedAt`
 * and never moves it once set, so "read" here means `openedAt !== null` rather
 * than a separate flag. Nothing on this record is `En`/`Es`-shaped (#195) —
 * `title`/`message` are the already-rendered text of one delivery, and the
 * bilingual pair lives on the template one level up.
 */
export interface NotificationDetail {
  id: string
  userId: string
  companyId: string
  type: string
  channel: string
  priority: string
  status: string
  title: string
  message: string
  data: string | null
  templateId: string | null
  scheduledFor: string
  sentAt: string | null
  deliveredAt: string | null
  openedAt: string | null
  failedAt: string | null
  failureReason: string | null
  retryCount: number
  createdAt: string
}

export interface ListMyNotificationsOptions {
  /** Server-side filter. Cheaper than fetching everything and filtering here. */
  unreadOnly?: boolean
}

/**
 * The caller's own inbox, most recent first.
 *
 * `/notifications/mine` is scoped per **user**, not per company — a CompanyAdmin
 * calling it gets their own inbox, not their tenant's — so no `companyId`
 * argument exists or should be added.
 *
 * The optional bag goes last, with a default: a prior bug in this repo put an
 * optional `baseUrl` before the required arguments and broke five exports.
 */
export async function listMyNotifications(
  baseUrl: string,
  options: ListMyNotificationsOptions = {},
): Promise<NotificationDetail[]> {
  const query = options.unreadOnly ? '?unreadOnly=true' : ''
  const response = await authFetch(`${baseUrl}/notifications/mine${query}`)
  const body = (await response.json()) as { notifications?: NotificationDetail[] } | null
  // The endpoint wraps the list in `{ notifications: [...] }`. Defaulting rather
  // than trusting the shape keeps a malformed 200 from throwing inside a poll
  // loop, where the failure would be silent.
  return body?.notifications ?? []
}

/**
 * Marks one notification read. Idempotent server-side — re-reading does not move
 * `openedAt` — so a double click is harmless.
 */
export async function markNotificationRead(
  baseUrl: string,
  id: string,
): Promise<NotificationDetail> {
  const response = await authFetch(`${baseUrl}/notifications/${id}/read`, { method: 'POST' })
  return (await response.json()) as NotificationDetail
}

/** True when the recipient has not opened this notification yet. */
export function isUnread(notification: NotificationDetail): boolean {
  return notification.openedAt === null
}
