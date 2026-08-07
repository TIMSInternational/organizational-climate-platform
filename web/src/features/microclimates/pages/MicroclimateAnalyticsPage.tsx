import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from '../../../i18n'
import { useCompanyScope } from '../../../company-context'
import { PageTopBar } from '../../../components/layout'
import {
  BarChart,
  KPIDisplay,
  PieChart,
  type ChartDatum,
  type Kpi,
  type PieSlice,
} from '../../../components/charts'
import {
  Badge,
  EmptyState,
  H2,
  LoadingRegion,
  NetworkError,
  SkeletonText,
  Table,
} from '../../../components/ui'
import { listMicroclimates, type Microclimate } from '../api/microclimates'
import { participationPercent } from '../microclimatePrivacy'
import {
  MICROCLIMATE_STATUSES,
  statusBadgeVariant,
  statusLabel,
} from '../microclimateVocabulary'

/** Sessions in the "responses by session" chart. Beyond this the labels collide. */
const MAX_BARS = 10

/**
 * #129 — microclimates across sessions.
 *
 * ## Built from the listing, because there is no analytics endpoint
 *
 * `/microclimates/analytics` does not exist; see `MicroclimateResultsPage` for the
 * full note. `GET /microclimates?companyId=` returns every session with its status,
 * its response count and its target, which is exactly the five headline numbers this
 * page shows — so the aggregation happens here rather than being faked as a server
 * capability.
 *
 * That is a real constraint on what belongs here, not a temporary shortcut. Anything
 * needing per-response data (engagement over time, a comparison against a benchmark,
 * a theme across sessions) is absent because the data does not exist to compute it,
 * and it will keep being absent until microclimate responses are stored individually.
 *
 * ## Averaging participation
 *
 * The average is over sessions that *have* a target, not over all of them. A session
 * created with `targetParticipantCount: 0` has no rate — `participationPercent`
 * returns null rather than zero — and folding it in as a zero would drag the average
 * down with a number that was never measured. The count of sessions included is not
 * shown separately, but the same rule governs the table's per-row column, so a reader
 * comparing them sees the same dashes.
 *
 * ## Axis rule
 *
 * Both charts here compare magnitudes across categories, so both are zero-anchored:
 * `BarChart` passes no `domain` and recharts' baseline stands. Fitting the bar axis
 * to the data range would make 18 responses look like a fraction of 20.
 */
export default function MicroclimateAnalyticsPage() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const companyId = scope.companyId

  const [microclimates, setMicroclimates] = useState<Microclimate[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!companyId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      setMicroclimates(await listMicroclimates(baseUrl, companyId))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, companyId, t])

  useEffect(() => {
    void reload()
  }, [reload])

  // Memoised so the derived arrays keep their identity between renders: an inline
  // `.filter(...)` allocates a new array every render, which makes every chart below
  // re-render for no reason and costs an `exhaustive-deps` warning anywhere one is
  // used as a dependency. The lint budget is full.
  const summary = useMemo(() => summarise(microclimates), [microclimates])

  const responseBars: ChartDatum[] = useMemo(
    () =>
      microclimates
        .toSorted((a, b) => b.responseCount - a.responseCount)
        .slice(0, MAX_BARS)
        .map((microclimate) => ({
          label: microclimate.title ?? t('microclimates.untitled'),
          values: { responses: microclimate.responseCount },
        })),
    [microclimates, t],
  )

  const statusSlices: PieSlice[] = useMemo(
    () =>
      MICROCLIMATE_STATUSES.map((status) => ({
        key: status,
        name: statusLabel(t, status),
        value: microclimates.filter((microclimate) => microclimate.status === status).length,
      })),
    [microclimates, t],
  )

  if (scope.status === 'needs-selection') {
    return (
      <EmptyState
        title={t('companyContext.chooseACompany')}
        description={t('companyContext.chooseACompanyDescription')}
      />
    )
  }

  if (scope.status === 'no-company') {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }

  return (
    <div>
      <PageTopBar
        title={t('microclimates.analyticsTitle')}
        description={t('microclimates.analyticsDescription')}
        breadcrumbs={[
          { label: t('navigation.microclimates'), href: '/microclimates' },
          { label: t('microclimates.analytics') },
        ]}
      />

      {loadError ? (
        <NetworkError
          title={t('errors.generic')}
          description={loadError}
          onRetry={reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={loading} label={t('common.loading')}>
          {loading ? (
            <SkeletonText lines={6} />
          ) : microclimates.length === 0 ? (
            <EmptyState
              title={t('microclimates.noAnalyticsDataAvailable')}
              description={t('microclimates.createMicroclimatesToSeeData')}
            />
          ) : (
            <>
              <KPIDisplay
                kpis={summaryKpis(summary, t)}
                columns={3}
                locale={locale}
                title={t('microclimates.summaryMetrics')}
              />

              <H2>{t('microclimates.analyticsResponsesBySession')}</H2>
              <BarChart
                title={t('microclimates.analyticsResponsesBySession')}
                data={responseBars}
                series={[{ key: 'responses', name: t('dashboard.responses') }]}
              />

              <H2>{t('microclimates.analyticsStatusSplit')}</H2>
              <PieChart
                data={statusSlices}
                donut
                title={t('microclimates.analyticsStatusSplit')}
              />

              <H2>{t('microclimates.analyticsSessions')}</H2>
              <Table>
                <thead>
                  <tr>
                    <th>{t('microclimates.title')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('microclimates.responseCount')}</th>
                    <th>{t('microclimates.analyticsParticipation')}</th>
                    <th>{t('microclimates.createdDate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {microclimates.map((microclimate) => {
                    const rate = participationPercent(
                      microclimate.responseCount,
                      microclimate.targetParticipantCount,
                    )
                    return (
                      <tr key={microclimate.id}>
                        <td>
                          <Link to={`/microclimates/${microclimate.id}/results`}>
                            {microclimate.title ?? t('microclimates.untitled')}
                          </Link>
                        </td>
                        <td>
                          <Badge variant={statusBadgeVariant(microclimate.status)}>
                            {statusLabel(t, microclimate.status)}
                          </Badge>
                        </td>
                        <td>
                          {t('surveys.responseProgress', {
                            count: microclimate.responseCount,
                            target: microclimate.targetParticipantCount,
                          })}
                        </td>
                        {/* An em dash, not 0%: this session recorded no expected
                            audience, so there is no rate rather than a rate of
                            nothing. */}
                        <td>{rate === null ? '—' : `${Math.round(rate)}%`}</td>
                        <td>{new Date(microclimate.createdAt).toLocaleDateString(locale)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

interface MicroclimateSummary {
  total: number
  active: number
  closed: number
  responses: number
  /** Mean participation over the sessions that have a target. Null when none does. */
  averageParticipation: number | null
}

// Deliberately not exported: a `.tsx` file that exports a component *and* a helper
// breaks React Fast Refresh, and `react(only-export-components)` is right to warn
// about it. The rules it encodes are covered through the page's own test.
function summarise(microclimates: readonly Microclimate[]): MicroclimateSummary {
  const rates = microclimates
    .map((microclimate) =>
      participationPercent(microclimate.responseCount, microclimate.targetParticipantCount),
    )
    .filter((rate): rate is number => rate !== null)

  return {
    total: microclimates.length,
    active: microclimates.filter((microclimate) => microclimate.status === 'active').length,
    closed: microclimates.filter((microclimate) => microclimate.status === 'closed').length,
    responses: microclimates.reduce((sum, microclimate) => sum + microclimate.responseCount, 0),
    averageParticipation:
      rates.length === 0 ? null : rates.reduce((sum, rate) => sum + rate, 0) / rates.length,
  }
}

function summaryKpis(
  summary: MicroclimateSummary,
  t: (key: string, params?: Record<string, string | number>) => string,
): Kpi[] {
  const kpis: Kpi[] = [
    { id: 'total', label: t('microclimates.totalMicroclimates'), value: summary.total },
    { id: 'active', label: t('microclimates.activeMicroclimates'), value: summary.active },
    { id: 'closed', label: t('microclimates.completedMicroclimates'), value: summary.closed },
    { id: 'responses', label: t('microclimates.totalResponses'), value: summary.responses },
  ]

  if (summary.averageParticipation !== null) {
    kpis.push({
      id: 'participation',
      label: t('microclimates.averageParticipationRate'),
      value: summary.averageParticipation,
      format: { kind: 'percentage' },
    })
  }

  return kpis
}
