import { authFetch } from '../../../api/authFetch'
import type { SurveyQuestion, SurveySettings } from '../api/surveys'

/**
 * Typed client for the four read-only routes of `SurveyHistoryEndpoints.cs` (#106): a
 * survey's change log (`survey_audit_logs`) and its published content snapshots
 * (`survey_versions`). Every route is `CanAdminister` — a super administrator, or a company
 * administrator of the survey's own company — and answers 403 to anyone else.
 *
 * There is no write route in that file: no restore, no revert. A version is a record of what
 * respondents saw, not a save point.
 *
 * Two fields arrive that the history screen deliberately never prints:
 * `SurveyVersionList.responseCount` / `collectedResponses` (response data has no place on a
 * page about authorship) and `SurveyAuditEntry.ipAddress`.
 */

/** The five values `SurveyAuditActions.All` writes. Anything else is an older or newer row. */
export type SurveyAuditAction = 'created' | 'updated' | 'status_changed' | 'duplicated' | 'version_created'

/** `SurveyAuditChangeSet`: field paths for an update, from/to for a status, the number for a version. */
export interface SurveyAuditChangeSet {
  fields?: readonly string[] | null
  from?: string | null
  to?: string | null
  versionNumber?: number | null
}

export interface SurveyAuditEntry {
  id: string
  surveyId: string
  action: string
  entityType: string
  /** For `duplicated`, the copy's survey id. */
  entityId: string | null
  changes: SurveyAuditChangeSet | null
  userId: string
  userName: string
  userEmail: string
  userRole: string
  timestamp: string
  ipAddress: string | null
}

export interface SurveyHistoryResponse {
  surveyId: string
  entries: SurveyAuditEntry[]
}

export interface SurveyVersionSummary {
  id: string
  surveyId: string
  versionNumber: number
  title: string | null
  language: string
  resolvedLocale: string
  fallbackFields: string[]
  /** `publish` | `republish` (`SurveyVersionReasons`). */
  reason: string
  /** Field paths that differ from the previous version; empty for the first. */
  changes: string[]
  questionCount: number
  createdBy: string
  createdByName: string | null
  createdByEmail: string | null
  createdAt: string
  isCurrent: boolean
  collectedResponses: boolean
}

export interface SurveyVersionList {
  surveyId: string
  currentVersion: number
  responseCount: number
  versions: SurveyVersionSummary[]
}

export interface SurveyVersionDetail {
  id: string
  surveyId: string
  versionNumber: number
  title: string | null
  description: string | null
  type: string
  language: string
  resolvedLocale: string
  fallbackFields: string[]
  startDate: string
  endDate: string
  departmentIds: string[]
  targetAudienceCount: number | null
  questions: SurveyQuestion[]
  settings: SurveySettings
  reason: string
  changes: string[]
  createdBy: string
  createdByName: string | null
  createdByEmail: string | null
  createdAt: string
  isCurrent: boolean
  collectedResponses: boolean
}

export interface SurveyVersionComparison {
  surveyId: string
  from: SurveyVersionDetail
  to: SurveyVersionDetail
  changes: string[]
}

/** The server's ceiling (`MaxHistoryLimit`); the screen asks for all of it and says when it is reached. */
export const HISTORY_LIMIT = 500

function withLang(url: string, lang?: string): string {
  return lang ? `${url}${url.includes('?') ? '&' : '?'}lang=${encodeURIComponent(lang)}` : url
}

export async function getSurveyHistory(baseUrl: string, surveyId: string): Promise<SurveyHistoryResponse> {
  const response = await authFetch(`${baseUrl}/surveys/${surveyId}/history?limit=${HISTORY_LIMIT}`)
  return response.json() as Promise<SurveyHistoryResponse>
}

export async function listSurveyVersions(baseUrl: string, surveyId: string, lang?: string): Promise<SurveyVersionList> {
  const response = await authFetch(withLang(`${baseUrl}/surveys/${surveyId}/versions`, lang))
  return response.json() as Promise<SurveyVersionList>
}

export async function compareSurveyVersions(
  baseUrl: string,
  surveyId: string,
  from: number,
  to: number,
  lang?: string,
): Promise<SurveyVersionComparison> {
  const response = await authFetch(withLang(`${baseUrl}/surveys/${surveyId}/versions/compare?from=${from}&to=${to}`, lang))
  return response.json() as Promise<SurveyVersionComparison>
}
