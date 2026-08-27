import { useEffect, useState } from 'react'
import { PageTopBar } from '../../../components/layout'
import { ErrorState, LoadingRegion } from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import NotificationPreferencesForm from '../components/NotificationPreferencesForm'
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from '../api/notificationPreferences'

/**
 * Self-service notification preferences (#103).
 *
 * Every authenticated role reaches this page — it is not admin surface, and the API it
 * calls has no user id in its route, so there is nothing to scope. That is also why it
 * is linked from the shell controls (beside language, theme and sign out) rather than
 * from `navSections`, which is role-aware and empty for employees.
 *
 * The form is only mounted once real values have arrived. Rendering it against a guessed
 * default and correcting it on load would flash preferences the user never chose, which
 * on a consent surface is exactly the thing to avoid.
 */
export default function NotificationPreferencesPage() {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  // The server's own message, or '' when the failure carried none. Kept out of the effect
  // as a translated string on purpose: `t` is not a stable reference, so putting it in the
  // dependency array would refetch on every render.
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    getNotificationPreferences(baseUrl)
      .then((result) => {
        if (!cancelled) setPreferences(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : '')
      })

    return () => {
      cancelled = true
    }
  }, [baseUrl])

  return (
    <div className="grid gap-panel-gap">
      {/* The eyebrow is passed, not derived, and it has to be. `PageTopBar` names the area
          from the nav section the open route sits in, and `navSections.ts` has no route
          under `/settings` for any role — so the derived value is `null` and this was the
          one page in the shell whose header opened on a bare `<h1>` with no kicker over
          it. Its two siblings in the same cluster, `/profile` and `/settings/privacy`,
          both already pass "Account" for exactly this reason; this page did not, and read
          as a different product's screen sitting between them. */}
      <PageTopBar
        eyebrow={t('notifications.preferences.eyebrow')}
        title={t('notifications.preferences.title')}
        description={t('notifications.preferences.description')}
      />

      {loadError !== null ? (
        <ErrorState
          title={t('notifications.preferences.loadError')}
          description={loadError || undefined}
        />
      ) : (
        <LoadingRegion loading={preferences === null} label={t('common.loading')}>
          {preferences && (
            <NotificationPreferencesForm
              preferences={preferences}
              onSubmit={async (values) => {
                setPreferences(await updateNotificationPreferences(baseUrl, values))
              }}
            />
          )}
        </LoadingRegion>
      )}
    </div>
  )
}
