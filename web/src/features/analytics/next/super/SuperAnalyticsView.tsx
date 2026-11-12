import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowRight, Gauge, Sparkles } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { PageHeader } from '../../../../components/layout'
import { Button, Chip, KpiCard, LoadingState } from '../../../../components/ui'
import { useCompanyContext } from '../../../../company-context'
import { calendarDay } from '../../../../lib/calendarDay'
import CompanyContextBar from '../../../org-structure/next/super/CompanyContextBar'
import { EmptyNote } from '../../../org-structure/next/super/parts'
import { CARD, GeneratedChip } from '../parts'
import { cohortPhrase, companyProfile, globalBenchmarks, isUnscored, lastClosedSurvey } from './derive'
import { useSuperAnalyticsModel } from './useSuperAnalyticsModel'
import { byCount } from '../../../../i18n/plural'

/** What `QualityScoreReading` prints for a reference the quality rule has never run on. */
const EM_DASH = '—'

const SCORE = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const

/** Stands in for the score inside a translated sentence, so the figure can be its own span. */
const SCORE_SLOT = '\u0001'

/** The sentence with its score in a span of its own, in the sans at tabular figures (`.num`). */
function withMonoScore(sentence: string, value: string) {
  const [before, ...rest] = sentence.split(SCORE_SLOT)
  if (rest.length === 0) return sentence
  return (
    <>
      {before}
      <span data-slot="score" className="tabular-nums">
        {value}
      </span>
      {rest.join(value)}
    </>
  )
}

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
 *
 * Apple design (11 Nov): `PageHeader`, `KpiCard`, bordered cards with no shadow, figures in the
 * sans at tabular figures. "Activa" wears the blue live chip and everything else is neutral:
 * "Sin revisar" was amber, and amber means Oportunidad only. The findings are machine-authored,
 * so their card says so (HIG `generative-ai.md` › Transparency).
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
  // `number | null` since #463: an unscored reference carries no number, and the em-dash is
  // what `QualityScoreReading` prints for one. Without this, the one call site below that
  // has no `isUnscored` guard would format a null as "0,00" — a failing grade nobody
  // measured, which is the defect #463 exists to remove.
  const score = (value: number | null) =>
    value === null ? EM_DASH : new Intl.NumberFormat(locale, SCORE).format(value)

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
        <div className="-mb-6">
          <PageHeader
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

        {state.status === 'loading' ? (
            <LoadingState rows={6} label={t('common.loading')} />
          ) : (
            <div className="flex flex-col gap-section">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <KpiCard
                  label={t('superadmin.next.analytics.tiles.own')}
                  value={state.own ? state.own.length.toLocaleString(locale) : EM_DASH}
                  unit={state.own ? t('superadmin.next.analytics.tiles.ownUnit') : undefined}
                  footnote={ownSub}
                />
                <KpiCard
                  label={t('superadmin.next.analytics.tiles.insights')}
                  value={state.insights ? state.insights.length.toLocaleString(locale) : EM_DASH}
                  unit={state.insights ? t('superadmin.next.analytics.tiles.insightsUnit') : undefined}
                  footnote={insightsSub}
                />
                <KpiCard
                  label={t('superadmin.next.analytics.tiles.lastClosed')}
                  value={closed ? closed.code : EM_DASH}
                  unit={
                    closed
                      ? t('superadmin.next.analytics.tiles.lastClosedUnit', { date: calendarDay(Date.parse(closed.endDate), locale) })
                      : undefined
                  }
                  footnote={
                    closed
                      ? t(byCount(closed.responses, 'superadmin.next.analytics.tiles.lastClosedSubOne', 'superadmin.next.analytics.tiles.lastClosedSub'), { count: closed.responses })
                      : state.surveys
                        ? t('superadmin.next.analytics.tiles.lastClosedNone')
                        : t('superadmin.next.unavailable')
                  }
                />
              </div>

              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                <Section id="analytics-refs" title={t('superadmin.next.analytics.refs.heading')} meta={t('superadmin.next.analytics.refs.meta')}>
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
                              ? withMonoScore(
                                  t('superadmin.next.analytics.refs.emptyGlobalOneCompared', {
                                    name: cohortPhrase(globals[0].name, t, locale),
                                    score: SCORE_SLOT,
                                    profile,
                                  }),
                                  score(globals[0].qualityScore),
                                )
                              : isUnscored(globals[0])
                              ? t('superadmin.next.analytics.refs.emptyGlobalOneUnscored', { name: cohortPhrase(globals[0].name, t, locale) })
                              : withMonoScore(
                                  t('superadmin.next.analytics.refs.emptyGlobalOne', { name: cohortPhrase(globals[0].name, t, locale), score: SCORE_SLOT }),
                                  score(globals[0].qualityScore),
                                )
                            : t('superadmin.next.analytics.refs.emptyGlobalMany', { count: globals.length })}
                    </EmptyNote>
                  ) : (
                    <ul className="m-0 flex list-none flex-col p-0">
                      {state.own.map((benchmark, index) => (
                        <li
                          key={benchmark.id}
                          className={`m-0 flex min-h-11 items-center justify-between gap-3 py-2 ${index > 0 ? 'border-t border-line-light' : ''}`}
                        >
                          <span className="min-w-0 truncate text-fg-primary">{benchmark.name}</span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="text-sm tabular-nums text-fg-secondary">
                              {isUnscored(benchmark)
                                ? t('superadmin.next.analytics.refs.unscored')
                                : t('superadmin.next.analytics.refs.quality', { score: score(benchmark.qualityScore) })}
                            </span>
                            <Chip
                              tone={benchmark.isActive ? 'live' : 'neutral'}
                              label={benchmark.isActive ? t('superadmin.next.analytics.refs.active') : t('superadmin.next.analytics.refs.inactive')}
                            />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>

                <Section id="analytics-insights" title={t('navigation.aiInsights')} meta={t('superadmin.next.analytics.insights.meta')}>
                  {state.insightsEnabled === false ? (
                    <EmptyNote icon={<Sparkles />} heading={t('superadmin.next.analytics.insights.disabledTitle')}>
                      {t('superadmin.next.analytics.insights.disabledText')}
                    </EmptyNote>
                  ) : state.insights === null ? (
                    <p className="m-0 text-xs text-fg-secondary">{t('superadmin.next.analytics.loadFailed')}</p>
                  ) : state.insights.length === 0 ? (
                    <EmptyNote icon={<Sparkles />} heading={t('superadmin.next.analytics.insights.emptyTitle')}>
                      <span className="flex flex-col gap-1.5">
                        <span>{t('superadmin.next.analytics.insights.emptyText')}</span>
                        <InsightsLink />
                      </span>
                    </EmptyNote>
                  ) : (
                    <>
                      <span className="self-start">
                        <GeneratedChip />
                      </span>
                      <ul className="m-0 flex list-none flex-col p-0">
                        {state.insights.map((insight, index) => (
                          <li
                            key={insight.id}
                            className={`m-0 flex min-h-11 items-center justify-between gap-3 py-2 ${index > 0 ? 'border-t border-line-light' : ''}`}
                          >
                            <span className="min-w-0 truncate text-fg-primary">{insight.title}</span>
                            <Chip
                              tone="neutral"
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
                </Section>
              </div>
            </div>
          )}
      </div>
    </div>
  )
}

function InsightsLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/analytics/ai-insights"
      className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-accent-blue-ink pointer-fine:min-h-8"
    >
      {t('superadmin.next.analytics.insights.open')}
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </Link>
  )
}

/** A titled card: the canvas's `.card` with its `.ch` header — serif title, quiet meta, a hairline. */
function Section({ id, title, meta, children }: { id: string; title: string; meta?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`${CARD} flex flex-col gap-3 px-5 py-4.5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line-light pb-3">
        <h2 id={id} className="m-0 text-2xl">
          {title}
        </h2>
        {meta && <span className="text-sm text-fg-tertiary">{meta}</span>}
      </div>
      {children}
    </section>
  )
}
