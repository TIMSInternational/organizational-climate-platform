import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { getCompanyAdminDashboard } from '../../../dashboard/api/dashboard'
import { getCompany, type CompanyDetail } from '../../api/companies'
import { listDemographicFields, type DemographicField } from '../../api/demographicFields'
import { listDepartments } from '../../api/departments'

export interface SuperDemographicsState {
  status: 'loading' | 'ready' | 'error'
  fields: readonly DemographicField[]
  /**
   * Active people — the sample every cut divides. `undefined` when the read failed: the
   * measured tiles and verdicts are then absent, never computed against a guess.
   */
  people: number | undefined
  company: CompanyDetail | null
  /** Active departments, for the empty catalogue's sentence; `null` when unread. */
  activeDepartments: number | null
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

/**
 * THE wiring seam of the super administrator's demographic fields: the two reads
 * `DemographicFieldsPage` makes — the field list and `GET /dashboard/company-admin` for
 * the headcount (`activeUserCount`: a deactivated account answers no survey) — plus the
 * tenant's name and its departments for the sentences around them.
 */
export function useSuperDemographicsModel(companyId: string | undefined): SuperDemographicsState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [status, setStatus] = useState<SuperDemographicsState['status']>('loading')
  const [fields, setFields] = useState<readonly DemographicField[]>([])
  const [people, setPeople] = useState<number | undefined>(undefined)
  const [company, setCompany] = useState<CompanyDetail | null>(null)
  const [activeDepartments, setActiveDepartments] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    async function load(id: string) {
      setStatus('loading')
      setError(null)
      try {
        const [list, dashboard, tenant, units] = await Promise.all([
          listDemographicFields(baseUrl, id, locale),
          optional(
            () => getCompanyAdminDashboard(baseUrl, { companyId: id }),
            (value) => typeof value === 'object' && value !== null && typeof (value as { activeUserCount?: unknown }).activeUserCount === 'number',
          ),
          optional(() => getCompany(baseUrl, id), (value) => typeof value === 'object' && value !== null && 'name' in value),
          optional(() => listDepartments(baseUrl, id), (value) => Array.isArray(value)),
        ])
        if (cancelled) return
        setFields(list)
        setPeople(dashboard ? dashboard.activeUserCount : undefined)
        setCompany(tenant)
        setActiveDepartments(units ? units.filter((unit) => unit.isActive).length : null)
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
  return { status, fields, people, company, activeDepartments, error, reload }
}
