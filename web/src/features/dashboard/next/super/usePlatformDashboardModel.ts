import { useCallback } from 'react'
import { useTranslation } from '../../../../i18n'
import { getSuperAdminDashboard } from '../../api/dashboard'
import { useDashboardData } from '../../useDashboardData'
import { listCompanies } from '../../../org-structure/api/companies'
import { getSystemStatus } from '../../../org-structure/api/systemStatus'
import { getSystemSettings } from '../../../org-structure/api/systemSettings'
import { listSurveys } from '../../../surveys/api/surveys'
import { composePlatform } from './derive'
import type { PlatformModel } from './model'

export interface PlatformDashboardState {
  status: 'loading' | 'ready' | 'error'
  model: PlatformModel | null
  error: string | null
  reload: () => void
}

/** Today as an ISO date, in the reader's own calendar — as `useAdminDashboardModel`. */
function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * An optional read: its failure costs its own region and nothing else. `accept` is the
 * shape check a 200 must pass too — a body that is not what the client promised is the
 * same answer as a failed request, not a region to render from.
 */
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
 * THE wiring seam of the platform overview: five existing clients, no new endpoint.
 *
 * `GET /dashboard/super-admin` is the page — every tile and every row starts there — so
 * its failure is the page's error state. The other four enrich it and each fails alone
 * (`model.ts` has the table). `listSurveys` sends no company: for a super_admin the
 * server applies no company predicate at all (`navSections.ts`, the surveys entry), so
 * one request answers for every tenant.
 */
export function usePlatformDashboardModel(): PlatformDashboardState {
  const { locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const load = useCallback(async () => {
    const [dashboard, companies, surveys, system, settings] = await Promise.all([
      getSuperAdminDashboard(baseUrl),
      optional(() => listCompanies(baseUrl), isList),
      optional(() => listSurveys(baseUrl, {}, locale), isList),
      optional(() => getSystemStatus(baseUrl), hasKey('database')),
      optional(() => getSystemSettings(baseUrl), hasKey('emailSettings')),
    ])
    return composePlatform({ dashboard, companies, surveys, system, settings }, today())
  }, [baseUrl, locale])

  const { data, failed, error, reload } = useDashboardData(load)
  return {
    status: failed ? 'error' : data ? 'ready' : 'loading',
    model: data,
    error,
    reload,
  }
}
