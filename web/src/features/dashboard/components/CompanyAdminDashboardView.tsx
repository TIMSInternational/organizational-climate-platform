import { useCallback } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, CheckCircle2, ClipboardList, FileText, Gauge, Plus, Radio } from 'lucide-react'
import { getCompanyAdminDashboard, type CompanyAdminDashboard } from '../api/dashboard'
import { useDashboardData } from '../useDashboardData'
import {
  belowTarget,
  measurableDepartments,
  organisationResponseRate,
  readDepartments,
  type DepartmentReading,
} from '../companyClimate'
import DashboardState from './DashboardState'
import DashboardSurveyTable from './DashboardSurveyTable'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { JourneyTimeline, PageTopBar, QuickActions, type JourneyStep, type QuickAction } from '../../../components/layout'
import { ClimateMap, KpiTile } from '../../../components/charts'
import { Button, EmptyState } from '../../../components/ui'

interface CompanyAdminDashboardViewProps {
  /**
   * Sent only for a SuperAdmin, who has no tenant of their own and must name one. For a
   * CompanyAdmin this is `undefined` and the **server** decides the scope from their claim
   * — sending an id from the client would be a scope the client chose, which is the shape
   * this endpoint refuses (a CompanyAdmin naming another tenant gets a 403).
   */
  companyId?: string
}

/**
 * One company's overview — **the reference implementation of the redesign.**
 *
 * Reached by a CompanyAdmin always, and by a SuperAdmin who has picked a tenant in the
 * header switcher — see `DashboardPage`.
 *
 * ## The composition, and why it is in this order
 *
 * `PageTopBar` (eyebrow / title / one line / actions) → a four-across row of `KpiTile` →
 * the climate map → the finding that needs attention beside three quick actions → where
 * the cycle stands → the surveys still running. It descends from *what is true* to *what
 * to do about it*: a reader who stops after the map has still learned the state of the
 * organisation, which is the whole argument of the design.
 *
 * Twelve more screens copy this shape, so three conventions are worth naming:
 *
 * 1. **Every reading is `font-mono tabular-nums`; prose stays sans.** `KpiTile` and
 *    `ClimateMap` do it internally, and the sub-lines below do it explicitly. That single
 *    typographic rule is what makes the product read as an instrument.
 * 2. **A withheld cell is drawn, never dropped.** `ClimateMap` hatches a row under the
 *    anonymity floor, and `companyClimate.ts` keeps that row out of the prose as well —
 *    see its module comment for why the two have to agree.
 * 3. **Colour never speaks alone.** The finding below is red *and* says "is behind"; the
 *    clear state is green *and* says "No department is behind".
 *
 * ## What the API cannot yet supply, and what is rendered instead
 *
 * The design's KPI row opens with a climate index and its delta since Q1, and its map is
 * departments × dimensions. `GET /dashboard/company-admin` carries neither: no score, no
 * dimension, no previous period. Nothing here invents one. The map plots the one polarity
 * the payload does support — completed responses per person against the organisation's own
 * rate — and the index tile is absent rather than faked. `companyClimate.ts` documents the
 * measurement; if per-dimension scores ever land, the composition here does not change,
 * only the `dimensions` and `scores` handed to `ClimateMap`.
 *
 * The department table this page used to draw is deliberately gone. It printed
 * `completedResponseCount` for every department including the ones under the floor, which
 * is exactly the figure the map's hatch exists to withhold — the two could not both be
 * right, and the table was the one that was wrong.
 */
export default function CompanyAdminDashboardView({ companyId }: CompanyAdminDashboardViewProps) {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const load = useCallback(
    () => getCompanyAdminDashboard(baseUrl, { companyId, lang: locale }),
    [baseUrl, companyId, locale],
  )
  const { data, loading, failed, error, reload } = useDashboardData(load)

  const readings = readDepartments(data?.departments ?? [])
  const measurable = measurableDepartments(readings)
  const unmeasurable = readings.length - measurable.length
  const target = organisationResponseRate(data)
  const behind = target === null ? [] : belowTarget(measurable, target)
  const worst = behind[0] ?? null

  const quickActions: QuickAction[] = [
    {
      id: 'new-survey',
      label: t('dashboard.newSurvey'),
      description: t('dashboard.newSurveySub'),
      href: '/surveys/new',
      icon: ClipboardList,
    },
    {
      id: 'microclimate',
      label: t('dashboard.runMicroclimate'),
      description: t('dashboard.runMicroclimateSub'),
      href: '/microclimates/new',
      icon: Radio,
    },
    {
      id: 'benchmarks',
      label: t('dashboard.compareBenchmarks'),
      description: t('dashboard.compareBenchmarksSub'),
      href: '/analytics/benchmarks',
      icon: Gauge,
    },
  ]

  return (
    <div>
      <PageTopBar
        // The tenant's name is the eyebrow and "Dashboard" is the title, which is the
        // redesign's header shape: the page is always the same page, and the thing that
        // changes between two SuperAdmin visits is which company it is about.
        eyebrow={data?.companyName ?? null}
        title={t('dashboard.title')}
        description={t('dashboard.organizationInsights')}
        actions={
          <>
            {data && (
              <Button asChild size="sm" variant="default">
                <Link to={`/admin/companies/${data.companyId}/reports`}>
                  <FileText aria-hidden="true" />
                  {t('dashboard.viewReports')}
                </Link>
              </Button>
            )}
            <Button asChild size="sm" variant="primary">
              <Link to="/surveys/new">
                <Plus aria-hidden="true" />
                {t('dashboard.newSurvey')}
              </Link>
            </Button>
          </>
        }
      />

      <DashboardState loading={loading} failed={failed} error={error} onRetry={reload}>
        {data && (
          <div className="flex flex-col gap-section">
            <div className="grid grid-cols-1 gap-panel-gap sm:grid-cols-2 xl:grid-cols-4">
              {/* Not a percentage: this counts responses, not people, so three surveys can
                  put one person on the numerator three times and "150%" would read as a
                  bug rather than as a reading. Stated as a rate per 100 people, which is
                  what it is, and the sub-line gives the two raw counts behind it.
                  `target ?? 0` covers a tenant with no users at all, where there is
                  nothing to divide by and no responses either. */}
              <KpiTile
                label={t('dashboard.responsesPer100')}
                value={target ?? 0}
                locale={locale}
                sub={
                  <span>
                    <span className="font-mono tabular-nums">{data.completedResponseCount}</span>{' '}
                    {t('dashboard.of')}{' '}
                    <span className="font-mono tabular-nums">{data.userCount}</span>
                  </span>
                }
              />
              <KpiTile
                label={t('dashboard.activeSurveys')}
                value={data.activeSurveyCount}
                locale={locale}
                sub={
                  <span>
                    <span className="font-mono tabular-nums">{data.draftSurveyCount}</span>{' '}
                    {t('dashboard.inDraft')}
                  </span>
                }
              />
              <KpiTile
                label={t('dashboard.openActionPlans')}
                value={data.openActionPlanCount}
                locale={locale}
                sub={
                  <span>
                    <span className="font-mono tabular-nums">{data.overdueActionPlanCount}</span>{' '}
                    {t('dashboard.overdueSuffix')}
                  </span>
                }
              />
              {/* Up is bad: one more department behind the organisation is not good news,
                  and the tile would otherwise paint a rising count green. */}
              <KpiTile
                label={t('charts.belowTargetLegend')}
                value={behind.length}
                higherIsBetter={false}
                locale={locale}
                sub={<span>{worst ? worst.name : t('dashboard.noneBelowTarget')}</span>}
              />
            </div>

            <section>
              <SectionHeading>{t('dashboard.responseRateByDepartment')}</SectionHeading>
              {measurable.length > 0 && target !== null ? (
                // The map and its notes sit side by side rather than stacked. Measured at
                // 1440: one dimension makes the whole figure about 450px wide (the legend,
                // not the column, sets that), so stacking left an empty band of panel beside
                // the hero — the reading looked incidental. `flex-wrap` folds them back
                // into one column under about 1000px of panel.
                <div className="flex flex-wrap items-start gap-section rounded-lg border border-line-light bg-surface-icon-box p-3">
                  <div className="min-w-0 max-w-full overflow-x-auto">
                    <ClimateMap
                      dimensions={[
                        {
                          key: 'responseRate',
                          label: t('dashboard.responsesPer100Short'),
                          fullLabel: t('dashboard.responsesPer100Full'),
                        },
                      ]}
                      rows={measurable.map(toClimateRow)}
                      target={target}
                    />
                  </div>
                  {/* `min-w-64`, not `min-w-0`: with nothing stopping it the note column
                      shrank to about 100px beside the map at a 900px viewport and set the
                      Spanish sentence in an eight-line ribbon. A floor makes `flex-wrap`
                      drop it under the map instead, which is what the wrap is for. */}
                  <div className="min-w-64 max-w-prose flex-1">
                    <p className="mb-0 text-xs text-fg-secondary">
                      {t('dashboard.mapTargetNote', { target })}
                    </p>
                    {unmeasurable > 0 && (
                      <p className="mb-0 mt-1 text-xs text-fg-tertiary">
                        {t('dashboard.departmentsWithoutMembers')}{' '}
                        <span className="font-mono tabular-nums">{unmeasurable}</span>
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <EmptyState
                  title={t('dashboard.noDepartmentsYet')}
                  description={t('dashboard.organizeDepartments')}
                />
              )}
            </section>

            <div className="grid grid-cols-1 gap-panel-gap lg:grid-cols-2">
              <section>
                <SectionHeading>{t('dashboard.needsAttention')}</SectionHeading>
                <NeedsAttention worst={worst} target={target} />
              </section>

              <section>
                <SectionHeading>{t('dashboard.quickActions')}</SectionHeading>
                <QuickActions actions={quickActions} columns={3} />
              </section>
            </div>

            <section>
              <SectionHeading>{t('dashboard.cycleHeading')}</SectionHeading>
              <JourneyTimeline
                steps={cycleSteps(data, t, locale)}
                label={t('dashboard.cycleTimelineLabel')}
              />
            </section>

            <section>
              <SectionHeading>{t('dashboard.currentOngoingSurveys')}</SectionHeading>
              {/* Linked: this view's two roles are exactly the two `CanAdminister` admits, so
                  `/surveys/{id}` resolves for them. The department view deliberately does not
                  pass this — see the prop. */}
              <DashboardSurveyTable surveys={data.ongoingSurveys} canOpenSurvey />
            </section>
          </div>
        )}
      </DashboardState>
    </div>
  )
}

/**
 * The 13px semibold heading the redesign puts over every block.
 *
 * An `<h2>` because it sits under the page's one `<h1>` in `PageTopBar`; the size comes
 * from `text-base`, which is this theme's 13px shell default, rather than from the bare
 * `h2` rule (20px), because the redesign's section headings are quieter than its readings
 * on purpose.
 */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-inline text-base">{children}</h2>
}

/** One department as a `ClimateMap` row. `rate` is non-null by construction — see `measurableDepartments`. */
function toClimateRow(reading: DepartmentReading) {
  return {
    id: reading.id,
    label: reading.name,
    // The floor is decided on responses, which is what `ClimateMap` compares against its
    // own `threshold`. Passing the member count instead would hatch the wrong rows.
    responses: reading.completedResponseCount,
    scores: [reading.rate ?? 0],
  }
}

/**
 * The single most important finding, with its evidence and the two things to do about it.
 *
 * Renders the cleared state rather than nothing when no department is behind: an empty
 * panel reads as "not measured", and the whole point of the section is to say whether
 * there is something to act on.
 *
 * `worst` is never a suppressed department — `belowTarget` filters those out — so naming
 * it and quoting its counts publishes nothing the map withholds.
 */
function NeedsAttention({ worst, target }: { worst: DepartmentReading | null; target: number | null }) {
  const { t } = useTranslation()
  const clear = worst === null || target === null

  return (
    <div className="flex gap-inline rounded-lg border border-line-light bg-surface-icon-box p-3">
      <span
        aria-hidden="true"
        className={
          clear
            ? 'flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-green-soft text-accent-green'
            : 'flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-red-soft text-accent-red'
        }
      >
        {clear ? <CheckCircle2 className="size-icon" /> : <AlertTriangle className="size-icon" />}
      </span>
      <div className="min-w-0">
        <p className="mb-0 font-semibold">
          {clear
            ? t('dashboard.attentionClear')
            : t('dashboard.attentionFinding', { department: worst.name })}
        </p>
        <p className="mb-0 mt-0.5 text-sm text-fg-secondary">
          {clear
            ? t('dashboard.attentionClearEvidence', { target: target ?? 0 })
            : t('dashboard.attentionEvidence', {
                completed: worst.completedResponseCount,
                members: worst.memberCount,
                department: worst.name,
                rate: worst.rate ?? 0,
                target: target ?? 0,
              })}
        </p>
        <div className="mt-2 flex flex-wrap gap-inline">
          {/* The action plan is created from the finding, so the finding is what the
              reader is looking at when they start one. */}
          <Button asChild size="sm" variant="primary">
            <Link to="/action-plans">{t('actionPlans.createActionPlan')}</Link>
          </Button>
          <Button asChild size="sm" variant="default">
            <Link to="/surveys">{t('dashboard.viewResponses')}</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Where the survey cycle stands, built from dates the payload actually carries.
 *
 * The status of each survey step comes from its own window rather than from
 * `Status`: the endpoint only returns surveys whose status is `active`
 * (`DashboardEndpoints.CompanyAdminAsync` filters on `SurveyStatuses.Active`), so reading
 * the status field would paint every step the same colour and the done / current / future
 * distinction the design is built on would disappear.
 */
function cycleSteps(data: CompanyAdminDashboard, t: TranslateFn, locale: string): JourneyStep[] {
  const now = Date.now()
  const steps: JourneyStep[] = [...data.ongoingSurveys]
    .sort((left, right) => Date.parse(left.startDate) - Date.parse(right.startDate))
    .map((survey) => {
      const opens = Date.parse(survey.startDate)
      const closes = Date.parse(survey.endDate)
      const status = opens > now ? 'pending' : closes < now ? 'completed' : 'active'
      const timestamp =
        status === 'pending'
          ? t('dashboard.timelineOpens', { date: new Date(opens).toLocaleDateString(locale) })
          : status === 'completed'
            ? t('dashboard.timelineClosed', { date: new Date(closes).toLocaleDateString(locale) })
            : t('dashboard.timelineCloses', { date: new Date(closes).toLocaleDateString(locale) })

      return {
        id: survey.id,
        title: survey.title ?? t('surveys.untitled'),
        description: t('dashboard.timelineResponses', { count: survey.responseCount }),
        timestamp,
        status,
      }
    })

  steps.push({
    id: 'action-plans',
    title: t('dashboard.openActionPlans'),
    description:
      data.overdueActionPlanCount > 0
        ? t('dashboard.timelineOverdue', { count: data.overdueActionPlanCount })
        : t('dashboard.timelineNoneOverdue'),
    timestamp: t('dashboard.timelineOpenCount', { count: data.openActionPlanCount }),
    status: data.openActionPlanCount > 0 ? 'active' : 'pending',
  })

  if (data.draftSurveyCount > 0) {
    steps.push({
      id: 'drafts',
      title: t('dashboard.draftsStep'),
      timestamp: t('dashboard.timelineDraftCount', { count: data.draftSurveyCount }),
      status: 'pending',
    })
  }

  return steps
}
