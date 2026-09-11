import type { SuperAdminDashboard } from '../../../dashboard/api/dashboard'
import { waveCode } from '../../../dashboard/next/compose'
import type { SurveyListItem } from '../../../surveys/api/surveys'
import type { Company } from '../../api/companies'

/**
 * The rows of the redesigned Empresas list (`/admin/companies`), composed from three
 * existing reads — `GET /admin/companies` (the profile), `GET /dashboard/super-admin`
 * (people, active surveys, completed responses per tenant) and `GET /surveys` (every
 * tenant's surveys for this role). Pure, so `companiesList.test.ts` pins each rule.
 *
 * The profile is the list; the other two enrich it and may fail alone, which is why their
 * fields are `null`-able: `null` is "not read", never "none".
 */
export interface CompanyListRow {
  id: string
  name: string
  emailDomain: string | null
  industry: string | null
  size: string | null
  country: string | null
  subscriptionTier: string | null
  createdAt: string
  /** People in the tenant; `null` when the platform read failed. */
  people: number | null
  completedResponses: number
  activeSurveyCount: number | null
  /** Surveys of every status; `null` when the survey list failed. */
  surveyCount: number | null
  /** The open wave's short code and close, e.g. "Q4" and 10 Oct. */
  openSurvey: { code: string; endDate: string } | null
}

export function composeCompanyRows(
  companies: readonly Company[],
  dashboard: SuperAdminDashboard | null,
  surveys: readonly SurveyListItem[] | null,
): CompanyListRow[] {
  const summaries = new Map((dashboard?.companies ?? []).map((summary) => [summary.id, summary]))
  return companies
    .map((company): CompanyListRow => {
      const summary = summaries.get(company.id)
      const own = surveys?.filter((survey) => survey.companyId === company.id) ?? []
      const open = own
        .filter((survey) => survey.status === 'active')
        .sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate))[0]
      return {
        id: company.id,
        name: company.name,
        emailDomain: company.emailDomain,
        industry: company.industry,
        size: company.size,
        country: company.country,
        subscriptionTier: company.subscriptionTier,
        createdAt: company.createdAt,
        people: summary ? summary.userCount : null,
        completedResponses: summary?.completedResponseCount ?? 0,
        activeSurveyCount: summary ? summary.activeSurveyCount : null,
        surveyCount: surveys === null ? null : own.length,
        openSurvey: open ? { code: waveCode(open.title, open.id.slice(0, 8)), endDate: open.endDate } : null,
      }
    })
    .sort(
      (a, b) =>
        (b.activeSurveyCount ?? 0) - (a.activeSurveyCount ?? 0) ||
        b.completedResponses - a.completedResponses ||
        a.name.localeCompare(b.name),
    )
}

/** The plan filter's "no plan" option — not a tier the API can hold. */
export const NO_PLAN = '__none'

/**
 * Name, email domain or sector, as the old list searched; and the plan, where `''` is
 * every plan and `NO_PLAN` the tenants with none.
 */
export function filterCompanyRows(rows: readonly CompanyListRow[], search: string, plan: string): CompanyListRow[] {
  const needle = search.trim().toLocaleLowerCase()
  return rows.filter((row) => {
    if (plan === NO_PLAN ? Boolean(row.subscriptionTier?.trim()) : plan !== '' && row.subscriptionTier !== plan) {
      return false
    }
    if (!needle) return true
    return [row.name, row.emailDomain, row.industry].some((field) => field?.toLocaleLowerCase().includes(needle))
  })
}

/** Created and never configured: no sector, size, country or plan at all. */
export function isUnconfigured(row: CompanyListRow): boolean {
  return [row.industry, row.size, row.country, row.subscriptionTier].every((field) => !field?.trim())
}
