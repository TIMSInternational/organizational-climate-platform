import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { getCompanyAdminDashboard, type CompanyAdminDashboard } from '../../../dashboard/api/dashboard'
import { listBenchmarks, type BenchmarkListItem } from '../../../analytics/api/benchmarks'
import { listReports, type ReportListItem } from '../../../reports/api/reports'
import { listSurveys, type SurveyListItem } from '../../../surveys/api/surveys'
import { getCompany, type CompanyDetail } from '../../api/companies'
import { updateCompanySettings, type CompanySettingsResponse } from '../../api/companySettings'
import { listDemographicFields, type DemographicField } from '../../api/demographicFields'
import { listDepartments, type Department } from '../../api/departments'
import { listUsers, type User } from '../../api/users'

export interface SuperCompanyDetailModel {
  company: CompanyDetail
  /** `null` when the read failed: the Encuestas and Marca cards say so, and are not saved. */
  settings: CompanySettingsResponse | null
  departments: Department[] | null
  users: User[] | null
  demographicFields: DemographicField[] | null
  reports: ReportListItem[] | null
  /** The tenant's OWN benchmarks: for this role the `companyId` filter is an exact match. */
  ownBenchmarks: BenchmarkListItem[] | null
  surveys: SurveyListItem[] | null
  dashboard: CompanyAdminDashboard | null
}

export interface SuperCompanyDetailState {
  status: 'loading' | 'ready' | 'error'
  model: SuperCompanyDetailModel | null
  error: string | null
  /** Bumped on every successful load, so the form can re-seed itself from fresh values. */
  version: number
  reload: () => void
}

async function optional<T>(work: () => Promise<T>, accept: (value: unknown) => boolean): Promise<T | null> {
  try {
    const value = await work()
    return accept(value) ? value : null
  } catch {
    return null
  }
}

const isList = (value: unknown) => Array.isArray(value)
const hasKey = (key: string) => (value: unknown) => typeof value === 'object' && value !== null && key in value

/**
 * THE wiring seam of the super administrator's company detail. The three reads the old
 * page made — `GET /admin/companies/{id}`, the settings through `PUT …/settings` with an
 * empty body (the only read there is: `CompanyDetailPage`'s header has the argument) and
 * `GET /admin/departments` — plus the ones behind the canvas's readings and link cards,
 * each an existing client: users, demographic fields, reports, the tenant's own
 * benchmarks, its surveys, and `GET /dashboard/company-admin?companyId=` for the action
 * plans. The profile is the page; every other read fails on its own.
 */
export function useSuperCompanyDetailModel(companyId: string | undefined): SuperCompanyDetailState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [status, setStatus] = useState<SuperCompanyDetailState['status']>('loading')
  const [model, setModel] = useState<SuperCompanyDetailModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    async function load(id: string) {
      setStatus('loading')
      setError(null)
      try {
        const [company, settings, departments, users, demographicFields, reports, ownBenchmarks, surveys, dashboard] =
          await Promise.all([
            getCompany(baseUrl, id),
            optional(() => updateCompanySettings(baseUrl, id, {}), hasKey('settings')),
            optional(() => listDepartments(baseUrl, id), isList),
            optional(() => listUsers(baseUrl, id), isList),
            optional(() => listDemographicFields(baseUrl, id, locale), isList),
            optional(() => listReports(baseUrl, id, locale), isList),
            optional(() => listBenchmarks(baseUrl, id, locale), isList),
            optional(() => listSurveys(baseUrl, { companyId: id }, locale), isList),
            optional(() => getCompanyAdminDashboard(baseUrl, { companyId: id, lang: locale }), hasKey('openActionPlanCount')),
          ])
        if (cancelled) return
        setModel({ company, settings, departments, users, demographicFields, reports, ownBenchmarks, surveys, dashboard })
        setVersion((count) => count + 1)
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('errors.generic'))
        setStatus('error')
      }
    }
    void load(companyId)
    return () => {
      cancelled = true
    }
  }, [companyId, baseUrl, locale, t, attempt])

  const reload = useCallback(() => setAttempt((count) => count + 1), [])
  return { status, model, error, version, reload }
}
