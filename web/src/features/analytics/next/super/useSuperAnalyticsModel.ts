import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { listCompanies, type Company } from '../../../org-structure/api/companies'
import { updateCompanySettings } from '../../../org-structure/api/companySettings'
import { listSurveys, type SurveyListItem } from '../../../surveys/api/surveys'
import { listBenchmarks, type BenchmarkListItem } from '../../api/benchmarks'
import { listAIInsights, type AIInsightListItem } from '../../api/insights'

export interface SuperAnalyticsState {
  status: 'loading' | 'ready'
  /** Every tenant, for the context strip and this tenant's name; `null` when unread. */
  companies: readonly Company[] | null
  /** This tenant's own benchmarks: for this role the filter is an exact match. */
  own: readonly BenchmarkListItem[] | null
  /** Every benchmark this role can read, globals included — to name what is NOT here. */
  all: readonly BenchmarkListItem[] | null
  insights: readonly AIInsightListItem[] | null
  /** The tenant's `aiInsightsEnabled`; `null` when unread (the list is then shown as read). */
  insightsEnabled: boolean | null
  surveys: readonly SurveyListItem[] | null
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

/**
 * THE wiring seam of the super administrator's Analítica. The old page's two reads —
 * `GET /admin/benchmarks?companyId=` and `GET /admin/ai-insights?companyId=` — plus, each
 * from an existing client: the unfiltered benchmark list (for this role it holds every
 * tenant's and the global ones, `BenchmarkEndpoints.ListAsync`), the tenant's settings for
 * `aiInsightsEnabled` (the empty-body `PUT` that is the only settings read), its surveys
 * for the last closed wave, and the tenant list for the context strip. There is no page to
 * lose: every region stands or falls on its own read and says which.
 */
export function useSuperAnalyticsModel(companyId: string | undefined): SuperAnalyticsState {
  const { locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<Omit<SuperAnalyticsState, 'reload'>>({
    status: 'loading',
    companies: null,
    own: null,
    all: null,
    insights: null,
    insightsEnabled: null,
    surveys: null,
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    async function load(id: string) {
      setState((previous) => ({ ...previous, status: 'loading' }))
      const [companies, own, all, insights, settings, surveys] = await Promise.all([
        optional(() => listCompanies(baseUrl), isList),
        optional(() => listBenchmarks(baseUrl, id, locale), isList),
        optional(() => listBenchmarks(baseUrl, undefined, locale), isList),
        optional(() => listAIInsights(baseUrl, id), isList),
        optional(() => updateCompanySettings(baseUrl, id, {}), (value) => typeof value === 'object' && value !== null && 'settings' in value),
        optional(() => listSurveys(baseUrl, { companyId: id }, locale), isList),
      ])
      if (cancelled) return
      setState({
        status: 'ready',
        companies,
        own,
        all,
        insights,
        insightsEnabled: settings ? settings.settings.aiInsightsEnabled : null,
        surveys,
      })
    }
    void load(companyId)
    return () => {
      cancelled = true
    }
  }, [companyId, baseUrl, locale, attempt])

  const reload = useCallback(() => setAttempt((count) => count + 1), [])
  return { ...state, reload }
}
