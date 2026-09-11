import { useCallback, useEffect, useState } from 'react'
import { acknowledgeAIInsight, listAIInsights, type AIInsightListItem } from '../api/insights'
import { getBenchmark, listBenchmarks, type Benchmark } from '../api/benchmarks'
import { listSurveys, type SurveyListItem } from '../../surveys/api/surveys'
import { useTranslation } from '../../../i18n'
import { benchmarkRows, latestClosedSurvey, sortInsights, type BenchmarkRow } from './model'

/**
 * The wiring seam for the two redesigned analytics screens. Both read only through the
 * existing clients; nothing here invents a field.
 */

type Load<T> = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; data: T }

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function useAIInsightsModel(companyId: string | undefined) {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<Load<AIInsightListItem[]>>({ status: 'loading' })
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!companyId) return
    setState({ status: 'loading' })
    try {
      setState({ status: 'ready', data: sortInsights(await listAIInsights(baseUrl, companyId)) })
    } catch (error) {
      // A failed read is an error, never an empty list: "no findings" would be a lie
      // about the company when what failed was the request.
      setState({ status: 'failed', message: messageOf(error, t('errors.generic')) })
    }
  }, [baseUrl, companyId, t])

  useEffect(() => {
    void reload()
  }, [reload])

  const acknowledge = useCallback(
    async (id: string) => {
      setAcknowledgingId(id)
      setActionError(null)
      try {
        await acknowledgeAIInsight(baseUrl, id)
        await reload()
      } catch (error) {
        setActionError(messageOf(error, t('errors.generic')))
      } finally {
        setAcknowledgingId(null)
      }
    },
    [baseUrl, reload, t],
  )

  return { state, reload, acknowledge, acknowledgingId, actionError }
}

export interface AnalyticsModel {
  benchmarks: BenchmarkRow[]
  insights: AIInsightListItem[]
  latestWave: SurveyListItem | null
}

export function useAnalyticsModel(companyId: string | undefined) {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<Load<AnalyticsModel>>({ status: 'loading' })

  const reload = useCallback(async () => {
    if (!companyId) return
    setState({ status: 'loading' })
    try {
      const [benchmarks, insights, surveys] = await Promise.all([
        listBenchmarks(baseUrl, companyId, locale),
        listAIInsights(baseUrl, companyId),
        // The wave line is context, not content: a failed survey read drops the line
        // rather than the page.
        listSurveys(baseUrl, {}, locale).catch(() => [] as SurveyListItem[]),
      ])
      const details = new Map<string, Benchmark | null>(
        await Promise.all(
          benchmarks.map(
            async (b) =>
              [b.id, await getBenchmark(baseUrl, b.id, locale).catch(() => null)] as const,
          ),
        ),
      )
      setState({
        status: 'ready',
        data: {
          benchmarks: benchmarkRows(benchmarks, details),
          insights: sortInsights(insights),
          latestWave: latestClosedSurvey(surveys, companyId),
        },
      })
    } catch (error) {
      setState({ status: 'failed', message: messageOf(error, t('errors.generic')) })
    }
  }, [baseUrl, companyId, locale, t])

  useEffect(() => {
    void reload()
  }, [reload])

  return { state, reload }
}
