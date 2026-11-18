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

/**
 * A SURVEY's mode: the company's two, plus `personal_link` (ruled 2026-11-18) -- no username and
 * no password; «Enviar invitaciones» mails each person their own link, and the link is the key.
 * A survey-only mode: the API refuses it as a company's default (`CredentialModes.ForCompany`).
 */
export type SurveyCredentialMode = CredentialMode | 'personal_link'

export const SURVEY_CREDENTIAL_MODES: readonly SurveyCredentialMode[] = ['shared', 'per_survey', 'personal_link']

/** Whether a value read from storage or the wire is one of the survey modes. */
export function isSurveyCredentialMode(value: unknown): value is SurveyCredentialMode {
  return value === 'shared' || value === 'per_survey' || value === 'personal_link'
}

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
  /**
   * The company's «Aviso de privacidad» (Ley 8968), plain text written by the CLIENT's legal
   * team, one per language. Null when none is set. Optional only because an API older than the
   * notice sends neither.
   */
  privacyNoticeEs?: string | null
  privacyNoticeEn?: string | null
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
  /**
   * The privacy notice, per language. Omitted leaves it alone; `""` clears it; the server trims
   * and refuses more than `PRIVACY_NOTICE_MAX_LENGTH` characters with a 400.
   */
  privacyNoticeEs?: string
  privacyNoticeEn?: string
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

/**
 * `PUT /admin/companies/{id}/logo`: the body IS the image. The server reads its type off the bytes
 * (PNG, JPEG or WebP, at most 512 KB), stores it, and points the branding at the versioned
 * same-origin path it answers with (walkthrough B4, 2026-11-08).
 */
export async function uploadCompanyLogo(baseUrl: string, companyId: string, file: Blob): Promise<{ logoUrl: string }> {
  const response = await authFetch(`${baseUrl}/admin/companies/${companyId}/logo`, { method: 'PUT', body: file })
  return (await response.json()) as { logoUrl: string }
}

export async function updateCompanySettings(baseUrl: string, companyId: string, input: UpdateCompanySettingsInput): Promise<CompanySettingsResponse> {
  const response = await authFetch(`${baseUrl}/admin/companies/${companyId}/settings`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<CompanySettingsResponse>
}
