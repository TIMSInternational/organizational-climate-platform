import { authFetch } from '../../../api/authFetch'

/**
 * The four wire vocabularies, mirroring `NotificationTypes`, `NotificationChannels`,
 * `NotificationPriorities` and `NotificationStatuses` in
 * `src/ClimateProject.Application/Notifications/`.
 *
 * They are exported because the alternative is every form and every filter inventing
 * its own literal — which is exactly how the five question-type vocabularies drifted
 * apart (#196). They are values rather than bare types so a `<select>` can iterate them.
 *
 * Note the asymmetry between reading and writing, which is deliberate on the backend and
 * reproduced here: the *read* shapes below type these columns as plain `string`, because
 * a stored or ETL-imported row may carry a value this list does not know and nothing that
 * reads notifications may reject one. The *write* shapes use the unions.
 */
export const NOTIFICATION_TYPES = [
  'survey_invitation',
  'survey_reminder',
  'survey_completion',
  'microclimate_invitation',
  'user_invitation',
  'action_plan_alert',
  'deadline_reminder',
  'ai_insight_alert',
  'system_notification',
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

/** Every channel the schema recognises. Templates (#96) may target all four. */
export const NOTIFICATION_CHANNELS = ['email', 'in_app', 'push', 'sms'] as const

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export type DispatchableNotificationChannel = Exclude<NotificationChannel, 'push'>

/**
 * The channels `POST /notifications` and `POST /notifications/bulk` accept.
 *
 * Derived from `NOTIFICATION_CHANNELS` rather than written out again, so adding a
 * channel above cannot leave this list stale — the same rule the backend's
 * `NotificationChannels.Dispatchable` follows. `push` is excluded because this repo has
 * no push infrastructure and no device-token storage, so a dispatch reporting `sent` for
 * a push notification would assert a delivery that provably did not happen. Templates may
 * still target it so authoring can get ahead of delivery.
 */
export const DISPATCHABLE_NOTIFICATION_CHANNELS: readonly DispatchableNotificationChannel[] =
  NOTIFICATION_CHANNELS.filter(
    (channel): channel is DispatchableNotificationChannel => channel !== 'push',
  )

export const NOTIFICATION_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const

export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number]

/**
 * Six values, not four. `cancelled` is what a preference-suppressed notification becomes
 * and is never `failed`: nothing failed, the recipient asked not to receive it, and a
 * filter that conflated the two would show opt-outs as an outage.
 */
export const NOTIFICATION_STATUSES = [
  'pending',
  'sent',
  'delivered',
  'opened',
  'failed',
  'cancelled',
] as const

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number]

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

/*
 * -----------------------------------------------------------------------------
 * Admin surface.
 *
 * Everything above is self-service and scoped per **user**. Everything below is
 * scoped per **company** (SuperAdmin, or a CompanyAdmin whose claim matches), which
 * is why `companyId` is a required argument on the routes that take one — the
 * server derives nothing here, and a client that omitted it would be asking for a
 * cross-tenant read.
 * -----------------------------------------------------------------------------
 */

export interface ListCompanyNotificationsOptions {
  /**
   * Server-side status filter. The endpoint caps a page at 200 rows most-recent-first,
   * so filtering here rather than after the fetch is not an optimisation: a local
   * filter would silently drop every match older than the 200th row.
   */
  status?: NotificationStatus
}

/**
 * A tenant's notification log, most recent first.
 *
 * The optional bag goes last, after the required `companyId`: a prior bug in this repo
 * put an optional `baseUrl` before the required arguments and broke five exports.
 */
export async function listCompanyNotifications(
  baseUrl: string,
  companyId: string,
  options: ListCompanyNotificationsOptions = {},
): Promise<NotificationDetail[]> {
  const query = new URLSearchParams({ companyId })
  if (options.status) {
    query.set('status', options.status)
  }
  const response = await authFetch(`${baseUrl}/notifications?${query.toString()}`)
  const body = (await response.json()) as { notifications?: NotificationDetail[] } | null
  return body?.notifications ?? []
}

/**
 * Dispatch to one recipient.
 *
 * `templateId` is optional and stays optional — most notifications this platform sends
 * are composed by the code that raises them, and there is no rendered-from-template
 * dispatch path yet. `title`/`message` are therefore already-rendered text in one
 * language, not an `En`/`Es` pair (#195); the bilingual fields live on the template.
 */
export interface DispatchNotificationInput {
  userId: string
  companyId: string
  type: NotificationType
  channel: DispatchableNotificationChannel
  priority: NotificationPriority
  title: string
  message: string
  /** Opaque JSON document carried alongside the notification. */
  data?: string
  templateId?: string
  /** ISO-8601 instant. Omit to deliver immediately. */
  scheduledFor?: string
}

export async function dispatchNotification(
  baseUrl: string,
  input: DispatchNotificationInput,
): Promise<NotificationDetail> {
  const response = await authFetch(`${baseUrl}/notifications`, {
    method: 'POST',
    // Passed through rather than rebuilt field by field: `JSON.stringify` drops
    // `undefined` properties, so an omitted optional stays omitted on the wire and the
    // server's own default applies. Naming each field here would turn every one of them
    // into an explicit `null`, which is a different request.
    body: JSON.stringify(input),
  })
  return (await response.json()) as NotificationDetail
}

export interface DispatchBulkNotificationInput extends Omit<DispatchNotificationInput, 'userId'> {
  userIds: string[]
}

/**
 * What a bulk dispatch did.
 *
 * `unknownUserIds` is reported rather than raising: a stale roster must not block the
 * ninety-nine recipients who do exist, but silently dropping them would hide a real
 * integration bug, so a caller should surface this list.
 */
export interface BulkNotificationResult {
  requested: number
  created: number
  sent: number
  /** Suppressed by the recipient's own preferences — `cancelled`, never `failed`. */
  suppressed: number
  failed: number
  unknownUserIds: string[]
  notifications: NotificationDetail[]
}

/**
 * One request, not one per recipient. That is what keeps the server's database work
 * bounded — the handler issues a fixed number of round trips regardless of how many
 * recipients are named — so a caller with a list must not loop `dispatchNotification`.
 */
export async function dispatchBulkNotifications(
  baseUrl: string,
  input: DispatchBulkNotificationInput,
): Promise<BulkNotificationResult> {
  const response = await authFetch(`${baseUrl}/notifications/bulk`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return (await response.json()) as BulkNotificationResult
}

export interface NotificationProcessResult {
  attempted: number
  sent: number
  suppressed: number
  failed: number
}

export interface ProcessDueNotificationsOptions {
  /**
   * Restrict the sweep to one tenant. Omitting it sweeps **every** tenant and is
   * SuperAdmin-only — a CompanyAdmin who leaves this out gets a 403, not their own
   * company, so a company-scoped caller must always pass it.
   */
  companyId?: string
}

/** Delivers everything now due: future-scheduled rows that have come round, and earlier failures with retries left. */
export async function processDueNotifications(
  baseUrl: string,
  options: ProcessDueNotificationsOptions = {},
): Promise<NotificationProcessResult> {
  const query = options.companyId
    ? `?${new URLSearchParams({ companyId: options.companyId }).toString()}`
    : ''
  const response = await authFetch(`${baseUrl}/notifications/process${query}`, { method: 'POST' })
  return (await response.json()) as NotificationProcessResult
}
