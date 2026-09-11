import { waveCode } from '../../../dashboard/next/compose'
import type { SurveyListItem } from '../../../surveys/api/surveys'
import type { CompanyDetail, UpdateCompanyInput } from '../../api/companies'
import type { CompanySettingsResponse, UpdateCompanySettingsInput } from '../../api/companySettings'
import type { Department } from '../../api/departments'
import type { User } from '../../api/users'

/**
 * The pure half of the super administrator's company detail: the readings it prints and
 * the one form's two diffs. `companyDetail.test.ts` pins each.
 */

export interface DepartmentSummary {
  active: readonly Department[]
  inactive: readonly Department[]
  /** Whether any inactive department still has people in it. */
  inactiveHavePeople: boolean
}

export function departmentSummary(departments: readonly Department[]): DepartmentSummary {
  // Numeric, so "Calidad 79" sits before "Calidad 406" as a reader expects.
  const byName = (a: Department, b: Department) => a.name.localeCompare(b.name, undefined, { numeric: true })
  const active = departments.filter((department) => department.isActive).sort(byName)
  const inactive = departments.filter((department) => !department.isActive).sort(byName)
  return { active, inactive, inactiveHavePeople: inactive.some((department) => department.employeeCount > 0) }
}

export interface PeopleReading {
  total: number
  active: number
  leaders: number
}

export function peopleReading(users: readonly User[]): PeopleReading {
  return {
    total: users.length,
    active: users.filter((user) => user.isActive).length,
    leaders: users.filter((user) => user.role === 'leader').length,
  }
}

/**
 * The waves the cadence helper names — "Q1 en febrero, Q2 en mayo…": every closed or open
 * survey, by close date, one per code (the latest), so an archived rehearsal copy or a
 * draft is not a wave. At most the last four.
 */
export function wavesByMonth(surveys: readonly SurveyListItem[], locale: string): Array<{ code: string; month: string }> {
  const month = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' })
  const latest = new Map<string, SurveyListItem>()
  for (const survey of surveys) {
    if (survey.status !== 'closed' && survey.status !== 'active') continue
    const code = waveCode(survey.title, '')
    if (!/^Q\d$/.test(code)) continue
    const seen = latest.get(code)
    if (!seen || Date.parse(survey.endDate) > Date.parse(seen.endDate)) latest.set(code, survey)
  }
  return [...latest.entries()]
    .sort(([, a], [, b]) => Date.parse(a.endDate) - Date.parse(b.endDate))
    .slice(-4)
    .map(([code, survey]) => ({ code, month: month.format(new Date(Date.parse(survey.endDate))) }))
}

/** 2555 days → 7 years; one decimal at most. */
export function retentionYears(days: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(days / 365)
}

export interface ProfileDraft {
  name: string
  emailDomain: string
  industry: string
  size: string
  country: string
  subscriptionTier: string
}

export interface SettingsDraft {
  language: string
  surveyFrequency: string
  anonymousSurveys: boolean
  /** As typed; validated by `settingsChanges`. */
  dataRetentionDays: string
  microclimateEnabled: boolean
  aiInsightsEnabled: boolean
  primaryColor: string
}

export function profileDraftOf(company: CompanyDetail): ProfileDraft {
  return {
    name: company.name,
    emailDomain: company.emailDomain ?? '',
    industry: company.industry ?? '',
    size: company.size ?? '',
    country: company.country ?? '',
    subscriptionTier: company.subscriptionTier ?? '',
  }
}

export function settingsDraftOf(response: CompanySettingsResponse): SettingsDraft {
  return {
    language: response.settings.language,
    surveyFrequency: response.settings.surveyFrequency,
    anonymousSurveys: response.settings.anonymousSurveys,
    dataRetentionDays: String(response.settings.dataRetentionDays),
    microclimateEnabled: response.settings.microclimateEnabled,
    aiInsightsEnabled: response.settings.aiInsightsEnabled,
    primaryColor: response.branding.primaryColor,
  }
}

const PROFILE_FIELDS = ['name', 'emailDomain', 'industry', 'size', 'country', 'subscriptionTier'] as const

/**
 * Only what changed, and only what the server will keep: `CompanyEndpoints.UpdateAsync`
 * assigns a field only when it is present and not blank, so a cleared field would be a
 * silent no-op — it is not sent, and it does not count as a change.
 */
export function profileChanges(initial: ProfileDraft, draft: ProfileDraft): UpdateCompanyInput {
  const changes: UpdateCompanyInput = {}
  for (const field of PROFILE_FIELDS) {
    const next = draft[field].trim()
    if (next !== '' && next !== initial[field].trim()) changes[field] = next
  }
  return changes
}

export const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/

/** Whole days, at least one: the retention input's only valid shape. */
export function parseRetention(value: string): number | null {
  if (!/^\s*\d+\s*$/.test(value)) return null
  const days = Number.parseInt(value, 10)
  return days >= 1 ? days : null
}

/** The settings half of the same form; an invalid retention or colour is not a change. */
export function settingsChanges(initial: SettingsDraft, draft: SettingsDraft): UpdateCompanySettingsInput {
  const changes: UpdateCompanySettingsInput = {}
  if (draft.language !== initial.language && draft.language.trim()) changes.language = draft.language
  if (draft.surveyFrequency !== initial.surveyFrequency && draft.surveyFrequency.trim()) {
    changes.surveyFrequency = draft.surveyFrequency
  }
  if (draft.anonymousSurveys !== initial.anonymousSurveys) changes.anonymousSurveys = draft.anonymousSurveys
  if (draft.microclimateEnabled !== initial.microclimateEnabled) changes.microclimateEnabled = draft.microclimateEnabled
  if (draft.aiInsightsEnabled !== initial.aiInsightsEnabled) changes.aiInsightsEnabled = draft.aiInsightsEnabled
  const days = parseRetention(draft.dataRetentionDays)
  if (days !== null && days !== parseRetention(initial.dataRetentionDays)) changes.dataRetentionDays = days
  if (draft.primaryColor !== initial.primaryColor && HEX_COLOUR.test(draft.primaryColor)) {
    changes.primaryColor = draft.primaryColor
  }
  return changes
}

/** Whether the draft holds something the form refuses to send — the save is then off. */
export function draftProblems(profile: ProfileDraft, settings: SettingsDraft | null): boolean {
  if (!profile.name.trim()) return true
  if (settings === null) return false
  return parseRetention(settings.dataRetentionDays) === null || !HEX_COLOUR.test(settings.primaryColor)
}

/**
 * "Calidad 18, Calidad 79 …" → "Calidad 18", "79", …: when every name shares its first word,
 * the word is printed once, as the canvas folds it. Anything else is returned as it came.
 */
export function foldCommonPrefix(names: readonly string[]): string[] {
  if (names.length < 2) return [...names]
  const first = names[0].split(/\s+/)[0]
  const prefix = `${first} `
  if (!first || !names.every((name) => name.startsWith(prefix) && name.length > prefix.length)) return [...names]
  return [names[0], ...names.slice(1).map((name) => name.slice(prefix.length))]
}

/** A quarter as report titles write it: "Q3" or, in Spanish, "T3" (trimestre). */
const REPORT_WAVE = /\b[QT]([1-4])\b/i

/**
 * The one quarter every report is of, or `null` — printed the way the canvas and the
 * tenant's own waves name a quarter ("Clima Q4"): "Clima organizacional — T3 2026" → "Q3".
 * The number is the reports' own; only the letter follows the board.
 */
export function reportWave(reports: readonly { title: string }[]): string | null {
  const codes = new Set(
    reports.map((report) => {
      const quarter = report.title.match(REPORT_WAVE)?.[1]
      return quarter ? `Q${quarter}` : null
    }),
  )
  const [code] = [...codes]
  return reports.length > 0 && codes.size === 1 && code ? code : null
}
