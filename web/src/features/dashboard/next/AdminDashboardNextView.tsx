import type { ReactNode } from 'react'
import { Link } from 'react-router'
import {
  AlertCircle,
  ArrowRight,
  Clock,
  Download,
  FileText,
  Plus,
  Radio,
  Send,
} from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { ANONYMITY_FLOOR, ClimateMap, KpiTile } from '../../../components/charts'
import { Button, Chip, LoadingRegion, SkeletonText } from '../../../components/ui'
import { useViewerCapabilities, type ViewerCapabilities } from '../../../auth/viewerCapabilities'
import { calendarDay } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import { KpiRow, SectionHeading } from '../components/dashboardGrammar'
import type { AdminDashboardModel, AttentionItem, RegionKey, RegionStatuses, Wave } from './model'
import {
  closedWaveCount,
  daysBetween,
  isBelowTarget,
  latestAverage,
  lowestCell,
  percent,
  percentReading,
  previousAverage,
  protectedRows,
  reading,
  risesInARow,
  signedReading,
} from './derive'
import TrendSparkline from './TrendSparkline'
import CycleTimeline, { type CycleStep } from './CycleTimeline'

/**
 * The body of the redesigned Panel de Control, exactly as the approved mockup:
 * header → where the organisation stands (four tiles) → what moved (six small
 * multiples) beside the map by group → what needs attention beside the cycle.
 *
 * It takes the model as a prop and makes no request: `DashboardPage` hands it
 * `useAdminDashboardModel()`, which composes it from the existing clients region by
 * region (`compose.ts`). `regions` says which of them fell back to the sample; each
 * section names its own in a sentence, beside the chip in the top bar. The
 * same rules as `CompanyAdminDashboardView` hold — every reading is
 * `font-mono tabular-nums`, prose stays sans; a withheld row is drawn hatched,
 * never dropped, and never prints a number (`ClimateMap` with `threshold` at the
 * floor); and no colour carries a change alone.
 */
export default function AdminDashboardNextView({
  model,
  regions,
}: {
  model: AdminDashboardModel
  regions?: RegionStatuses
}) {
  const { t, locale } = useTranslation()
  // Every action below shows only when the server would answer it with something other
  // than 403 — see `auth/viewerCapabilities.ts` for the rule each one mirrors.
  const capabilities = useViewerCapabilities()
  const { target } = model
  const latest = latestAverage(model)
  const previous = previousAverage(model)
  const rises = risesInARow(model)
  const withheld = protectedRows(model, ANONYMITY_FLOOR)
  const completion = percent(model.participation.completed, model.participation.responses)
  const open = model.openSurvey
  const openProgress = open ? percent(open.responses, open.audience) : null
  const waveCodes = model.waves.filter((wave) => wave.status === 'closed').map((wave) => wave.code)
  const dimensionName = (key: string) =>
    model.dimensions.find((dimension) => dimension.key === key)?.name ?? key

  return (
    <div>
      <PageTopBar
        eyebrow={model.companyName}
        title={t('dashboard.next.title')}
        description={t('dashboard.next.description')}
        // The one honest marker on a screen fed by a sample: nobody may read these
        // numbers as measurements while `isSample` holds.
        badge={model.isSample ? { text: t('dashboard.next.sampleChip'), variant: 'warning' } : undefined}
        actions={
          capabilities.canExport || capabilities.canLaunchMicroclimate || capabilities.canAuthorSurveys ? (
            <>
              {capabilities.canExport && (
                <Button size="sm" variant="default" type="button">
                  <Download aria-hidden="true" />
                  {t('dashboard.next.export')}
                </Button>
              )}
              {capabilities.canLaunchMicroclimate && (
                <Button asChild size="sm" variant="default">
                  <Link to="/microclimates/new">
                    <Radio aria-hidden="true" />
                    {t('dashboard.next.launchMicroclimate')}
                  </Link>
                </Button>
              )}
              {capabilities.canAuthorSurveys && (
                <Button asChild size="sm" variant="primary">
                  <Link to="/surveys/new">
                    <Plus aria-hidden="true" />
                    {t('dashboard.next.newSurvey')}
                  </Link>
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-section">
        <section aria-labelledby="next-where">
          <SectionHeading>
            <span id="next-where">{t('dashboard.next.whereHeading')}</span>
          </SectionHeading>
          <RegionNotice regions={regions} region="company" t={t} />
          <KpiRow>
            <KpiTile
              label={t('dashboard.next.climateLabel', { wave: model.latestClosedWave.code })}
              value={latest}
              format={{ kind: 'number', decimals: 2 }}
              previousValue={previous ?? undefined}
              locale={locale}
              changeLabel={
                model.previousWave
                  ? t('dashboard.next.climateVs', { wave: model.previousWave.code })
                  : undefined
              }
              sub={
                <span>
                  · {t('dashboard.next.climateSub', { target: reading(target, locale) })}
                  {rises >= 2 && <> · {t('dashboard.next.risesInARow', { count: rises })}</>}
                </span>
              }
            />
            <KpiTile
              label={t('dashboard.next.participationLabel', { wave: model.latestClosedWave.code })}
              value={model.participation.responses}
              locale={locale}
              sub={
                <span className="flex flex-col">
                  <span>
                    {t('dashboard.next.participationSub', {
                      percent: completion === null ? '—' : percentReading(completion, locale),
                    })}
                  </span>
                  {withheld.map((row) => (
                    <span key={row.departmentId} className="text-fg-label">
                      {t('dashboard.next.participationProtected', {
                        group: row.name,
                        floor: ANONYMITY_FLOOR,
                      })}
                    </span>
                  ))}
                </span>
              }
            />
            <KpiTile
              label={t('dashboard.next.openSurveyLabel', { wave: open?.code ?? '—' })}
              value={open ? open.responses : null}
              locale={locale}
              sub={
                open && (
                  <span className="flex w-full flex-col gap-1.5">
                    <span>
                      {t('dashboard.next.openSurveySub', {
                        audience: open.audience,
                        date: calendarDay(Date.parse(open.closesAt), locale),
                      })}
                    </span>
                    <span
                      role="progressbar"
                      aria-label={t('dashboard.next.openSurveyProgress', {
                        responses: open.responses,
                        audience: open.audience,
                      })}
                      aria-valuemin={0}
                      aria-valuemax={open.audience}
                      aria-valuenow={open.responses}
                      className="block h-1 w-full overflow-hidden rounded-full bg-line-light"
                    >
                      <span
                        className="block h-full rounded-full bg-accent-purple"
                        style={{ width: `${Math.max(openProgress ?? 0, 2)}%` }}
                      />
                    </span>
                  </span>
                )
              }
            />
            <KpiTile
              label={t('dashboard.next.plansLabel')}
              value={model.plans.open}
              locale={locale}
              sub={
                <span className="flex flex-col">
                  <span>{t('dashboard.next.plansOpen')}</span>
                  {model.plans.overdue > 0 && (
                    <span className="flex items-center gap-1 text-accent-red">
                      <AlertCircle aria-hidden="true" className="size-3" />
                      <span className="font-mono tabular-nums">{model.plans.overdue}</span>
                      <span>
                        {t(
                          model.plans.overdue === 1
                            ? 'dashboard.next.plansOverdueOne'
                            : 'dashboard.next.plansOverdueMany',
                          { nodo: model.plans.overdueNodo ?? '—' },
                        )}
                      </span>
                    </span>
                  )}
                </span>
              }
            />
          </KpiRow>
        </section>

        <div className="grid grid-cols-1 gap-panel-gap xl:grid-cols-5">
          <section
            aria-labelledby="next-moved"
            className="rounded-lg border border-line-default bg-surface-card p-card xl:col-span-3"
          >
            <div className="mb-inline flex flex-wrap items-baseline justify-between gap-inline">
              <SectionHeading>
                <span id="next-moved">{t('dashboard.next.movedHeading')}</span>
              </SectionHeading>
              <p className="m-0 text-2xs text-fg-label">
                {t('dashboard.next.movedLegend', {
                  target: reading(target, locale),
                  count: closedWaveCount(model),
                })}
              </p>
            </div>
            <RegionNotice regions={regions} region="trends" t={t} />
            <div className="grid grid-cols-1 gap-panel-gap sm:grid-cols-2 lg:grid-cols-3">
              {model.dimensions.map((dimension) => {
                const value = dimension.values[dimension.values.length - 1]
                const before = dimension.values[dimension.values.length - 2]
                if (value === undefined) return null
                const below = isBelowTarget(value, target)
                return (
                  <div
                    key={dimension.key}
                    data-slot="trend-card"
                    data-dimension={dimension.key}
                    data-below-target={below ? 'true' : 'false'}
                    className="rounded-lg border border-line-light bg-surface-icon-box p-3"
                  >
                    <div className="text-xs text-fg-secondary">{dimension.name}</div>
                    <div className="flex flex-wrap items-baseline gap-inline">
                      <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums">
                        {reading(value, locale)}
                      </span>
                      {before !== undefined && (
                        <span
                          className={cn(
                            'font-mono text-xs tabular-nums',
                            value >= before ? 'text-accent-green' : 'text-accent-red',
                          )}
                        >
                          {signedReading(value - before, locale)}
                        </span>
                      )}
                      {below && <Chip tone="critical" label={t('dashboard.next.belowTarget')} />}
                    </div>
                    <div className="mt-2">
                      <TrendSparkline
                        values={dimension.values}
                        target={target}
                        labels={waveCodes}
                        label={t('dashboard.next.sparklineLabel', {
                          dimension: dimension.name,
                          values: dimension.values.map((v) => reading(v, locale)).join(' → '),
                          target: reading(target, locale),
                        })}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section
            aria-labelledby="next-by-group"
            className="rounded-lg border border-line-default bg-surface-card p-card xl:col-span-2"
          >
            <div className="mb-inline flex flex-wrap items-baseline justify-between gap-inline">
              <SectionHeading>
                <span id="next-by-group">
                  {t('dashboard.next.byGroupHeading', { wave: model.latestClosedWave.code })}
                </span>
              </SectionHeading>
              {/* `GET /surveys/{id}/results` is `CanAdminister` (`SurveyResultsEndpoints.cs:199`):
                  an admin with a company, for any survey of the scoped tenant. */}
              {capabilities.seesWholeCompany && (
                <Link
                  to={`/surveys/${model.latestClosedWave.id}/results`}
                  className="inline-flex items-center gap-1 text-xs text-fg-secondary hover:text-fg-primary"
                >
                  {t('dashboard.next.openResults')}
                  <ArrowRight aria-hidden="true" className="size-3" />
                </Link>
              )}
            </div>
            <RegionNotice regions={regions} region="map" t={t} />
            <div className="overflow-x-auto">
              <ClimateMap
                // Short column heads, full name on hover and for AT: measured at 1440, six
                // full names made the grid wider than its panel and clipped two columns.
                dimensions={model.map.dimensionKeys.map((key) => ({
                  key,
                  label: shortLabel(dimensionName(key)),
                  fullLabel: dimensionName(key),
                }))}
                rows={model.map.rows.map((row) => ({
                  id: row.departmentId,
                  label: row.name,
                  responses: row.responses,
                  scores: row.scores,
                }))}
                target={target}
                deadBandAt={0.1}
                extremeAt={1}
                decimals={1}
                // The floor, and never lower: a row under it is hatched and prints nothing.
                threshold={ANONYMITY_FLOOR}
              />
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 gap-panel-gap xl:grid-cols-5">
          <section aria-labelledby="next-attention" className="xl:col-span-3">
            <SectionHeading>
              <span id="next-attention">{t('dashboard.next.attentionHeading')}</span>
            </SectionHeading>
            <RegionNotice regions={regions} region="actionPlans" t={t} />
            <RegionNotice regions={regions} region="tracking" t={t} />
            <ul
              data-slot="attention-list"
              className="m-0 list-none divide-y divide-line-light rounded-lg border border-line-default bg-surface-card p-0"
            >
              {model.attention.map((item, index) => (
                <AttentionRow
                  key={index}
                  item={item}
                  model={model}
                  t={t}
                  locale={locale}
                  capabilities={capabilities}
                />
              ))}
            </ul>
          </section>

          <section aria-labelledby="next-cycle" className="flex flex-col gap-panel-gap xl:col-span-2">
            <div>
              <SectionHeading>
                <span id="next-cycle">{t('dashboard.next.cycleHeading')}</span>
              </SectionHeading>
              <RegionNotice regions={regions} region="surveys" t={t} />
              <div className="rounded-lg border border-line-default bg-surface-card p-card">
                <CycleTimeline
                  steps={model.waves.map((wave) => toCycleStep(wave, t, locale))}
                  label={t('dashboard.next.cycleLabel')}
                />
                <p className="mt-panel-gap mb-0 flex items-start gap-inline rounded-md bg-surface-icon-box p-3 text-xs text-fg-secondary">
                  <FileText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span>{t('dashboard.next.cycleNote')}</span>
                </p>
              </div>
            </div>
            <RegionNotice regions={regions} region="microclimates" t={t} />
            {model.liveMicroclimate && (
              <div
                data-slot="live-microclimate"
                className="flex items-center justify-between gap-panel-gap rounded-lg border border-line-default bg-surface-card p-card"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-fg-primary">
                    {t('dashboard.next.liveHeading')}
                  </div>
                  <div className="truncate text-xs text-fg-secondary">{model.liveMicroclimate.name}</div>
                  <div className="text-xs text-fg-secondary">
                    <span className="font-mono tabular-nums">{model.liveMicroclimate.responses}</span>{' '}
                    {t('dashboard.next.liveSub', {
                      date: calendarDay(Date.parse(model.liveMicroclimate.closesAt), locale),
                      floor: ANONYMITY_FLOOR,
                    })}
                  </div>
                </div>
                {/* The live page loads `GET /microclimates/{id}/live-results`, which is
                    `CanAccessCompany` (`MicroclimateEndpoints.cs:1420`): the same admin-with-a-company. */}
                {capabilities.seesWholeCompany && (
                  <Link
                    to={`/microclimates/${model.liveMicroclimate.id}/live`}
                    className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-secondary hover:text-fg-primary"
                  >
                    {t('dashboard.next.viewSession')}
                    <ArrowRight aria-hidden="true" className="size-3" />
                  </Link>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

/** The first letters of a column head; the full name rides on `fullLabel`. */
function shortLabel(name: string): string {
  return name.length > 6 ? `${name.slice(0, 5)}…` : name
}

/** One wave on the rail: its code and a status line, with the date in the reader's locale. */
function toCycleStep(wave: Wave, t: TranslateFn, locale: string): CycleStep {
  const detail =
    wave.status === 'closed' && wave.closedAt
      ? t('dashboard.next.waveClosed', { date: calendarDay(Date.parse(wave.closedAt), locale) })
      : wave.status === 'open' && wave.closesAt
        ? t('dashboard.next.waveCloses', { date: calendarDay(Date.parse(wave.closesAt), locale) })
        : t('dashboard.next.wavePlanned')
  return {
    id: wave.id,
    code: wave.status === 'open' ? t('dashboard.next.waveOpen', { code: wave.code }) : wave.code,
    detail,
    status: wave.status,
  }
}

/**
 * The substitution marker `MonoReadings` uses, for the same reason: no sentence in
 * either catalogue contains it, so a placeholder can be swapped for an element
 * after the catalogue has ordered the sentence.
 */
const MARK = '␟'

type RichParam = string | number | { strong: string } | { mono: string }

/**
 * A translated sentence with some of its parameters set as elements: `{ strong }`
 * for the entity the line is about, `{ mono }` for a reading. The catalogue orders
 * the sentence; the markers are swapped back afterwards.
 */
function RichLine({
  t,
  messageKey,
  params,
}: {
  t: TranslateFn
  messageKey: string
  params: Record<string, RichParam>
}) {
  const pieces: ReactNode[] = []
  const marked: Record<string, string | number> = {}
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'object') {
      marked[name] = `${MARK}${pieces.length}${MARK}`
      pieces.push(
        'strong' in value ? (
          <strong className="font-semibold text-fg-primary">{value.strong}</strong>
        ) : (
          <span className="font-mono tabular-nums">{value.mono}</span>
        ),
      )
    } else {
      marked[name] = value
    }
  }
  return (
    <span>
      {t(messageKey, marked)
        .split(MARK)
        .map((piece, index) =>
          index % 2 === 1 ? <span key={index}>{pieces[Number(piece)]}</span> : piece,
        )}
    </span>
  )
}

function AttentionRow({
  item,
  model,
  t,
  locale,
  capabilities,
}: {
  item: AttentionItem
  model: AdminDashboardModel
  t: TranslateFn
  locale: string
  capabilities: ViewerCapabilities
}) {
  const progressOf = (progress: number) =>
    progress === 0 ? t('dashboard.next.noProgress') : percentReading(progress, locale)

  if (item.kind === 'lowest-cell') {
    const cell = lowestCell(model, ANONYMITY_FLOOR)
    if (!cell) return null
    const dimension = model.dimensions.find((d) => d.key === cell.dimensionKey)?.name ?? cell.dimensionKey
    return (
      <AttentionItemRow
        icon={<AlertCircle aria-hidden="true" className="size-4" />}
        tone="critical"
        headline={
          <RichLine
            t={t}
            messageKey="dashboard.next.lowestCellHeadline"
            params={{
              department: { strong: cell.row.name },
              dimension: dimension.toLocaleLowerCase(locale),
              score: { mono: reading(cell.score, locale) },
            }}
          />
        }
        detail={
          item.plan
            ? t('dashboard.next.lowestCellPlanSub', {
                plan: item.plan.name,
                progress: progressOf(item.plan.progress),
              })
            : t('dashboard.next.lowestCellNoPlanSub')
        }
        // Reading an action plan is `CanAccessCompany` (`ActionPlanEndpoints.cs:276-279`):
        // the whole-company viewer, and nobody else. Creating one is `canCreateActionPlan`.
        action={
          item.plan
            ? capabilities.seesWholeCompany
              ? { label: t('dashboard.next.openPlan'), href: `/action-plans/${item.plan.id}` }
              : undefined
            : capabilities.canCreateActionPlan
              ? { label: t('dashboard.next.createPlan'), href: '/action-plans' }
              : undefined
        }
      />
    )
  }

  if (item.kind === 'overdue-plan') {
    return (
      <AttentionItemRow
        icon={<Clock aria-hidden="true" className="size-4" />}
        tone="critical"
        headline={
          <RichLine
            t={t}
            messageKey="dashboard.next.overduePlanHeadline"
            params={{ nodo: { strong: item.nodo }, plan: item.plan.name }}
          />
        }
        detail={t('dashboard.next.overduePlanSub', {
          date: item.plan.dueAt ? calendarDay(Date.parse(item.plan.dueAt), locale) : '—',
          owner: item.plan.owner ?? '—',
          progress: progressOf(item.plan.progress),
        })}
        // `avance` is the node leader's or an admin's (`PlanAccessHandler`); a plan the
        // model knows no node for is offered to admins only, never widened.
        action={
          capabilities.canRecordProgress({ nodoExternalId: item.plan.nodoExternalId ?? '' })
            ? { label: t('dashboard.next.logProgress'), href: `/tracking/planes/${item.plan.id}` }
            : undefined
        }
      />
    )
  }

  const survey = model.openSurvey
  if (!survey || survey.id !== item.surveyId) return null
  const previousRate = percent(model.participation.completed, model.participation.responses)
  return (
    <AttentionItemRow
      icon={<Send aria-hidden="true" className="size-4" />}
      tone="warning"
      headline={
        <RichLine
          t={t}
          messageKey="dashboard.next.lowParticipationHeadline"
          params={{
            survey: { strong: survey.name },
            responses: { mono: survey.responses.toLocaleString(locale) },
            audience: { mono: survey.audience.toLocaleString(locale) },
            days: { mono: daysBetween(model.asOf, survey.closesAt).toLocaleString(locale) },
          }}
        />
      }
      detail={t(
        item.remindersSent === null
          ? 'dashboard.next.lowParticipationSubUnknown'
          : item.remindersSent === 0
            ? 'dashboard.next.lowParticipationSubNoReminder'
            : 'dashboard.next.lowParticipationSubReminders',
        {
          wave: model.latestClosedWave.code,
          percent: previousRate === null ? '—' : percentReading(previousRate, locale),
          count: item.remindersSent ?? 0,
        },
      )}
      // A reminder is a distribution write on the survey, gated like authoring it.
      action={
        capabilities.canAuthorSurveys
          ? { label: t('dashboard.next.sendReminder'), href: `/surveys/${survey.id}/distribution` }
          : undefined
      }
    />
  )
}

function AttentionItemRow({
  icon,
  tone,
  headline,
  detail,
  action,
}: {
  icon: ReactNode
  tone: 'critical' | 'warning'
  headline: ReactNode
  detail: string
  /** Absent when the viewer may not take it: the row still informs, it just offers nothing. */
  action?: { label: string; href: string }
}) {
  return (
    <li data-slot="attention-item" className="flex items-center gap-panel-gap p-3">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          tone === 'critical'
            ? 'bg-accent-red-soft text-accent-red'
            : 'bg-accent-amber-soft text-accent-amber-ink',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-fg-primary">{headline}</div>
        <div className="text-xs text-fg-secondary">{detail}</div>
      </div>
      {action && (
        <Button asChild size="sm" variant="default" className="shrink-0">
          <Link to={action.href}>{action.label}</Link>
        </Button>
      )}
    </li>
  )
}

const REGION_NAME_KEYS: Record<RegionKey, string> = {
  company: 'dashboard.next.regionCompany',
  surveys: 'dashboard.next.regionSurveys',
  trends: 'dashboard.next.regionTrends',
  map: 'dashboard.next.regionMap',
  actionPlans: 'dashboard.next.regionActionPlans',
  tracking: 'dashboard.next.regionTracking',
  microclimates: 'dashboard.next.regionMicroclimates',
}

/**
 * The honest sentence a section carries when its region is the sample: which region,
 * and the server's own reason when it gave one. Drawn nowhere otherwise — a live
 * region says nothing, and neither does a deployment with no tracking service.
 */
function RegionNotice({
  regions,
  region,
  t,
}: {
  regions: RegionStatuses | undefined
  region: RegionKey
  t: TranslateFn
}) {
  const state = regions?.[region]
  if (!state || state.status !== 'fallback') return null
  const name = t(REGION_NAME_KEYS[region])
  return (
    <p
      data-slot="region-fallback"
      data-region={region}
      role="status"
      className="m-0 mb-inline rounded-md bg-accent-amber-soft px-3 py-2 text-xs text-accent-amber-ink"
    >
      {state.reason === 'empty'
        ? t('dashboard.next.fallbackEmpty', { region: name })
        : t('dashboard.next.fallbackRegion', {
            region: name,
            error: state.error ?? t('dashboard.next.fallbackNoReason'),
          })}
    </p>
  )
}

const SECTION_REGIONS: readonly { id: string; headingKey: string; region: RegionKey }[] = [
  { id: 'next-where', headingKey: 'dashboard.next.whereHeading', region: 'company' },
  { id: 'next-moved', headingKey: 'dashboard.next.movedHeading', region: 'trends' },
  { id: 'next-attention', headingKey: 'dashboard.next.attentionHeading', region: 'actionPlans' },
  { id: 'next-cycle', headingKey: 'dashboard.next.cycleHeading', region: 'surveys' },
]

/**
 * The page while its regions load: the same top bar and section headings, each section
 * a skeleton announced by name, so the wait reads as the page arriving and not as an
 * empty one. Rendered by `DashboardPage` until `useAdminDashboardModel` has a model.
 */
export function AdminDashboardNextSkeleton() {
  const { t } = useTranslation()
  return (
    <div>
      <PageTopBar title={t('dashboard.next.title')} description={t('dashboard.next.description')} />
      <div className="flex flex-col gap-section">
        {SECTION_REGIONS.map((section) => (
          <section key={section.id} aria-labelledby={section.id}>
            <SectionHeading>
              <span id={section.id}>{t(section.headingKey)}</span>
            </SectionHeading>
            <LoadingRegion
              loading
              label={t('dashboard.next.loadingRegion', { region: t(REGION_NAME_KEYS[section.region]) })}
            >
              <SkeletonText lines={3} />
            </LoadingRegion>
          </section>
        ))}
      </div>
    </div>
  )
}
