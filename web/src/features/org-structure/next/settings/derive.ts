import type { CompanySettingsResponse, UpdateCompanySettingsInput } from '../../api/companySettings'
import type { Department } from '../../api/departments'
import type { DashboardSurveySummary } from '../../../dashboard/api/dashboard'
import type { SurveyDetail } from '../../../surveys/api/surveys'
import { plainTitle, waveOf } from '../../../dashboard/next/super/derive'

/**
 * Pure rules behind the CompanySettings artboard (`/admin/companies/:id` for a company
 * administrator). Everything the screen prints about the tenant is derived here from the
 * payloads `useCompanySettingsModel` reads; nothing is typed as a string.
 */

/**
 * Every field the form edits, as the controls hold it — the artboard's fields that a
 * company administrator may change on `PUT /admin/companies/{id}/settings`. The microclimate
 * and AI flags are not among them: the artboard draws no control for either and no endpoint
 * reads them, so this form never sends them.
 */
export interface SettingsDraft {
  language: string
  surveyFrequency: string
  anonymousSurveys: boolean
  dataRetentionDays: number
  timezone: string
  primaryColor: string
}

export const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/

export function draftOf(response: CompanySettingsResponse): SettingsDraft {
  const { settings, branding } = response
  return {
    language: settings.language,
    surveyFrequency: settings.surveyFrequency,
    anonymousSurveys: settings.anonymousSurveys,
    dataRetentionDays: settings.dataRetentionDays,
    timezone: settings.timezone,
    primaryColor: branding.primaryColor,
  }
}

/**
 * Only what changed. `CompanyEndpoints.UpdateSettingsAsync` assigns a field only when it is
 * present (and, for strings, not blank), so an unchanged field is left off the wire rather than
 * re-sent, and a colour that is not `#rrggbb` is not a change the form may send.
 */
export function changesOf(initial: SettingsDraft, draft: SettingsDraft): UpdateCompanySettingsInput {
  const changes: UpdateCompanySettingsInput = {}
  if (draft.language !== initial.language && draft.language.trim()) changes.language = draft.language
  if (draft.surveyFrequency !== initial.surveyFrequency && draft.surveyFrequency.trim()) changes.surveyFrequency = draft.surveyFrequency
  if (draft.anonymousSurveys !== initial.anonymousSurveys) changes.anonymousSurveys = draft.anonymousSurveys
  if (draft.dataRetentionDays !== initial.dataRetentionDays && draft.dataRetentionDays >= 1) changes.dataRetentionDays = draft.dataRetentionDays
  if (draft.timezone !== initial.timezone && draft.timezone.trim()) changes.timezone = draft.timezone
  if (draft.primaryColor !== initial.primaryColor && HEX_COLOUR.test(draft.primaryColor)) changes.primaryColor = draft.primaryColor
  return changes
}

/** The zones a Central American tenant picks from; the stored value is always offered too. */
export const TIMEZONES: readonly string[] = [
  'America/Costa_Rica',
  'America/Guatemala',
  'America/El_Salvador',
  'America/Tegucigalpa',
  'America/Managua',
  'America/Panama',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/New_York',
  'Europe/Madrid',
  'UTC',
]

export function timezoneOptions(current: string): readonly string[] {
  return current && !TIMEZONES.includes(current) ? [current, ...TIMEZONES] : TIMEZONES
}

/**
 * `America/Costa_Rica` → `UTC−6`, read from the platform's own zone data; `null` if unknown.
 * A zero offset is `UTC` itself: ICU names `UTC` "GMT+0" (Node 22 and Chromium both do), and
 * "UTC (UTC+0)" would print the zone twice.
 */
export function utcOffset(timeZone: string, at: Date): string | null {
  try {
    const name =
      new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
        .formatToParts(at)
        .find((part) => part.type === 'timeZoneName')?.value ?? ''
    const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(name)
    if (!match) return null
    const hours = Number(match[2] ?? 0)
    const minutes = Number(match[3] ?? 0)
    if (!match[1] || (hours === 0 && minutes === 0)) return 'UTC'
    return `UTC${match[1] === '-' ? '−' : '+'}${hours}${match[3] ? `:${match[3]}` : ''}`
  } catch {
    return null
  }
}

/** Whole years the select offers; the stored number of days is always offered too. */
export const RETENTION_DAYS: readonly number[] = [365, 730, 1095, 1825, 2555, 3650]

export function retentionOptions(current: number): readonly number[] {
  return current >= 1 && !RETENTION_DAYS.includes(current)
    ? [...RETENTION_DAYS, current].sort((a, b) => a - b)
    : RETENTION_DAYS
}

/**
 * The survey the anonymity helper names — the artboard's "La encuesta Q4 sembrada se creó como
 * no anónima": of the surveys running now (`ongoingSurveys` on `GET /dashboard/company-admin`),
 * the one that started last; `null` when none is running.
 */
export function latestOngoing(surveys: readonly DashboardSurveySummary[]): DashboardSurveySummary | null {
  return surveys.reduce<DashboardSurveySummary | null>(
    (latest, survey) => (latest === null || survey.startDate > latest.startDate ? survey : latest),
    null,
  )
}

export interface SurveyAnonymity {
  /** "Q4" for "Encuesta de Clima Q4 (abierta)"; the title without its parentheticals otherwise. */
  wave: string
  anonymous: boolean
}

/** What `GET /surveys/{id}` says about that survey: its wave and whether it was created anonymous. */
export function anonymityOf(detail: Pick<SurveyDetail, 'title' | 'settings'>): SurveyAnonymity | null {
  const wave = waveOf(detail.title) ?? plainTitle(detail.title)
  return wave === null ? null : { wave, anonymous: detail.settings.anonymous }
}

export interface DepartmentReading {
  active: number
  inactive: number
  /** People in ACTIVE departments — the same reading the Departments screen's tile prints. */
  people: number
}

export function departmentReading(departments: readonly Department[]): DepartmentReading {
  const active = departments.filter((department) => department.isActive)
  return {
    active: active.length,
    inactive: departments.length - active.length,
    people: active.reduce((total, department) => total + department.employeeCount, 0),
  }
}
