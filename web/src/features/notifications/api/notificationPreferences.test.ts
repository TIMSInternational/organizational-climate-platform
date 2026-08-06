import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
  DIGEST_FREQUENCIES,
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from './notificationPreferences'

const baseUrl = 'http://api.test'

const preferences: NotificationPreferences = {
  emailSurveys: true,
  emailMicroclimates: true,
  emailActionPlans: true,
  emailReminders: true,
  digestFrequency: 'weekly',
}

describe('notificationPreferences api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('reads the caller own preferences from a route with no user id in it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(preferences), { status: 200 }))
    const result = await getNotificationPreferences(baseUrl)

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/notifications/preferences`, expect.anything())
    expect(result).toEqual(preferences)
  })

  it('sends all five values on save, so an opt-out is never inferred from an absent field', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(preferences), { status: 200 }))
    await updateNotificationPreferences(baseUrl, {
      emailSurveys: false,
      emailMicroclimates: true,
      emailActionPlans: false,
      emailReminders: false,
      digestFrequency: 'never',
    })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init).toMatchObject({ method: 'PUT' })
    expect(JSON.parse(String(init!.body))).toEqual({
      emailSurveys: false,
      emailMicroclimates: true,
      emailActionPlans: false,
      emailReminders: false,
      digestFrequency: 'never',
    })
  })

  it('never sends a push preference — the platform has no push delivery path', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(preferences), { status: 200 }))
    await updateNotificationPreferences(baseUrl, preferences)

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const body = JSON.parse(String(init!.body)) as Record<string, unknown>
    expect(Object.keys(body)).toHaveLength(5)
    expect(Object.keys(body).some((key) => key.toLowerCase().includes('push'))).toBe(false)
  })

  it('carries the same digest vocabulary the API validates against', () => {
    expect(DIGEST_FREQUENCIES).toEqual(['daily', 'weekly', 'monthly', 'never'])
  })

  it('surfaces the API message when a save is rejected', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'digestFrequency is required' }), { status: 400 }),
    )
    await expect(updateNotificationPreferences(baseUrl, preferences)).rejects.toThrow(
      'digestFrequency is required',
    )
  })
})
