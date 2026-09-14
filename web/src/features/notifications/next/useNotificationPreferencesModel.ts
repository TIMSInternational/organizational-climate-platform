import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../i18n'
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from '../api/notificationPreferences'

export interface NotificationPreferencesState {
  status: 'loading' | 'ready' | 'error'
  /** What the account holds — never a guessed default. `null` until read. */
  saved: NotificationPreferences | null
  error: string | null
  retry: () => void
  save: (values: NotificationPreferences) => Promise<NotificationPreferences>
}

/**
 * THE wiring seam of *Preferencias de notificaciones* (`/settings/notifications`): the old
 * page's two calls, unchanged — `GET /notifications/preferences` and `PUT` of exactly the five
 * values the person set, keeping what the server returns as the new saved state. The caller is
 * resolved from the token; no user id is sent.
 */
export function useNotificationPreferencesModel(): NotificationPreferencesState {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [saved, setSaved] = useState<NotificationPreferences | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(null)
    getNotificationPreferences(baseUrl)
      .then((result) => {
        if (!cancelled) setSaved(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error && err.message ? err.message : t('notifications.preferences.loadError'))
      })
    return () => {
      cancelled = true
    }
  }, [attempt, baseUrl, t])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  return {
    status: error !== null ? 'error' : saved === null ? 'loading' : 'ready',
    saved,
    error,
    retry,
    save: async (values) => {
      const result = await updateNotificationPreferences(baseUrl, values)
      setSaved(result)
      return result
    },
  }
}
