import { authFetch } from '../../../api/authFetch'
import type { ResultBandsWire } from '../../result-bands/api'

/**
 * How a company's people sign in to its surveys (`CredentialModes` on the API):
 * - `shared` — one username and password per person, mailed once, for every survey;
 * - `per_survey` — no account credentials; each person gets a code for each survey when
 *   invited to it.
 * A survey resolves and FREEZES its mode when it is created, so changing the company's
 * mode reaches only surveys created afterwards.
 */
export type CredentialMode = 'shared' | 'per_survey'

export const CREDENTIAL_MODES: readonly CredentialMode[] = ['shared', 'per_survey']

/** The company's mode, or `shared` — the API's default — when a payload carries none. */
export function credentialModeOf(settings: { credentialMode?: string } | null | undefined): CredentialMode {
  return settings?.credentialMode === 'per_survey' ? 'per_survey' : 'shared'
}

export interface CompanySettingsData {
  surveyFrequency: string
  microclimateEnabled: boolean
  aiInsightsEnabled: boolean
  anonymousSurveys: boolean
  dataRetentionDays: number
  timezone: string
  language: string
  /** `shared` | `per_survey`. Optional only because older fixtures predate it; the API always sends it. */
  credentialMode?: CredentialMode
}

export interface CompanyBranding {
  logoUrl: string | null
  primaryColor: string
  secondaryColor: string
  fontFamily: string
  customCss: string | null
}

export interface CompanySettingsResponse {
  companyId: string
  settings: CompanySettingsData
  branding: CompanyBranding
  /** The company's result bands. Absent only from an API older than them. */
  resultBands?: ResultBandsWire
}

export interface UpdateCompanySettingsInput {
  surveyFrequency?: string
  microclimateEnabled?: boolean
  aiInsightsEnabled?: boolean
  anonymousSurveys?: boolean
  dataRetentionDays?: number
  timezone?: string
  language?: string
  logoUrl?: string
  primaryColor?: string
  secondaryColor?: string
  fontFamily?: string
  customCss?: string
  /** The whole scale, replaced at once — the API refuses a scale with a gap or an overlap. */
  resultBands?: ResultBandsWire
  /** Applies only to surveys created after the change; each survey froze its own at create. */
  credentialMode?: CredentialMode
}

/**
 * `GET /admin/companies/{id}/settings` — the settings read without writing. The screens used
 * to read them by sending an empty `PUT`, which the audit trail logged as an update on every
 * page view. Same authorization as the PUT: a super admin any company, a company admin their own.
 */
export async function getCompanySettings(baseUrl: string, companyId: string): Promise<CompanySettingsResponse> {
  const response = await authFetch(`${baseUrl}/admin/companies/${companyId}/settings`)
  return response.json() as Promise<CompanySettingsResponse>
}

export async function updateCompanySettings(baseUrl: string, companyId: string, input: UpdateCompanySettingsInput): Promise<CompanySettingsResponse> {
  const response = await authFetch(`${baseUrl}/admin/companies/${companyId}/settings`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<CompanySettingsResponse>
}
