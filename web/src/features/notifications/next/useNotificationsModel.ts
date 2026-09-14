import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { getProfile } from '../../profile/api/profile'
import { isUnread, listMyNotifications, markNotificationRead, type NotificationDetail } from '../api/notifications'
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from '../api/notificationPreferences'
import { notifyNotificationsChanged, subscribeToNotificationChanges } from '../notificationsChanged'

/** Tags this page's own announcements so the bell's refresh does not echo back here. */
const INBOX_NEXT = Symbol('notifications-next-page')

export interface NotificationsModelState {
  status: 'loading' | 'ready' | 'error'
  notifications: NotificationDetail[]
  error: string | null
  /** `null` when `GET /notifications/preferences` failed — the switches are then not drawn. */
  preferences: NotificationPreferences | null
  /** The viewer's own address (`GET /profile`), or `null`; it decides the local-mail note. */
  email: string | null
  reload: () => void
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  savePreferences: (next: NotificationPreferences) => Promise<void>
}

/**
 * The wiring seam of the Notifications artboard. Self-service end to end: `/notifications/mine`,
 * `/notifications/preferences` and `/profile` all resolve the caller from the token, so every
 * role reads its own inbox and nothing here takes a company id.
 */
export function useNotificationsModel(): NotificationsModelState {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [status, setStatus] = useState<NotificationsModelState['status']>('loading')
  const [notifications, setNotifications] = useState<NotificationDetail[]>([])
  const [error, setError] = useState<string | null>(null)
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [email, setEmail] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [inbox, prefs, profile] = await Promise.allSettled([
      listMyNotifications(baseUrl),
      getNotificationPreferences(baseUrl),
      getProfile(baseUrl),
    ])
    setPreferences(prefs.status === 'fulfilled' ? prefs.value : null)
    setEmail(profile.status === 'fulfilled' ? profile.value.email : null)
    if (inbox.status === 'fulfilled') {
      setNotifications(inbox.value)
      setError(null)
      setStatus('ready')
    } else {
      const reason: unknown = inbox.reason
      setError(reason instanceof Error ? reason.message : t('notifications.loadFailed'))
      setStatus('error')
    }
  }, [baseUrl, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(
    () =>
      subscribeToNotificationChanges((source) => {
        if (source !== INBOX_NEXT) void load()
      }),
    [load],
  )

  const markRead = useCallback(
    async (id: string) => {
      const updated = await markNotificationRead(baseUrl, id)
      setNotifications((current) => current.map((row) => (row.id === id ? updated : row)))
      notifyNotificationsChanged(INBOX_NEXT)
    },
    [baseUrl],
  )

  // No bulk endpoint exists (`NotificationEndpoints.cs` maps only `POST /notifications/{id}/read`),
  // so this marks the LOADED unread rows one by one and applies whichever succeeded.
  const markAllRead = useCallback(async () => {
    const results = await Promise.allSettled(
      notifications.filter(isUnread).map((row) => markNotificationRead(baseUrl, row.id)),
    )
    const byId = new Map(results.flatMap((result) => (result.status === 'fulfilled' ? [[result.value.id, result.value]] : [])))
    if (byId.size === 0) return
    setNotifications((current) => current.map((row) => byId.get(row.id) ?? row))
    notifyNotificationsChanged(INBOX_NEXT)
  }, [baseUrl, notifications])

  const savePreferences = useCallback(
    async (next: NotificationPreferences) => {
      setPreferences(await updateNotificationPreferences(baseUrl, next))
    },
    [baseUrl],
  )

  return { status, notifications, error, preferences, email, reload: () => void load(), markRead, markAllRead, savePreferences }
}
