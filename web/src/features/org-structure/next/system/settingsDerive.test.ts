import { describe, it, expect } from 'vitest'
import type { SystemSettingsData } from '../../api/systemSettings'
import { draftFrom, isDirty, locksUsersOut, updatePayload } from './settingsDerive'

const SETTINGS: SystemSettingsData = {
  loginEnabled: true,
  maintenanceMode: false,
  maintenanceMessage: null,
  maxLoginAttempts: 5,
  sessionTimeoutMinutes: 60,
  passwordPolicy: { minLength: 8, requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: false },
  emailSettings: { smtpEnabled: false, fromEmail: null, smtpHost: null, smtpPort: null },
  updatedAt: '2026-08-12T02:47:06Z',
}

describe('settingsDerive', () => {
  it('writes exactly the five fields the old form wrote — never the password policy or the mail settings', () => {
    const body = updatePayload(draftFrom(SETTINGS))
    expect(Object.keys(body).sort()).toEqual(
      ['loginEnabled', 'maintenanceMessage', 'maintenanceMode', 'maxLoginAttempts', 'sessionTimeoutMinutes'].sort(),
    )
    expect(body).toEqual({ loginEnabled: true, maintenanceMode: false, maintenanceMessage: '', maxLoginAttempts: 5, sessionTimeoutMinutes: 60 })
  })

  it('is dirty only when a written field moved', () => {
    const draft = draftFrom(SETTINGS)
    expect(isDirty(draft, SETTINGS)).toBe(false)
    expect(isDirty({ ...draft, sessionTimeoutMinutes: 30 }, SETTINGS)).toBe(true)
    expect(isDirty({ ...draft, maintenanceMessage: 'Volvemos pronto' }, SETTINGS)).toBe(true)
  })

  it('warns from the pending position: login off or maintenance on locks everyone but a super administrator out', () => {
    const draft = draftFrom(SETTINGS)
    expect(locksUsersOut(draft)).toBe(false)
    expect(locksUsersOut({ ...draft, loginEnabled: false })).toBe(true)
    expect(locksUsersOut({ ...draft, maintenanceMode: true })).toBe(true)
  })
})
