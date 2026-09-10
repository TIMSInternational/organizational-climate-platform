import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { useCompanyScope } from '../../../company-context'
import { listActionPlans, type ActionPlan } from '../../action-plans/api/actionPlans'
import { getSurveyAnalytics, type SurveyAnalyticsResponse } from '../api/surveyResults'
import { buildClimateMap } from '../surveyResultsMap'
import type { SurveyResultsNextModel } from './model'
import { sampleWave } from './sampleModel'

export interface SurveyResultsModelState {
  model: SurveyResultsNextModel | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * The model behind `/surveys/:id/results` — the ONE place this screen fetches.
 *
 * Two real requests, through the clients the current page and the action-plan pages
 * already use: `GET /surveys/{id}/analytics` (both halves of one aggregation in one
 * round trip — see `surveyResults.ts` on why not `/results` + `/statistics`) and
 * `GET /action-plans?companyId=` for the plan that covers a group. The map is built by
 * `buildClimateMap`, exactly as the current page builds it, so withheld rows arrive
 * hatched and never as a number.
 *
 * A failed plans request is not "no plans": it lands as `plans: null` and the view says
 * the plans could not be loaded. A failed analytics request is the page's error.
 *
 * `sample` is `sampleModel.ts` until the endpoints in its header exist; the view keeps
 * the "sample data" chip on every region it feeds.
 */
export function useSurveyResultsModel(surveyId: string | undefined): SurveyResultsModelState {
  const { t, locale } = useTranslation()
  const scope = useCompanyScope()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const companyId = scope.status === 'ready' ? scope.companyId : undefined

  const [payload, setPayload] = useState<SurveyAnalyticsResponse | null>(null)
  const [plans, setPlans] = useState<ActionPlan[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!surveyId) return
    setLoading(true)
    setError(null)
    try {
      // The UI locale is a request; the payload's `resolvedLocale` says what came back.
      const analytics = await getSurveyAnalytics(baseUrl, surveyId, locale)
      setPayload(analytics)
      // Plans are the secondary reading: their failure must not take the map down.
      let loadedPlans: ActionPlan[] | null = null
      if (companyId) {
        try {
          loadedPlans = await listActionPlans(baseUrl, companyId, {}, locale)
        } catch {
          loadedPlans = null
        }
      }
      setPlans(loadedPlans)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, surveyId, companyId, locale, t])

  useEffect(() => {
    reload()
  }, [reload])

  const model = useMemo<SurveyResultsNextModel | null>(() => {
    if (!payload) return null
    const breakdown =
      payload.breakdowns.find((candidate) => candidate.dimension === 'department') ??
      payload.breakdowns[0] ??
      null
    const climate = breakdown
      ? buildClimateMap(breakdown, payload.questions, payload.minimumGroupSize, (segment) => segment.label ?? segment.key)
      : null
    return {
      surveyId: payload.surveyId,
      name: payload.title,
      status: payload.status,
      summary: payload.summary,
      isSuppressed: payload.isSuppressed,
      minimumGroupSize: payload.minimumGroupSize,
      questions: payload.questions,
      breakdown,
      breakdowns: payload.breakdowns,
      climate,
      plans,
      sample: sampleWave,
    }
  }, [payload, plans])

  return { model, loading, error, reload }
}
