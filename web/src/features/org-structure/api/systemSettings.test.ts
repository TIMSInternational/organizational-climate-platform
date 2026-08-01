import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { getSystemSettings, updateSystemSettings } from './systemSettings'

const baseUrl = 'http://api.test'

describe('systemSettings api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  const settings = {
    loginEnabled: true, maintenanceMode: false, maintenanceMessage: null, maxLoginAttempts: 5, sessionTimeoutMinutes: 60,
    passwordPolicy: { minLength: 8, requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: false },
    emailSettings: { smtpEnabled: false, fromEmail: null, smtpHost: null, smtpPort: null },
    updatedAt: '2026-01-01',
  }

  it('gets system settings', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(settings), { status: 200 }))
    const result = await getSystemSettings(baseUrl)
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/system-settings`, expect.anything())
    expect(result).toEqual(settings)
  })

  it('updates system settings', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...settings, loginEnabled: false }), { status: 200 }))
    const result = await updateSystemSettings(baseUrl, { loginEnabled: false })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/system-settings`, expect.objectContaining({ method: 'PUT' }))
    expect(result.loginEnabled).toBe(false)
  })
})
