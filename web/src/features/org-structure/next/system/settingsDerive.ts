import type { SystemSettingsData } from '../../api/systemSettings'

/**
 * The editable half of Configuración del Sistema — exactly the five fields the page has
 * always written (`SystemSettingsForm.tsx`'s `onSubmit`): availability and session. The
 * password policy and the stored mail settings are read-only on this screen, so they never
 * enter the draft and can never ride along on a save.
 */
export interface SettingsDraft {
  loginEnabled: boolean
  maintenanceMode: boolean
  maintenanceMessage: string
  maxLoginAttempts: number
  sessionTimeoutMinutes: number
}

export function draftFrom(settings: SystemSettingsData): SettingsDraft {
  return {
    loginEnabled: settings.loginEnabled,
    maintenanceMode: settings.maintenanceMode,
    maintenanceMessage: settings.maintenanceMessage ?? '',
    maxLoginAttempts: settings.maxLoginAttempts,
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
  }
}

/** Whether the draft differs from what the server last answered — what Descartar undoes. */
export function isDirty(draft: SettingsDraft, settings: SystemSettingsData): boolean {
  const saved = draftFrom(settings)
  return (Object.keys(saved) as (keyof SettingsDraft)[]).some((key) => saved[key] !== draft[key])
}

/**
 * Whether saving this draft stops everyone but a super administrator from signing in —
 * `CheckSystemSettingsGateAsync` (`AuthEndpoints.cs:424-450`) refuses sign-in when login is
 * off or maintenance is on, and lets a `super_admin` through. The warning shows while the
 * operator is deciding, from the pending position, as the old form showed it.
 */
export function locksUsersOut(draft: SettingsDraft): boolean {
  return !draft.loginEnabled || draft.maintenanceMode
}

/** The PUT body — the same five fields, the same shape, the old page sent. */
export function updatePayload(draft: SettingsDraft): SettingsDraft {
  return { ...draft }
}
