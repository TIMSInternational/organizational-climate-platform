import { ArrowRight, Gauge, Sparkles } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { PageTopBar } from '../../../components/layout'
import { Button, Chip, ErrorState, LoadingRegion, SkeletonText, Table } from '../../../components/ui'
import { useCompanyName } from '../../../company-context/useCompanyName'
import { useTranslation } from '../../../i18n'
import { insightPriorityLabel } from '../insightVocabulary'
import { EmptyRow, IconBox, PanelHeading, TABLE_CARD_CLASS, TH_CLASS } from '../../shared-next/parts'
import { openInsightCount, priorityTone, type BenchmarkRow } from './model'
import { useAnalyticsModel } from './useAnalyticsModels'

/**
 * Analítica, redesigned (canvas board "AnalyticsDashboard"): one job — which references
 * the company can be compared against, and how many AI findings wait for review. The
 * per-dimension comparison lives in Puntos de Referencia, and the header says so.
 *
 * Assembled from reads that exist: `GET /admin/benchmarks` (+ each row's detail for the
 * cohort size), `GET /admin/ai-insights` and `GET /surveys` for the wave the references
 * are read against. The previous `pages/AnalyticsDashboardPage.tsx` stays in the tree as
 * the wiring reference; the router no longer mounts it.
 */

const MAX_INSIGHTS_BESIDE = 3

export default function AnalyticsNextPage() {
  const { t } = useTranslation()
  const { companyId } = useParams<{ companyId: string }>()
  const companyName = useCompanyName()
  const { state, reload } = useAnalyticsModel(companyId)
  const company = companyName ?? t('insights.next.thisCompany')

  if (!companyId) return <p role="alert">{t('common.noCompanyAssociated')}</p>

  return (
    <div>
      <PageTopBar
        eyebrow={[t('insights.next.proposal'), companyName].filter(Boolean).join(' · ')}
        title={t('analytics.next.title')}
        description={t('analytics.next.description')}
        breadcrumbs={undefined}
        actions={
          <Button asChild variant="outline">
            <Link to="/analytics/benchmarks">
              <Gauge aria-hidden="true" />
              {t('navigation.benchmarks')}
            </Link>
          </Button>
        }
      />

      {state.status === 'loading' ? (
        <LoadingRegion loading label={t('common.loading')}>
          <SkeletonText lines={5} />
        </LoadingRegion>
      ) : state.status === 'failed' ? (
        <ErrorState
          title={t('errors.generic')}
          description={state.message}
          action={
            <Button variant="outline" onClick={() => void reload()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : (
        <div className="grid items-start gap-panel-gap xl:grid-cols-[minmax(0,1fr)_22.5rem]">
          <section aria-labelledby="analytics-references">
            <PanelHeading
              id="analytics-references"
              title={t('analytics.next.references')}
              count={state.data.benchmarks.length}
              aside={
                state.data.latestWave
                  ? t('analytics.next.againstWave', {
                      title: state.data.latestWave.title ?? t('surveys.untitled'),
                      count: state.data.latestWave.responseCount,
                    })
                  : null
              }
            />
            <div className={TABLE_CARD_CLASS}>
              <div className="overflow-x-auto">
                <Table className="w-full border-collapse text-sm">
                  <thead className="border-b border-line-light">
                    <tr>
                      <th scope="col" className={TH_CLASS}>{t('analytics.next.colReference')}</th>
                      <th scope="col" className={`${TH_CLASS} w-40`}>{t('analytics.next.colScope')}</th>
                      <th scope="col" className={`${TH_CLASS} w-32`}>{t('analytics.next.colGroup')}</th>
                      <th scope="col" className={`${TH_CLASS} w-32`}>{t('analytics.next.colQuality')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.benchmarks.map((row) => (
                      <BenchmarkTableRow key={row.id} row={row} />
                    ))}
                  </tbody>
                </Table>
              </div>
              {!state.data.benchmarks.some((row) => !row.isGlobal) && (
                <EmptyRow
                  className="border-t border-line-light bg-surface-icon-box"
                  icon={<Gauge />}
                  title={t('analytics.next.noOwnTitle', { company })}
                  lines={[t('analytics.next.noOwnBody')]}
                />
              )}
            </div>
          </section>

          <section aria-labelledby="analytics-insights">
            <PanelHeading
              id="analytics-insights"
              title={t('analytics.next.insights')}
              count={openInsightCount(state.data.insights)}
              aside={t('analytics.next.toReview')}
            />
            <div className={TABLE_CARD_CLASS}>
              {openInsightCount(state.data.insights) === 0 ? (
                <div className="flex items-start gap-3 p-4">
                  <IconBox>
                    <Sparkles />
                  </IconBox>
                  <div className="min-w-0 text-xs">
                    <p className="m-0 text-sm font-semibold text-fg-primary">{t('insights.next.emptyTitle')}</p>
                    <p className="m-0 text-fg-secondary">
                      {state.data.insights.length === 0
                        ? t('analytics.next.insightsEmpty')
                        : t('analytics.next.insightsAllReviewed')}
                    </p>
                    <Link to="/analytics/ai-insights" className="mt-1 inline-flex items-center gap-1 text-fg-secondary">
                      {t('analytics.next.openInsights')}
                      <ArrowRight aria-hidden="true" className="size-3" />
                    </Link>
                  </div>
                </div>
              ) : (
                <ul className="m-0 list-none divide-y divide-line-light p-0">
                  {state.data.insights
                    .filter((insight) => !insight.isAcknowledged)
                    .slice(0, MAX_INSIGHTS_BESIDE)
                    .map((insight) => (
                      <li key={insight.id} data-testid="analytics-insight" className="flex items-start gap-2 p-3 text-sm">
                        <Chip tone={priorityTone(insight.priority)} label={insightPriorityLabel(t, insight.priority)} />
                        <span className="min-w-0 text-fg-primary">{insight.title}</span>
                      </li>
                    ))}
                  <li className="p-3 text-xs">
                    <Link to="/analytics/ai-insights" className="inline-flex items-center gap-1 text-fg-secondary">
                      {t('analytics.next.openInsights')}
                      <ArrowRight aria-hidden="true" className="size-3" />
                    </Link>
                  </li>
                </ul>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function typeLabel(t: (key: string) => string, type: string): string {
  const known = ['industry', 'internal', 'regional', 'company_size']
  return known.includes(type) ? t(`analytics.next.type.${type}`) : type
}

function categoryLabel(t: (key: string) => string, category: string): string {
  return ['climate', 'engagement'].includes(category) ? t(`analytics.next.category.${category}`) : category
}

function BenchmarkTableRow({ row }: { row: BenchmarkRow }) {
  const { t } = useTranslation()
  const facts = [
    typeLabel(t, row.type),
    categoryLabel(t, row.category),
    row.isActive ? t('analytics.next.active') : t('analytics.next.inactive'),
    ...(row.isActive ? [t('analytics.next.usedByBenchmarks')] : []),
  ]
  return (
    <tr data-testid="benchmark-row" className="border-b border-line-light last:border-b-0">
      <td className="px-3 py-2.5 align-top">
        <div className="font-semibold text-fg-primary">{row.name}</div>
        <div className="text-xs text-fg-secondary">{facts.join(' · ')}</div>
      </td>
      <td className="px-3 py-2.5 align-middle">
        <Chip
          tone={row.isGlobal ? 'neutral' : 'accent'}
          label={row.isGlobal ? t('analytics.next.scopeGlobal') : t('analytics.next.scopeOwn')}
        />
      </td>
      <td className="px-3 py-2.5 align-middle text-fg-secondary">
        {row.groupSize === null ? (
          '—'
        ) : (
          <>
            <span className="font-mono text-fg-primary tabular-nums">{row.groupSize}</span>{' '}
            {t('analytics.next.companies')}
          </>
        )}
      </td>
      <td className="px-3 py-2.5 align-middle text-fg-secondary">
        {row.qualityScore === null ? (
          t('analytics.next.qualityPending')
        ) : (
          <span className="font-mono text-fg-primary tabular-nums">{row.qualityScore}</span>
        )}
      </td>
    </tr>
  )
}
