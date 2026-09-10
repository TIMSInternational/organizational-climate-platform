import { Link, useNavigate, useParams } from 'react-router'
import { ArrowRight, Gauge, Sparkles } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { ANONYMITY_FLOOR, KpiTile } from '../../../../components/charts'
import { Button, LoadingRegion, SkeletonText } from '../../../../components/ui'
import { useCompanyContext } from '../../../../company-context'
import { calendarDay } from '../../../../lib/calendarDay'
import CompanyContextBar from '../../../org-structure/next/super/CompanyContextBar'
import { CanvasChip, EmptyNote, Panel } from '../../../org-structure/next/super/parts'
import { companyProfile, globalBenchmarks, isUnscored, lastClosedSurvey } from './derive'
import { useSuperAnalyticsModel } from './useSuperAnalyticsModel'

const SCORE = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const

/**
 * `/admin/companies/:companyId/analytics` for a super administrator — the canvas's
 * *Analítica (tenant abierto)* (`SuperAnalyticsDashboard` artboard).
 * `AnalyticsDashboardPage` dispatches here for this role and keeps drawing the company
 * administrator's page otherwise.
 *
 * The triage's ruling row, applied: it shows only what the tenant has switched on, names
 * which tenant it reads and offers the switcher on the page, and a tenant with AI insights
 * switched off reads as a sentence rather than an empty grid. For this role the benchmark
 * filter is an exact match, so the global references are not the tenant's and are named
 * — not listed — in the empty state.
 */
export default function SuperAnalyticsView() {
  const { t, locale } = useTranslation()
  const { companyId } = useParams<{ companyId: string }>()
  const { selectedCompanyId, selectCompany } = useCompanyContext()
  const navigate = useNavigate()
  const state = useSuperAnalyticsModel(companyId)
  const company = state.companies?.find((candidate) => candidate.id === companyId) ?? null
  // "(servicios, mediana)": the tenant's own sector and size, as its record holds them.
  const profile = companyProfile(company, t, locale)
  const closed = state.surveys ? lastClosedSurvey(state.surveys) : null
  const globals = state.all ? globalBenchmarks(state.all) : null
  const unreviewed = state.insights?.filter((insight) => !insight.isAcknowledged).length ?? 0
  const score = (value: number) => new Intl.NumberFormat(locale, SCORE).format(value)

  const ownSub =
    state.own && state.own.length > 0
      ? t('superadmin.next.analytics.tiles.ownActive', { count: state.own.filter((benchmark) => benchmark.isActive).length })
      : globals === null
        ? undefined
        : globals.length === 1
          ? t('superadmin.next.analytics.tiles.globalOnlyOne')
          : globals.length > 1
            ? t('superadmin.next.analytics.tiles.globalMany', { count: globals.length })
            : t('superadmin.next.analytics.tiles.noneAtAll')

  const insightsSub =
    state.insightsEnabled === false
      ? t('superadmin.next.analytics.tiles.insightsDisabled')
      : state.insights === null
        ? undefined
        : state.insights.length === 0
          ? t('superadmin.next.analytics.tiles.insightsNone')
          : t('superadmin.next.analytics.tiles.insightsOpen', { count: unreviewed })

  return (
    <div>
      <CompanyContextBar
        mode="tenant"
        companies={state.companies ?? (companyId ? [{ id: companyId, name: company?.name ?? '…' }] : [])}
        value={companyId ?? null}
        isActive={selectedCompanyId === companyId}
        onChange={(next) => {
          if (!next) return
          selectCompany(next)
          navigate(`/admin/companies/${next}/analytics`)
        }}
      />
      <div className="flex flex-col gap-section">
        <div className="-mb-2">
          <PageTopBar
            eyebrow={t('navigation.systemAdministration')}
            title={t('navigation.analytics')}
            description={t('superadmin.next.analytics.description')}
            breadcrumbs={[
              { label: t('navigation.companies'), href: '/admin/companies' },
              ...(company ? [{ label: company.name, href: `/admin/companies/${companyId}` }] : []),
              { label: t('navigation.analytics') },
            ]}
            actions={
              <Button asChild variant="outline">
                <Link to="/analytics/benchmarks">
                  <Gauge aria-hidden="true" />
                  {t('navigation.benchmarks')}
                </Link>
              </Button>
            }
          />
        </div>

        <LoadingRegion loading={state.status === 'loading'} label={t('common.loading')}>
          {state.status === 'loading' ? (
            <SkeletonText lines={6} />
          ) : (
            <div className="flex flex-col gap-section">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <KpiTile
                 
                  label={t('superadmin.next.analytics.tiles.own')}
                  value={state.own ? state.own.length : null}
                  unit={t('superadmin.next.analytics.tiles.ownUnit')}
                  locale={locale}
                  sub={ownSub ? <span>{ownSub}</span> : undefined}
                />
                <KpiTile
                 
                  label={t('superadmin.next.analytics.tiles.insights')}
                  value={state.insights ? state.insights.length : null}
                  unit={t('superadmin.next.analytics.tiles.insightsUnit')}
                  locale={locale}
                  sub={insightsSub ? <span>{insightsSub}</span> : undefined}
                />
                <KpiTile
                 
                  label={t('superadmin.next.analytics.tiles.lastClosed')}
                  value={null}
                  valueText={closed ? closed.code : undefined}
                  unit={
                    closed
                      ? t('superadmin.next.analytics.tiles.lastClosedUnit', { date: calendarDay(Date.parse(closed.endDate), locale) })
                      : undefined
                  }
                  locale={locale}
                  sub={
                    <span>
                      {closed
                        ? t('superadmin.next.analytics.tiles.lastClosedSub', { count: closed.responses })
                        : state.surveys
                          ? t('superadmin.next.analytics.tiles.lastClosedNone')
                          : t('superadmin.next.unavailable')}
                    </span>
                  }
                />
              </div>

              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                <Panel
                  labelledBy="analytics-refs"
                  heading={
                    <h2 id="analytics-refs" className="m-0 text-2xl">
                      {t('superadmin.next.analytics.refs.heading')}
                    </h2>
                  }
                  meta={t('superadmin.next.analytics.refs.meta')}
                >
                  {state.own === null ? (
                    <p className="m-0 text-xs text-fg-secondary">{t('superadmin.next.analytics.loadFailed')}</p>
                  ) : state.own.length === 0 ? (
                    <EmptyNote icon={<Gauge />} heading={t('superadmin.next.analytics.refs.emptyTitle')}>
                      {globals === null
                        ? t('superadmin.next.analytics.refs.emptyOwnOnly')
                        : globals.length === 0
                          ? t('superadmin.next.analytics.refs.emptyNone')
                          : globals.length === 1
                            ? profile
                              ? t('superadmin.next.analytics.refs.emptyGlobalOneCompared', {
                                  name: globals[0].name,
                                  score: score(globals[0].qualityScore),
                                  profile,
                                })
                              : isUnscored(globals[0])
                              ? t('superadmin.next.analytics.refs.emptyGlobalOneUnscored', { name: globals[0].name })
                              : t('superadmin.next.analytics.refs.emptyGlobalOne', { name: globals[0].name, score: score(globals[0].qualityScore) })
                            : t('superadmin.next.analytics.refs.emptyGlobalMany', { count: globals.length })}
                    </EmptyNote>
                  ) : (
                    <ul className="m-0 flex list-none flex-col p-0">
                      {state.own.map((benchmark, index) => (
                        <li
                          key={benchmark.id}
                          className={`m-0 flex items-center justify-between gap-3 py-2 ${index > 0 ? 'border-t border-line-light' : ''}`}
                        >
                          <span className="min-w-0 truncate text-fg-primary">{benchmark.name}</span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="font-mono text-xs tabular-nums text-fg-secondary">
                              {isUnscored(benchmark)
                                ? t('superadmin.next.analytics.refs.unscored')
                                : t('superadmin.next.analytics.refs.quality', { score: score(benchmark.qualityScore) })}
                            </span>
                            <CanvasChip
                              tone={benchmark.isActive ? 'good' : 'neutral'}
                              label={benchmark.isActive ? t('superadmin.next.analytics.refs.active') : t('superadmin.next.analytics.refs.inactive')}
                            />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>

                <Panel
                  labelledBy="analytics-insights"
                  heading={
                    <h2 id="analytics-insights" className="m-0 text-2xl">
                      {t('navigation.aiInsights')}
                    </h2>
                  }
                  meta={t('superadmin.next.analytics.insights.meta')}
                >
                  {state.insightsEnabled === false ? (
                    <EmptyNote icon={<Sparkles />} heading={t('superadmin.next.analytics.insights.disabledTitle')}>
                      {t('superadmin.next.analytics.insights.disabledText')}
                    </EmptyNote>
                  ) : state.insights === null ? (
                    <p className="m-0 text-xs text-fg-secondary">{t('superadmin.next.analytics.loadFailed')}</p>
                  ) : state.insights.length === 0 ? (
                    <EmptyNote icon={<Sparkles />} heading={t('superadmin.next.analytics.insights.emptyTitle')}>
                      <span className="flex flex-col gap-1.5">
                        <span>{t('superadmin.next.analytics.insights.emptyText', { floor: ANONYMITY_FLOOR })}</span>
                        <InsightsLink />
                      </span>
                    </EmptyNote>
                  ) : (
                    <>
                      <ul className="m-0 flex list-none flex-col p-0">
                        {state.insights.map((insight, index) => (
                          <li
                            key={insight.id}
                            className={`m-0 flex items-center justify-between gap-3 py-2 ${index > 0 ? 'border-t border-line-light' : ''}`}
                          >
                            <span className="min-w-0 truncate text-fg-primary">{insight.title}</span>
                            <CanvasChip
                              tone={insight.isAcknowledged ? 'neutral' : 'warning'}
                              label={
                                insight.isAcknowledged
                                  ? t('superadmin.next.analytics.insights.reviewed')
                                  : t('superadmin.next.analytics.insights.pending')
                              }
                            />
                          </li>
                        ))}
                      </ul>
                      <InsightsLink />
                    </>
                  )}
                </Panel>
              </div>
            </div>
          )}
        </LoadingRegion>
      </div>
    </div>
  )
}

function InsightsLink() {
  const { t } = useTranslation()
  return (
    <Link to="/analytics/ai-insights" className="inline-flex items-center gap-1 self-start text-xs text-fg-secondary hover:text-fg-primary">
      {t('superadmin.next.analytics.insights.open')}
      <ArrowRight aria-hidden="true" className="size-3" />
    </Link>
  )
}
