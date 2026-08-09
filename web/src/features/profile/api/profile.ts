import { authFetch } from '../../../api/authFetch'
import type { NotificationPreferences } from '../../notifications/api/notificationPreferences'

/**
 * The caller's own account (#136).
 *
 * **No function in this file takes a user id, and that is the security property, not an
 * omission.** The endpoints resolve the caller from their token and can address no other
 * row, so there is no parameter a caller could tamper with. Administrative access to
 * somebody else's user row exists separately, under `/admin/users`.
 */
const PATH = '/profile'

export interface Profile {
  id: string
  companyId: string | null
  companyName: string | null
  email: string
  name: string
  role: string
  departmentId: string | null
  departmentName: string | null
  managerId: string | null
  isActive: boolean
  /**
   * False for a Google-only account. The change-password form is hidden rather than shown
   * and rejected — there is no current password to supply, so it could never succeed.
   */
  hasPassword: boolean
  lastLoginAt: string | null
  createdAt: string
  demographics: Record<string, string>
}

export interface ProfileActivityEntry {
  id: string
  action: string
  resource: string
  resourceId: string | null
  success: boolean
  timestamp: string
}

/** Display preferences. `dashboardLayout` is reported but not writable — #133 owns it. */
export interface ProfileDisplayPreferences {
  language: string
  timezone: string
  theme: string
  dashboardLayout: string
}

/**
 * **One store, two views.** `notifications` here is the same object
 * `/notifications/preferences` returns — the same five fields over the same columns — which
 * is why the type is imported from that feature rather than redeclared. A second interface
 * with the same shape is exactly how two stores start.
 */
export interface ProfilePreferences {
  display: ProfileDisplayPreferences
  notifications: NotificationPreferences
}

/** Values the API accepts for `display.theme`; mirrors `theme/adminTheme.ts`. */
export const PROFILE_THEMES = ['light', 'dark', 'system'] as const

export type ProfileTheme = (typeof PROFILE_THEMES)[number]

export async function getProfile(baseUrl: string): Promise<Profile> {
  const response = await authFetch(`${baseUrl}${PATH}`)
  return response.json() as Promise<Profile>
}

/**
 * Changes the caller's display name, and only that.
 *
 * The API accepts no other field, so this deliberately sends no other field: an email or a
 * role in this payload would be silently discarded, which is a worse thing for a caller to
 * discover later than a compile error now.
 */
export async function updateProfile(baseUrl: string, name: string): Promise<Profile> {
  const response = await authFetch(`${baseUrl}${PATH}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  })
  return response.json() as Promise<Profile>
}

/**
 * Changes the caller's own password, proving they know the current one.
 *
 * Resolves to nothing: the endpoint answers 204 with an empty body, because a password
 * route is the last place to start echoing state back. A wrong current password comes back
 * as a 400 whose message `authFetch` throws, **not** a 401 — a 401 would be
 * indistinguishable from an expired session and would bounce the user to the login page,
 * losing the form.
 */
export async function changePassword(
  baseUrl: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await authFetch(`${baseUrl}${PATH}/password`, {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}

/** The caller's own audit trail, most recent first. `limit` is clamped server-side. */
export async function getProfileActivity(
  baseUrl: string,
  limit?: number,
): Promise<ProfileActivityEntry[]> {
  const query = limit === undefined ? '' : `?limit=${limit}`
  const response = await authFetch(`${baseUrl}${PATH}/activity${query}`)
  const body = (await response.json()) as { activity: ProfileActivityEntry[] }
  return body.activity
}

export async function getProfilePreferences(baseUrl: string): Promise<ProfilePreferences> {
  const response = await authFetch(`${baseUrl}${PATH}/preferences`)
  return response.json() as Promise<ProfilePreferences>
}

/**
 * Saves the **display half only**, and sends nothing else.
 *
 * The endpoint's semantics are partial — an omitted field means "leave exactly as stored" —
 * and that is what makes this safe: the four notification flags are consent state, and a
 * save of the theme picker must not be able to touch them. The notification half is edited
 * on its own page (`/settings/notifications`), against the same store.
 */
export async function updateProfileDisplayPreferences(
  baseUrl: string,
  input: ProfileDisplayPreferences,
): Promise<ProfilePreferences> {
  const response = await authFetch(`${baseUrl}${PATH}/preferences`, {
    method: 'PUT',
    body: JSON.stringify({
      language: input.language,
      timezone: input.timezone,
      theme: input.theme,
    }),
  })
  return response.json() as Promise<ProfilePreferences>
}
