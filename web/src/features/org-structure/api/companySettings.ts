import { authFetch } from '../../../api/authFetch'
import type { ResultBandsWire } from '../../result-bands/api'

export interface CompanySettingsData {
  surveyFrequency: string
  microclimateEnabled: boolean
  aiInsightsEnabled: boolean
  anonymousSurveys: boolean
  dataRetentionDays: number
  timezone: string
  language: string
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
}

export async function updateCompanySettings(baseUrl: string, companyId: string, input: UpdateCompanySettingsInput): Promise<CompanySettingsResponse> {
  const response = await authFetch(`${baseUrl}/admin/companies/${companyId}/settings`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<CompanySettingsResponse>
}
