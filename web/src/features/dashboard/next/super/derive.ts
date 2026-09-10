import type { SuperAdminDashboard } from '../../api/dashboard'
import type { Company } from '../../../org-structure/api/companies'
import type { SurveyListItem } from '../../../surveys/api/surveys'
import type {
  SystemAggregateStatus,
  SystemComponentStatus,
  SystemJobStatus,
  SystemStatusResponse,
} from '../../../org-structure/api/systemStatus'
import type { SystemSettingsData } from '../../../org-structure/api/systemSettings'
import { waveCode } from '../compose'
import { daysBetween } from '../derive'
import type { MissingPart, OpenSurvey, PlatformAttention, PlatformCompanyRow, PlatformModel, StatusMix } from './model'

/**
 * Every number the platform overview prints, derived from the payloads — never typed.
 * Pure, so `derive.test.ts` pins each rule against the tenant's own figures.
 */

export function statusMix(surveys: readonly Pick<SurveyListItem, 'status'>[]): StatusMix {
  const mix: StatusMix = { active: 0, closed: 0, draft: 0, archived: 0, total: surveys.length }
  for (const survey of surveys) {
    if (survey.status === 'active' || survey.status === 'closed' || survey.status === 'draft' || survey.status === 'archived') {
      mix[survey.status] += 1
    }
  }
  return mix
}

/** The tenant's open wave — the one closing soonest when, unusually, two are open. */
export function openSurveyOf(surveys: readonly SurveyListItem[]): OpenSurvey | null {
  const open = surveys
    .filter((survey) => survey.status === 'active')
    .sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate))[0]
  if (!open) return null
  return {
    id: open.id,
    companyId: open.companyId,
    name: open.title,
    code: waveCode(open.title, open.id.slice(0, 8)),
    startDate: open.startDate,
    endDate: open.endDate,
    responses: open.responseCount,
    audience: open.targetAudienceCount,
  }
}

/**
 * The calendar day an instant falls on, in UTC — the same reading `calendarDay` prints.
 * Survey dates are calendar days on the wire but the seeded ones carry a time of day, so
 * counting instants says "17 days" to a close the screen itself prints as 16 days away.
 */
export function utcDay(iso: string): string {
  return iso.slice(0, 10)
}

/** "Por actividad": an open survey first, then completed responses, then the name. */
export function byActivity(a: PlatformCompanyRow, b: PlatformCompanyRow): number {
  return (
    b.activeSurveyCount - a.activeSurveyCount ||
    b.completedResponses - a.completedResponses ||
    a.name.localeCompare(b.name)
  )
}

export function companyRows(
  dashboard: SuperAdminDashboard,
  companies: readonly Company[] | null,
  surveys: readonly SurveyListItem[] | null,
): PlatformCompanyRow[] {
  const profiles = new Map((companies ?? []).map((company) => [company.id, company]))
  const byCompany = new Map<string, SurveyListItem[]>()
  for (const survey of surveys ?? []) {
    const list = byCompany.get(survey.companyId) ?? []
    list.push(survey)
    byCompany.set(survey.companyId, list)
  }
  return dashboard.companies
    .map((summary): PlatformCompanyRow => {
      const profile = profiles.get(summary.id)
      const own = byCompany.get(summary.id) ?? []
      return {
        id: summary.id,
        name: summary.name,
        emailDomain: profile?.emailDomain ?? null,
        industry: profile?.industry ?? null,
        country: profile?.country ?? null,
        size: profile?.size ?? null,
        subscriptionTier: profile?.subscriptionTier ?? null,
        profileKnown: profile !== undefined,
        createdAt: summary.createdAt,
        people: summary.userCount,
        completedResponses: summary.completedResponseCount,
        activeSurveyCount: summary.activeSurveyCount,
        surveyCount: surveys === null ? null : own.length,
        openSurvey: surveys === null ? null : openSurveyOf(own),
      }
    })
    .sort(byActivity)
}

/** People on the platform whose account belongs to no tenant. Never negative. */
export function peopleWithoutCompany(dashboard: SuperAdminDashboard): number {
  const inTenants = dashboard.companies.reduce((sum, company) => sum + company.userCount, 0)
  return Math.max(0, dashboard.userCount - inTenants)
}

/**
 * Whether an open wave is behind its pace: its share of responses is under HALF the
 * share of its window that has already elapsed. Half, so the flag means "clearly
 * behind", not "a day slow" — on 10 Sep 2026 it holds for Acme's Q4 (1 of 24 with 21 of
 * 37 days gone) and not for Meridiano's (3 of 24 with 7 of 37 gone). A wave with no
 * invitation list has no pace to be behind.
 */
export function isBehindPace(survey: OpenSurvey, asOf: string): boolean {
  if (survey.audience === null || survey.audience <= 0) return false
  const window = daysBetween(utcDay(survey.startDate), utcDay(survey.endDate))
  const elapsed = daysBetween(utcDay(survey.startDate), asOf)
  if (window <= 0 || elapsed <= 0) return false
  const elapsedShare = Math.min(elapsed / window, 1)
  return survey.responses / survey.audience < elapsedShare / 2
}

export function attentionItems(
  rows: readonly PlatformCompanyRow[],
  surveys: readonly SurveyListItem[] | null,
  settings: SystemSettingsData | null,
  asOf: string,
): PlatformAttention[] {
  const items: PlatformAttention[] = []

  for (const row of rows) {
    const survey = row.openSurvey
    if (survey && isBehindPace(survey, asOf)) {
      items.push({
        kind: 'behind-pace',
        companyId: row.id,
        companyName: row.name,
        survey,
        daysLeft: Math.max(0, daysBetween(asOf, utcDay(survey.endDate))),
      })
    }
  }

  if (settings && !settings.emailSettings.smtpEnabled) {
    items.push({
      kind: 'mail-off',
      unconfigured: !settings.emailSettings.fromEmail && !settings.emailSettings.smtpHost,
    })
  }

  if (surveys) {
    for (const row of rows) {
      const drafts = surveys.filter((survey) => survey.companyId === row.id && survey.status === 'draft')
      if (drafts.length === 0) continue
      items.push({
        kind: 'drafts',
        companyId: row.id,
        companyName: row.name,
        count: drafts.length,
        since: drafts.map((draft) => draft.createdAt).sort()[0],
        names: drafts.map((draft) => draft.title).filter((name): name is string => Boolean(name?.trim())),
        singleQuestion: drafts.every((draft) => draft.questionCount === 1),
        languages: [...new Set(drafts.map((draft) => draft.language))],
        closesOn: drafts.map((draft) => draft.endDate).sort()[0] ?? null,
      })
    }
  }

  for (const row of rows) {
    // A profile we could not read is not a profile that is empty.
    if (!row.profileKnown) continue
    const missing: MissingPart[] = []
    if (!row.industry?.trim()) missing.push('sector')
    if (!row.country?.trim()) missing.push('country')
    if (!row.subscriptionTier?.trim()) missing.push('plan')
    if (missing.length === 0) continue
    if (row.surveyCount === 0) missing.push('surveys')
    items.push({
      kind: 'unconfigured',
      companyId: row.id,
      companyName: row.name,
      createdAt: row.createdAt,
      people: row.people,
      missing,
    })
  }

  return items
}

export function composePlatform(
  parts: {
    dashboard: SuperAdminDashboard
    companies: Company[] | null
    surveys: SurveyListItem[] | null
    system: SystemStatusResponse | null
    settings: SystemSettingsData | null
  },
  asOf: string,
): PlatformModel {
  const { dashboard, companies, surveys } = parts
  const rows = companyRows(dashboard, companies, surveys)
  const tenantsWith = (status: string) =>
    surveys === null
      ? []
      : rows.filter((row) => surveys.some((survey) => survey.companyId === row.id && survey.status === status)).map((row) => row.name)
  return {
    asOf,
    companyCount: dashboard.companyCount,
    userCount: dashboard.userCount,
    activeUserCount: dashboard.activeUserCount,
    peopleWithoutCompany: peopleWithoutCompany(dashboard),
    surveyCount: dashboard.surveyCount,
    activeSurveyCount: dashboard.activeSurveyCount,
    responseCount: dashboard.responseCount,
    completedResponseCount: dashboard.completedResponseCount,
    rows,
    mix: surveys === null ? null : statusMix(surveys),
    openCompanies: tenantsWith('active'),
    draftCompanies: tenantsWith('draft'),
    attention: attentionItems(rows, surveys, parts.settings, asOf),
    system: parts.system,
    missing: {
      companies: companies === null,
      surveys: surveys === null,
      system: parts.system === null,
      settings: parts.settings === null,
    },
  }
}

export type StatusTone = 'good' | 'warning' | 'critical' | 'neutral'

/** A status token's chip tone. Mirrors `SystemHealthPage`'s reading of the same tokens. */
export function toneOf(status: SystemComponentStatus | SystemAggregateStatus): StatusTone {
  switch (status) {
    case 'ok':
      return 'good'
    case 'slow':
    case 'backlog':
    case 'stale':
    case 'never-run':
    case 'degraded':
      return 'warning'
    case 'timeout':
    case 'unreachable':
    case 'failing':
    case 'unhealthy':
      return 'critical'
    default:
      return 'neutral'
  }
}

const JOB_SEVERITY: Readonly<Record<string, number>> = {
  ok: 0,
  unknown: 1,
  'never-run': 2,
  slow: 3,
  backlog: 3,
  stale: 4,
  timeout: 5,
  unreachable: 6,
  failing: 6,
}

/** The worst status among the scheduled jobs, or `null` when none has reported. */
export function worstJob(jobs: readonly SystemJobStatus[]): SystemComponentStatus | null {
  let worst: SystemComponentStatus | null = null
  for (const job of jobs) {
    if (worst === null || (JOB_SEVERITY[job.status] ?? 1) > (JOB_SEVERITY[worst] ?? 1)) worst = job.status
  }
  return worst
}

/** The most recent successful run across the jobs, or `null`. */
export function latestSuccess(jobs: readonly SystemJobStatus[]): string | null {
  const times = jobs.map((job) => job.lastSuccessAt).filter((at): at is string => at !== null)
  if (times.length === 0) return null
  return times.reduce((latest, at) => (Date.parse(at) > Date.parse(latest) ? at : latest))
}

/** "hace 28 segundos", in the reader's language, from `then` to `now`. */
export function ago(then: string, now: string, locale: string): string {
  const seconds = Math.round((Date.parse(then) - Date.parse(now)) / 1000)
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const size = Math.abs(seconds)
  if (size < 60) return format.format(seconds, 'second')
  if (size < 3600) return format.format(Math.round(seconds / 60), 'minute')
  if (size < 86400) return format.format(Math.round(seconds / 3600), 'hour')
  return format.format(Math.round(seconds / 86400), 'day')
}
