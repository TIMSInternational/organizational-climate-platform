import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { ANONYMITY_FLOOR } from '../../../../components/charts'
import { todayCalendarDay } from '../../../../lib/calendarDay'
import { listDepartments, type Department } from '../../api/departments'
import { listUsers, type User } from '../../api/users'
import { listActionPlans, type ActionPlan } from '../../../action-plans/api/actionPlans'
import { DEPARTMENT_GROUP, getClimateTrends, type ClimateTrendsResponse } from '../../../surveys/api/climateTrends'
import { latestClosedWave, rowsOf, summaryOf, type DepartmentRow, type DepartmentsSummary, type Wave } from './derive'

export interface DepartmentsModel {
  departments: Department[]
  rows: DepartmentRow[]
  summary: DepartmentsSummary
  wave: Wave | null
  /** Which enrichments failed — each column then prints a dash, never a zero. */
  missing: { users: boolean; plans: boolean; climate: boolean }
}

export interface DepartmentsModelState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  model: DepartmentsModel | null
  error: string | null
  reload: () => void
}

/**
 * The wiring seam of the Departments artboard: four existing clients, read together.
 *
 * - `GET /admin/departments` — the page; losing it is an error with a retry.
 * - `GET /admin/users` — who leads and who supervises each department (`role` + `departmentId`).
 * - `GET /action-plans` — open, overdue and not-started plans per department.
 * - `GET /surveys/climate-trends?groupBy=department` — the latest closed wave per department,
 *   suppressed under the floor by the server and checked again here.
 *
 * The last three are readings on the page and fail on their own (`Promise.allSettled`).
 * `scopeCompanyId` is sent to the climate endpoint only for a super administrator, whose tenant
 * is their selection; a company administrator's comes from the claim on the server.
 */
export function useDepartmentsModel(companyId: string | null, scopeCompanyId?: string): DepartmentsModelState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<Omit<DepartmentsModelState, 'reload'>>({
    status: companyId ? 'loading' : 'idle',
    model: null,
    error: null,
  })

  const load = useCallback(async () => {
    if (!companyId) return
    setState((current) => ({ ...current, status: 'loading', error: null }))
    const [departments, users, plans, trends] = await Promise.allSettled([
      listDepartments(baseUrl, companyId),
      listUsers(baseUrl, companyId),
      listActionPlans(baseUrl, companyId, {}, locale),
      getClimateTrends(baseUrl, { groupBy: DEPARTMENT_GROUP, lang: locale, companyId: scopeCompanyId }),
    ])
    if (departments.status === 'rejected') {
      const reason: unknown = departments.reason
      setState({ status: 'error', model: null, error: reason instanceof Error ? reason.message : t('errors.generic') })
      return
    }
    const today = todayCalendarDay()
    const userList: User[] | null = users.status === 'fulfilled' ? users.value : null
    const planList: ActionPlan[] | null = plans.status === 'fulfilled' ? plans.value : null
    const climate: ClimateTrendsResponse | null = trends.status === 'fulfilled' ? trends.value : null
    const rows = rowsOf({
      departments: departments.value,
      users: userList,
      plans: planList,
      trends: climate,
      today,
      floor: ANONYMITY_FLOOR,
      locale,
    })
    setState({
      status: 'ready',
      error: null,
      model: {
        departments: departments.value,
        rows,
        summary: summaryOf(rows, planList, today),
        wave: latestClosedWave(climate),
        missing: { users: userList === null, plans: planList === null, climate: climate === null },
      },
    })
  }, [baseUrl, companyId, scopeCompanyId, locale, t])

  useEffect(() => {
    void load()
  }, [load])

  return { ...state, reload: () => void load() }
}
