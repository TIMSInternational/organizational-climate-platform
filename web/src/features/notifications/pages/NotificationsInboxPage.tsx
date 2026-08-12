import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { Badge, Button, Checkbox } from '../../../components/ui'
import {
  isUnread,
  listMyNotifications,
  markNotificationRead,
  type NotificationDetail,
} from '../api/notifications'
import { notifyNotificationsChanged, subscribeToNotificationChanges } from '../notificationsChanged'
import { formatNotificationTimestamp } from '../formatTimestamp'
import { groupNotificationsByDay, type NotificationGroupKey } from '../groupByDay'

/** Tags this page's own announcements so it can ignore them. See the effect below. */
const INBOX_PAGE = Symbol('notifications-inbox-page')

/** Catalogue paths for the three recency headings `groupByDay.ts` produces. */
const GROUP_LABEL_PATH: Record<NotificationGroupKey, string> = {
  today: 'notifications.groupToday',
  yesterday: 'notifications.groupYesterday',
  earlier: 'notifications.groupEarlier',
}

/**
 * Catalogue paths for the wire type vocabulary, keyed by the API's own values
 * (`NOTIFICATION_TYPES` in `../api/notifications`).
 *
 * A type with no entry falls back to the raw wire value rather than to a blank chip —
 * the same rule `ProfileActivityList` follows, and for the same reason: an ETL-imported
 * or newly-added type should read legibly-if-untranslated rather than disappear.
 */
const TYPE_LABEL_PATH: Record<string, string> = {
  survey_invitation: 'notifications.typeSurveyInvitation',
  survey_reminder: 'notifications.typeSurveyReminder',
  survey_completion: 'notifications.typeSurveyCompletion',
  microclimate_invitation: 'notifications.typeMicroclimateInvitation',
  user_invitation: 'notifications.typeUserInvitation',
  action_plan_alert: 'notifications.typeActionPlanAlert',
  deadline_reminder: 'notifications.typeDeadlineReminder',
  ai_insight_alert: 'notifications.typeAiInsightAlert',
  system_notification: 'notifications.typeSystemNotification',
}

/**
 * The caller's own notification inbox.
 *
 * Self-service, so there is no company picker and no role gate: `/notifications/mine`
 * is scoped per **user**, and a CompanyAdmin calling it gets their own inbox rather
 * than their tenant's. That is why this page — unlike every other list page in the
 * app — reads nothing off the JWT claims.
 *
 * The unread filter is pushed to the server (`?unreadOnly=true`) rather than applied
 * to a full list here: the endpoint caps a page at 200 rows, so filtering client-side
 * would silently drop unread items older than the 200th notification.
 *
 * ## Why this is a grouped list and no longer a table
 *
 * A notification is a message, not a record: five columns of which two held prose made
 * every row wrap differently and put the thing the reader is scanning for — *what
 * changed, and does it want anything from me* — behind a status column. The redesign
 * renders one hairline-separated row per notification under a recency heading, with
 * the unread mark, the title, the message, what kind of notification it is, and the
 * one action it offers. `Table`'s scroll container (#218) is not lost by this: there
 * is no fixed-width row left to scroll, and prose reflows instead.
 *
 * Read state is still carried **in words** as well as by the dot and the weight — the
 * dot is 8px of colour and nothing else (`size-2`, and `theme.css` sets `--spacing` to
 * `--admin-space-4` = 4px), which WCAG 1.4.1 does not accept on its own. The approved
 * prototype draws it at 7px; this build has no 7px step and rounding it to the scale is
 * the right trade, since the measurement is not what carries the meaning.
 *
 * ## Every reading is mono
 *
 * The timestamp and the per-group unread count are set in `font-mono tabular-nums`;
 * the title and message stay in the sans face. That is the typographic rule the whole
 * redesign runs on, applied to the only two numbers on this screen.
 */
export default function NotificationsInboxPage() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [notifications, setNotifications] = useState<NotificationDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)

  /**
   * @param showSpinner false for a background refresh triggered by the bell.
   * Swapping the list for "Loading…" because something changed elsewhere on the
   * page would make the row the user is reading disappear under them.
   */
  const load = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true)
      setError(null)
      try {
        setNotifications(await listMyNotifications(baseUrl, { unreadOnly }))
      } catch (err) {
        setError(err instanceof Error ? err.message : t('notifications.loadFailed'))
      } finally {
        if (showSpinner) setLoading(false)
      }
    },
    [baseUrl, unreadOnly, t],
  )

  useEffect(() => {
    void load(true)
  }, [load])

  // Keeps this page honest when the shell bell is what marked something read.
  // Its own announcements are skipped: `handleMarkRead` has already patched the
  // row, and re-fetching in response to itself would throw that away and cost a
  // round trip for nothing.
  useEffect(
    () =>
      subscribeToNotificationChanges((source) => {
        if (source === INBOX_PAGE) return
        void load(false)
      }),
    [load],
  )

  // Recomputed from the list rather than held in state: two sources for "which day is
  // this in" is how a heading starts disagreeing with the row under it. `new Date()`
  // is read once per grouping so every row in one render is bucketed against the same
  // instant — grouping row by row can put two rows a microsecond apart on either side
  // of midnight.
  const groups = useMemo(() => groupNotificationsByDay(notifications, new Date()), [notifications])
  const unreadCount = notifications.filter(isUnread).length

  async function handleMarkRead(id: string): Promise<void> {
    const updated = await markNotificationRead(baseUrl, id)
    // Patched in place rather than re-fetched: #99 requires the row to stop being
    // unread without a reload, and a round trip would blink the whole list.
    setNotifications((current) =>
      unreadOnly
        ? current.filter((notification) => notification.id !== id)
        : current.map((notification) => (notification.id === id ? updated : notification)),
    )
    // What updates the bell's badge. See notificationsChanged.ts.
    notifyNotificationsChanged(INBOX_PAGE)
  }

  /**
   * Marks every unread notification **currently loaded** read.
   *
   * There is no bulk endpoint: `NotificationEndpoints.cs` maps `POST
   * /notifications/{id}/read` and nothing wider, so this issues one request per unread
   * row. That is why it acts on the loaded page rather than on the inbox as a whole —
   * claiming to clear notifications this page has never fetched would be a promise the
   * client cannot keep.
   *
   * `allSettled`, not `all`: one failed row must not abandon the rest, and the ones
   * that did succeed are applied. Anything still unread afterwards is simply still
   * there, which is the honest report and needs no extra message.
   */
  async function handleMarkAllRead(): Promise<void> {
    setMarkingAll(true)
    try {
      const results = await Promise.allSettled(
        notifications
          .filter(isUnread)
          .map((notification) => markNotificationRead(baseUrl, notification.id)),
      )
      const updated = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value)
      if (updated.length === 0) return

      const byId = new Map(updated.map((notification) => [notification.id, notification]))
      setNotifications((current) =>
        unreadOnly
          ? current.filter((notification) => !byId.has(notification.id))
          : current.map((notification) => byId.get(notification.id) ?? notification),
      )
      notifyNotificationsChanged(INBOX_PAGE)
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <div className="grid gap-panel-gap">
      <PageTopBar
        eyebrow={t('notifications.eyebrow')}
        title={t('notifications.title')}
        description={t('notifications.inboxDescription')}
        actions={
          <>
            {/* A real `<label>` wrapping the control, so the text is part of the hit
                target and the accessible name — Radix's Checkbox is a `<button
                role="checkbox">`, which no `for`-less label would otherwise name. */}
            <label className="mb-0 flex items-center gap-inline">
              <Checkbox
                checked={unreadOnly}
                onCheckedChange={(checked) => setUnreadOnly(checked === true)}
              />
              <span>{t('notifications.unreadOnly')}</span>
            </label>
            <Button variant="outline" size="sm" asChild>
              <Link to="/settings/notifications">{t('notifications.preferencesAction')}</Link>
            </Button>
            {/* Disabled with nothing to mark rather than hidden: a control that appears
                and disappears as the inbox drains is harder to find than one that is
                always in the same place. */}
            <Button
              variant="outline"
              size="sm"
              disabled={unreadCount === 0 || markingAll}
              onClick={() => void handleMarkAllRead()}
            >
              {t('notifications.markAllAsRead')}
            </Button>
          </>
        }
      />

      {error && <p role="alert">{error}</p>}

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : notifications.length === 0 ? (
        <p>{unreadOnly ? t('notifications.noUnread') : t('notifications.noNotifications')}</p>
      ) : (
        <div className="grid gap-section">
          {groups.map((group) => (
            <section key={group.key} className="grid gap-inline">
              <div className="flex flex-wrap items-baseline justify-between gap-inline">
                <h2 className="mb-0 text-sm font-semibold tracking-tight">
                  {t(GROUP_LABEL_PATH[group.key])}
                </h2>
                <span className="font-mono text-2xs uppercase tracking-label text-fg-tertiary tabular-nums">
                  {t('notifications.groupUnreadCount', {
                    unread: group.unread,
                    total: group.items.length,
                  })}
                </span>
              </div>

              {/* Hairlines between rows, one border around the set: the design's
                  1px-gap-over-a-line stack, expressed with `divide-y` so an empty
                  first or last row cannot leave a doubled rule. */}
              <ul
                className="m-0 list-none divide-y divide-line-light overflow-hidden rounded-lg border border-line-light p-0"
              >
                {group.items.map((notification) => {
                  const unread = isUnread(notification)
                  const typePath = TYPE_LABEL_PATH[notification.type]
                  return (
                    <li
                      key={notification.id}
                      data-slot="notification-row"
                      className="flex flex-wrap items-start gap-inline bg-surface-panel p-3"
                    >
                      {/* The dot is decoration on top of the badge below, never the
                          only carrier of read state — hence aria-hidden. */}
                      <span
                        aria-hidden="true"
                        className={
                          unread
                            ? 'mt-1.5 size-2 shrink-0 rounded-full bg-accent-blue'
                            : 'mt-1.5 size-2 shrink-0 rounded-full bg-transparent'
                        }
                      />

                      <div className="min-w-0 flex-1">
                        <p
                          className={
                            unread
                              ? 'mb-0 font-semibold text-fg-primary'
                              : 'mb-0 font-medium text-fg-secondary'
                          }
                        >
                          {notification.title}
                        </p>
                        <p className="mb-0 text-sm text-fg-secondary">{notification.message}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-inline">
                          <Badge variant="secondary">
                            {typePath ? t(typePath) : notification.type}
                          </Badge>
                          {/* Read state in words, not by the dot or the weight alone. */}
                          <Badge variant={unread ? 'default' : 'outline'}>
                            {unread ? t('notifications.unread') : t('notifications.read')}
                          </Badge>
                        </div>
                      </div>

                      {/* A column, not a row: with the action beside the timestamp the
                          rows that have no action let their timestamp run to the panel
                          edge while the rest stop short of it, so a column of readings
                          that should line up does not. Stacking costs no height — the
                          left-hand block is already three lines tall.

                          `w-full` below `sm` drops the whole block onto its own line.
                          Measured at 390px: sharing the line leaves the message about
                          150px wide and wraps a one-line sentence to five, because the
                          timestamp cannot shrink and the prose can. */}
                      <div className="flex w-full shrink-0 flex-col items-start gap-1 sm:w-auto sm:items-end">
                        <time
                          dateTime={notification.createdAt}
                          className="font-mono text-xs text-fg-tertiary tabular-nums"
                        >
                          {formatNotificationTimestamp(notification.createdAt, locale)}
                        </time>
                        {unread && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleMarkRead(notification.id)}
                          >
                            {t('notifications.markAsRead')}
                          </Button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
