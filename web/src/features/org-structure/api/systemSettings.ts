import { authFetch } from '../../../api/authFetch'

export interface PasswordPolicy {
  minLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireNumbers: boolean
  requireSpecialChars: boolean
}

export interface SystemEmailSettings {
  smtpEnabled: boolean
  fromEmail: string | null
  smtpHost: string | null
  smtpPort: number | null
}

export interface SystemSettingsData {
  loginEnabled: boolean
  maintenanceMode: boolean
  maintenanceMessage: string | null
  maxLoginAttempts: number
  sessionTimeoutMinutes: number
  passwordPolicy: PasswordPolicy
  emailSettings: SystemEmailSettings
  updatedAt: string
}

export interface UpdateSystemSettingsInput {
  loginEnabled?: boolean
  maintenanceMode?: boolean
  maintenanceMessage?: string
  maxLoginAttempts?: number
  sessionTimeoutMinutes?: number
  passwordPolicy?: PasswordPolicy
  emailSettings?: SystemEmailSettings
}

/**
 * `maintenanceMessage` is a paired column (#210) resolved server-side for `lang`. Without
 * it the server answered in its fallback language, and a Spanish operator read the English
 * half of a bilingual notice on the one screen that can turn sign-in off.
 */
export async function getSystemSettings(baseUrl: string, lang?: string): Promise<SystemSettingsData> {
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : ''
  const response = await authFetch(`${baseUrl}/admin/system-settings${query}`)
  return response.json() as Promise<SystemSettingsData>
}

export async function updateSystemSettings(baseUrl: string, input: UpdateSystemSettingsInput): Promise<SystemSettingsData> {
  const response = await authFetch(`${baseUrl}/admin/system-settings`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<SystemSettingsData>
}
