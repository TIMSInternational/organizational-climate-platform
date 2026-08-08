import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from '../../../i18n'
import { DropdownMenuItem, NotificationDropdown, type NotificationItem } from '../../../components/ui'
import { markNotificationRead } from '../api/notifications'
import { notifyNotificationsChanged } from '../notificationsChanged'
import { useUnreadNotifications } from '../useUnreadNotifications'
import { formatNotificationTimestamp } from '../formatTimestamp'

/**
 * The unread-notification bell in the app shell.
 *
 * ## Why this is not the legacy `PageTopBar`
 *
 * The legacy `layout/PageTopBar.tsx` was 19 lines that rendered a right-aligned
 * `<NotificationDropdown />`. #80 replaced the shell and gave that *name* to the
 * port of `layout/Navbar.tsx` — a page header with title, breadcrumbs and an
 * action slot — deliberately leaving the bell out, because
 * "`NotificationDropdown` has no data source until #99 and a bell that can only
 * ever say 'no notifications' is worse than no bell". #99 is the data source, so
 * the bell comes back — into the shell header that `AdminLayout` owns, not into
 * `PageTopBar`, which is per-page and would put a shell control inside whichever
 * page happened to render one.
 *
 * ## What it shows
 *
 * Unread only. The dropdown is a glance surface — the full history, read
 * included, is the inbox page, which the footer links to. That also keeps the
 * poll cheap: `?unreadOnly=true` is filtered server-side and is empty most of the
 * time, rather than pulling the 200-row page cap every minute.
 *
 * Selecting an item marks it read and goes to the inbox, because the dropdown
 * shows a truncated `message` and the inbox is where the whole thing is legible.
 */
export interface NotificationBellProps {
  /**
   * Called whenever the unread tally changes, so the shell can put the same number
   * on the Notifications nav row.
   *
   * A callback rather than the shell owning the hook and passing the state down:
   * `useUnreadNotifications` polls, and a second caller would be a second poller —
   * two requests a minute for one number, and two places on screen 200px apart free
   * to disagree for up to a whole interval. One poller, one number, and the rail
   * observes it.
   */
  onUnreadCountChange?: (count: number) => void
}

export function NotificationBell({ onUnreadCountChange }: NotificationBellProps = {}) {
  const { t, locale } = useTranslation()
  const navigate = useNavigate()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const { unread, count } = useUnreadNotifications(baseUrl)

  useEffect(() => {
    onUnreadCountChange?.(count)
  }, [count, onUnreadCountChange])

  const items: NotificationItem[] = unread.map((notification) => ({
    id: notification.id,
    title: notification.title,
    description: notification.message,
    timestamp: formatNotificationTimestamp(notification.createdAt, locale),
    // Everything here came back from `?unreadOnly=true`, so the primitive's own
    // unread tally (which drives its badge) matches `count` by construction.
    read: false,
  }))

  async function handleSelect(item: NotificationItem): Promise<void> {
    try {
      await markNotificationRead(baseUrl, item.id)
    } catch {
      // A failed mark-read must not swallow the navigation: the user asked to
      // read the thing, and the next poll will still show it unread. Announcing
      // it here would need a toast inside a menu that is already closing.
    }
    // Announced even on failure -- a refetch is how both surfaces re-converge on
    // whatever the server actually thinks.
    notifyNotificationsChanged()
    void navigate('/notifications')
  }

  return (
    <NotificationDropdown
      notifications={items}
      // The count is in the accessible name, not only in the badge: the badge is
      // `aria-hidden` inside the primitive, so without this a screen-reader user
      // is told "Notifications" and nothing about how many are waiting.
      triggerLabel={
        count > 0 ? t('notifications.bellLabelWithUnread', { count }) : t('notifications.bellLabel')
      }
      heading={t('notifications.unreadHeading')}
      emptyText={t('notifications.noUnread')}
      onSelect={(item) => void handleSelect(item)}
      footer={
        // A menu item rather than a bare link, so it takes part in the menu's
        // roving focus and is reachable with the arrow keys like every other row.
        // #80 shipped a nav control that was unreachable by keyboard entirely;
        // an anchor dropped loose into a Radix menu is that same defect.
        <DropdownMenuItem asChild>
          <Link to="/notifications">{t('notifications.viewAll')}</Link>
        </DropdownMenuItem>
      }
    />
  )
}
