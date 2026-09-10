import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { useCompanyScope } from '../../../company-context'
import { listActionPlans, type ActionPlan } from '../../action-plans/api/actionPlans'
import { getClimateTrends, type ClimateTrendsResponse } from '../api/climateTrends'
import { getSurveyAnalytics, type SurveyAnalyticsResponse } from '../api/surveyResults'
import { getSurvey } from '../api/surveys'
import { composeResultsModel, previousSurveyOf, type PreviousPayloads } from './compose'
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
 * Five real requests, all through clients the app already has:
 *
 * - `GET /surveys/{id}/analytics` — the map, the questions, the protected rows: both
 *   halves of one aggregation in one round trip (`surveyResults.ts` says why not
 *   `/results` + `/statistics`);
 * - `GET /surveys/{id}` — the closing date, which the analytics envelope does not carry;
 * - `GET /action-plans?companyId=` — the plan that covers a group;
 * - `GET /surveys/climate-trends` — which wave came before this one, and the company's
 *   climate across the waves (the rises in a row). It is the call the Panel de Control
 *   makes (`dashboard/next/loadModel.ts`), so both screens name the same previous wave;
 * - `GET /surveys/{previous}/analytics` — that wave's own dimension and group means,
 *   which every "frente a Q2" on this page is measured against.
 *
 * Only the first is the page's own: its failure is the page's error. Every other one is
 * a secondary reading, fetched after it, whose failure is SAID rather than guessed at:
 * `plans: null` ("could not be loaded", not "no plan"), `closesAt: null` (the header
 * names the last response's day instead), `previous: failed` (no comparison is printed,
 * and the note under the map says why). The model is published once, with every
 * reading in it, so the page never flashes a "could not load" that is merely early.
 *
 * Nothing it returns is a sample. The opened group's 1–5 spread is not fetched because no
 * endpoint has it: `SurveySegmentQuestionResult` carries a group's mean per question and
 * no distribution, so the opened cell prints that mean and says the spread is withheld.
 */
export function useSurveyResultsModel(surveyId: string | undefined): SurveyResultsModelState {
  const { t, locale } = useTranslation()
  const scope = useCompanyScope()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const companyId = scope.status === 'ready' ? scope.companyId : undefined

  const [payload, setPayload] = useState<SurveyAnalyticsResponse | null>(null)
  const [plans, setPlans] = useState<ActionPlan[] | null>(null)
  const [closesAt, setClosesAt] = useState<string | null>(null)
  const [previous, setPrevious] = useState<PreviousPayloads>({ status: 'failed' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!surveyId) return
    setLoading(true)
    setError(null)
    try {
      // The UI locale is a request; the payload's `resolvedLocale` says what came back.
      const analytics = await getSurveyAnalytics(baseUrl, surveyId, locale)
      // The secondary readings, together: none of them may take the map down.
      const [survey, loadedPlans, trends] = await Promise.allSettled([
        getSurvey(baseUrl, surveyId, locale),
        companyId ? listActionPlans(baseUrl, companyId, {}, locale) : Promise.resolve(null),
        getClimateTrends(baseUrl, { companyId, lang: locale }),
      ])
      const closed = survey.status === 'fulfilled' ? (survey.value.endDate ?? null) : null
      const earlier = await loadPrevious(baseUrl, trends, surveyId, closed, locale)
      setPayload(analytics)
      setClosesAt(closed)
      setPlans(loadedPlans.status === 'fulfilled' ? loadedPlans.value : null)
      setPrevious(earlier)
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
    () => (payload ? composeResultsModel(payload, plans, closesAt, previous) : null),
    [payload, plans, closesAt, previous],
  )

  return { model, loading, error, reload }
}

/**
 * The previous wave: named by the trends window, read from its own analytics. Any
 * failure on the way — the trends request, a shape it cannot read, the previous
 * survey's analytics — is `failed`, never a comparison against nothing.
 */
async function loadPrevious(
  baseUrl: string,
  trends: PromiseSettledResult<ClimateTrendsResponse>,
  surveyId: string,
  closesAt: string | null,
  locale: string,
): Promise<PreviousPayloads> {
  if (trends.status !== 'fulfilled') return { status: 'failed' }
  try {
    const survey = previousSurveyOf(trends.value, surveyId, closesAt)
    if (survey === null) return { status: 'none' }
    const analytics = await getSurveyAnalytics(baseUrl, survey.surveyId, locale)
    return { status: 'loaded', trends: trends.value, survey, analytics }
  } catch {
    return { status: 'failed' }
  }
}
