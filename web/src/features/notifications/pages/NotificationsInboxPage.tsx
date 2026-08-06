import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { Badge, Button, Checkbox, Table } from '../../../components/ui'
import {
  isUnread,
  listMyNotifications,
  markNotificationRead,
  type NotificationDetail,
} from '../api/notifications'
import { notifyNotificationsChanged, subscribeToNotificationChanges } from '../notificationsChanged'
import { formatNotificationTimestamp } from '../formatTimestamp'

/** Tags this page's own announcements so it can ignore them. See the effect below. */
const INBOX_PAGE = Symbol('notifications-inbox-page')

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
 */
export default function NotificationsInboxPage() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [notifications, setNotifications] = useState<NotificationDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unreadOnly, setUnreadOnly] = useState(false)

  /**
   * @param showSpinner false for a background refresh triggered by the bell.
   * Swapping the table for "Loading…" because something changed elsewhere on the
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

  async function handleMarkRead(id: string): Promise<void> {
    const updated = await markNotificationRead(baseUrl, id)
    // Patched in place rather than re-fetched: #99 requires the row to stop being
    // unread without a reload, and a round trip would blink the whole table.
    setNotifications((current) =>
      unreadOnly
        ? current.filter((notification) => notification.id !== id)
        : current.map((notification) => (notification.id === id ? updated : notification)),
    )
    // What updates the bell's badge. See notificationsChanged.ts.
    notifyNotificationsChanged(INBOX_PAGE)
  }

  return (
    <div>
      <PageTopBar
        title={t('notifications.title')}
        description={t('notifications.inboxDescription')}
        actions={
          // A real `<label>` wrapping the control, so the text is part of the hit
          // target and the accessible name — Radix's Checkbox is a `<button
          // role="checkbox">`, which no `for`-less label would otherwise name.
          <label className="mb-0 flex items-center gap-inline">
            <Checkbox
              checked={unreadOnly}
              onCheckedChange={(checked) => setUnreadOnly(checked === true)}
            />
            <span>{t('notifications.unreadOnly')}</span>
          </label>
        }
      />

      {error && <p role="alert">{error}</p>}

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : notifications.length === 0 ? (
        <p>{unreadOnly ? t('notifications.noUnread') : t('notifications.noNotifications')}</p>
      ) : (
        // The `<Table>` primitive, never a bare `<table>`: it owns `w-full` and the
        // `overflow-x-auto` container those two rules need (#218).
        <Table>
          <thead>
            <tr>
              <th>{t('common.status')}</th>
              <th>{t('notifications.titleColumn')}</th>
              <th>{t('notifications.messageColumn')}</th>
              <th>{t('notifications.receivedColumn')}</th>
              <th>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {notifications.map((notification) => {
              const unread = isUnread(notification)
              return (
                <tr key={notification.id}>
                  <td>
                    {/* Read/unread is carried by a labelled badge, not by weight
                        alone: bold-vs-normal is invisible to a screen reader and to
                        anyone who cannot compare two rows side by side. */}
                    <Badge variant={unread ? 'default' : 'secondary'}>
                      {unread ? t('notifications.unread') : t('notifications.read')}
                    </Badge>
                  </td>
                  <td className={unread ? 'font-semibold text-fg-primary' : undefined}>
                    {notification.title}
                  </td>
                  <td>{notification.message}</td>
                  <td>{formatNotificationTimestamp(notification.createdAt, locale)}</td>
                  <td>
                    {unread && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleMarkRead(notification.id)}
                      >
                        {t('notifications.markAsRead')}
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </div>
  )
}
