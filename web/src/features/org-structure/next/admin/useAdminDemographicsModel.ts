import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { useCompanyName } from '../../../../company-context/useCompanyName'
import { getCompanyAdminDashboard } from '../../../dashboard/api/dashboard'
import { listDemographicFields, type DemographicField } from '../../api/demographicFields'

export interface AdminDemographicsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  companyName: string | null
  fields: readonly DemographicField[]
  /**
   * Active people — the sample every cut divides (`activeUserCount`). `undefined` when
   * `GET /dashboard/company-admin` failed: no verdict is then claimed and no mean printed.
   */
  people: number | undefined
  /** Departments with people (`departmentCount`), the only cut while no field exists; `null` unread. */
  departments: number | null
  error: string | null
  reload: () => void
}

/**
 * THE wiring seam of the company administrator's *Campos demográficos* (`DemographicFields`
 * artboard): the two reads the old `DemographicFieldsPage` made — `GET
 * /admin/demographic-fields?companyId=&lang=` (the catalogue, which the page cannot do
 * without) and `GET /dashboard/company-admin` (the active people and the departments), which
 * fails on its own. The tenant's name is `useCompanyName()`'s, off `GET /profile`.
 */
export function useAdminDemographicsModel(companyId: string | undefined, enabled: boolean): AdminDemographicsState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const companyName = useCompanyName()
  const [status, setStatus] = useState<AdminDemographicsState['status']>(enabled ? 'loading' : 'idle')
  const [fields, setFields] = useState<readonly DemographicField[]>([])
  const [people, setPeople] = useState<number | undefined>(undefined)
  const [departments, setDepartments] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!companyId || !enabled) return
    let cancelled = false
    async function load(id: string) {
      setStatus('loading')
      setError(null)
      try {
        const [list, dashboard] = await Promise.all([
          listDemographicFields(baseUrl, id, locale),
          getCompanyAdminDashboard(baseUrl, { companyId: id }).catch(() => null),
        ])
        if (cancelled) return
        setFields(list)
        setPeople(dashboard ? dashboard.activeUserCount : undefined)
        setDepartments(dashboard ? dashboard.departmentCount : null)
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
  }, [baseUrl, companyId, enabled, attempt, locale, t])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  return { status, companyName, fields, people, departments, error, reload }
}
