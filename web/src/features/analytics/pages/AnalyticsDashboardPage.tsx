import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { listBenchmarks, type BenchmarkListItem } from '../api/benchmarks'
import { acknowledgeAIInsight, listAIInsights, type AIInsightListItem } from '../api/insights'
import AIInsightList from '../components/AIInsightList'
import BenchmarkList from '../components/BenchmarkList'
import BenchmarkQualityChart from '../components/BenchmarkQualityChart'
import { getToken } from '../../../auth/token'
import { decodeJwtPayload } from '../../../auth/jwt'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { KPIDisplay, type Kpi } from '../../../components/charts'
import {
  Alert,
  AlertDescription,
  H2,
  LoadingRegion,
  NetworkError,
  SkeletonText,
} from '../../../components/ui'

/**
 * The analytics dashboard for one company: benchmarks, and the AI insights raised against
 * that company.
 *
 * ## Scoping
 *
 * Company comes from the URL (`/admin/companies/:companyId/analytics`), not from the
 * viewer's JWT — see the long note in `ReportsListPage.tsx`. That is what keeps a
 * SuperAdmin from being silently scoped to their own user row's company, which is the trap
 * #94 flags and the reason Action Plans blocks SuperAdmin outright.
 *
 * One asymmetry is worth stating because it is the backend's and not this page's:
 * `BenchmarkEndpoints.ListAsync` ignores the `companyId` filter for a CompanyAdmin and
 * always returns global benchmarks (`CompanyId == null`) **plus** their own company's, but
 * for a SuperAdmin the same filter is an exact match and therefore excludes globals. So a
 * SuperAdmin viewing this page sees only the named company's benchmarks. Passing the filter
 * anyway is the lesser evil: dropping it would show a SuperAdmin every benchmark on the
 * platform on a page whose whole title is one company. The banner says which view is in
 * effect rather than leaving the gap to be discovered.
 *
 * ## AI insights are fetched separately, on purpose
 *
 * `/admin/ai-insights` is not registered in `Program.cs` — Task 4 (#86) is still open — so
 * every call 404s today. Fetching both in one `Promise.all` would therefore put the entire
 * page into its error state and hide the benchmarks, which do work. Two independent
 * requests with two independent error states means the insights section degrades on its
 * own, both now and later for any transient failure.
 */
export default function AnalyticsDashboardPage() {
  const { t, locale } = useTranslation()
  const { companyId } = useParams<{ companyId: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const isSuperAdmin = claims?.role === 'super_admin'

  const [benchmarks, setBenchmarks] = useState<BenchmarkListItem[]>([])
  const [benchmarksLoading, setBenchmarksLoading] = useState(true)
  const [benchmarksError, setBenchmarksError] = useState<string | null>(null)

  const [insights, setInsights] = useState<AIInsightListItem[]>([])
  const [insightsLoading, setInsightsLoading] = useState(true)
  const [insightsError, setInsightsError] = useState<string | null>(null)
  const [acknowledgingId, setAcknowledgingId] = useState<string | undefined>(undefined)

  // `useCallback` for the same reason as ReportsListPage: the lint budget is exactly
  // full, so a new exhaustive-deps warning fails CI. `t` is stable per locale.
  const reloadBenchmarks = useCallback(async () => {
    if (!companyId) return
    setBenchmarksLoading(true)
    setBenchmarksError(null)
    try {
      setBenchmarks(await listBenchmarks(baseUrl, companyId))
    } catch (err) {
      setBenchmarksError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setBenchmarksLoading(false)
    }
  }, [baseUrl, companyId, t])

  const reloadInsights = useCallback(async () => {
    if (!companyId) return
    setInsightsLoading(true)
    setInsightsError(null)
    try {
      setInsights(await listAIInsights(baseUrl, companyId))
    } catch (err) {
      setInsightsError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setInsightsLoading(false)
    }
  }, [baseUrl, companyId, t])

  useEffect(() => {
    reloadBenchmarks()
    reloadInsights()
  }, [reloadBenchmarks, reloadInsights])

  async function handleAcknowledge(insight: AIInsightListItem) {
    setAcknowledgingId(insight.id)
    try {
      await acknowledgeAIInsight(baseUrl, insight.id)
      await reloadInsights()
    } catch (err) {
      setInsightsError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setAcknowledgingId(undefined)
    }
  }

  if (!companyId) {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }

  const outstandingInsights = insights.filter((insight) => !insight.isAcknowledged).length
  const kpis: Kpi[] = [
    { id: 'benchmarks', label: t('analytics.kpiBenchmarks'), value: benchmarks.length },
    {
      id: 'activeBenchmarks',
      label: t('analytics.kpiActiveBenchmarks'),
      value: benchmarks.filter((benchmark) => benchmark.isActive).length,
    },
    {
      id: 'outstandingInsights',
      label: t('analytics.kpiOutstandingInsights'),
      value: outstandingInsights,
      // Up is bad: an unacknowledged insight is work nobody has looked at.
      higherIsBetter: false,
    },
  ]

  return (
    <div>
      <PageTopBar
        title={t('navigation.analytics')}
        description={t('navigation.analyticsDesc')}
        breadcrumbs={[
          { label: t('navigation.companySettings'), href: `/admin/companies/${companyId}` },
          { label: t('navigation.analytics') },
        ]}
      />

      {isSuperAdmin && (
        <Alert className="mb-panel-gap">
          <AlertDescription>{t('analytics.superAdminScopeNotice')}</AlertDescription>
        </Alert>
      )}

      <KPIDisplay
        kpis={kpis}
        title={t('analytics.overview')}
        locale={locale}
        isLoading={benchmarksLoading || insightsLoading}
      />

      <H2>{t('analytics.benchmarks')}</H2>
      {benchmarksError ? (
        <NetworkError
          title={t('errors.generic')}
          description={benchmarksError}
          onRetry={reloadBenchmarks}
          retryText={t('common.retry')}
        />
      ) : (
        // `LoadingRegion` announces `common.loading` in an sr-only live region, so
        // the visible placeholder is a skeleton rather than a second copy of the word.
        <LoadingRegion loading={benchmarksLoading} label={t('common.loading')}>
          {benchmarksLoading ? (
            <SkeletonText lines={4} />
          ) : (
            <>
              <BenchmarkQualityChart benchmarks={benchmarks} />
              <BenchmarkList benchmarks={benchmarks} />
            </>
          )}
        </LoadingRegion>
      )}

      <H2>{t('analytics.aiInsights')}</H2>
      {insightsError ? (
        // Deliberately not the same copy as the benchmarks failure. The likeliest
        // cause today is that the endpoint does not exist yet, and "check your
        // connection" would send an admin chasing a network problem that is not there.
        <NetworkError
          title={t('analytics.insightsUnavailable')}
          description={t('analytics.insightsUnavailableDescription')}
          onRetry={reloadInsights}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={insightsLoading} label={t('common.loading')}>
          {insightsLoading ? (
            <SkeletonText lines={3} />
          ) : (
            <AIInsightList
              insights={insights}
              acknowledgingId={acknowledgingId}
              onAcknowledge={handleAcknowledge}
            />
          )}
        </LoadingRegion>
      )}
    </div>
  )
}
