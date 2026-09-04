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
import { KpiTile, type Kpi } from '../../../components/charts'
import {
  Alert,
  AlertDescription,
  H2,
  LoadingRegion,
  NetworkError,
  SkeletonText,
} from '../../../components/ui'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { KpiRow, SectionHeading } from '../../dashboard/components/dashboardGrammar'

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
 * `/admin/ai-insights` IS registered — `Program.cs` calls `app.MapAIInsightEndpoints()`
 * (#86 closed 2026-08-03) — so the reason this page fetches it separately is no longer
 * "it 404s". The reason that survives is the general one: fetching both in one
 * `Promise.all` would put the entire page into its error state on an insights failure and
 * hide the benchmarks, which are the page's title. Two independent requests with two
 * independent error states means the insights section degrades on its own for any
 * transient failure. (An earlier version of this comment said the route did not exist;
 * measured 2026-09-03, it does.)
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
  const [acknowledgeError, setAcknowledgeError] = useState<string | null>(null)

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
    setAcknowledgeError(null)
    try {
      await acknowledgeAIInsight(baseUrl, insight.id)
      await reloadInsights()
    } catch (err) {
      // Its OWN error state, not `insightsError`. Reusing that one would replace the
      // whole table with "AI insights are not available" -- throwing away a list that
      // loaded perfectly well, and blaming the wrong thing -- because one row's write
      // failed. The list stays; the message sits above it.
      setAcknowledgeError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setAcknowledgingId(undefined)
    }
  }

  if (!companyId) {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }

  const outstandingInsights = insights.filter((insight) => !insight.isAcknowledged).length
  // Each card carries the ForMaps "Continue →" link out to the page the number
  // actually lives on. This band is a summary of two other pages and nothing else,
  // so every card here has an unambiguous destination — which is not true of the
  // KPI bands that sit directly above the list they count (Action Plans,
  // Departments), where the link would point at the same screen.
  const kpis: Kpi[] = [
    {
      id: 'benchmarks',
      label: t('analytics.kpiBenchmarks'),
      value: benchmarks.length,
      action: { label: t('navigation.benchmarks'), href: '/analytics/benchmarks' },
    },
    {
      id: 'activeBenchmarks',
      label: t('analytics.kpiActiveBenchmarks'),
      value: benchmarks.filter((benchmark) => benchmark.isActive).length,
      action: { label: t('navigation.benchmarks'), href: '/analytics/benchmarks' },
    },
    {
      id: 'outstandingInsights',
      label: t('analytics.kpiOutstandingInsights'),
      value: outstandingInsights,
      // Up is bad: an unacknowledged insight is work nobody has looked at.
      higherIsBetter: false,
      action: { label: t('navigation.aiInsights'), href: '/analytics/ai-insights' },
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

      {/* The redesign's flat strip. `KpiTile` has no `action` prop and does not need one:
          its sub-line takes a node, so the "Continue →" link this band exists for becomes
          the line under each reading instead of a link on a card's floor. Nothing is lost
          in the conversion, which was the only reason this screen had stayed on the card
          grid.

          The skeleton replaces `KPIDisplay`'s `isLoading`: a strip of tiles reading zero
          while two requests are still in flight is a screen stating three wrong facts. */}
      <SectionHeading>{t('analytics.overview')}</SectionHeading>
      {benchmarksLoading || insightsLoading ? (
        <SkeletonText lines={2} />
      ) : (
        <KpiRow>
          {kpis.map((kpi) => (
            <KpiTile
              key={kpi.id}
              label={kpi.label}
              value={kpi.value}
              higherIsBetter={kpi.higherIsBetter}
              locale={locale}
              sub={
                kpi.action ? (
                  <Link
                    to={kpi.action.href}
                    className="inline-flex items-center gap-1 font-medium text-accent-blue no-underline hover:underline"
                  >
                    {kpi.action.label}
                    {/* Decorative: the link text already says where it goes. */}
                    <ArrowRight aria-hidden="true" className="size-3" />
                  </Link>
                ) : undefined
              }
            />
          ))}
        </KpiRow>
      )}

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
          {acknowledgeError && (
            <Alert variant="destructive" className="mb-panel-gap">
              <AlertDescription>{acknowledgeError}</AlertDescription>
            </Alert>
          )}
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
