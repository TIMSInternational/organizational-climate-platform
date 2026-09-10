import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { useCompanyScope } from '../../../company-context'
import { listActionPlans, type ActionPlan } from '../../action-plans/api/actionPlans'
import { getSurveyAnalytics, type SurveyAnalyticsResponse } from '../api/surveyResults'
import { getSurvey } from '../api/surveys'
import { composeResultsModel } from './compose'
import type { SurveyResultsNextModel } from './model'

export interface SurveyResultsModelState {
  model: SurveyResultsNextModel | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * The model behind `/surveys/:id/results` — the ONE place this screen fetches.
 *
 * Three real requests, through the clients the previous page and the action-plan pages
 * already use: `GET /surveys/{id}/analytics` (both halves of one aggregation in one
 * round trip — see `surveyResults.ts` on why not `/results` + `/statistics`),
 * `GET /surveys/{id}` for the closing date the analytics envelope does not carry, and
 * `GET /action-plans?companyId=` for the plan that covers a group. `composeResultsModel`
 * turns the three into the model, the same function the tests build from the tenant's
 * real payloads.
 *
 * A failed plans request is not "no plans": it lands as `plans: null` and the view says
 * the plans could not be loaded. A failed survey request lands as `closesAt: null` and
 * the header names the last response's day instead. A failed analytics request is the
 * page's error.
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
  const [closesAt, setClosesAt] = useState<string | null>(null)
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
      // The closing date is a secondary reading: its failure must not take the map down.
      let closed: string | null = null
      try {
        closed = (await getSurvey(baseUrl, surveyId, locale)).endDate ?? null
      } catch {
        closed = null
      }
      setClosesAt(closed)
      // Plans are the other secondary reading, for the same reason.
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

  const model = useMemo<SurveyResultsNextModel | null>(
    () => (payload ? composeResultsModel(payload, plans, closesAt) : null),
    [payload, plans, closesAt],
  )

  return { model, loading, error, reload }
}
