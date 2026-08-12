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
 * role-aware — and which does not mention `/profile` under any role, so no nav entry
 * anywhere points here. (The earlier wording said the non-admin branch of `navSections`
 * "returns nothing at all"; it has not since Dashboard, My surveys and Notifications were
 * added to it. The reason this page stays out of the nav is unchanged — it is per-user
 * surface, not a section — but the sentence supporting it was stale.)
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
 *
 * ## The layout, and the one thing it deliberately does not do
 *
 * The redesign pairs Details and Preferences across two columns, then runs Password and
 * Recent activity full width beneath them. Details stays first in the DOM as well as on
 * screen, because it is the panel the page is named after.
 *
 * The approved prototype puts a single **Save** in the page header. This page does not,
 * and that is a behaviour decision rather than an oversight: the three panels are three
 * independent writes against three endpoints, each with its own validation and its own
 * failure — a name that is blank, a timezone the server cannot resolve, a current password
 * that is wrong. One button over three of those either has to submit all three (turning a
 * rejected timezone into a failed rename) or has to guess which one the reader meant. Each
 * panel keeps its own submit, one column apart, which is what the code already did
 * correctly.
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
      {/* The eyebrow is passed rather than derived. `PageTopBar` names the area itself
          from the nav section the open route sits in, and `/profile` appears in no
          section for any role — `navSections.ts` never mentions it — so the derived
          value is `null` and the page would have no eyebrow at all. This is exactly the
          case the `eyebrow` prop documents: "a page belongs somewhere the nav does not
          say". */}
      <PageTopBar
        eyebrow={t('profile.eyebrow')}
        title={t('profile.title')}
        description={t('profile.description')}
      />

      {loadError !== null ? (
        <ErrorState title={t('profile.loadError')} description={loadError || undefined} />
      ) : (
        <LoadingRegion loading={profile === null} label={t('common.loading')}>
          {profile && (
            <div className="grid gap-panel-gap">
              {/* `items-start`, not the default stretch: the two panels hold different
                  numbers of fields and stretching the shorter one leaves a stripe of
                  empty card under its Save button. */}
              <div className="grid items-start gap-panel-gap lg:grid-cols-2">
                <ProfileDetailsForm
                  profile={profile}
                  onSubmit={async (name) => {
                    setProfile(await updateProfile(baseUrl, name))
                    refreshActivity()
                  }}
                />

                {preferences && (
                  <ProfilePreferencesForm
                    preferences={preferences.display}
                    onSubmit={async (values) => {
                      setPreferences(await updateProfileDisplayPreferences(baseUrl, values))
                      refreshActivity()
                    }}
                  />
                )}
              </div>

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

              {activity && <ProfileActivityList entries={activity} />}
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}
