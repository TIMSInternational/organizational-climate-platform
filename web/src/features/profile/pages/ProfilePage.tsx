import { useCallback, useEffect, useState } from 'react'
import { PageTopBar } from '../../../components/layout'
import { ErrorState, LoadingRegion } from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import ChangePasswordForm from '../components/ChangePasswordForm'
import ProfileActivityList from '../components/ProfileActivityList'
import ProfileDetailsForm from '../components/ProfileDetailsForm'
import ProfilePreferencesForm from '../components/ProfilePreferencesForm'
import {
  changePassword,
  getProfile,
  getProfileActivity,
  getProfilePreferences,
  updateProfile,
  updateProfileDisplayPreferences,
  type Profile,
  type ProfileActivityEntry,
  type ProfilePreferences,
} from '../api/profile'

/**
 * The signed-in person's own account (#136).
 *
 * ## Reachable by every role, deliberately
 *
 * No role gate beyond `RequireAuth`, and no company id anywhere: every endpoint behind this
 * page resolves the caller from their own token and can address no other row. That is why
 * it is linked from the shell's account menu rather than from `navSections`, which is
 * role-aware and returns nothing at all for employees, supervisors and leaders — the very
 * people whose own profile this is.
 *
 * ## Three independent loads, three independent failures
 *
 * Profile, preferences and activity are fetched separately and each renders as soon as it
 * lands. They are genuinely independent — a failure to read the audit trail is no reason to
 * refuse to show someone their own name, and blocking the whole page on the slowest of the
 * three would make the common case worse to protect against the rare one.
 *
 * Activity is refetched after every successful write, because every one of those writes
 * appends to it. A list that silently omits the change the user just made would look broken
 * in exactly the way an audit trail must not.
 */
export default function ProfilePage() {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [profile, setProfile] = useState<Profile | null>(null)
  const [preferences, setPreferences] = useState<ProfilePreferences | null>(null)
  const [activity, setActivity] = useState<ProfileActivityEntry[] | null>(null)

  // The server's own message, or '' when the failure carried none. Held as a plain string
  // rather than a translated one so `t` — which is not a stable reference — stays out of
  // the effect's dependencies.
  const [loadError, setLoadError] = useState<string | null>(null)

  const refreshActivity = useCallback(() => {
    getProfileActivity(baseUrl)
      .then(setActivity)
      // A failed refresh leaves the previous list in place rather than blanking it. The
      // write it followed already succeeded; saying otherwise here would be misleading.
      .catch(() => undefined)
  }, [baseUrl])

  useEffect(() => {
    let cancelled = false

    getProfile(baseUrl)
      .then((result) => {
        if (!cancelled) setProfile(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : '')
      })

    getProfilePreferences(baseUrl)
      .then((result) => {
        if (!cancelled) setPreferences(result)
      })
      .catch(() => undefined)

    getProfileActivity(baseUrl)
      .then((result) => {
        if (!cancelled) setActivity(result)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [baseUrl])

  return (
    <div className="grid gap-panel-gap">
      <PageTopBar title={t('profile.title')} description={t('profile.description')} />

      {loadError !== null ? (
        <ErrorState title={t('profile.loadError')} description={loadError || undefined} />
      ) : (
        <LoadingRegion loading={profile === null} label={t('common.loading')}>
          {profile && (
            <div className="grid gap-panel-gap">
              <ProfileDetailsForm
                profile={profile}
                onSubmit={async (name) => {
                  setProfile(await updateProfile(baseUrl, name))
                  refreshActivity()
                }}
              />

              {/* Hidden, not disabled, for a Google-only account: there is no current
                  password to prove knowledge of, so the form could never succeed and a
                  greyed-out one would only invite the question of why. */}
              {profile.hasPassword && (
                <ChangePasswordForm
                  onSubmit={async (currentPassword, newPassword) => {
                    await changePassword(baseUrl, currentPassword, newPassword)
                    refreshActivity()
                  }}
                />
              )}

              {preferences && (
                <ProfilePreferencesForm
                  preferences={preferences.display}
                  onSubmit={async (values) => {
                    setPreferences(await updateProfileDisplayPreferences(baseUrl, values))
                    refreshActivity()
                  }}
                />
              )}

              {activity && <ProfileActivityList entries={activity} />}
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}
