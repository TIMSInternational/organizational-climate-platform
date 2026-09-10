import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { getSuperAdminDashboard } from '../../../dashboard/api/dashboard'
import { listSurveys } from '../../../surveys/api/surveys'
import { listCompanies } from '../../api/companies'
import { updateCompanySettings } from '../../api/companySettings'
import { composeCompanyRows, type CompanyListRow } from './companiesList'

export interface CompaniesListState {
  status: 'loading' | 'ready' | 'error'
  rows: readonly CompanyListRow[]
  /**
   * Each tenant's content language, read one tenant at a time. Absent while in flight,
   * `null` when that tenant's read failed — "sin leer", never a guessed language.
   */
  languages: ReadonlyMap<string, string | null>
  error: string | null
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
const isDashboard = (value: unknown) =>
  typeof value === 'object' && value !== null && Array.isArray((value as { companies?: unknown }).companies)

/**
 * THE wiring seam of the Empresas list. Same `GET /admin/companies` the old page made,
 * plus three enrichments, none of them a new endpoint:
 *
 * - `GET /dashboard/super-admin` for each tenant's people and active surveys — the
 *   list payload has neither;
 * - `GET /surveys` with no company (every tenant, for this role) for the open wave;
 * - the tenant's settings for its language, through `updateCompanySettings(id, {})`.
 *   There is no GET for settings: every member of `UpdateCompanySettingsRequest` is
 *   optional and `CompanyEndpoints.UpdateSettingsAsync` assigns only the ones present, so
 *   an empty body writes nothing and returns the record — the same read `CompanyDetailPage`
 *   makes on load. One per tenant, each settled on its own.
 *
 * `enabled` is `canManageCompanies`: every one of these is super-only, so nothing is
 * requested for a viewer the server would refuse.
 */
export function useCompaniesListModel(enabled: boolean): CompaniesListState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [status, setStatus] = useState<CompaniesListState['status']>(enabled ? 'loading' : 'ready')
  const [rows, setRows] = useState<readonly CompanyListRow[]>([])
  const [languages, setLanguages] = useState<ReadonlyMap<string, string | null>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    async function load() {
      setStatus('loading')
      setError(null)
      try {
        const [companies, dashboard, surveys] = await Promise.all([
          listCompanies(baseUrl),
          optional(() => getSuperAdminDashboard(baseUrl), isDashboard),
          optional(() => listSurveys(baseUrl, {}, locale), isList),
        ])
        if (cancelled) return
        setRows(composeCompanyRows(companies, dashboard, surveys))
        setStatus('ready')
        const read = await Promise.all(
          companies.map(async (company) => {
            const settings = await optional(
              () => updateCompanySettings(baseUrl, company.id, {}),
              (value) => typeof value === 'object' && value !== null && 'settings' in value,
            )
            return [company.id, settings ? settings.settings.language : null] as const
          }),
        )
        if (!cancelled) setLanguages(new Map(read))
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('errors.generic'))
        setStatus('error')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [enabled, baseUrl, locale, t, attempt])

  const reload = useCallback(() => setAttempt((count) => count + 1), [])
  return { status, rows, languages, error, reload }
}
