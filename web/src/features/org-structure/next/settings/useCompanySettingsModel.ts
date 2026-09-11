import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { updateCompanySettings, type CompanySettingsResponse } from '../../api/companySettings'
import { listDepartments } from '../../api/departments'
import { getCompanyAdminDashboard } from '../../../dashboard/api/dashboard'
import { departmentReading, type DepartmentReading } from './derive'

export interface CompanySettingsModel {
  companyName: string | null
  settings: CompanySettingsResponse
  /** `null` when `GET /admin/departments` failed: the counts are then not printed, never 0. */
  departments: DepartmentReading | null
  /** `null` when `GET /dashboard/company-admin` failed, for the same reason. */
  surveys: { total: number; active: number } | null
}

export interface CompanySettingsModelState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  model: CompanySettingsModel | null
  error: string | null
  /** Bumped on every load, so the form re-seeds from what the server kept. */
  version: number
  reload: () => void
  /** A save answered with the record the server now holds; the form re-seeds from it. */
  replaceSettings: (settings: CompanySettingsResponse) => void
}

/**
 * The wiring seam of the CompanySettings artboard. Three existing clients, read together:
 *
 * - the settings and branding — `PUT /admin/companies/{id}/settings` with an EMPTY body, which is
 *   how this API reads them (no `GET` exists; every member of `UpdateCompanySettingsRequest` is
 *   nullable and `CompanyEndpoints.UpdateSettingsAsync` assigns only the ones present, so `{}`
 *   writes nothing and answers the current record — the same read the old page made);
 * - the department counts — `GET /admin/departments`;
 * - the survey counts and the tenant's name — `GET /dashboard/company-admin`.
 *
 * The settings are the page; the other two are readings on it and fail on their own.
 * `companyId === null` means the viewer may not manage this company, and nothing is asked.
 */
export function useCompanySettingsModel(companyId: string | null): CompanySettingsModelState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<Omit<CompanySettingsModelState, 'reload' | 'replaceSettings'>>({
    status: companyId ? 'loading' : 'idle',
    model: null,
    error: null,
    version: 0,
  })

  const load = useCallback(async () => {
    if (!companyId) return
    setState((current) => ({ ...current, status: 'loading', error: null }))
    const [settings, departments, dashboard] = await Promise.allSettled([
      updateCompanySettings(baseUrl, companyId, {}),
      listDepartments(baseUrl, companyId),
      getCompanyAdminDashboard(baseUrl, { lang: locale }),
    ])
    if (settings.status === 'rejected') {
      const reason: unknown = settings.reason
      setState((current) => ({
        ...current,
        status: 'error',
        error: reason instanceof Error ? reason.message : t('errors.generic'),
      }))
      return
    }
    setState((current) => ({
      status: 'ready',
      error: null,
      version: current.version + 1,
      model: {
        settings: settings.value,
        companyName: dashboard.status === 'fulfilled' ? dashboard.value.companyName : null,
        departments: departments.status === 'fulfilled' ? departmentReading(departments.value) : null,
        surveys:
          dashboard.status === 'fulfilled'
            ? { total: dashboard.value.surveyCount, active: dashboard.value.activeSurveyCount }
            : null,
      },
    }))
  }, [baseUrl, companyId, locale, t])

  useEffect(() => {
    void load()
  }, [load])

  const replaceSettings = useCallback((settings: CompanySettingsResponse) => {
    setState((current) =>
      current.model
        ? { ...current, version: current.version + 1, model: { ...current.model, settings } }
        : current,
    )
  }, [])

  return { ...state, reload: () => void load(), replaceSettings }
}
