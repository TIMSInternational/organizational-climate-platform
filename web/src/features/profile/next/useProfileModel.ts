import { useCallback, useEffect, useState } from 'react'
import { setToken } from '../../../auth/token'
import {
  changePassword,
  getProfile,
  getProfileActivity,
  getProfilePreferences,
  updateProfile,
  updateProfileDisplayPreferences,
  type Profile,
  type ProfileActivityEntry,
  type ProfileDisplayPreferences,
  type ProfilePreferences,
} from '../api/profile'

export interface ProfileState {
  status: 'loading' | 'ready' | 'error'
  profile: Profile | null
  /** `null` until read, and when its read failed: the preferences card is then not drawn. */
  preferences: ProfilePreferences | null
  /** `null` until read, and when its read failed: the activity card is then not drawn. */
  activity: readonly ProfileActivityEntry[] | null
  error: string | null
  saveName: (name: string) => Promise<void>
  saveDisplay: (values: ProfileDisplayPreferences) => Promise<void>
  savePassword: (currentPassword: string, newPassword: string) => Promise<void>
}

/**
 * THE wiring seam of *Tu perfil* (`/profile`, Profile artboard): the reads and writes the old
 * `ProfilePage` made, unchanged — `GET /profile` (the page cannot do without it),
 * `GET /profile/preferences` and `GET /profile/activity` (each fails on its own), `PUT /profile`
 * for the name, `PUT /profile/preferences` for the display block only, and
 * `PUT /profile/password`, whose answer is a fresh token stored BEFORE anything is re-read
 * (the old token's sessions are revoked by the change). Each save refreshes the activity.
 */
export function useProfileModel(): ProfileState {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [profile, setProfile] = useState<Profile | null>(null)
  const [preferences, setPreferences] = useState<ProfilePreferences | null>(null)
  const [activity, setActivity] = useState<readonly ProfileActivityEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshActivity = useCallback(() => {
    getProfileActivity(baseUrl)
      .then(setActivity)
      .catch(() => undefined)
  }, [baseUrl])

  useEffect(() => {
    let cancelled = false
    getProfile(baseUrl)
      .then((result) => {
        if (!cancelled) setProfile(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '')
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

  return {
    status: error !== null ? 'error' : profile === null ? 'loading' : 'ready',
    profile,
    preferences,
    activity,
    error,
    saveName: async (name) => {
      setProfile(await updateProfile(baseUrl, name))
      refreshActivity()
    },
    saveDisplay: async (values) => {
      setPreferences(await updateProfileDisplayPreferences(baseUrl, values))
      refreshActivity()
    },
    savePassword: async (currentPassword, newPassword) => {
      setToken(await changePassword(baseUrl, currentPassword, newPassword))
      refreshActivity()
    },
  }
}
