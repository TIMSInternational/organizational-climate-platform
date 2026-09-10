import { useCallback, useMemo } from 'react'
import { ANONYMITY_FLOOR } from '../../../components/charts'
import { createTranslator, useTranslation } from '../../../i18n'
import { CATALOGUES, FALLBACK_LOCALE } from '../../../i18n/locale'
import { getTrackingApiBaseUrl, isTrackingEnabled } from '../../tracking/api/config'
import { useDashboardData } from '../useDashboardData'
import { loadAdminDashboard } from './loadModel'
import type { AdminDashboardModel, RegionStatuses } from './model'

export interface AdminDashboardModelState {
  loading: boolean
  /** `null` until the first load settles. */
  model: AdminDashboardModel | null
  regions: RegionStatuses | null
  /** The loader itself threw — it settles every region on its own, so this is a defect. */
  failed: boolean
  error: string | null
  reload: () => void
}

/** Today as an ISO date, in the reader's own calendar. */
function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * The model behind the company administrator's `/dashboard`, composed from the
 * existing clients (`loadModel.ts` fetches, `compose.ts` derives). Each region falls
 * back to `sampleModel.ts` only when its own fetch fails, `isSample` says whether any
 * did, and `regions` says which — the page shows the chip and names the region.
 *
 * `companyId` is the scope `DashboardPage` resolved: set only for a SuperAdmin, who has
 * no tenant of their own and must name one, and `undefined` for a CompanyAdmin, whose
 * scope the server takes from the claim — a client that sent its own idea of the tenant
 * would be choosing a scope, which `GET /dashboard/company-admin` refuses.
 *
 * `load` is memoised on the scope and the locale, as `useDashboardData` requires; the
 * dimension-name resolver is built from the catalogue for the locale rather than taken
 * from `useTranslation`, so a re-render cannot hand the hook a new function and refetch.
 */
export function useAdminDashboardModel(companyId?: string): AdminDashboardModelState {
  const { locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const dimensionName = useMemo(() => {
    const t = createTranslator(CATALOGUES[locale], CATALOGUES[FALLBACK_LOCALE])
    return (key: string) => {
      const messageKey = `surveyRespond.dimensions.${key}`
      const text = t(messageKey)
      // Categories are authored free text; one the catalogue does not name is shown as is.
      return text === messageKey ? key : text
    }
  }, [locale])

  const load = useCallback(
    () =>
      loadAdminDashboard({
        baseUrl,
        trackingBaseUrl: isTrackingEnabled() ? getTrackingApiBaseUrl() : null,
        companyId,
        lang: locale,
        asOf: today(),
        floor: ANONYMITY_FLOOR,
        dimensionName,
      }),
    [baseUrl, companyId, locale, dimensionName],
  )

  const { data, loading, failed, error, reload } = useDashboardData(load)
  return { loading, model: data?.model ?? null, regions: data?.regions ?? null, failed, error, reload }
}
