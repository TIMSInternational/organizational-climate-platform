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

export async function getSystemSettings(baseUrl: string): Promise<SystemSettingsData> {
  const response = await authFetch(`${baseUrl}/admin/system-settings`)
  return response.json() as Promise<SystemSettingsData>
}

export async function updateSystemSettings(baseUrl: string, input: UpdateSystemSettingsInput): Promise<SystemSettingsData> {
  const response = await authFetch(`${baseUrl}/admin/system-settings`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<SystemSettingsData>
}
