import { authFetch } from '../../../api/authFetch'

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
}

export async function updateCompanySettings(baseUrl: string, companyId: string, input: UpdateCompanySettingsInput): Promise<CompanySettingsResponse> {
  const response = await authFetch(`${baseUrl}/admin/companies/${companyId}/settings`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<CompanySettingsResponse>
}
