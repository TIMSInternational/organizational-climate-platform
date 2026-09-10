import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { getSuperAdminDashboard } from '../../../dashboard/api/dashboard'
import { listSurveys } from '../../../surveys/api/surveys'
import { listCompanies } from '../../api/companies'
import { composeCompanyRows, type CompanyListRow } from './companiesList'

export interface CompaniesListState {
  status: 'loading' | 'ready' | 'error'
  rows: readonly CompanyListRow[]
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
 * plus two enrichments, neither a new endpoint:
 *
 * - `GET /dashboard/super-admin` for each tenant's people and active surveys — the
 *   list payload has neither;
 * - `GET /surveys` with no company (every tenant, for this role) for the open wave.
 *
 * It sends NO request that writes. Each tenant's content language lives only in its
 * settings, and the only read of those is `PUT /admin/companies/{id}/settings` with an
 * empty body — a PUT, so `AuditPolicy.IsMutatingMethod` (AuditPolicy.cs:137-141) audits it
 * and `AuditWritingMiddleware` adds a `companies.settings.update` row per call. A list
 * that fired one per tenant on every visit would fill the audit trail with updates nobody
 * made, so the language column says where the language is read — the tenant's detail —
 * instead of reading it. `CompaniesListNextPage.test.tsx` pins that no PUT is sent.
 *
 * `enabled` is `canManageCompanies`: every one of these is super-only, so nothing is
 * requested for a viewer the server would refuse.
 */
export function useCompaniesListModel(enabled: boolean): CompaniesListState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [status, setStatus] = useState<CompaniesListState['status']>(enabled ? 'loading' : 'ready')
  const [rows, setRows] = useState<readonly CompanyListRow[]>([])
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
  return { status, rows, error, reload }
}
