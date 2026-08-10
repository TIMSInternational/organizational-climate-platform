import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
  PROFILE_THEMES,
  changePassword,
  getProfile,
  getProfileActivity,
  getProfilePreferences,
  updateProfile,
  updateProfileDisplayPreferences,
  type Profile,
  type ProfilePreferences,
} from './profile'

const baseUrl = 'http://api.test'

const profile: Profile = {
  id: '11111111-1111-1111-1111-111111111111',
  companyId: '22222222-2222-2222-2222-222222222222',
  companyName: 'Acme',
  email: 'person@acme.com',
  name: 'A Person',
  role: 'employee',
  departmentId: null,
  departmentName: 'Engineering',
  managerId: null,
  isActive: true,
  hasPassword: true,
  lastLoginAt: '2026-08-01T09:00:00Z',
  createdAt: '2026-01-01T09:00:00Z',
  demographics: {},
}

const preferences: ProfilePreferences = {
  display: { language: 'en', timezone: 'UTC', theme: 'light', dashboardLayout: 'default' },
  notifications: {
    emailSurveys: true,
    emailMicroclimates: true,
    emailActionPlans: true,
    emailReminders: true,
    digestFrequency: 'weekly',
  },
}

function respond(body: unknown, status = 200) {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))
}

describe('profile api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  /**
   * The security property of this whole feature, asserted on the client too: not one of
   * these calls puts a user id anywhere a caller could tamper with it. There is no id to
   * substitute, so there is no substitution to get wrong.
   */
  it('never puts a user id in a url or a body', async () => {
    respond(profile)
    respond(profile)
    respond({ activity: [] })
    respond(preferences)
    respond(preferences)
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }))

    await getProfile(baseUrl)
    await updateProfile(baseUrl, 'New Name')
    await getProfileActivity(baseUrl)
    await getProfilePreferences(baseUrl)
    await updateProfileDisplayPreferences(baseUrl, preferences.display)
    await changePassword(baseUrl, 'Current1Pass', 'Rep1acementPass')

    for (const [url, init] of vi.mocked(fetch).mock.calls) {
      expect(String(url)).not.toContain(profile.id)
      const body = init?.body === undefined ? '' : String(init.body)
      expect(body.toLowerCase()).not.toContain('userid')
      expect(body).not.toContain(profile.id)
    }
  })

  it('reads the caller own profile from a route with no id in it', async () => {
    respond(profile)

    const result = await getProfile(baseUrl)

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/profile`, expect.anything())
    expect(result).toEqual(profile)
  })

  it('sends only the name on update, because that is the only editable field', async () => {
    respond(profile)

    await updateProfile(baseUrl, 'Renamed Person')

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init).toMatchObject({ method: 'PUT' })
    expect(JSON.parse(String(init!.body))).toEqual({ name: 'Renamed Person' })
  })

  it('sends both passwords and resolves with nothing on a 204', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(changePassword(baseUrl, 'Current1Pass', 'Rep1acementPass')).resolves.toBeUndefined()

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(`${baseUrl}/profile/password`)
    expect(init).toMatchObject({ method: 'PUT' })
    expect(JSON.parse(String(init!.body))).toEqual({
      currentPassword: 'Current1Pass',
      newPassword: 'Rep1acementPass',
    })
  })

  it('surfaces the server message when the current password is wrong', async () => {
    respond({ message: 'Current password is incorrect' }, 400)

    await expect(changePassword(baseUrl, 'wrong', 'Rep1acementPass')).rejects.toThrow(
      'Current password is incorrect',
    )
  })

  it('unwraps the activity envelope and passes a limit through', async () => {
    respond({ activity: [{ id: 'a', action: 'profile.update', resource: 'profile', resourceId: null, success: true, timestamp: '2026-08-01T09:00:00Z' }] })

    const entries = await getProfileActivity(baseUrl, 5)

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/profile/activity?limit=5`, expect.anything())
    expect(entries).toHaveLength(1)
    expect(entries[0].action).toBe('profile.update')
  })

  it('omits the limit entirely when none is asked for', async () => {
    respond({ activity: [] })

    await getProfileActivity(baseUrl)

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/profile/activity`, expect.anything())
  })

  it('reads both halves of the one preferences store', async () => {
    respond(preferences)

    const result = await getProfilePreferences(baseUrl)

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/profile/preferences`, expect.anything())
    expect(result.notifications.digestFrequency).toBe('weekly')
  })

  /**
   * The consent guarantee, at the client boundary. The four email flags are opt-outs; a
   * save of the theme picker must not be able to carry a value for any of them, because the
   * endpoint's partial semantics are the only thing keeping them as the user left them.
   */
  it('sends only display fields on save, never a notification preference', async () => {
    respond(preferences)

    await updateProfileDisplayPreferences(baseUrl, {
      language: 'es',
      timezone: 'America/Bogota',
      theme: 'dark',
      dashboardLayout: 'default',
    })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const body = JSON.parse(String(init!.body)) as Record<string, unknown>
    expect(body).toEqual({ language: 'es', timezone: 'America/Bogota', theme: 'dark' })
    expect(Object.keys(body).some((key) => key.toLowerCase().includes('notification'))).toBe(false)
    expect(Object.keys(body).some((key) => key.toLowerCase().includes('email'))).toBe(false)
    // dashboardLayout is reported by the API and owned by #133; sending it would mint a
    // vocabulary that issue has to live with.
    expect(body).not.toHaveProperty('dashboardLayout')
  })

  it('carries the same theme vocabulary the API validates against', () => {
    expect(PROFILE_THEMES).toEqual(['light', 'dark', 'system'])
  })
})
